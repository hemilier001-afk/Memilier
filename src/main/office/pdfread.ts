// 纯 TS 的 PDF 文本提取（第二版：支持中文等 CID 编码）。
// 关键：现代 PDF（Word/WPS/Chrome 导出）用嵌入字体 + CID 编码，字节流里没有明文——
// 必须解析每个字体的 /ToUnicode CMap（CID → Unicode 映射表）才能还原文字。
// 流程：解析对象表（含 /ObjStm 压缩对象流展开）→ 逐页取 /Resources 字体的 CMap →
// 内容流里跟踪 Tf 字体切换，把 <hex>/(literal) 字符串经当前字体 CMap 解码。
// 扫描件（纯图片）仍无文字可提，如实说明。
import { inflateRawSync, inflateSync } from 'node:zlib'

interface PdfObj {
  dict: string
  stream?: Buffer
}

interface CMap {
  /** 源编码字节数（bfchar 源码 hex 长度/2；CID 通常 2） */
  codeBytes: number
  map: Map<number, string>
  /** 无 ToUnicode 但编码为 UniXX-UCS2：串字节直接按 UTF-16BE 解 */
  identityUtf16?: boolean
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

/** ASCII85 解码（ReportLab 等生成器常用 [/ASCII85Decode /FlateDecode] 链） */
function ascii85Decode(s: string): Buffer {
  const end = s.indexOf('~>')
  const data = (end >= 0 ? s.slice(0, end) : s).replace(/^<~/, '')
  const out: number[] = []
  let tuple = 0
  let count = 0
  for (let i = 0; i < data.length; i++) {
    const ch = data[i]
    if (ch === 'z' && count === 0) {
      out.push(0, 0, 0, 0)
      continue
    }
    const c = data.charCodeAt(i) - 33
    if (c < 0 || c > 84) continue // 空白等一律跳过
    tuple = tuple * 85 + c
    count++
    if (count === 5) {
      out.push((tuple >>> 24) & 255, (tuple >>> 16) & 255, (tuple >>> 8) & 255, tuple & 255)
      tuple = 0
      count = 0
    }
  }
  if (count > 0) {
    for (let i = count; i < 5; i++) tuple = tuple * 85 + 84
    const bytes = [(tuple >>> 24) & 255, (tuple >>> 16) & 255, (tuple >>> 8) & 255, tuple & 255]
    out.push(...bytes.slice(0, count - 1))
  }
  return Buffer.from(out)
}

/** 按 /Filter 声明的滤镜链解码；未知滤镜（LZW/DCT/JPX/CCITT…）返回 undefined=不可解，
 *  绝不把未解码的生字节当文本流用（否则压缩数据里的巧合字节会被当成乱码"文本"提出来） */
function decodeStream(dict: string, raw: Buffer): Buffer | undefined {
  const fm = /\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/.exec(dict)
  if (!fm) return raw
  if (/\/Predictor\s+([2-9]|1[0-5])\b/.test(dict)) return undefined // 带预测器的不解（多为 xref 流）
  const names = [...fm[1].matchAll(/\/([A-Za-z0-9]+)/g)].map((x) => x[1])
  let buf = raw
  for (const n of names) {
    if (n === 'FlateDecode' || n === 'Fl') {
      const d = tryInflate(buf)
      if (!d) return undefined
      buf = d
    } else if (n === 'ASCII85Decode' || n === 'A85') {
      buf = ascii85Decode(buf.toString('latin1'))
    } else if (n === 'ASCIIHexDecode' || n === 'AHx') {
      const h = buf
        .toString('latin1')
        .split('>')[0]
        .replace(/[^0-9A-Fa-f]/g, '')
      buf = Buffer.from(h.length % 2 ? `${h}0` : h, 'hex')
    } else {
      return undefined
    }
  }
  return buf
}

/** 十六进制（UTF-16BE 语义）→ 字符串（含代理对） */
function hexToUnicode(hex: string): string {
  const clean = hex.replace(/\s/g, '')
  if (clean.length % 4 !== 0) {
    // 非 2 字节对齐：按 1 字节 latin 兜底
    const b = Buffer.from(clean.length % 2 ? clean.slice(0, -1) : clean, 'hex')
    return b.toString('latin1')
  }
  const b = Buffer.from(clean, 'hex')
  const swapped = Buffer.alloc(b.length)
  for (let i = 0; i + 1 < b.length; i += 2) {
    swapped[i] = b[i + 1]
    swapped[i + 1] = b[i]
  }
  return swapped.toString('utf16le')
}

// ---------- 对象表 ----------
function parseObjects(latin: string): Map<number, PdfObj> {
  const objs = new Map<number, PdfObj>()
  const re = /(\d+)\s+\d+\s+obj\b/g
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
      const dataStart = sIdx + (body[sIdx + 6] === '\r' ? 8 : 7)
      const sEnd = body.lastIndexOf('endstream')
      const raw = Buffer.from(body.slice(dataStart, sEnd < 0 ? undefined : sEnd), 'latin1')
      objs.set(num, { dict, stream: decodeStream(dict, raw) })
    } else {
      objs.set(num, { dict: body })
    }
    re.lastIndex = end + 6
  }
  // /ObjStm 压缩对象流展开（PDF 1.5+：Word/Acrobat 常把字体字典藏在这里面）
  for (const o of [...objs.values()]) {
    if (!/\/Type\s*\/ObjStm\b/.test(o.dict) || !o.stream) continue
    const n = Number(/\/N\s+(\d+)/.exec(o.dict)?.[1] ?? 0)
    const first = Number(/\/First\s+(\d+)/.exec(o.dict)?.[1] ?? 0)
    if (!n || !first) continue
    const s = o.stream.toString('latin1')
    const nums = s.slice(0, first).trim().split(/\s+/).map(Number)
    for (let i = 0; i < n; i++) {
      const objNum = nums[i * 2]
      const off = nums[i * 2 + 1]
      if (objNum == null || off == null) break
      const nextOff = i + 1 < n ? nums[(i + 1) * 2 + 1] : undefined
      const content = s.slice(first + off, nextOff != null ? first + nextOff : undefined)
      if (!objs.has(objNum)) objs.set(objNum, { dict: content })
    }
  }
  return objs
}

