// Markdown → .docx（WordprocessingML）纯 TS 生成器。
// 支持：# ~ ###### 六级标题、正文段落、**粗体**/*斜体*/`等宽`/~~删除线~~、
// - 无序 & 1. 有序列表（按前导空格分层缩进）、| 表格 |、``` 代码块、> 引用、--- 分隔线、
// ![图](路径) 内嵌图片、<!-- pagebreak --> 分页符。中文直接可用（字体由 Word 渲染）。
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
  strike?: boolean
}

function parseInline(text: string): Run[] {
  const runs: Run[] = []
  const re = /(\*\*((?:[^*]|\*(?!\*))+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(~~([^~]+)~~)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) })
    if (m[2] !== undefined) runs.push({ text: m[2], bold: true })
    else if (m[4] !== undefined) runs.push({ text: m[4], italic: true })
    else if (m[6] !== undefined) runs.push({ text: m[6], code: true })
    else if (m[8] !== undefined) runs.push({ text: m[8], strike: true })
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
  if (r.strike) props.push('<w:strike/>')
  const rPr = props.length ? `<w:rPr>${props.join('')}</w:rPr>` : ''
  return `<w:r>${rPr}<w:t xml:space="preserve">${xmlEsc(r.text)}</w:t></w:r>`
}

function para(
  runs: Run[],
  opts?: {
    style?: string
    indent?: boolean
    bullet?: string
    level?: number
    /** 正文段落首行缩进 2 字符（中文排版惯例）；标题/列表/表格/代码块不用 */
    firstLine?: boolean
  }
): string {
  const pPr: string[] = []
  if (opts?.style) pPr.push(`<w:pStyle w:val="${opts.style}"/>`)
  if (opts?.indent) {
    // 按嵌套层级递增缩进：此前固定 420，导致「一级/二级/三级」看起来完全一样
    const left = 420 + (opts.level ?? 0) * 420
    pPr.push(`<w:ind w:left="${left}" w:hanging="210"/>`)
  } else if (opts?.firstLine) {
    // firstLineChars=200 表示"2 个字符"，随字号自适应，比固定磅值更稳
    pPr.push('<w:ind w:firstLineChars="200"/>')
  }
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
    // 分页符：HTML 注释形式，在其它 Markdown 渲染器里不可见（法律文书常需每份单独起页）
    if (/^\s*<!--\s*(pagebreak|分页)\s*-->\s*$/i.test(line)) {
      out.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
      i++
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      out.push(para(parseInline(h[2]), { style: `Heading${h[1].length}` }))
    } else if (/^\s*[-*]\s+/.test(line)) {
      // 前导空格 → 嵌套层级（2 空格或 1 个 Tab 记一级）
      const lead = /^[\t ]*/.exec(line)![0].replace(/\t/g, '  ').length
      const level = Math.min(Math.floor(lead / 2), 4)
      const marks = ['•', '◦', '▪', '·', '-']
      out.push(
        para(parseInline(line.replace(/^\s*[-*]\s+/, '')), {
          indent: true,
          bullet: marks[level],
          level
        })
      )
    } else if (/^\s*\d+\.\s+/.test(line)) {
      const lead = /^[\t ]*/.exec(line)![0].replace(/\t/g, '  ').length
      const level = Math.min(Math.floor(lead / 2), 4)
      const n = /^\s*(\d+)\./.exec(line)![1]
      out.push(
        para(parseInline(line.replace(/^\s*\d+\.\s+/, '')), {
          indent: true,
          bullet: `${n}.`,
          level
        })
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
      out.push(para(parseInline(line), { firstLine: true }))
    }
    i++
  }
  return out.join('')
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:before="140" w:after="70"/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading5"><w:name w:val="heading 5"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:before="120" w:after="60"/><w:outlineLvl w:val="4"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading6"><w:name w:val="heading 6"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:before="100" w:after="50"/><w:outlineLvl w:val="5"/></w:pPr><w:rPr><w:b/><w:i/><w:sz w:val="22"/></w:rPr></w:style>
</w:styles>`

/** Markdown → .docx 文件内容。images：`![](path)` 里 path→图片字节（由工具层从工作区读入）。 */
export interface DocxOptions {
  /** 页眉文字（法律文书常放事务所抬头/文号） */
  header?: string
  /** 页脚文字；用 {page} 插入当前页码、{pages} 插入总页数 */
  footer?: string
}

export function markdownToDocx(
  markdown: string,
  images?: Map<string, Buffer>,
  opts?: DocxOptions
): Buffer {
  const imgCtx: ImgCtx = { images: images ?? new Map(), used: [] }
  const header = opts?.header?.trim()
  const footer = opts?.footer?.trim()
  // 页脚里的 {page}/{pages} 转成真正的页码域（PAGE / NUMPAGES），否则只是死字
  const fieldRuns = (text: string): string =>
    text
      .split(/(\{page\}|\{pages\})/)
      .filter((x) => x !== '')
      .map((seg) =>
        seg === '{page}' || seg === '{pages}'
          ? `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${
              seg === '{page}' ? 'PAGE' : 'NUMPAGES'
            } </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`
          : `<w:r><w:t xml:space="preserve">${xmlEsc(seg)}</w:t></w:r>`
      )
      .join('')
  const hdrXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr>${fieldRuns(
    header ?? ''
  )}</w:p></w:hdr>`
  const ftrXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr>${fieldRuns(
    footer ?? ''
  )}</w:p></w:ftr>`
  const sectRefs =
    (header ? '<w:headerReference w:type="default" r:id="rIdHdr"/>' : '') +
    (footer ? '<w:footerReference w:type="default" r:id="rIdFtr"/>' : '')
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${bodyXml(
    markdown,
    imgCtx
  )}<w:sectPr>${sectRefs}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992"/></w:sectPr></w:body></w:document>`

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
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>${
        header
          ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
          : ''
      }${
        footer
          ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
          : ''
      }
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
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${imgRels}${
        header
          ? '<Relationship Id="rIdHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>'
          : ''
      }${
        footer
          ? '<Relationship Id="rIdFtr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'
          : ''
      }
</Relationships>`
    },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/document.xml', data: document },
    ...(header ? [{ name: 'word/header1.xml', data: hdrXml }] : []),
    ...(footer ? [{ name: 'word/footer1.xml', data: ftrXml }] : []),
    ...imgCtx.used.map((u) => ({ name: `word/${u.name}`, data: u.buf }))
  ])
}
