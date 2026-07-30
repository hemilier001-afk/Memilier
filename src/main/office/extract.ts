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
  const body = xmlUnesc(text)
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // 页眉/页脚此前完全没读（实测丢失）：法律文书的事务所抬头、页码、落款常放在这里
  const partText = (re: RegExp): string[] => {
    const seen = new Set<string>()
    for (const k of files.keys()) {
      if (!re.test(k)) continue
      const raw = files.get(k)!.toString('utf8')
      const t = xmlUnesc(
        raw
          .replace(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g, '') // 域代码(PAGE/NUMPAGES)不是显示文本
          .replace(/<w:tab[^>]*\/>/g, ' ')
          .replace(/<\/w:p>/g, '\n')
          .replace(/<[^>]+>/g, '')
      )
        .replace(/[ \t]+/g, ' ')
        .trim()
      // 只有页码域的页眉会解析出空串；同内容的多份页眉（首页/奇偶页）去重
      if (t) seen.add(t)
    }
    return [...seen]
  }
  const headers = partText(/^word\/header\d*\.xml$/)
  const footers = partText(/^word\/footer\d*\.xml$/)
  const extra: string[] = []
  if (headers.length) extra.push(`【页眉】${headers.join(' / ')}`)
  if (footers.length) extra.push(`【页脚】${footers.join(' / ')}`)
  return extra.length ? `${extra.join('\n')}\n\n${body}` : body
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
// Excel 把日期存成"序列号"（1899-12-30 起的天数），单元格靠样式的 numFmt 显示成日期。
// 不还原的话，"出生日期"读出来就是 34908 这种数字——模型据此分析必然出错（实测踩过）。
const BUILTIN_DATE_FMT = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])

/** 解析 styles.xml：返回「样式索引 → 是否日期格式」以及是否含时间部分 */
function dateStyles(stylesXml: string): Map<number, 'date' | 'datetime' | 'time'> {
  const out = new Map<number, 'date' | 'datetime' | 'time'>()
  if (!stylesXml) return out
  // 自定义格式：numFmtId → formatCode
  const custom = new Map<number, string>()
  for (const m of stylesXml.matchAll(/<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    custom.set(Number(m[1]), xmlUnesc(m[2]))
  }
  const xfsBlock = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? ''
  let i = 0
  for (const xf of xfsBlock.matchAll(/<xf[^>]*>/g)) {
    const id = Number(/numFmtId="(\d+)"/.exec(xf[0])?.[1] ?? 0)
    let kind: 'date' | 'datetime' | 'time' | null = null
    if (BUILTIN_DATE_FMT.has(id)) {
      kind =
        id >= 18 && id <= 21
          ? 'time'
          : id === 22 || id === 45 || id === 46 || id === 47
            ? 'datetime'
            : 'date'
    } else {
      const code = custom.get(id)
      if (code) {
        // 去掉引号内的字面量与颜色/条件段后再判断，避免把 "y" 这种文字误判成日期
        const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '')
        const hasDate = /[yYmMdD]/.test(bare) && !/^[^ymdYMD]*$/.test(bare)
        const hasTime = /[hHsS]/.test(bare)
        if (hasDate) kind = hasTime ? 'datetime' : 'date'
        else if (hasTime) kind = 'time'
      }
    }
    if (kind) out.set(i, kind)
    i++
  }
  return out
}

/** Excel 序列号 → 可读日期。基准 1899-12-30 已内含 1900 闰年 bug 的补偿 */
function serialToDate(serial: number, kind: 'date' | 'datetime' | 'time'): string {
  if (!Number.isFinite(serial) || serial <= 0) return String(serial)
  const ms = Math.round((serial - 25569) * 86400 * 1000) // 25569 = 1970-01-01 的序列号
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return String(serial)
  const p = (n: number): string => String(n).padStart(2, '0')
  const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
  const time = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  if (kind === 'time') return time
  return kind === 'datetime' ? `${date} ${time}` : date
}

/** 单元格内的换行会把 TSV 打散、整张表列错位（实测：表头"剩余本金\r（元）"断成三行） */
function flattenCell(v: string): string {
  return v.replace(/\r\n|[\r\n]/g, ' ').replace(/\t/g, ' ')
}

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
  const dateFmt = dateStyles(files.get('xl/styles.xml')?.toString('utf8') ?? '')
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
          // 数值 + 日期样式 → 还原成人类可读的日期（否则是 34908 这种序列号）
          const sIdx = Number(/s="(\d+)"/.exec(attrs)?.[1] ?? -1)
          const kind = sIdx >= 0 ? dateFmt.get(sIdx) : undefined
          if (kind && val !== '' && !Number.isNaN(Number(val))) {
            val = serialToDate(Number(val), kind)
          }
        }
        const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1]
        const idx = ref ? colIndex(ref) : cells.length
        while (cells.length < idx) cells.push('')
        cells[idx] = flattenCell(val)
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
    // 演讲者备注（notesSlideN.xml）此前完全没读：讲稿/要点说明常写在这里
    const notes = files.get(`ppt/notesSlides/notesSlide${i + 1}.xml`)?.toString('utf8')
    if (notes) {
      const lines: string[] = []
      for (const p of notes.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? []) {
        const t = [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
          .map((m) => xmlUnesc(m[1]))
          .join('')
          .trim()
        // 备注页里通常混着一个纯数字的页码占位符，过滤掉
        if (t && !/^\d+$/.test(t)) lines.push(t)
      }
      if (lines.length) out.push(`【备注】${lines.join(' ')}`)
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
