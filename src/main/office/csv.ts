// CSV/TSV 读写（纯 TS）。读：正规解析（含引号包裹、字段内逗号/换行、"" 转义）；
// 写：按 RFC4180 转义（含分隔符/引号/换行的字段加引号）。中文与 Excel 兼容（写出带 UTF-8 BOM）。

/** 解析 CSV/TSV 文本 → 二维数组。delimiter 缺省按内容猜（制表符优先，其次逗号/分号）。 */
export function parseCsv(text: string, delimiter?: string): string[][] {
  let s = text
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1) // 去 BOM
  const delim = delimiter ?? guessDelimiter(s)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
      continue
    }
    if (c === '"') inQuotes = true
    else if (c === delim) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  // 收尾（最后一行无换行时）
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  // 去掉纯空的末尾行
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop()
  return rows
}

function guessDelimiter(s: string): string {
  const head = s.slice(0, 4000)
  const tabs = (head.match(/\t/g) ?? []).length
  const commas = (head.match(/,/g) ?? []).length
  const semis = (head.match(/;/g) ?? []).length
  if (tabs >= commas && tabs >= semis && tabs > 0) return '\t'
  if (semis > commas) return ';' // 部分中文/欧洲 Excel 用分号
  return ','
}

/** 单个字段按需加引号（含分隔符/引号/换行时） */
function escapeField(v: string, delim: string): string {
  if (v.includes('"') || v.includes(delim) || v.includes('\n') || v.includes('\r')) {
    return `"${v.replace(/"/g, '""')}"`
  }
  return v
}

/** 二维数组 → CSV/TSV 文本。withBom：写 UTF-8 BOM（Excel 双击不乱码），默认 true。 */
export function toCsv(rows: (string | number)[][], delimiter = ',', withBom = true): string {
  const body = rows
    .map((r) => r.map((c) => escapeField(String(c ?? ''), delimiter)).join(delimiter))
    .join('\r\n')
  return (withBom ? '﻿' : '') + body
}

/** 解析结果 → 对齐的 TSV 展示（read_document 输出用，与 xlsx 提取风格一致） */
export function csvToDisplay(text: string, delimiter?: string): string {
  return parseCsv(text, delimiter)
    .map((r) => r.join('\t'))
    .join('\n')
}
