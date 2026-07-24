// 纯函数安全判定（无 electron/fs 依赖，便于单测）：危险命令识别 + 私网 IP 识别。

// 高危命令模式：命中则强制二次确认（即使「本会话记住」也照弹框）
const DANGER_PATTERNS: RegExp[] = [
  /\brm\s+-[a-z]*[rf]/i, // rm -rf / -r / -f（含 -fr 等任意顺序）
  /\brm\s+.*\s-[a-z]*[rf]/i, // rm path -rf
  /\b(rmdir|unlink)\b/i,
  /(^|\s)-{1,2}delete\b/i, // find ... -delete / 各类 --delete
  /\b(del|erase)\b.*\/[sq]/i, // Windows del /s /q
  /\brd\s+\/s/i,
  /\bformat\s+[a-z]:/i, // Windows 格式化磁盘 format C:（不误伤 npm run format）
  /\bmkfs\b/i,
  /\bdd\b\s+if=/i,
  /\b(shutdown|reboot|halt|poweroff)\b/i,
  /\bkillall\b/i,
  /:\(\)\s*\{.*\|.*&.*\}/, // fork 炸弹
  /\bsudo\b|\bdoas\b/i,
  /\bchmod\b\s+-R\s+0?777/i,
  /\bchown\b\s+-R\b/i,
  // 下载并管道到 shell 执行（仅 shell，不含 python/node，避免误伤 curl|python -m json.tool）
  /\b(curl|wget|iwr|invoke-webrequest)\b[^|]*\|\s*(sh|bash|zsh|fish|ksh|dash)\b/i,
  /(^|[;&|]\s*)(eval|iex|invoke-expression)\b/i, // 动态执行（仅命令起始/分隔符后，避免误判 npm run eval 等）
  />\s*\/dev\/(sd|nvme|disk|null)/i,
  // git 危险操作；push --force 排除安全的 --force-with-lease，且不跨命令分隔符
  /\bgit\b[^|;&]*(reset\s+--hard|clean\s+-[a-z]*f|push\b[^|;&]*--force(?!-with-lease))/i
]

export function isDangerousCommand(cmd: string): boolean {
  return DANGER_PATTERNS.some((re) => re.test(cmd || ''))
}

// 私网 / 本地 / 元数据地址识别（用于 SSRF 防护）
export function isPrivateIp(ipRaw: string): boolean {
  if (!ipRaw) return true
  let ip = ipRaw.trim().toLowerCase()
  // IPv4-mapped IPv6（如 ::ffff:127.0.0.1）取出内嵌 IPv4
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) ip = mapped[1]
  if (ip === '::1' || ip === '::' || ip === '0.0.0.0') return true
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (m) {
    const a = +m[1]
    const b = +m[2]
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true // link-local / 云元数据 169.254.169.254
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64.0.0/10
    return false
  }
  // IPv6 ULA(fc/fd) / 链路本地(fe80)
  if (/^f[cd]/.test(ip) || /^fe80/.test(ip)) return true
  return false
}

// ---------------- 权限预设策略（纯函数，有单测） ----------------
import type { ApprovalMode, CustomPolicy, PolicyCategory } from '../../shared/types'

/** 工具 → 策略类别。browser_* 归入 network（浏览器组整体视作联网面）。 */
export function toolCategory(
  name: string,
  sideEffect: 'none' | 'write' | 'exec',
  isMcp: boolean
): PolicyCategory {
  if (isMcp) return 'mcp'
  if (sideEffect === 'none') return 'read'
  if (name === 'run_command') return 'command'
  if (name === 'fetch_url' || name === 'web_search' || name.startsWith('browser_')) return 'network'
  if (name === 'add_memory' || name === 'forget_memory' || name === 'save_skill')
    return 'memorySkill'
  return 'fileWrite'
}

/** 预设 → 该类别是否免确认。返回 'ask' 时落回权限网关既有逻辑（只读自动放行/记住/弹框）。
 *  危险命令(forcePrompt)与 deny 规则在调用方先行判定，不进本函数——任何预设都压不掉它们。 */
export function presetDecision(
  mode: ApprovalMode,
  category: PolicyCategory,
  custom?: CustomPolicy
): 'auto' | 'ask' {
  if (mode === 'full') return 'auto'
  if (category === 'read') return 'ask' // read 由 autoApproveReadOnly 既有开关管
  if (mode === 'ask') return 'ask'
  if (mode === 'auto') return category === 'mcp' ? 'ask' : 'auto' // 第三方 MCP 仍逐项确认
  return custom?.[category] ?? 'ask'
}
