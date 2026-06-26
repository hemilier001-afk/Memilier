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
