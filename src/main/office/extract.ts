// Office/PDF → 纯文本提取（read_document 工具、附件上传、右栏预览共用）。
// docx/xlsx/pptx 走 ZIP+XML 解析（可靠）；PDF 为尽力而为的内置解析
// （文本型 PDF 可提取；扫描件/CID 嵌入字体编码的提取有限，结果里如实说明）。
import { randomUUID } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readZip, xmlUnesc } from './zip'
import { extractPdfText } from './pdfread'
import { runOcr } from './ocr'
import { csvToDisplay } from './csv'

const MAX_INPUT_BYTES = 20 * 1024 * 1024

export const OFFICE_EXTS = ['.docx', '.xlsx', '.pptx', '.pdf', '.csv', '.tsv'] as const
export function isOfficeFile(name: string): boolean {
  const lower = name.toLowerCase()
  return OFFICE_EXTS.some((e) => lower.endsWith(e))
}

function assertSize(buf: Buffer): void {
  if (buf.length > MAX_INPUT_BYTES) throw new Error('文件超过 20MB，暂不支持提取')
}

// ---------- Word ----------
export function extractDocx(buf: Buffer): string {
  assertSize(buf)
  const files = readZip(buf)
  let doc = files.get('word/document.xml')?.toString('utf8')
  if (!doc) throw new Error('未找到 word/document.xml（可能不是 .docx）')
  // 表格先转 TSV（行=换行、单元格=tab），否则全部拍平成换行丢失行列结构
  doc = doc.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (tbl) => {
    const trs = tbl.match(/<w:tr[\s\S]*?<\/w:tr>/g) ?? []
    const lines = trs.map((tr) =>
      (tr.match(/<w:tc[\s\S]*?<\/w:tc>/g) ?? [])
        .map((tc) =>
          tc
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        )
        .join('\t')
    )
    return `\n${lines.join('\n')}\n`
  })
  const text = doc
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
  return xmlUnesc(text)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** docx 批注 + 修订（增删痕迹）提取：法律/协作审阅用。无则返回空串。 */
export function extractDocxRevisions(buf: Buffer): string {
  const files = readZip(buf)
  const out: string[] = []
  const runsText = (xml: string): string =>
    xmlUnesc(xml.replace(/<w:tab[^>]*\/>/g, '\t').replace(/<[^>]+>/g, '')).trim()

  // 批注（word/comments.xml）
  const comments = files.get('word/comments.xml')?.toString('utf8')
  if (comments) {
    const items = comments.match(/<w:comment\b[\s\S]*?<\/w:comment>/g) ?? []
    if (items.length) {
      out.push('【批注】')
      for (const c of items) {
        const author = /w:author="([^"]*)"/.exec(c)?.[1] ?? '匿名'
        const date = /w:date="([^"]*)"/.exec(c)?.[1]?.slice(0, 10) ?? ''
        const txt = runsText(c).replace(/\s+/g, ' ')
        if (txt) out.push(`- ${author}${date ? `（${date}）` : ''}：${txt}`)
      }
    }
  }

  // 修订：<w:ins>=插入、<w:del>=删除（删除文字在 <w:delText>）
  const doc = files.get('word/document.xml')?.toString('utf8') ?? ''
  const ins = (doc.match(/<w:ins\b[\s\S]*?<\/w:ins>/g) ?? [])
    .map((x) => ({ author: /w:author="([^"]*)"/.exec(x)?.[1] ?? '匿名', text: runsText(x) }))
    .filter((x) => x.text)
  const del = (doc.match(/<w:del\b[\s\S]*?<\/w:del>/g) ?? [])
    .map((x) => ({
      author: /w:author="([^"]*)"/.exec(x)?.[1] ?? '匿名',
      text: xmlUnesc(
        (x.match(/<w:delText[^>]*>([\s\S]*?)<\/w:delText>/g) ?? [])
          .map((d) => d.replace(/<[^>]+>/g, ''))
          .join('')
      ).trim()
    }))
    .filter((x) => x.text)
  if (ins.length || del.length) {
    out.push('【修订痕迹】')
    for (const x of ins) out.push(`+ 插入（${x.author}）：${x.text.replace(/\s+/g, ' ')}`)
    for (const x of del) out.push(`- 删除（${x.author}）：${x.text.replace(/\s+/g, ' ')}`)
  }
  return out.join('\n')
}

