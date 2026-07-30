import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ToolCall } from '@shared/types'

// 共享可变状态（vi.hoisted 保证在 mock 工厂之前求值）
const h = vi.hoisted(() => ({
  conv: {
    id: 'c1',
    title: '新对话',
    model: 'test-model',
    messages: [] as any[],
    workspaceDir: '/tmp/ws',
    createdAt: 0,
    updatedAt: 0
  },
  tool: null as any
}))

vi.mock('../src/main/store', () => ({
  store: {
    getConversation: () => h.conv,
    getSettings: () => ({ defaultModel: 'test-model', workspaceDir: '/tmp/ws' }),
    saveConversation: vi.fn()
  }
}))
vi.mock('../src/main/mcp/manager', () => ({
  mcpManager: {
    listToolDefs: vi.fn().mockResolvedValue([]),
    isMcpTool: () => false,
    callTool: vi.fn()
  }
}))
vi.mock('../src/main/plugins/manager', () => ({
  pluginManager: {
    activePlugins: () => [],
    mcpServers: () => ({})
  }
}))
vi.mock('../src/main/skills/manager', () => ({
  skillManager: { listSkills: vi.fn().mockResolvedValue([]) }
}))
vi.mock('../src/main/agent/tools', () => ({
  listToolDefs: () => [],
  describeTool: () => 'desc',
  getTool: () => h.tool
}))

import { runAgent } from '../src/main/agent/loop'

function makeOpts(
  chatImpl: any,
  permission = {
    request: vi.fn().mockResolvedValue(true),
    requestEx: vi.fn().mockResolvedValue({ approved: true, via: 'user' })
  }
) {
  const events: AgentEvent[] = []
  const opts = {
    conversationId: 'c1',
    userContent: '你好',
    provider: { id: 'test', listModels: vi.fn(), chat: vi.fn(chatImpl) },
    permission: permission as any,
    signal: new AbortController().signal,
    send: (e: AgentEvent) => events.push(e)
  }
  return { opts, events }
}

beforeEach(() => {
  h.conv.messages = []
  h.conv.title = '新对话'
  h.tool = null
})

describe('runAgent', () => {
  it('无工具调用时：输出消息并结束', async () => {
    const { opts, events } = makeOpts(async () => ({ content: '你好呀', toolCalls: [] }))
    await runAgent(opts as any)

    const types = events.map((e) => e.type)
    expect(types).toContain('message')
    expect(types[types.length - 1]).toBe('done')

    // 持久化了用户消息 + 助手消息
    const roles = h.conv.messages.map((m) => m.role)
    expect(roles).toEqual(['user', 'assistant'])
    // 用户首条消息会成为标题
    expect(h.conv.title).toBe('你好')
  })

  it('有工具调用时：执行工具并回灌结果，再产出最终回答', async () => {
    const execute = vi.fn().mockResolvedValue('文件内容')
    h.tool = {
      name: 'read_file',
      sideEffect: 'read',
      schema: { parse: (a: any) => a, safeParse: (a: any) => ({ success: true, data: a }) },
      execute
    }

    const toolCall: ToolCall = {
      id: 't1',
      name: 'read_file',
      args: { path: 'a.txt' },
      status: 'pending'
    }
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ content: '', toolCalls: [toolCall] })
      .mockResolvedValueOnce({ content: '读完了', toolCalls: [] })
    const { opts, events } = makeOpts(chat)

    await runAgent(opts as any)

    expect(execute).toHaveBeenCalledTimes(1)
    const types = events.map((e) => e.type)
    expect(types).toContain('tool_call_start')
    expect(types).toContain('tool_call_result')
    expect(types[types.length - 1]).toBe('done')

    // user / assistant(带工具) / tool(结果) / assistant(最终)
    const roles = h.conv.messages.map((m) => m.role)
    expect(roles).toEqual(['user', 'assistant', 'tool', 'assistant'])
    const toolMsg = h.conv.messages.find((m) => m.role === 'tool')
    expect(toolMsg.content).toBe('文件内容')
  })

  it('参数不合法时：不执行工具，回灌中文提示让模型自纠', async () => {
    const execute = vi.fn()
    h.tool = {
      name: 'read_file',
      sideEffect: 'read',
      schema: {
        parse: (a: any) => a,
        safeParse: () => ({
          success: false,
          error: {
            issues: [
              { code: 'invalid_type', path: ['path'], message: 'Required', received: 'undefined' }
            ]
          }
        })
      },
      execute
    }
    const toolCall: ToolCall = { id: 't1', name: 'read_file', args: {}, status: 'pending' }
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ content: '', toolCalls: [toolCall] })
      .mockResolvedValueOnce({ content: '好的', toolCalls: [] })
    const { opts } = makeOpts(chat)

    await runAgent(opts as any)

    expect(execute).not.toHaveBeenCalled()
    const toolMsg = h.conv.messages.find((m) => m.role === 'tool')
    expect(toolMsg.content).toMatch(/参数不合法/)
  })

  it('权限被拒绝时：不执行工具，回灌拒绝信息', async () => {
    const execute = vi.fn()
    h.tool = {
      name: 'write_file',
      sideEffect: 'write',
      schema: { parse: (a: any) => a, safeParse: (a: any) => ({ success: true, data: a }) },
      execute
    }
    const permission = {
      request: vi.fn().mockResolvedValue(false),
      requestEx: vi.fn().mockResolvedValue({ approved: false, via: 'user' })
    }

    const toolCall: ToolCall = { id: 't1', name: 'write_file', args: {}, status: 'pending' }
    const chat = vi
      .fn()
      .mockResolvedValueOnce({ content: '', toolCalls: [toolCall] })
      .mockResolvedValueOnce({ content: '好的，已停止', toolCalls: [] })
    const { opts, events } = makeOpts(chat, permission)

    await runAgent(opts as any)

    expect(execute).not.toHaveBeenCalled()
    const toolMsg = h.conv.messages.find((m) => m.role === 'tool')
    expect(toolMsg.content).toMatch(/拒绝/)
    expect(events[events.length - 1].type).toBe('done')
  })
})