// ---------- 字典工具（平衡的 << >> 切片；正则切嵌套字典会切飞） ----------
function balancedDict(src: string, from: number): string | null {
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

/** 取 /Key 的值：间接引用返回对象 dict；内联字典返回切片；否则 null */
function dictValue(dict: string, key: string, objs: Map<number, PdfObj>): string | null {
  const kIdx = dict.search(new RegExp(`\\/${key}(?![A-Za-z0-9])`))
  if (kIdx < 0) return null
  const after = dict.slice(kIdx + key.length + 1)
  const ref = /^\s*(\d+)\s+\d+\s+R/.exec(after)
  if (ref) return objs.get(Number(ref[1]))?.dict ?? null
  if (/^\s*<</.test(after)) return balancedDict(after, 0)
  return null
}

// ---------- ToUnicode CMap ----------
function parseCMap(s: string): CMap {
  const map = new Map<number, string>()
  let codeBytes = 2
  for (const seg of s.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    for (const pair of seg.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      codeBytes = Math.max(1, Math.round(pair[1].length / 2))
      map.set(parseInt(pair[1], 16), hexToUnicode(pair[2]))
    }
  }
  for (const seg of s.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    // 形式1：<lo> <hi> <dst>；形式2：<lo> <hi> [<d1> <d2> …]
    const re =
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[((?:\s*<[0-9A-Fa-f]+>\s*)+)\])/g
    let m: RegExpExecArray | null
    while ((m = re.exec(seg))) {
      const lo = parseInt(m[1], 16)
      const hi = parseInt(m[2], 16)
      codeBytes = Math.max(1, Math.round(m[1].length / 2))
      if (hi - lo > 65_535) continue // 防呆
      if (m[3] != null) {
        const dstBase = parseInt(m[3], 16)
        const width = m[3].length
        for (let c = lo; c <= hi; c++) {
          map.set(c, hexToUnicode((dstBase + (c - lo)).toString(16).padStart(width, '0')))
        }
      } else if (m[4]) {
        const dsts = [...m[4].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => x[1])
        dsts.forEach((d, i) => {
          if (lo + i <= hi) map.set(lo + i, hexToUnicode(d))
        })
      }
    }
  }
  return { codeBytes, map }
}