// ---------- Excel ----------
export function extractXlsx(buf: Buffer): string {
  assertSize(buf)
  const files = readZip(buf)
  // 共享字符串表：<si> 内可能有多个 <t>（富文本分片），拼起来
  const shared: string[] = []
  const ss = files.get('xl/sharedStrings.xml')?.toString('utf8')
  if (ss) {
    for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      const ts = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => xmlUnesc(m[1]))
      shared.push(ts.join(''))
    }
  }
  // 工作表名（workbook.xml 里的顺序即 sheet1..N 的顺序）
  const wb = files.get('xl/workbook.xml')?.toString('utf8') ?? ''
  const names = [...wb.matchAll(/<sheet[^>]*name="([^"]*)"/g)].map((m) => xmlUnesc(m[1]))
  const sheets = [...files.keys()]
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
  const out: string[] = []
  sheets.forEach((key, idx) => {
    const xml = files.get(key)!.toString('utf8')
    out.push(`=== 工作表：${names[idx] ?? `Sheet${idx + 1}`} ===`)
    for (const row of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? []) {
      const cells: string[] = []
      // 按 r="C5" 的列引用对位：稀疏行（有空单元格）不再把后面的值顶到前面的列
      const colIndex = (ref: string): number => {
        let n = 0
        for (const ch of ref) {
          if (ch >= 'A' && ch <= 'Z') n = n * 26 + (ch.charCodeAt(0) - 64)
          else break
        }
        return n - 1
      }
      for (const m of row.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = m[1]
        const body = m[2]
        const t = /t="([^"]+)"/.exec(attrs)?.[1]
        let val: string
        if (t === 's') {
          const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
          val = shared[Number(v)] ?? ''
        } else if (t === 'inlineStr') {
          val = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => xmlUnesc(x[1])).join('')
        } else {
          const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
          val = v ? xmlUnesc(v) : ''
        }
        const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1]
        const idx = ref ? colIndex(ref) : cells.length
        while (cells.length < idx) cells.push('')
        cells[idx] = val
      }
      if (cells.some((c) => c !== '')) out.push(cells.join('\t'))
    }
  })
  return out.join('\n').trim()
}

// ---------- PowerPoint ----------
export function extractPptx(buf: Buffer): string {
  assertSize(buf)
  const files = readZip(buf)
  const slides = [...files.keys()]
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
  if (!slides.length) throw new Error('未找到幻灯片（可能不是 .pptx）')
  const out: string[] = []
  slides.forEach((key, i) => {
    const xml = files.get(key)!.toString('utf8')
    out.push(`--- 幻灯片 ${i + 1} ---`)
    // 每个段落 <a:p> 一行；段内文本 run <a:t> 直接拼接
    for (const p of xml.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? []) {
      const ts = [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => xmlUnesc(m[1]))
      const line = ts.join('').trim()
      if (line) out.push(line)
    }
  })
  return out.join('\n').trim()
}

// ---------- PDF ----------
// 完整解析见 pdfread.ts：对象表（含 ObjStm 展开）→ ToUnicode CMap → 按页字体跟踪解码，
// 中文等 CID 编码可正常还原；扫描件（纯图片）无文字层——由 extractPdfSmart 走 OCR 回退。
export function extractPdf(buf: Buffer): string {
  assertSize(buf)
  return extractPdfText(buf)
}

/** PDF 提取 + 扫描件 OCR 回退（macOS 用系统 Vision 引擎；不可用时保留如实提示） */
async function extractPdfSmart(buf: Buffer): Promise<string> {
  const parsed = extractPdf(buf)
  const failed = parsed.startsWith('（未能从该 PDF') || parsed.startsWith('（该 PDF 已加密')
  if (!failed) return parsed
  // 落临时文件供 OCR 进程读取（CGPDFDocument 需要文件路径；空口令加密件也能渲染）
  const tmp = path.join(os.tmpdir(), `hemi-ocr-${randomUUID()}.pdf`)
  try {
    await fsp.writeFile(tmp, buf)
    const ocr = await runOcr(tmp, 20)
    if (ocr) {
      return `[扫描/图像型 PDF · 已用本机 OCR（Apple Vision）识别，内容可能存在识别误差]\n\n${ocr}`
    }
  } finally {
    void fsp.rm(tmp, { force: true })
  }
  return parsed
}

/** 按扩展名分发提取（附件上传 / read_document / 右栏预览共用入口）。
 *  revisions=true 时，docx 追加批注/修订痕迹（审阅用）。 */
export async function extractAny(name: string, buf: Buffer, revisions = false): Promise<string> {
  const lower = name.toLowerCase()
  if (lower.endsWith('.docx')) {
    const body = extractDocx(buf)
    if (!revisions) return body
    const rev = extractDocxRevisions(buf)
    return rev ? `${body}\n\n${rev}` : `${body}\n\n（无批注或修订痕迹）`
  }
  if (lower.endsWith('.xlsx')) return extractXlsx(buf)
  if (lower.endsWith('.pptx')) return extractPptx(buf)
  if (lower.endsWith('.pdf')) return extractPdfSmart(buf)
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) {
    assertSize(buf)
    return csvToDisplay(buf.toString('utf8'), lower.endsWith('.tsv') ? '\t' : undefined)
  }
  if (/\.(doc|xls|ppt)$/.test(lower)) {
    throw new Error(
      '旧版二进制格式（.doc/.xls/.ppt）不支持：请先在 Office 里另存为 .docx/.xlsx/.pptx'
    )
  }
  throw new Error('不支持的文档格式')
}
