import { describe, expect, it, vi } from 'vitest'
import { isRetryable, RETRY_STATUS, withRetry } from '../src/main/providers/util'

describe('isRetryable（哪些失败值得重试）', () => {
  it('限流与网关类状态码可重试', () => {
    for (const s of [429, 500, 502, 503, 504]) expect(RETRY_STATUS.has(s)).toBe(true)
    expect(RETRY_STATUS.has(400)).toBe(false)
    expect(RETRY_STATUS.has(401)).toBe(false) // 鉴权失败重试无意义
  })
  it('网络类错误可重试', () => {
    expect(isRetryable(new Error('fetch failed'))).toBe(true)
    expect(isRetryable(new Error('ECONNRESET'))).toBe(true)
    expect(isRetryable(new Error('响应超时：60s 内无数据'))).toBe(true)
  })
  it('用户主动中断不重试', () => {
    expect(isRetryable(new Error('The operation was aborted'))).toBe(false)
    expect(isRetryable(new Error('用户中断'))).toBe(false)
  })
  it('业务错误不重试', () => {
    expect(isRetryable(new Error('invalid api key'))).toBe(false)
  })
})

describe('withRetry（指数退避）', () => {
  it('首次成功不重试', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    expect(await withRetry(fn)).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('瞬时网络错误后重试成功', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValue('ok')
    expect(await withRetry(fn, { attempts: 3 })).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('可重试状态码（429）会重试；最终仍失败则原样返回，由调用方报错', async () => {
    const fn = vi.fn().mockResolvedValue({ status: 429 })
    const r = await withRetry(fn, { attempts: 2, statusOf: (x: { status: number }) => x.status })
    expect(fn).toHaveBeenCalledTimes(2)
    expect(r).toEqual({ status: 429 })
  })

  it('不可重试的错误立即抛出', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('invalid api key'))
    await expect(withRetry(fn, { attempts: 3 })).rejects.toThrow('invalid api key')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('已中断则不再重试', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const fn = vi.fn().mockRejectedValue(new Error('fetch failed'))
    await expect(withRetry(fn, { attempts: 3, signal: ctrl.signal })).rejects.toBeTruthy()
    expect(fn).not.toHaveBeenCalled()
  })
}, 20_000)
