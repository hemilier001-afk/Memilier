// PDF 页级操作（纯 TS）：合并 / 拆分 / 抽页 / 旋转。
// 核心是一个装配器 assemble(pages)：从若干源 PDF 里挑出指定页（可旋转），
// 深拷贝每页引用到的全部对象（资源/字体/内容流），重新编号，写出带经典 xref 表的新 PDF。
// 加密 PDF 的流是密文，无法安全拷贝——直接拒绝。
import { inflateRawSync, inflateSync } from 'node:zlib'

interface RawObj {
  dict: string
  stream: Buffer | null
}
interface SourceDoc {
  objs: Map<number, RawObj>
  /** 页对象号，按文档顺序 */
  pageOrder: number[]
}

function tryInflate(buf: Buffer): Buffer | null {
  try {
    return inflateSync(buf)
  } catch {
    try {
      return inflateRawSync(buf)
    } catch {
      return null
    }
  }
}

/** 平衡 << >> 切片（正则切嵌套字典会错） */
function balancedDict(src: string, from = 0): string | null {
  const start = src.indexOf('<<', from)
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < src.length - 1; i++) {
    if (src[i] === '<' && src[i + 1] === '<') {
      depth++
      i++
    } else if (src[i] === '>' && src[i + 1] === '>') {
      depth--
      i++
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return null
}

/** 解析源 PDF → 对象表（保留原始流字节）+ 页顺序。含 /ObjStm 展开。 */
export function parseSource(buf: Buffer): SourceDoc {
  const latin = buf.toString('latin1')
  if (!latin.startsWith('%PDF')) throw new Error('不是有效的 PDF 文件')
  if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(latin)) {
    throw new Error('该 PDF 已加密（受密码保护），无法进行页操作。请先解除保护。')
  }
  const objs = new Map<number, RawObj>()
  const re = /(\d+)\s+(\d+)\s+obj\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(latin))) {
    const num = Number(m[1])
    const bodyStart = m.index + m[0].length
    const end = latin.indexOf('endobj', bodyStart)
    if (end < 0) continue
    const body = latin.slice(bodyStart, end)
    const sIdx = body.search(/stream\r?\n/)
    if (sIdx >= 0) {
      const dict = body.slice(0, sIdx)
      const dataStart = bodyStart + sIdx + (body[sIdx + 6] === '\r' ? 8 : 7)
      // endstream 在整段内的绝对位置
      const sRel = body.lastIndexOf('endstream')
      const dataEnd = bodyStart + sRel
      const stream = buf.subarray(dataStart, dataEnd)
      objs.set(num, { dict, stream: Buffer.from(stream) })
    } else {
      objs.set(num, { dict: body, stream: null })
    }
    re.lastIndex = end + 6
  }
  // ObjStm 展开（PDF1.5+ 常把 Page 字典压在对象流里）
  for (const o of [...objs.values()]) {
    if (!/\/Type\s*\/ObjStm\b/.test(o.dict) || !o.stream) continue
    const inflated = tryInflate(o.stream)
    if (!inflated) continue
    const s = inflated.toString('latin1')
    const n = Number(/\/N\s+(\d+)/.exec(o.dict)?.[1] ?? 0)
    const first = Number(/\/First\s+(\d+)/.exec(o.dict)?.[1] ?? 0)
    if (!n || !first) continue
    const nums = s.slice(0, first).trim().split(/\s+/).map(Number)
    for (let i = 0; i < n; i++) {
      const objNum = nums[i * 2]
      const off = nums[i * 2 + 1]
      if (objNum == null || off == null) break
      const nextOff = i + 1 < n ? nums[(i + 1) * 2 + 1] : undefined
      const content = s.slice(first + off, nextOff != null ? first + nextOff : undefined)
      if (!objs.has(objNum)) objs.set(objNum, { dict: content, stream: null })
    }
  }
  // 页顺序：从 Catalog→Pages 树 DFS（拿不到就退回按对象号收集 /Type /Page）
  const pageOrder = collectPages(objs, latin)
  return { objs, pageOrder }
}

