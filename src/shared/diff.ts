// 极简的按行 diff（LCS），用于 Diff 面板展示。零依赖，便于单测。

export interface DiffLine {
  type: 'add' | 'del' | 'ctx'
  text: string
}

// LCS 表规模上限：超出则退化为「整删整增」概要，避免大文件把渲染进程算到冻结/OOM
const MAX_LCS_CELLS = 4_000_000

/** 基于最长公共子序列计算逐行差异 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.length ? before.split('\n') : []
  const b = after.length ? after.split('\n') : []
  const m = a.length
  const n = b.length

  if ((m + 1) * (n + 1) > MAX_LCS_CELLS) {
    return [
      { type: 'ctx', text: `（文件过大，略过逐行对比：-${m} 行 → +${n} 行）` },
      { type: 'del', text: `原文件 ${m} 行` },
      { type: 'add', text: `新文件 ${n} 行` }
    ]
  }

  // LCS 长度表
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ type: 'ctx', text: a[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: 'del', text: a[i] })
      i++
    } else {
      out.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < m) out.push({ type: 'del', text: a[i++] })
  while (j < n) out.push({ type: 'add', text: b[j++] })
  return out
}

/** 统计新增 / 删除行数 */
export function diffStat(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const l of lines) {
    if (l.type === 'add') added++
    else if (l.type === 'del') removed++
  }
  return { added, removed }
}
