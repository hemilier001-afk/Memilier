import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { memory } from '../src/main/memory'

let ws = ''

beforeEach(() => {
  ws = mkdtempSync(path.join(os.tmpdir(), 'hemilier-mem-'))
})
afterEach(() => {
  rmSync(ws, { recursive: true, force: true })
})

describe('memory', () => {
  it('同文去重（upsert）：相同内容不堆重复条目，只刷新时间/类型', async () => {
    const a = await memory.add(ws, '项目用 pnpm 而不是 npm', 'fact')
    const b = await memory.add(ws, '项目用 pnpm 而不是 npm', 'preference')
    expect(b.id).toBe(a.id)
    const all = await memory.list(ws)
    expect(all).toHaveLength(1)
    expect(all[0].type).toBe('preference')
  })

  it('注入预算优先保留最新条目（而非最旧）', async () => {
    for (let i = 0; i < 60; i++) await memory.add(ws, `条目-${i}`, 'fact')
    const rendered = await memory.renderForPrompt(ws)
    expect(rendered).toContain('条目-59') // 最新的必须在
    expect(rendered).not.toContain('条目-0 ') // 最旧的被挤出
    expect(rendered).toContain('较早记忆未注入') // 有溢出提示
  })

  it('forget 按 id 前缀删除', async () => {
    const e = await memory.add(ws, '要删的', 'todo')
    await memory.add(ws, '要留的', 'fact')
    await memory.forget(ws, e.id.slice(0, 8))
    const all = await memory.list(ws)
    expect(all).toHaveLength(1)
    expect(all[0].text).toBe('要留的')
  })
})
