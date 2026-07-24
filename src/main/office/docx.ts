// Markdown → .docx（WordprocessingML）纯 TS 生成器。
// 支持：# ## ### 标题、正文段落、**粗体**/*斜体*/`等宽`、- 无序 & 1. 有序列表、
// | 表格 |、``` 代码块、> 引用、--- 分隔线。中文直接可用（文本层是 UTF-8，字体由 Word 渲染）。
import { writeZip, xmlEsc } from './zip'
import { imageSize } from './imagesize'

const EMU_PER_PX = 9525
const MAX_CONTENT_EMU = 5_486_400 // ≈6 英寸（A4 去页边距后的正文宽）

interface UsedImage {
  rId: string
  name: string
  buf: Buffer
  ext: string
}
interface ImgCtx {
  images: Map<string, Buffer>
  used: UsedImage[]
}

/** ![alt](path) → 内联图片 drawing（按原始宽高比缩放到正文宽内）；找不到图则退回 alt 文本段 */
function imageXml(alt: string, srcPath: string, ctx: ImgCtx): string {
  const buf = ctx.images.get(srcPath)
  const info = buf && imageSize(buf)
  if (!buf || !info) return para(parseInline(alt || srcPath))
  let cx = info.width * EMU_PER_PX
  let cy = info.height * EMU_PER_PX
  if (cx > MAX_CONTENT_EMU) {
    cy = Math.round((cy * MAX_CONTENT_EMU) / cx)
    cx = MAX_CONTENT_EMU
  }
  const n = ctx.used.length + 1
  const rId = `rIdImg${n}`
  ctx.used.push({
    rId,
    name: `media/image${n}.${info.ext === 'jpeg' ? 'jpg' : info.ext}`,
    buf,
    ext: info.ext
  })
  return (
    `<w:p><w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Image${n}"/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="${n}" name="Image${n}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
  )
}

// ---------- 行内解析：**b** *i* `code` → 带样式的 run ----------
interface Run {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
}

function parseInline(text: string): Run[] {
  const runs: Run[] = []
  const re = /(\*\*((?:[^*]|\*(?!\*))+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) })
    if (m[2] !== undefined) runs.push({ text: m[2], bold: true })
    else if (m[4] !== undefined) runs.push({ text: m[4], italic: true })
    else if (m[6] !== undefined) runs.push({ text: m[6], code: true })
    last = m.index + m[0].length
  }
  if (last < text.length) runs.push({ text: text.slice(last) })
  return runs.length ? runs : [{ text: '' }]
}

function runXml(r: Run): string {
  const props: string[] = []
  if (r.bold) props.push('<w:b/>')
  if (r.italic) props.push('<w:i/>')
  if (r.code) props.push('<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>')
  const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : ''
  return `<w:r>${rPr}<w:t xml:space="preserve">${xmlEsc(r.text)}</w:t></w:r>`
}

function para(runs: Run[], opts?: { style?: string; indent?: boolean; bullet?: string }): string {
  const pPr: string[] = []
  if (opts?.style) pPr.push(`<w:pStyle w:val="${opts.style}"/>`)
  if (opts?.indent) pPr.push('<w:ind w:left="420" w:hanging="210"/>')
  const prefix = opts?.bullet ? [{ text: `${opts.bullet} ` }] : []
  return `<w:p>${pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : ''}${[...prefix, ...runs]
    .map(runXml)
    .join('')}</w:p>`
}

function tableXml(rows: string[][]): string {
  const border = 'w:sz="4" w:color="B8B6AE"'
  const cells = (cols: string[], header: boolean): string =>
    `<w:tr>${cols
      .map(
        (c) =>
          `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${para(
            parseInline(c).map((r) => (header ? { ...r, bold: true } : r))
          )}</w:tc>`
      )
      .join('')}</w:tr>`
  return (
    `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>` +
    `<w:tblBorders>` +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((s) => `<w:${s} w:val="single" ${border}/>`)
      .join('') +
    `</w:tblBorders></w:tblPr>` +
    rows.map((r, i) => cells(r, i === 0)).join('') +
    `</w:tbl>`
  )
}

/** markdown 主体 → w:body 内容 */
function bodyXml(markdown: string, imgCtx: ImgCtx): string {
  const out: string[] = []
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    // 图片：整行 ![alt](path)
    const img = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line)
    if (img) {
      out.push(imageXml(img[1], img[2].trim(), imgCtx))
      i++
      continue
    }
    // 代码块
    if (/^```/.test(line)) {
      i++
      const code: string[] = []
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++])
      i++ // 跳过收尾 ```
      for (const c of code) out.push(para([{ text: c, code: true }]))
      continue
    }
    // 表格：连续 | 行；分隔行 |---| 跳过
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cols = lines[i]
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim())
        if (!cols.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cols)
        i++
      }
      if (rows.length) out.push(tableXml(rows))
      continue
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) {
      out.push(para(parseInline(h[2]), { style: `Heading${h[1].length}` }))
    } else if (/^\s*[-*]\s+/.test(line)) {
      out.push(para(parseInline(line.replace(/^\s*[-*]\s+/, '')), { indent: true, bullet: '•' }))
    } else if (/^\s*\d+\.\s+/.test(line)) {
      const n = /^\s*(\d+)\./.exec(line)![1]
      out.push(
        para(parseInline(line.replace(/^\s*\d+\.\s+/, '')), { indent: true, bullet: `${n}.` })
      )
    } else if (/^\s*>\s?/.test(line)) {
      out.push(
        para(
          parseInline(line.replace(/^\s*>\s?/, '')).map((r) => ({ ...r, italic: true })),
          { indent: true }
        )
      )
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push(
        '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:color="B8B6AE"/></w:pBdr></w:pPr></w:p>'
      )
    } else if (line.trim() === '') {
      // 空行不落段（相邻段落自带间距），连续空行只保留节奏
      if (out.length && !out[out.length - 1].endsWith('</w:tbl>')) {
        /* 跳过 */
      }
    } else {
      out.push(para(parseInline(line)))
    }
    i++
  }
  return out.join('')
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
</w:styles>`

/** Markdown → .docx 文件内容。images：`![](path)` 里 path→图片字节（由工具层从工作区读入）。 */
export function markdownToDocx(markdown: string, images?: Map<string, Buffer>): Buffer {
  const imgCtx: ImgCtx = { images: images ?? new Map(), used: [] }
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml(
    markdown,
    imgCtx
  )}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`

  const exts = new Set(imgCtx.used.map((u) => (u.ext === 'jpeg' ? 'jpg' : u.ext)))
  const imgDefaults = [...exts]
    .map((e) => `<Default Extension="${e}" ContentType="image/${e === 'jpg' ? 'jpeg' : e}"/>`)
    .join('')
  const imgRels = imgCtx.used
    .map(
      (u) =>
        `<Relationship Id="${u.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${u.name}"/>`
    )
    .join('')

  return writeZip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>${imgDefaults}
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${imgRels}
</Relationships>`
    },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/document.xml', data: document },
    ...imgCtx.used.map((u) => ({ name: `word/${u.name}`, data: u.buf }))
  ])
}