describe('系统提示（智能体的行为基线）', () => {
  /** 跑一轮并捕获发给模型的 system 提示 */
  async function captureSystem(kind?: string): Promise<string> {
    if (kind) (h.conv as any).kind = kind
    let sys = ''
    const { opts } = makeOpts(async (o: any) => {
      sys = o.messages[0].content
      return { content: 'ok', toolCalls: [] }
    })
    await runAgent(opts as any)
    return sys
  }

  it('身份涵盖办公与编码两类能力，并明确列出办公工具', async () => {
    const sys = await captureSystem()
    expect(sys).toContain('通用智能体')
    // 回归防线：不要再退回成"编码智能体"（那会让模型不主动用办公工具）
    expect(sys).not.toContain('具备工具调用能力的编码智能体')
    for (const t of ['read_document', 'write_docx', 'write_xlsx', 'export_pdf']) {
      expect(sys).toContain(t)
    }
  })

  it('含「多步必列计划」与「完成后验证」的硬要求', async () => {
    const sys = await captureSystem()
    expect(sys).toContain('update_plan')
    expect(sys).toContain('完成后要验证')
  })

  it('按空间注入不同侧重（三空间此前共用一套提示）', async () => {
    expect(await captureSystem('cowork')).toContain('Cowork')
    expect(await captureSystem('code')).toContain('Code（编码）')
    expect(await captureSystem('chat')).toContain('Chat（日常）')
  })
})

describe('上下文预算（messageSize）', () => {
  it('不把工具结果重复计入预算（结果走独立 tool 消息，不进 assistant 请求体）', async () => {
    const { messageSize } = await import('../src/main/agent/loop')
    const big = 'x'.repeat(50_000)
    const assistantWithCall = {
      id: 'a',
      role: 'assistant' as const,
      content: '',
      toolCalls: [
        { id: 't1', name: 'read_document', args: { path: 'a.xlsx' }, status: 'done', result: big }
      ],
      createdAt: 0
    }
    const toolMsg = { id: 't', role: 'tool' as const, content: big, toolCallId: 't1', createdAt: 0 }
    // 旧实现会把 50k 的 result 也算进去 → 同一份输出计两遍
    expect(messageSize(assistantWithCall as never)).toBeLessThan(500)
    expect(messageSize(toolMsg as never)).toBe(big.length)
  })

  it('正常消息仍按内容长度计', async () => {
    const { messageSize } = await import('../src/main/agent/loop')
    expect(messageSize({ id: 'x', role: 'user', content: '你好', createdAt: 0 } as never)).toBe(2)
  })
})
