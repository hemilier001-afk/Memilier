import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeHookRunner } from '../src/main/agent/hooks'

let ws = ''

async function writeHooks(cfg: unknown): Promise<void> {
  await fs.mkdir(path.join(ws, '.hemilier'), { recursive: true })
  await fs.writeFile(path.join(ws, '.hemilier', 'hooks.json'), JSON.stringify(cfg), 'utf8')
}

describe('生命周期钩子（hooks）', () => {
  beforeEach(async () => {
    ws = await fs.mkdtemp(path.join(os.tmpdir(), 'hemi-hooks-'))
  })
  afterEach(async () => {
    await fs.rm(ws, { recursive: true, force: true })
  })

  it('enabled=false 时不加载任何钩子（默认关）', async () => {
    await writeHooks({ PreToolUse: [{ command: 'exit 1' }] })
    const h = await makeHookRunner({ workspace: ws, enabled: false })
    expect(h.any).toBe(false)
    expect((await h.preTool('run_command', { command: 'ls' })).block).toBe(false)
  })

  it('无配置文件时优雅降级（any=false，不拦截）', async () => {
    const h = await makeHookRunner({ workspace: ws, enabled: true })
    expect(h.any).toBe(false)
    expect((await h.preTool('write_file', { path: 'a.txt' })).block).toBe(false)
  })

  it('PreToolUse 非零退出 → 拦截该工具，reason 带命令输出', async () => {
    await writeHooks({
      PreToolUse: [{ matcher: 'run_command', command: 'echo 禁止危险命令 && exit 3' }]
    })
    const h = await makeHookRunner({ workspace: ws, enabled: true })
    const r = await h.preTool('run_command', { command: 'rm -rf /' })
    expect(r.block).toBe(true)
    expect(r.reason).toContain('禁止危险命令')
  })

  it('PreToolUse 退出 0 → 放行', async () => {
    await writeHooks({ PreToolUse: [{ matcher: 'run_command', command: 'exit 0' }] })
    const h = await makeHookRunner({ workspace: ws, enabled: true })
    expect((await h.preTool('run_command', { command: 'ls' })).block).toBe(false)
  })

  it('matcher 正则不匹配的工具不触发', async () => {
    await writeHooks({ PreToolUse: [{ matcher: 'edit_file|write_file', command: 'exit 1' }] })
    const h = await makeHookRunner({ workspace: ws, enabled: true })
    // run_command 不在 matcher 里 → 不拦截
    expect((await h.preTool('run_command', { command: 'ls' })).block).toBe(false)
    // write_file 命中 → 拦截
    expect((await h.preTool('write_file', { path: 'a' })).block).toBe(true)
  })

  it('PostToolUse 与 Stop 不抛错（副作用型钩子）', async () => {
    const marker = path.join(ws, 'post-ran')
    await writeHooks({
      PostToolUse: [{ command: `touch "${marker}"` }],
      Stop: [{ command: 'true' }]
    })
    const h = await makeHookRunner({ workspace: ws, enabled: true })
    await h.postTool('write_file', { path: 'a.txt' })
    await h.stop()
    // PostToolUse 命令确实执行了
    await new Promise((r) => setTimeout(r, 100))
    const ran = await fs
      .access(marker)
      .then(() => true)
      .catch(() => false)
    expect(ran).toBe(true)
  })
})
