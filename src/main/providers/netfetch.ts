// 主进程网络请求统一走 Electron 的 net.fetch：它使用 Chromium 网络栈，
// 自动尊重系统代理 / 会话代理（Node 的全局 fetch 不走系统代理，国内用户接海外 API 会失败）。
// 单测等无 Electron 环境时回退到全局 fetch。
export function netFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { net } = require('electron') as typeof import('electron')
    if (net?.fetch) return net.fetch(url, init as Parameters<typeof net.fetch>[1])
  } catch {
    /* 无 Electron（单测）时回退 */
  }
  return fetch(url, init)
}
