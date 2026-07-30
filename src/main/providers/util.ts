// “停顿超时”守卫：合并用户中断信号 + 空闲看门狗。
// 每收到一块数据就 reset()；若 ms 内无任何数据则中断（防止挂起的端点把对话卡在“生成中”）。
// 用空闲超时而非总时长超时，避免误杀正常的长输出。
export function stallGuard(
  userSignal: AbortSignal | undefined,
  ms: number
): { signal: AbortSignal; reset: () => void; dispose: () => void } {
  const ctrl = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const reset = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => ctrl.abort(new Error(`响应超时：${ms / 1000}s 内无数据`)), ms)
  }
  const onAbort = (): void => ctrl.abort()
  if (userSignal) {
    if (userSignal.aborted) ctrl.abort()
    else userSignal.addEventListener('abort', onAbort)
  }
  const dispose = (): void => {
    if (timer) clearTimeout(timer)
    userSignal?.removeEventListener('abort', onAbort)
  }
  reset()
  return { signal: ctrl.signal, reset, dispose }
}

// ---------------- 瞬时故障重试 ----------------
// 云端 API 的 429（限流）/5xx（网关抖动）/网络闪断是常态，尤其国内接海外端点。
// 之前不重试 → 一次抖动就中断整轮对话。这里按指数退避重试**建立连接**阶段；
// 已开始流式输出后不重试（避免重复内容），由 stallGuard 兜底。
export const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 529])

/** 是否值得重试：网络类错误 / 可重试状态码（用户主动中断不重试） */
export function isRetryable(e: unknown, status?: number): boolean {
  if (status != null) return RETRY_STATUS.has(status)
  const msg = e instanceof Error ? e.message : String(e ?? '')
  if (/abort|取消|用户中断/i.test(msg)) return false
  return /fetch failed|network|ECONN|ETIMEDOUT|EAI_AGAIN|socket|TLS|超时|timeout/i.test(msg)
}

/** 重试建立请求：attempts 次尝试，退避 0.6s→1.8s→5.4s（含抖动）。
 *  fn 返回 Response；HTTP 状态可重试时也会重试（由 statusOf 提取）。 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; statusOf?: (r: T) => number | undefined; signal?: AbortSignal } = {}
): Promise<T> {
  const attempts = opts.attempts ?? 3
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    if (opts.signal?.aborted) break
    try {
      const r = await fn()
      const status = opts.statusOf?.(r)
      if (status != null && RETRY_STATUS.has(status) && i < attempts - 1) {
        await backoff(i, opts.signal)
        continue
      }
      return r
    } catch (e) {
      lastErr = e
      if (i >= attempts - 1 || !isRetryable(e)) throw e
      await backoff(i, opts.signal)
    }
  }
  throw lastErr ?? new Error('请求失败')
}

function backoff(i: number, signal?: AbortSignal): Promise<void> {
  const ms = Math.round(600 * 3 ** i * (0.8 + Math.random() * 0.4)) // 0.6s → 1.8s → 5.4s
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        resolve()
      },
      { once: true }
    )
  })
}
