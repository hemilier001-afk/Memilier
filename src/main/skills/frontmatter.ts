/**
 * SKILL.md 的 YAML frontmatter 解析工具。
 * 刻意保持零依赖（不引入 electron / fs），以便单元测试。
 */

/** 解析 frontmatter，仅取简单的 key: value（去掉首尾引号）。无 frontmatter 时返回空对象。 */
export function parseFrontmatter(text: string): Record<string, string> {
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(text)
  if (!m) return {}
  const out: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i < 0) continue
    const key = line.slice(0, i).trim()
    const value = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
    if (key) out[key] = value
  }
  return out
}

/** 去除开头的 frontmatter 块，返回正文。无 frontmatter 时原样返回。 */
export function stripFrontmatter(text: string): string {
  const m = /^---\s*\n[\s\S]*?\n---\s*\n?/.exec(text)
  return m ? text.slice(m[0].length) : text
}
