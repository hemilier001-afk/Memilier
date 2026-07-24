// run_command 的 Seatbelt 沙箱（仅 macOS；对齐 Claude Code 的 bash 沙箱思路）：
// 读不限、网不限（联网工具另有 SSRF 网关），文件写入限定在 工作区 + 临时目录 + 常见构建缓存，
// 防止一条被放行的命令越界改动工作区之外的文件。full（完全访问）模式与 Windows 不沙箱。
import { existsSync, realpathSync } from 'node:fs'
import os from 'node:os'

const escapePath = (p: string): string => p.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

/** 允许写入的路径清单（realpath 归一化，防符号链接绕过，如 /tmp -> /private/tmp） */
export function sandboxWritePaths(workspace: string): string[] {
  const home = os.homedir()
  const raw = [
    workspace,
    os.tmpdir(), // 每用户 /var/folders/... 临时目录
    '/tmp',
    '/private/tmp',
    '/var/tmp',
    '/private/var/tmp',
    '/dev', // tty / null 等设备写入
    `${home}/.npm`,
    `${home}/.cache`,
    `${home}/Library/Caches` // npm/pip 等工具链缓存，否则 install 类命令必挂
  ]
  const uniq = new Set<string>()
  for (const p of raw) {
    try {
      uniq.add(realpathSync(p))
    } catch {
      uniq.add(p)
    }
  }
  return [...uniq]
}

/** 生成 Seatbelt profile：默认全放行，再整体禁写，最后放行白名单子路径（后规则优先） */
export function buildSeatbeltProfile(writePaths: string[]): string {
  const subs = writePaths.map((p) => `  (subpath "${escapePath(p)}")`).join('\n')
  return `(version 1)\n(allow default)\n(deny file-write*)\n(allow file-write*\n${subs}\n)`
}

export function sandboxAvailable(): boolean {
  return process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec')
}