/** 字体对象 → CMap（带缓存；无 ToUnicode 返回 null=按 latin 处理） */
function cmapForFont(
  fontDict: string,
  objs: Map<number, PdfObj>,
  cache: Map<number, CMap | null>
): CMap | null {
  const ref = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(fontDict)
  if (!ref) {
    // 无 ToUnicode 但用标准 UCS2 编码 CMap：串字节本身就是 UTF-16BE，可直接解
    if (/\/Encoding\s*\/Uni(GB|CNS|JIS|KS)-(UCS2|UTF16)-[HV]/.test(fontDict)) {
      return { codeBytes: 2, map: new Map(), identityUtf16: true }
    }
    return null
  }
  const num = Number(ref[1])
  if (cache.has(num)) return cache.get(num)!
  const stream = objs.get(num)?.stream
  const cm = stream ? parseCMap(stream.toString('latin1')) : null
  cache.set(num, cm && cm.map.size ? cm : null)
  return cache.get(num)!
}

// ---------- 内容流解码 ----------
function unescapeLiteral(s: string): Buffer {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c !== '\\') {
      out.push(s.charCodeAt(i) & 0xff)
      continue
    }
    const n = s[i + 1]
    if (n === 'n') out.push(10)
    else if (n === 'r') out.push(13)
    else if (n === 't') out.push(9)
    else if (n === 'b' || n === 'f') out.push(32)
    else if (n >= '0' && n <= '7') {
      const oct = /^[0-7]{1,3}/.exec(s.slice(i + 1))![0]
      out.push(parseInt(oct, 8) & 0xff)
      i += oct.length
      continue
    } else if (n === '\n') {
      i++
      continue
    } else out.push(s.charCodeAt(i + 1) & 0xff)
    i++
  }
  return Buffer.from(out)
}

function decodeBytes(bytes: Buffer, cmap: CMap | null): string {
  if (!cmap) {
    const t = bytes.toString('latin1')
    // 全是可打印 ASCII 才当明文；否则是没有 ToUnicode 的 CID 乱码，丢弃
    return /^[\x20-\x7e\t\r\n]*$/.test(t) ? t : ''
  }
  if (cmap.identityUtf16) {
    const swapped = Buffer.alloc(bytes.length - (bytes.length % 2))
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      swapped[i] = bytes[i + 1]
      swapped[i + 1] = bytes[i]
    }
    return swapped.toString('utf16le')
  }
  let out = ''
  const w = cmap.codeBytes
  for (let i = 0; i + w <= bytes.length; i += w) {
    let code = 0
    for (let k = 0; k < w; k++) code = (code << 8) | bytes[i + k]
    out += cmap.map.get(code) ?? ''
  }
  return out
}

function textFromContent(content: string, fonts: Map<string, CMap | null>): string {
  let cur: CMap | null = fonts.size === 1 ? [...fonts.values()][0] : null
  const parts: string[] = []
  let lastTmY: number | null = null
  // 断行按「垂直位移」判断：Skia/Chromium 对同一行的每个字形单独 Td(x,0) 定位，
  // 逢 Td 就断行会把一行打散成一字一行；只有 y 分量变化才是真换行。
  const re =
    /\/([^\s/<>()[\]{}]+)\s+[-\d.]+\s+Tf|\(((?:\\.|[^\\()])*)\)\s*(?:Tj|'|")|<([0-9A-Fa-f\s]+)>\s*(?:Tj|'|")|\[((?:\\.|[^\]])*)\]\s*TJ|[-\d.]+\s+([-\d.]+)\s+(?:Td|TD)\b|((?:[-\d.]+\s+){6})Tm\b|(T\*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content))) {
    if (m[1] !== undefined) {
      if (fonts.has(m[1])) cur = fonts.get(m[1])!
    } else if (m[2] !== undefined) {
      parts.push(decodeBytes(unescapeLiteral(m[2]), cur))
    } else if (m[3] !== undefined) {
      const hex = m[3].replace(/\s/g, '')
      if (!cur && hex.toUpperCase().startsWith('FEFF')) parts.push(hexToUnicode(hex.slice(4)))
      else parts.push(decodeBytes(Buffer.from(hex.length % 2 ? hex.slice(0, -1) : hex, 'hex'), cur))
    } else if (m[4] !== undefined) {
      // TJ 数组：内含多个 () / <> 分段
      for (const el of m[4].matchAll(/\(((?:\\.|[^\\()])*)\)|<([0-9A-Fa-f\s]+)>/g)) {
        if (el[1] !== undefined) parts.push(decodeBytes(unescapeLiteral(el[1]), cur))
        else {
          const hx = el[2].replace(/\s/g, '')
          parts.push(decodeBytes(Buffer.from(hx.length % 2 ? hx.slice(0, -1) : hx, 'hex'), cur))
        }
      }
    } else if (m[5] !== undefined) {
      if (Math.abs(parseFloat(m[5])) > 0.1) parts.push('\n') // Td/TD：y 相对位移≠0 才换行
    } else if (m[6] !== undefined) {
      const nums = m[6].trim().split(/\s+/).map(Number)
      const y = nums[5] // Tm 矩阵第 6 个数 = 绝对 y
      if (lastTmY !== null && Math.abs(y - lastTmY) > 0.5) parts.push('\n')
      lastTmY = y
    } else if (m[7] !== undefined) {
      parts.push('\n') // T* 恒为换行
    }
  }
  return parts.join('')
}

