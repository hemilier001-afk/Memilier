import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendAudit, auditPath, listAudit } from '../src/main/audit'
import type { AuditEntry } from '../src/shared/types'

// 无 electron 环境下 auditPath 退回 os.tmpdir()/hemilier-audit.log
const LOG = auditPath()

// 全量测试并行执行时，跑 agent loop 的用例也会往同一个临时 audit.log 追加，
// 因此这里用唯一标记隔离，只断言本用例自己写入的记录。
const MARK = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

function entry(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    ts: Date.now(),
    conv: MARK,
    tool: 'run_command',
    args: '{"command":"ls"}',
    effect: 'exec',
    decision: 'user',
    ok: true,
    ms: 12,
    ...over
  }
}

/** 串行写入是异步排队的，等日志文件出现目标行数 */
async function waitLines(n: number, timeoutMs = 2000): Promise<AuditEntry[]> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const rows = (await listAudit(500)).filter((r) => r.conv === MARK)
    if (rows.length >= n || Date.now() > deadline) return rows
    await new Promise((r) => setTimeout(r, 20))
  }
}

describe('audit 审计日志', () => {
  beforeEach(async () => {
    await fs.rm(LOG, { force: true })
    await fs.rm(`${LOG}.1`, { force: true })
  })
  afterEach(async () => {
    await fs.rm(LOG, { force: true })
    await fs.rm(`${LOG}.1`, { force: true })
  })

  it('auditPath 在测试环境退回临时目录', () => {
    expect(LOG.startsWith(os.tmpdir())).toBe(true)
    expect(LOG.endsWith('.log')).toBe(true)
  })

  it('appendAudit 落盘、listAudit 新→旧返回', async () => {
    appendAudit(entry({ tool: 'read_file', decision: 'readonly' }))
    appendAudit(entry({ tool: 'write_file', decision: 'preset' }))
    const rows = await waitLines(2)
    expect(rows.length).toBeGreaterThanOrEqual(2)
    // 最新在前
    expect(rows[0].tool).toBe('write_file')
    expect(rows[1].tool).toBe('read_file')
    expect(rows[1].decision).toBe('readonly')
  })

  it('损坏行被跳过，不影响其它记录', async () => {
    appendAudit(entry({ tool: 'a' }))
    await waitLines(1)
    await fs.appendFile(LOG, '这不是合法 JSON\n', 'utf8')
    appendAudit(entry({ tool: 'b' }))
    const rows = await waitLines(2)
    const tools = rows.map((r) => r.tool)
    expect(tools).toContain('a')
    expect(tools).toContain('b')
  })

  it('超过 2MB 轮转为 .1（保留一代）', async () => {
    // 直接写一个 >2MB 的日志文件，再 append 触发轮转
    await fs.writeFile(LOG, 'x'.repeat(2 * 1024 * 1024 + 10), 'utf8')
    appendAudit(entry({ tool: 'after-rotate' }))
    await waitLines(1)
    expect(existsSync(`${LOG}.1`)).toBe(true)
    const rows = (await listAudit(50)).filter((r) => r.conv === MARK)
    // 轮转后的新文件只含新记录（旧的大文件被搬到 .1）
    expect(rows.some((r) => r.tool === 'after-rotate')).toBe(true)
  })
})
