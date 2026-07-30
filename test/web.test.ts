import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _clearWebCaches,
  contentKind,
  getCachedPage,
  isDisallowed,
  parseRobots,
  robotsAllows,
  setCachedPage
} from '../src/main/web'

beforeEach(() => _clearWebCaches())

describe('robots.txt 解析与判定', () => {
  const SAMPLE = `
# 注释行
User-agent: BadBot
Disallow: /

User-agent: *
Disallow: /private
Disallow: /tmp
Allow: /private/public
`.trim()

  it('只取 User-agent: * 的规则组（不误用别的 UA 段）', () => {
    const r = parseRobots(SAMPLE)
    expect(r.disallow).toContain('/private')
    expect(r.disallow).toContain('/tmp')
    expect(r.disallow).not.toContain('/') // BadBot 的 Disallow: / 不该被采用
    expect(r.allow).toContain('/private/public')
  })

  it('前缀匹配：被 Disallow 覆盖的路径判定为禁止', () => {
    const r = parseRobots(SAMPLE)
    expect(isDisallowed(r, '/private/secret')).toBe(true)
    expect(isDisallowed(r, '/tmp/x')).toBe(true)
    expect(isDisallowed(r, '/public/page')).toBe(false)
  })

  it('更长的 Allow 前缀可反否 Disallow（Google 语义）', () => {
    const r = parseRobots(SAMPLE)
    expect(isDisallowed(r, '/private/public/doc')).toBe(false)
  })

  it('空 robots / 无规则 → 不禁止', () => {
    expect(isDisallowed(parseRobots(''), '/anything')).toBe(false)
    expect(isDisallowed(parseRobots('User-agent: *\n'), '/anything')).toBe(false)
  })

  it('robotsAllows：禁止的路径返回 false，允许的返回 true', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'User-agent: *\nDisallow: /private'
    } as Response)
    expect(await robotsAllows('https://x.com/private/a', fetchImpl)).toBe(false)
    expect(await robotsAllows('https://x.com/open/a', fetchImpl)).toBe(true)
    // 同一 host 的 robots 只取一次（有缓存）
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('取不到 robots.txt 时放行（fail-open，不因此瘫痪抓取）', async () => {
    const boom = vi.fn().mockRejectedValue(new Error('网络不可达'))
    expect(await robotsAllows('https://y.com/page', boom)).toBe(true)
    const notFound = vi.fn().mockResolvedValue({ ok: false } as Response)
    expect(await robotsAllows('https://z.com/page', notFound)).toBe(true)
  })
})

describe('内容类型分流', () => {
  it('PDF：按 content-type 或 .pdf 后缀识别', () => {
    expect(contentKind('application/pdf', 'https://a.com/x')).toBe('pdf')
    expect(contentKind('', 'https://a.com/报告.pdf')).toBe('pdf')
  })
  it('HTML / 纯文本', () => {
    expect(contentKind('text/html; charset=utf-8', 'https://a.com/')).toBe('html')
    expect(contentKind('text/plain', 'https://a.com/a.txt')).toBe('text')
    expect(contentKind('application/json', 'https://a.com/api')).toBe('text')
  })
  it('二进制：图片/压缩包/Office 文件不当文本处理', () => {
    expect(contentKind('image/png', 'https://a.com/a.png')).toBe('binary')
    expect(contentKind('application/octet-stream', 'https://a.com/x')).toBe('binary')
    expect(contentKind('', 'https://a.com/表.xlsx')).toBe('binary')
    expect(contentKind('video/mp4', 'https://a.com/v')).toBe('binary')
  })
})

describe('抓取缓存', () => {
  it('写入后可命中；未写入的返回 undefined', () => {
    expect(getCachedPage('https://a.com/1')).toBeUndefined()
    setCachedPage('https://a.com/1', '正文')
    expect(getCachedPage('https://a.com/1')).toBe('正文')
  })

  it('超出容量上限时淘汰最旧的条目（不会无限增长）', () => {
    for (let i = 0; i < 45; i++) setCachedPage(`https://a.com/${i}`, `p${i}`)
    expect(getCachedPage('https://a.com/0')).toBeUndefined() // 最早的已被淘汰
    expect(getCachedPage('https://a.com/44')).toBe('p44') // 最新的还在
  })

  it('过期条目不再命中', () => {
    setCachedPage('https://a.com/ttl', '旧内容')
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 6 * 60_000) // 超过 5 分钟 TTL
    expect(getCachedPage('https://a.com/ttl')).toBeUndefined()
    vi.useRealTimers()
  })
})
