// 审计日志：每次工具执行的「谁批的、批没批、跑没跑成」追加写入 userData/audit.log（JSONL）。
// 借鉴 Claude 的可追溯思路：权限自动化程度越高（替我审批/完全访问），事后可查越重要。
// 写入串行化保序；超 2MB 轮转为 audit.log.1（保留一代）。测试环境退回 os.tmpdir。
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AuditEntry } from '../shared/types'

const MAX_BYTES = 2 * 1024 * 1024

export function auditPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron')
    return path.join(app.getPath('userData'), 'audit.log')
  } catch {
    return path.join(os.tmpdir(), 'hemilier-audit.log')
  }
}

let queue: Promise<void> = Promise.resolve()

/** 追加一条审计记录（fire-and-forget：审计失败不影响工具执行） */
export function appendAudit(entry: AuditEntry): void {
  const file = auditPath()
  queue = queue
    .then(async () => {
      try {
        const st = await fs.stat(file).catch(() => null)
        if (st && st.size > MAX_BYTES) {
          await fs.rm(`${file}.1`, { force: true })
          await fs.rename(file, `${file}.1`)
        }
        await fs.appendFile(file, JSON.stringify(entry) + '\n', 'utf8')
      } catch {
        /* 审计尽力而为 */
      }
    })
    .catch(() => {})
}

/** 最近 limit 条（新→旧），损坏行跳过 */
export async function listAudit(limit = 200): Promise<AuditEntry[]> {
  try {
    const raw = await fs.readFile(auditPath(), 'utf8')
    const lines = raw.split('\n').filter(Boolean)
    const out: AuditEntry[] = []
    for (const line of lines.slice(-limit)) {
      try {
        out.push(JSON.parse(line) as AuditEntry)
      } catch {
        /* skip */
      }
    }
    return out.reverse()
  } catch {
    return []
  }
}
