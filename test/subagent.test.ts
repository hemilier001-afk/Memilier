import { describe, expect, it, vi } from 'vitest'

// 子 agent（多 agent 编排）测试：内置类型清单 + runSubAgent 冒烟。

const h = vi.hoisted(() => ({
  fake: {
    id: 'test',
    listModels: vi.fn(),
    chat: vi.fn()
  }
}))

vi.mock('../src/main/store', () => ({
  store: { getSettings: () => ({ defaultModel: 'ollama::m', workspaceDir: '/tmp' }) }
}))
vi.mock('../src/main/providers/registry', () => ({
  bareModel: (id: string) => id.split('::').pop() ?? id,
  resolveProvider: () => h.fake
}))
vi.mock('../src/main/mcp/manager', () => ({
  mcpManager: { isMcpTool: () => false, callTool: vi.fn(), listToolDefs: vi.fn() }
}))
vi.mock('../src/main/plugins/manager', () => ({
  pluginManager: { activePlugins: () => [], mcpServers: () => ({}) }
}))
vi.mock('../src/main/skills/manager', () => ({
  skillManager: { listSkills: vi.fn().mockResolvedValue([]) }
}))
vi.mock('../src/main/memory', () => ({
  memory: { renderForPrompt: vi.fn().mockResolvedValue('') }
}))
vi.mock('../src/main/images', () => ({
  imageStore: { resolve: (x: string) => x, save: vi.fn(), isRef: () => false, deleteRefs: vi.fn() }
}))

describe('agentManager', () => {
  it('内置子 agent 类型：explore / code / review 都在', async () => {
    const { agentManager } = await import('../src/main/agent/agents/manager')
    const names = (await agentManager.list('/tmp/__no_such_ws__')).map((a) => a.name)
    expect(names).toContain('explore')
    expect(names).toContain('code')
    expect(names).toContain('review')
  })
})

describe('runSubAgent', () => {
  it('返回子 agent 的最终报告', async () => {
    h.fake.chat.mockResolvedValueOnce({ content: '子 agent 的报告：完成了。', toolCalls: [] })
    const { runSubAgent } = await import('../src/main/agent/loop')
    const report = await runSubAgent({
      agentName: undefined,
      task: '总结一下',
      workspace: '/tmp',
      parentModelId: 'ollama::m',
      permission: {
        request: vi.fn().mockResolvedValue(true),
        requestEx: vi.fn().mockResolvedValue({ approved: true, via: 'user' })
      } as any,
      signal: new AbortController().signal,
      skillDirs: [],
      depth: 0
    })
    expect(report).toContain('子 agent 的报告')
  })

  it('实时进度通过 onProgress 回传（至少一次「思考中」）', async () => {
    h.fake.chat.mockResolvedValueOnce({ content: '完成。', toolCalls: [] })
    const { runSubAgent } = await import('../src/main/agent/loop')
    const traces: string[] = []
    await runSubAgent({
      agentName: undefined,
      task: '干活',
      workspace: '/tmp',
      parentModelId: 'ollama::m',
      permission: {
        request: vi.fn().mockResolvedValue(true),
        requestEx: vi.fn().mockResolvedValue({ approved: true, via: 'user' })
      } as any,
      signal: new AbortController().signal,
      skillDirs: [],
      depth: 0,
      onProgress: (t) => traces.push(t)
    })
    expect(traces.length).toBeGreaterThan(0)
    expect(traces.some((t) => t.includes('思考中'))).toBe(true)
  })

  it('depth>=1 时拒绝再派生（禁递归）', async () => {
    const { runSubAgent } = await import('../src/main/agent/loop')
    const report = await runSubAgent({
      agentName: undefined,
      task: '做点什么',
      workspace: '/tmp',
      parentModelId: 'ollama::m',
      permission: {
        request: vi.fn(),
        requestEx: vi.fn().mockResolvedValue({ approved: true, via: 'user' })
      } as any,
      signal: new AbortController().signal,
      skillDirs: [],
      depth: 1
    })
    expect(report).toContain('不能再派生')
  })

  it('未知子 agent 类型时返回可用类型清单', async () => {
    const { runSubAgent } = await import('../src/main/agent/loop')
    const report = await runSubAgent({
      agentName: '__nope__',
      task: '做点什么',
      workspace: '/tmp/__no_such_ws__',
      parentModelId: 'ollama::m',
      permission: {
        request: vi.fn(),
        requestEx: vi.fn().mockResolvedValue({ approved: true, via: 'user' })
      } as any,
      signal: new AbortController().signal,
      skillDirs: [],
      depth: 0
    })
    expect(report).toContain('explore')
  })
})

