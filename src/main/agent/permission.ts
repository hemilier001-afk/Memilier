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
    /** 强制弹框：危险操作即使被自动放行/已记住也要再确认 */
    forcePrompt = false
  ): Promise<boolean> {
    if (this.autoApproveAll) return Promise.resolve(true)
    if (!forcePrompt && sideEffect === 'none' && this.getSettings().autoApproveReadOnly) {
      return Promise.resolve(true)
    }
    const key = rememberKey(tc, sideEffect)
    if (!forcePrompt && this.remembered.has(key)) return Promise.resolve(true)
    const id = randomUUID()
    return new Promise<boolean>((resolve) => {
      this.pending.set(id, { resolve, key })
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