function refNum(dict: string, key: string): number | null {
  const m = new RegExp(`\\/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(dict)
  return m ? Number(m[1]) : null
}

function collectPages(objs: Map<number, RawObj>, latin: string): number[] {
  const rootNum = refNum(latin.slice(latin.lastIndexOf('trailer')), 'Root')
  const order: number[] = []
  const seen = new Set<number>()
  const walk = (num: number, depth: number): void => {
    if (depth > 50 || seen.has(num)) return
    seen.add(num)
    const o = objs.get(num)
    if (!o) return
    if (/\/Type\s*\/Page(?![a-zA-Z])/.test(o.dict)) {
      order.push(num)
      return
    }
    const kids = /\/Kids\s*\[([\s\S]*?)\]/.exec(o.dict)?.[1] ?? ''
    for (const k of kids.matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(k[1]), depth + 1)
  }
  const catalog = rootNum != null ? objs.get(rootNum) : undefined
  const pagesRoot = catalog ? refNum(catalog.dict, 'Pages') : null
  if (pagesRoot != null) walk(pagesRoot, 0)
  if (!order.length) {
    // 退回：按对象号顺序收集所有 Page（顺序可能不完美，但不漏页）
    for (const [num, o] of [...objs.entries()].sort((a, b) => a[0] - b[0])) {
      if (/\/Type\s*\/Page(?![a-zA-Z])/.test(o.dict)) order.push(num)
    }
  }
  return order
}

/** 沿源文档 /Parent 链找可继承属性（MediaBox/Resources/Rotate），内联进页字典 */
function inheritedAttr(objs: Map<number, RawObj>, pageNum: number, key: string): string | null {
  let cur: number | null = pageNum
  for (let up = 0; up < 20 && cur != null; up++) {
    const o = objs.get(cur)
    if (!o) break
    // 内联数组或字典：/MediaBox [..]、/Resources <<..>>
    const arr = new RegExp(`\\/${key}\\s*\\[([^\\]]*)\\]`).exec(o.dict)
    if (arr) return `[${arr[1]}]`
    const kIdx = o.dict.search(new RegExp(`\\/${key}\\b`))
    if (kIdx >= 0) {
      const after = o.dict.slice(kIdx)
      if (/^\/\w+\s*<</.test(after)) {
        const d = balancedDict(after)
        if (d) return d
      }
      const ref = new RegExp(`\\/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(o.dict)
      if (ref) return `${ref[1]} 0 R` // 引用：留给闭包拷贝
    }
    cur = refNum(o.dict, 'Parent')
  }
  return null
}

export interface PagePick {
  doc: SourceDoc
  pageNum: number
  /** 顺时针旋转角度（0/90/180/270），叠加到原 /Rotate 上 */
  rotate?: number
}

