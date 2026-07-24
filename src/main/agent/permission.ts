import { randomUUID } from 'node:crypto'
import type { PermissionRequest, Settings, ToolCall } from '@shared/types'

export type SideEffect = 'none' | 'write' | 'exec'

type SendFn = (req: PermissionRequest) => void

interface Pending {
  resolve: (approved: boolean) => void
  key: string
}

// “本会话记住”的粒度：run_command 记到命令首词（如 cmd:npm）、其余记到具体工具名。
// 不再用 `eff:exec` 这种粗粒度——否则记住一个 fetch_url 会顺带放行 web_search 等所有 exec 工具。
export function rememberKey(tc: ToolCall, sideEffect: SideEffect): string {
  if (tc.name === 'run_command') {
    const prog = String((tc.args as { command?: string })?.command ?? '')
      .trim()
      .split(/\s+/)[0]
    return `cmd:${prog || 'cmd'}`
  }
  return `tool:${tc.name || sideEffect}`
}

/**
 * 权限网关：只读工具可按设置自动放行；写文件 / 执行命令 / 调用 MCP 工具需用户在 UI 中确认。
 * “本会话记住”按更细的 key 加入白名单（命令首词 / 具体 MCP 工具 / 副作用级别），直到 APP 重启。
 */
export class PermissionManager {
  private pending = new Map<string, Pending>()
  private remembered = new Set<string>()

  constructor(
    private send: SendFn,
    private getSettings: () => Settings,
    /** 后台例程无人应答，自动放行所有工具 */
    private autoApproveAll = false
  ) {}

  request(
    tc: ToolCall,
    sideEffect: SideEffect,
    description: string,
    forcePrompt = false,
    signal?: AbortSignal
  ): Promise<boolean> {
    return this.requestEx(tc, sideEffect, description, forcePrompt, signal).then((r) => r.approved)
  }

  /** 同 request，但带上「依据」（供审计日志区分 无人值守/只读自动/已记住/用户点头） */
  requestEx(
    tc: ToolCall,
    sideEffect: SideEffect,
    description: string,
    /** 强制弹框：危险操作即使被自动放行/已记住也要再确认 */
    forcePrompt = false,
    /** 本次运行的中断信号：运行被中止时挂起的授权请求自动按“拒绝”解决，避免会话永久卡死 */
    signal?: AbortSignal
  ): Promise<{ approved: boolean; via: 'unattended' | 'readonly' | 'remembered' | 'user' }> {
    // 无人值守（后台例程）：普通工具自动放行，但危险操作（forcePrompt）直接拒绝而非放行
    if (this.autoApproveAll) return Promise.resolve({ approved: !forcePrompt, via: 'unattended' })
    if (!forcePrompt && sideEffect === 'none' && this.getSettings().autoApproveReadOnly) {
      return Promise.resolve({ approved: true, via: 'readonly' })
    }
    const key = rememberKey(tc, sideEffect)
    if (!forcePrompt && this.remembered.has(key)) {
      return Promise.resolve({ approved: true, via: 'remembered' })
    }
    if (signal?.aborted) return Promise.resolve({ approved: false, via: 'user' })
    const id = randomUUID()
    return new Promise<{ approved: boolean; via: 'user' }>((resolve) => {
      const onAbort = (): void => {
        if (this.pending.delete(id)) resolve({ approved: false, via: 'user' })
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, {
        key,
        resolve: (approved) => {
          signal?.removeEventListener('abort', onAbort)
          resolve({ approved, via: 'user' })
        }
      })
      this.send({ id, toolName: tc.name, args: tc.args, description })
    })
  }

  respond(id: string, approved: boolean, remember: boolean): void {
    const entry = this.pending.get(id)
    if (!entry) return
    this.pending.delete(id)
    if (approved && remember) this.remembered.add(entry.key)
    entry.resolve(approved)
  }
}