const perm = () =>
  ({
    request: vi.fn().mockResolvedValue(true),
    requestEx: vi.fn().mockResolvedValue({ approved: true, via: 'user' })
  }) as any

const spawn = async (over: Record<string, unknown> = {}) => {
  const { runSubAgent } = await import('../src/main/agent/loop')
  return runSubAgent({
    agentName: undefined,
    task: '干活',
    workspace: '/tmp',
    parentModelId: 'ollama::m',
    permission: perm(),
    signal: new AbortController().signal,
    skillDirs: [],
    depth: 0,
    ...over
  } as Parameters<typeof runSubAgent>[0])
}

describe('子 agent 健壮性与并发', () => {
  it('子 agent 内部报错不炸主 agent：错误作为报告回灌', async () => {
    h.fake.chat.mockRejectedValueOnce(new Error('模型端 503'))
    const report = await spawn()
    expect(report).toContain('执行失败')
    expect(report).toContain('503')
  })

  it('报错后并发槽正确归还（不会把后续子 agent 永久卡住）', async () => {
    // 连续 4 次失败：若槽位泄漏，第 4 次会挂起（上限 3）
    for (let i = 0; i < 4; i++) {
      h.fake.chat.mockRejectedValueOnce(new Error(`fail-${i}`))
      const report = await spawn()
      expect(report).toContain('执行失败')
    }
  })

  it('同时派生多个时并发不超过上限（超出的排队而非丢弃）', async () => {
    let concurrent = 0
    let peak = 0
    h.fake.chat.mockImplementation(async () => {
      concurrent++
      peak = Math.max(peak, concurrent)
      await new Promise((r) => setTimeout(r, 20))
      concurrent--
      return { content: '好了', toolCalls: [] }
    })
    const reports = await Promise.all(Array.from({ length: 6 }, () => spawn()))
    expect(reports).toHaveLength(6) // 6 个都跑完，没有被丢弃
    expect(reports.every((r) => r.includes('好了'))).toBe(true)
    expect(peak).toBeLessThanOrEqual(3) // 但同时在跑的不超过 3
    h.fake.chat.mockReset()
  })
})

describe('子 agent 继承项目上下文', () => {
  it('工作区 AGENTS.md 的项目指令会注入子 agent 的系统提示', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const ws = mkdtempSync(path.join(os.tmpdir(), 'hemi-sub-ws-'))
    writeFileSync(path.join(ws, 'AGENTS.md'), '本项目一律用 pnpm，禁止用 npm 安装依赖。', 'utf8')

    let sysPrompt = ''
    h.fake.chat.mockImplementationOnce(async (o: any) => {
      sysPrompt = o.messages.find((m: any) => m.role === 'system')?.content ?? ''
      return { content: '收到', toolCalls: [] }
    })
    await spawn({ workspace: ws })
    expect(sysPrompt).toContain('pnpm')
    expect(sysPrompt).toContain('项目指令')
    rmSync(ws, { recursive: true, force: true })
  })

  it('可用技能清单会注入子 agent（便于它 load_skill）', async () => {
    const { skillManager } = await import('../src/main/skills/manager')
    ;(skillManager.listSkills as any).mockResolvedValueOnce([
      { name: 'office-word', description: '生成 Word 文档', source: 'builtin' }
    ])
    let sysPrompt = ''
    h.fake.chat.mockImplementationOnce(async (o: any) => {
      sysPrompt = o.messages.find((m: any) => m.role === 'system')?.content ?? ''
      return { content: '收到', toolCalls: [] }
    })
    await spawn()
    expect(sysPrompt).toContain('office-word')
    expect(sysPrompt).toContain('可用技能')
  })
})