// ---------- 主入口 ----------
export function extractPdfText(buf: Buffer): string {
  const latin = buf.toString('latin1')
  if (!latin.startsWith('%PDF')) throw new Error('不是有效的 PDF 文件')
  // 加密文档（哪怕空口令）流都是密文，解出来只会是乱码——直接如实说明
  if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(latin)) {
    return '（该 PDF 已加密（受密码保护），无法提取文本。请提供解除保护后的版本。）'
  }
  const objs = parseObjects(latin)
  const cmapCache = new Map<number, CMap | null>()
  const pageTexts: string[] = []

  // 逐页：/Type /Page → Resources（可继承自 /Parent）→ /Font 名称→CMap → /Contents 解码
  for (const [, obj] of objs) {
    if (!/\/Type\s*\/Page(?![a-zA-Z])/.test(obj.dict)) continue
    // Resources 沿 Parent 链向上找（最多 5 层）
    let res: string | null = null
    let cursor: string | null = obj.dict
    for (let up = 0; up < 5 && cursor; up++) {
      res = dictValue(cursor, 'Resources', objs)
      if (res) break
      const parent = /\/Parent\s+(\d+)\s+\d+\s+R/.exec(cursor)
      cursor = parent ? (objs.get(Number(parent[1]))?.dict ?? null) : null
    }
    const fonts = new Map<string, CMap | null>()
    const fontDict = res ? dictValue(res, 'Font', objs) : null
    if (fontDict) {
      for (const f of fontDict.matchAll(/\/([^\s/<>()[\]{}]+)\s+(\d+)\s+\d+\s+R/g)) {
        const fObj = objs.get(Number(f[2]))
        if (fObj) fonts.set(f[1], cmapForFont(fObj.dict, objs, cmapCache))
      }
    }
    // Contents：单引用或数组
    const contentBufs: Buffer[] = []
    const single = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(obj.dict)
    const arr = /\/Contents\s*\[([^\]]*)\]/.exec(obj.dict)
    const refs = single
      ? [Number(single[1])]
      : arr
        ? [...arr[1].matchAll(/(\d+)\s+\d+\s+R/g)].map((x) => Number(x[1]))
        : []
    for (const r of refs) {
      const st = objs.get(r)?.stream
      if (st) contentBufs.push(st)
    }
    if (!contentBufs.length) continue
    const text = textFromContent(Buffer.concat(contentBufs).toString('latin1'), fonts)
    if (text.trim()) pageTexts.push(text.replace(/\n{3,}/g, '\n\n').trim())
  }

  const out = pageTexts.join('\n\n')
  if (out.trim()) return out

  // 兜底：没有页面结构（极简/非标准 PDF）→ 全局扫描所有含文本算子的流（latin 明文路径）
  const chunks: string[] = []
  for (const o of objs.values()) {
    if (!o.stream) continue
    const sc = o.stream.toString('latin1')
    if (/\b(Tj|TJ)\b/.test(sc)) chunks.push(sc)
  }
  if (!chunks.length && /\b(Tj|TJ)\b/.test(latin)) chunks.push(latin)
  const fallback = chunks
    .map((c) => textFromContent(c, new Map()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (fallback) return fallback
  return '（未能从该 PDF 提取到文本：可能是扫描件（纯图片），或字体未携带 ToUnicode 映射表。可尝试让用户提供文字版，或使用带 OCR 的外部工具。）'
}