/** 装配若干页 → 新 PDF 字节 */
export function assemble(pages: PagePick[]): Buffer {
  if (!pages.length) throw new Error('没有可装配的页面')
  // 1) 逐页：解析出「独立页对象」（内联继承属性、剥掉 /Parent），并收集其引用闭包
  const NEW_CATALOG = 1
  const NEW_PAGES = 2
  let nextNew = 3
  const oldToNew = new Map<string, number>() // `${docIdx}:${oldNum}` → newNum
  const docList: SourceDoc[] = []
  const docIdxOf = (d: SourceDoc): number => {
    let i = docList.indexOf(d)
    if (i < 0) {
      i = docList.length
      docList.push(d)
    }
    return i
  }
  const out: { newNum: number; dict: string; stream: Buffer | null; docIdx: number }[] = []
  const pageRefs: number[] = []

  const assignNew = (docIdx: number, oldNum: number): number => {
    const key = `${docIdx}:${oldNum}`
    let n = oldToNew.get(key)
    if (n == null) {
      n = nextNew++
      oldToNew.set(key, n)
    }
    return n
  }

  for (const pick of pages) {
    const di = docIdxOf(pick.doc)
    const { objs } = pick.doc
    const page = objs.get(pick.pageNum)
    if (!page) continue
    // 闭包：从页对象出发，跟随除 /Parent 外的所有引用
    const closure = new Set<number>()
    const stack = [pick.pageNum]
    while (stack.length) {
      const num = stack.pop()!
      if (closure.has(num)) continue
      closure.add(num)
      const o = objs.get(num)
      if (!o) continue
      const scan = o.dict.replace(/\/Parent\s+\d+\s+\d+\s+R/g, '')
      for (const r of scan.matchAll(/(\d+)\s+(\d+)\s+R/g)) stack.push(Number(r[1]))
    }
    // 预分配闭包内所有对象的新号
    for (const n of closure) assignNew(di, n)
    pageRefs.push(assignNew(di, pick.pageNum))

    // 生成各对象（页对象特殊处理：内联继承属性 + 改 Parent + 旋转）
    for (const n of closure) {
      const o = objs.get(n)!
      let dict = o.dict
      if (n === pick.pageNum) {
        // 补齐继承属性
        for (const key of ['MediaBox', 'Resources']) {
          if (!new RegExp(`\\/${key}\\b`).test(dict)) {
            const inh = inheritedAttr(objs, n, key)
            if (inh) dict = dict.replace(/>>\s*$/, ` /${key} ${inh} >>`)
          }
        }
        // Parent → 新 Pages（用占位符，避免被通用引用重写误伤）
        dict = dict.replace(/\/Parent\s+\d+\s+\d+\s+R/g, '/Parent @@PAGES@@')
        if (!/@@PAGES@@/.test(dict)) dict = dict.replace(/>>\s*$/, ' /Parent @@PAGES@@ >>')
        // 旋转
        if (pick.rotate) {
          const cur = Number(/\/Rotate\s+(-?\d+)/.exec(dict)?.[1] ?? 0)
          const rot = (((cur + pick.rotate) % 360) + 360) % 360
          dict = /\/Rotate\s+-?\d+/.test(dict)
            ? dict.replace(/\/Rotate\s+-?\d+/, `/Rotate ${rot}`)
            : dict.replace(/>>\s*$/, ` /Rotate ${rot} >>`)
        }
      }
      out.push({ newNum: assignNew(di, n), dict, stream: o.stream, docIdx: di })
    }
  }

  // 2) 重写所有对象里的引用号（按各自 doc 的映射）；再落 Parent 占位符
  const rewritten = out.map((obj) => {
    const dict = obj.dict.replace(/(\d+)\s+(\d+)\s+R/g, (whole, a) => {
      const nn = oldToNew.get(`${obj.docIdx}:${Number(a)}`)
      return nn != null ? `${nn} 0 R` : whole
    })
    return {
      newNum: obj.newNum,
      dict: dict.replace(/@@PAGES@@/g, `${NEW_PAGES} 0 R`),
      stream: obj.stream
    }
  })

  // 3) 写出：Catalog + Pages + 各对象，经典 xref
  const parts: Buffer[] = []
  const offsets = new Map<number, number>()
  let pos = 0
  const push = (b: Buffer | string): void => {
    const buf = Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1')
    parts.push(buf)
    pos += buf.length
  }
  push('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n')

  const emitObj = (num: number, dict: string, stream: Buffer | null): void => {
    offsets.set(num, pos)
    if (stream) {
      // /Length 用真实字节数（原始流字节保持不变，仅确保长度正确）
      const d = /\/Length\s+\d+(\s+\d+\s+R)?/.test(dict)
        ? dict.replace(/\/Length\s+\d+(\s+\d+\s+R)?/, `/Length ${stream.length}`)
        : dict.replace(/>>\s*$/, ` /Length ${stream.length} >>`)
      push(`${num} 0 obj\n${d.trim()}\nstream\n`)
      push(stream)
      push('\nendstream\nendobj\n')
    } else {
      push(`${num} 0 obj\n${dict.trim()}\nendobj\n`)
    }
  }

  emitObj(NEW_CATALOG, `<< /Type /Catalog /Pages ${NEW_PAGES} 0 R >>`, null)
  emitObj(
    NEW_PAGES,
    `<< /Type /Pages /Count ${pageRefs.length} /Kids [${pageRefs.map((r) => `${r} 0 R`).join(' ')}] >>`,
    null
  )
  for (const o of rewritten.sort((a, b) => a.newNum - b.newNum)) emitObj(o.newNum, o.dict, o.stream)

  // xref
  const total = nextNew // 0..nextNew-1
  const xrefPos = pos
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`
  for (let i = 1; i < total; i++) {
    const off = offsets.get(i) ?? 0
    xref += `${String(off).padStart(10, '0')} 00000 n \n`
  }
  push(xref)
  push(`trailer\n<< /Size ${total} /Root ${NEW_CATALOG} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`)
  return Buffer.concat(parts)
}

// ---------- 便捷入口 ----------

/** 合并多个 PDF（全页拼接，按传入顺序） */
export function mergePdfs(buffers: Buffer[]): Buffer {
  const picks: PagePick[] = []
  for (const b of buffers) {
    const doc = parseSource(b)
    for (const p of doc.pageOrder) picks.push({ doc, pageNum: p })
  }
  return assemble(picks)
}

/** 解析「1-3,5,8-」式页码（1-based，含端点）→ 0-based 下标数组 */
export function parsePageRange(spec: string, total: number): number[] {
  const out: number[] = []
  for (const part of spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const m = /^(\d+)?\s*-\s*(\d+)?$/.exec(part)
    if (m) {
      const a = m[1] ? Number(m[1]) : 1
      const b = m[2] ? Number(m[2]) : total
      for (let i = a; i <= b; i++) if (i >= 1 && i <= total) out.push(i - 1)
    } else if (/^\d+$/.test(part)) {
      const i = Number(part)
      if (i >= 1 && i <= total) out.push(i - 1)
    }
  }
  return out
}

/** 抽取/拆分：从单个 PDF 取指定页（页码规格如 "1-3,5"），可整体旋转 */
export function extractPages(buf: Buffer, rangeSpec: string, rotate = 0): Buffer {
  const doc = parseSource(buf)
  const idxs = parsePageRange(rangeSpec, doc.pageOrder.length)
  if (!idxs.length)
    throw new Error(`页码范围「${rangeSpec}」未匹配到任何页（共 ${doc.pageOrder.length} 页）`)
  return assemble(idxs.map((i) => ({ doc, pageNum: doc.pageOrder[i], rotate })))
}

/** 旋转：对指定页（或全部）叠加旋转角度 */
export function rotatePages(buf: Buffer, rotate: number, rangeSpec?: string): Buffer {
  const doc = parseSource(buf)
  const total = doc.pageOrder.length
  const idxs = rangeSpec
    ? parsePageRange(rangeSpec, total)
    : Array.from({ length: total }, (_v, i) => i)
  const set = new Set(idxs)
  return assemble(
    doc.pageOrder.map((p, i) => ({ doc, pageNum: p, rotate: set.has(i) ? rotate : 0 }))
  )
}

/** 页数（供工具层校验/提示） */
export function pdfPageCount(buf: Buffer): number {
  return parseSource(buf).pageOrder.length
}
