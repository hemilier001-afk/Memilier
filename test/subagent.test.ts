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
      permission: { request: vi.fn().mockResolvedValue(true) } as any,
      signal: new AbortController().signal,
      skillDirs: [],
      depth: 0
    })
    expect(report).toContain('子 agent 的报告')
  })

  it('depth>=1 时拒绝再派生（禁递归）', async () => {
    const { runSubAgent } = await import('../src/main/agent/loop')
    const report = await runSubAgent({
      agentName: undefined,
      task: '做点什么',
      workspace: '/tmp',
      parentModelId: 'ollama::m',
      permission: { request: vi.fn() } as any,
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
      permission: { request: vi.fn() } as any,
      signal: new AbortController().signal,
      skillDirs: [],
      depth: 0
    })
    expect(report).toContain('explore')
  })
})
