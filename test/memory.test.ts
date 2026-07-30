import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { memory, tokenizeQuery } from '../src/main/memory'

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

describe('中文检索（tokenizeQuery + search）', () => {
  it('中文按 2-gram 切词；拉丁按空白切', () => {
    expect(tokenizeQuery('保密协议')).toEqual(['保密', '密协', '协议'])
    expect(tokenizeQuery('hello world')).toEqual(['hello', 'world'])
    // 中英混排：两种片段都保留
    const mixed = tokenizeQuery('用 TypeScript 写文书')
    expect(mixed).toContain('typescript')
    expect(mixed).toContain('文书')
  })

  it('自然中文提问能检索到（旧实现按空白切词时为 0 命中）', async () => {
    await memory.add(ws, '保密协议的甲方是张亚希，乙方是北京原法科技', 'fact')
    await memory.add(ws, '文书统一用宋体小四，页边距 2.5cm', 'preference')

    // 不带空格的自然提问——这是模型调 recall 时的真实形态
    expect(await memory.search(ws, '保密协议甲方是谁')).toContain('张亚希')
    expect(await memory.search(ws, '文书用什么字体')).toContain('宋体')
    // 带空格的查询也照常工作
    expect(await memory.search(ws, '保密协议 甲方')).toContain('张亚希')
  })

  it('完全无关的查询不误报', async () => {
    await memory.add(ws, '文书统一用宋体小四', 'preference')
    expect(await memory.search(ws, '完全无关的量子力学问题')).toBe('')
  })

  it('命中多条时按覆盖比例排序（更贴合的在前）', async () => {
    await memory.add(ws, '合同模板放在 templates 目录', 'fact')
    await memory.add(ws, '合同评审要走法务流程，模板不可私改', 'decision')
    const r = await memory.search(ws, '合同模板')
    const first = r.split('\n')[0]
    expect(first).toContain('templates') // 两个词全覆盖的排前面
  })
})