describe('子 agent 能力补齐（用量 / 截断）', () => {
  it('常规长度报告不再被截断（旧上限 6000 字符会大面积砍掉调研结果）', async () => {
    h.fake.chat.mockResolvedValueOnce({ content: 'x'.repeat(15000), toolCalls: [] })
    const { runSubAgent } = await import('../src/main/agent/loop')
    const report = await runSubAgent({
      task: '详细调研',
      workspace: '/tmp',
      parentModelId: 'ollama::m',
      permission: {
        request: vi.fn().mockResolvedValue(true),
        requestEx: vi.fn().mockResolvedValue({ approved: true, via: 'user' })
      } as any,
      signal: new AbortController().signal,
      skillDirs: [],
      depth: 0
    })
    expect(report).not.toContain('已截断') // 1.5 万字的报告应完整回灌
    expect(report).toContain('x'.repeat(15000))
  })

  it('确实超出上限时如实告知（含原文长度与上限值）', async () => {
    h.fake.chat.mockResolvedValueOnce({ content: 'y'.repeat(80000), toolCalls: [] })
    const { runSubAgent } = await import('../src/main/agent/loop')
    const report = await runSubAgent({
      task: '写一份很长的调研',
      workspace: '/tmp',
      parentModelId: 'ollama::m',
      permission: {
        request: vi.fn().mockResolvedValue(true),
        requestEx: vi.fn().mockResolvedValue({ approved: true, via: 'user' })
      } as any,
      signal: new AbortController().signal,
      skillDirs: [],
      depth: 0
    })
    expect(report).toContain('报告过长已截断')
    expect(report).toContain('原文 80000 字符')
  })

  it('token 用量经 onUsage 回传（此前子 agent 开销完全不计入会话统计）', async () => {
    h.fake.chat.mockResolvedValueOnce({
      content: '做完了',
      toolCalls: [],
      usage: { prompt: 100, completion: 20, total: 120 }
    })
    const { runSubAgent } = await import('../src/main/agent/loop')
    const seen: { prompt: number; completion: number; total: number }[] = []
    await runSubAgent({
      task: '小任务',
      workspace: '/tmp',
      parentModelId: 'ollama::m',
      permission: {
        request: vi.fn().mockResolvedValue(true),
        requestEx: vi.fn().mockResolvedValue({ approved: true, via: 'user' })
      } as any,
      signal: new AbortController().signal,
      skillDirs: [],
      depth: 0,
      onUsage: (u) => seen.push(u)
    })
    expect(seen).toEqual([{ prompt: 100, completion: 20, total: 120 }])
  })
})

describe('插件可打包子 agent（能力面对齐 Claude Code 插件）', () => {
  it('插件 agents/ 目录里的角色被识别，source=plugin', async () => {
    const { mkdtempSync, writeFileSync, mkdirSync } = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const dir = mkdtempSync(path.join(os.tmpdir(), 'hemi-plugin-agents-'))
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      path.join(dir, 'contract-review.md'),
      '---\nname: contract-review\ndescription: 合同审阅\ntools: read_file, grep\n---\n\n你是合同审阅子 agent。',
      'utf8'
    )
    const { agentManager } = await import('../src/main/agent/agents/manager')
    const list = await agentManager.list('/tmp/__no_ws__', [dir])
    const hit = list.find((a) => a.name === 'contract-review')
    expect(hit).toBeTruthy()
    expect(hit!.source).toBe('plugin')
    expect(hit!.tools).toEqual(['read_file', 'grep'])
    // 内置角色不受影响
    expect(list.map((a) => a.name)).toContain('explore')
  })

  it('工作区自定义可覆盖插件同名角色（优先级 工作区 > 全局 > 插件 > 内置）', async () => {
    const { mkdtempSync, writeFileSync, mkdirSync } = await import('node:fs')
    const os = await import('node:os')
    const path = await import('node:path')
    const pluginDir = mkdtempSync(path.join(os.tmpdir(), 'hemi-pd-'))
    const ws = mkdtempSync(path.join(os.tmpdir(), 'hemi-ws-'))
    writeFileSync(
      path.join(pluginDir, 'explore.md'),
      '---\nname: explore\ndescription: 插件版\n---\n插件正文',
      'utf8'
    )
    const wsAgents = path.join(ws, '.hemilier', 'agents')
    mkdirSync(wsAgents, { recursive: true })
    writeFileSync(
      path.join(wsAgents, 'explore.md'),
      '---\nname: explore\ndescription: 工作区版\n---\n工作区正文',
      'utf8'
    )
    const { agentManager } = await import('../src/main/agent/agents/manager')
    const hit = (await agentManager.list(ws, [pluginDir])).find((a) => a.name === 'explore')!
    expect(hit.source).toBe('workspace')
    expect(hit.description).toBe('工作区版')
  })
})
