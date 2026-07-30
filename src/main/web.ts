// 联网抓取的辅助层：robots.txt 遵守 + 抓取结果缓存 + 内容类型分流。
// 从 agent/tools.ts 拆出来，便于单测（纯逻辑部分不碰网络）。

// ---------- robots.txt ----------
export interface RobotsRules {
  /** 针对 * 或本 UA 的 Disallow 前缀（已按最长优先排序） */
  disallow: string[]
  allow: string[]
}

/** 解析 robots.txt：只取适用于 `*` 的规则组（我们不声明专有 UA）。
 *  规则语义按 Google 的实现：Allow 与 Disallow 冲突时，**匹配更长的前缀**优先。 */
export function parseRobots(text: string): RobotsRules {
  const disallow: string[] = []
  const allow: string[] = []
  let inStar = false
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line)
    if (!m) continue
    const key = m[1].toLowerCase()
    const val = m[2].trim()
    if (key === 'user-agent') {
      inStar = val === '*'
      continue
    }
    if (!inStar) continue
    if (key === 'disallow' && val) disallow.push(val)
    else if (key === 'allow' && val) allow.push(val)
  }
  const byLen = (a: string, b: string): number => b.length - a.length
  return { disallow: disallow.sort(byLen), allow: allow.sort(byLen) }
}

/** 路径是否被 robots 规则禁止（Allow 更长前缀可反否 Disallow） */
export function isDisallowed(rules: RobotsRules, pathname: string): boolean {
  const hit = (list: string[]): string | undefined =>
    list.find((p) => (p === '/' ? true : pathname.startsWith(p)))
  const d = hit(rules.disallow)
  if (!d) return false
  const a = hit(rules.allow)
  // Allow 前缀更长（更具体）→ 放行
  return !(a && a.length >= d.length)
}

// 每个 host 的 robots 规则缓存（含"取不到"的负缓存，避免每次抓取都多一次请求）
const robotsCache = new Map<string, { rules: RobotsRules | null; at: number }>()
const ROBOTS_TTL = 30 * 60_000 // 30 分钟

/** 检查是否允许抓取；取不到 robots.txt 时**放行**（业界惯例：fail-open）。 */
export async function robotsAllows(
  url: string,
  fetchImpl: (u: string) => Promise<Response>
): Promise<boolean> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return true
  }
  const key = u.origin
  const now = Date.now()
  const cached = robotsCache.get(key)
  let rules = cached && now - cached.at < ROBOTS_TTL ? cached.rules : undefined
  if (rules === undefined) {
    try {
      const res = await fetchImpl(`${u.origin}/robots.txt`)
      rules = res.ok ? parseRobots(await res.text()) : null
    } catch {
      rules = null // 取不到就当没有限制
    }
    robotsCache.set(key, { rules, at: now })
  }
  if (!rules) return true
  return !isDisallowed(rules, u.pathname || '/')
}

// ---------- 抓取结果缓存 ----------
const pageCache = new Map<string, { text: string; at: number }>()
const PAGE_TTL = 5 * 60_000 // 5 分钟：同一轮任务里反复读同一页不再重复下载
const PAGE_CACHE_MAX = 40

export function getCachedPage(url: string): string | undefined {
  const hit = pageCache.get(url)
  if (!hit) return undefined
  if (Date.now() - hit.at > PAGE_TTL) {
    pageCache.delete(url)
    return undefined
  }
  return hit.text
}

export function setCachedPage(url: string, text: string): void {
  if (pageCache.size >= PAGE_CACHE_MAX) {
    // 简单淘汰：删掉最早写入的一条（Map 保持插入顺序）
    const oldest = pageCache.keys().next().value
    if (oldest !== undefined) pageCache.delete(oldest)
  }
  pageCache.set(url, { text, at: Date.now() })
}

/** 仅供测试：清空模块级缓存 */
export function _clearWebCaches(): void {
  robotsCache.clear()
  pageCache.clear()
}

// ---------- 内容类型分流 ----------
export type ContentKind = 'html' | 'pdf' | 'text' | 'binary'

/** 按 content-type（辅以 URL 后缀）判断该怎么处理响应体 */
export function contentKind(contentType: string, url: string): ContentKind {
  const ct = (contentType || '').toLowerCase()
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase()
    } catch {
      return url.toLowerCase()
    }
  })()
  if (ct.includes('pdf') || path.endsWith('.pdf')) return 'pdf'
  if (ct.includes('html') || ct.includes('xhtml')) return 'html'
  if (
    ct.startsWith('image/') ||
    ct.startsWith('audio/') ||
    ct.startsWith('video/') ||
    ct.includes('octet-stream') ||
    ct.includes('zip') ||
    /\.(png|jpe?g|gif|webp|svg|mp4|mp3|zip|docx|xlsx|pptx)$/.test(path)
  ) {
    return 'binary'
  }
  return 'text'
}
