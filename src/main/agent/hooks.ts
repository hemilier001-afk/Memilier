import { exec } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

// 生命周期钩子（对齐 Claude Code 的 hooks）：在工具执行前后 / 运行结束时自动跑一条 shell 命令。
// 配置：<workspace>/.hemilier/hooks.json
//   {
//     "PreToolUse":  [{ "matcher": "run_command", "command": "echo blocked && exit 1" }],
//     "PostToolUse": [{ "matcher": "edit_file|write_file", "command": "npm run format" }],
//     "Stop":        [{ "command": "osascript -e 'display notification \"done\"'" }]
//   }
// matcher 为工具名的正则（缺省=匹配全部）。PreToolUse 命令**非零退出即拦截该工具**（安全闸）。
// 安全：整套仅在 settings.enableHooks=true 时启用（默认关，防不可信仓库的 hooks 自动执行）。

export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'Stop'

interface HookRule {
  matcher?: string
  command: string
}
type HooksConfig = Partial<Record<HookEvent, HookRule[]>>

const HOOK_TIMEOUT_MS = 30_000

async function loadHooks(workspace: string): Promise<HooksConfig> {
  try {
    const raw = await fs.readFile(path.join(workspace, '.hemilier', 'hooks.json'), 'utf8')
    const j = JSON.parse(raw) as HooksConfig
    return j && typeof j === 'object' ? j : {}
  } catch {
    return {}
  }
}

function matches(rule: HookRule, toolName: string): boolean {
  if (!rule.matcher) return true
  try {
    return new RegExp(rule.matcher).test(toolName)
  } catch {
    return rule.matcher === toolName
  }
}

function runCommand(
  command: string,
  workspace: string,
  env: Record<string, string>
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd: workspace,
        env: { ...process.env, ...env },
        timeout: HOOK_TIMEOUT_MS,
        maxBuffer: 1024 * 1024
      },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as { code?: number }).code === 'number'
            ? (err as { code: number }).code
            : err
              ? 1
              : 0
        resolve({ code, out: `${stdout ?? ''}${stderr ?? ''}`.slice(0, 2000) })
      }
    )
  })
}

export interface HookRunnerOptions {
  workspace: string
  enabled: boolean
}

/** 为一次 agent 运行创建钩子执行器（加载一次配置，供多次触发复用）。 */
export async function makeHookRunner(opts: HookRunnerOptions): Promise<{
  /** 工具执行前：返回 { block, reason } —— block=true 表示被 PreToolUse 钩子拦截 */
  preTool: (
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<{ block: boolean; reason?: string }>
  /** 工具执行后：跑 PostToolUse（如自动格式化） */
  postTool: (toolName: string, args: Record<string, unknown>) => Promise<void>
  /** 运行结束：跑 Stop 钩子 */
  stop: () => Promise<void>
  /** 是否配置了任何钩子（供 UI/提示用） */
  any: boolean
}> {
  const empty = {
    preTool: async () => ({ block: false }),
    postTool: async () => {},
    stop: async () => {},
    any: false
  }
  if (!opts.enabled) return empty
  const cfg = await loadHooks(opts.workspace)
  const any = !!(cfg.PreToolUse?.length || cfg.PostToolUse?.length || cfg.Stop?.length)
  if (!any) return empty

  const envFor = (toolName: string, args: Record<string, unknown>): Record<string, string> => ({
    HEMILIER_TOOL: toolName,
    HEMILIER_FILE: String((args?.path as string) ?? ''),
    HEMILIER_COMMAND: String((args?.command as string) ?? '')
  })

  return {
    any,
    preTool: async (toolName, args) => {
      for (const rule of cfg.PreToolUse ?? []) {
        if (!matches(rule, toolName)) continue
        const { code, out } = await runCommand(rule.command, opts.workspace, envFor(toolName, args))
        if (code !== 0)
          return { block: true, reason: out.trim() || `PreToolUse 钩子拦截（退出码 ${code}）` }
      }
      return { block: false }
    },
    postTool: async (toolName, args) => {
      for (const rule of cfg.PostToolUse ?? []) {
        if (!matches(rule, toolName)) continue
        await runCommand(rule.command, opts.workspace, envFor(toolName, args))
      }
    },
    stop: async () => {
      for (const rule of cfg.Stop ?? []) {
        await runCommand(rule.command, opts.workspace, {
          HEMILIER_TOOL: '',
          HEMILIER_FILE: '',
          HEMILIER_COMMAND: ''
        })
      }
    }
  }
}
