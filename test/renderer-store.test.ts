// 渲染端多会话状态机（handleAgentEvent）单测：
// 前台/后台会话互不干扰是并行体验的核心保证，这里锁定其行为防回归。
import { beforeEach, describe, expect, it, vi } from 'vitest'

// store.ts 在动作里访问 window.api / matchMedia，模块加载前先垫最小 shim
;(globalThis as unknown as { window: unknown }).window = {
  api: {
    // done/error 分支会刷新会话列表（更新侧栏标题/时间）
    listConversations: async () => []
  },
  matchMedia: () => ({ matches: false }),
  addEventListener: () => {},
  removeEventListener: () => {}
}
;(globalThis as unknown as { document: unknown }).document = {
  documentElement: { classList: { toggle: vi.fn() }, dataset: {} }
}

const { useStore, handleAgentEvent } = await import('../src/renderer/src/store')
type S = ReturnType<typeof useStore.getState>

const conv = (id: string): S['active'] =>
  ({
    id,
    title: id,
    model: 'm',
    kind: 'chat',
    messages: [],
    workspaceDir: '/tmp',
    createdAt: 1,
    updatedAt: 1
  }) as unknown as S['active']

const fire = (cid: string, event: unknown): void =>
  handleAgentEvent(
    cid,
    event as Parameters<typeof handleAgentEvent>[1],
    useStore.setState as never,
    useStore.getState
  )

describe('handleAgentEvent 多会话状态机', () => {
  beforeEach(() => {
    useStore.setState({
      active: conv('A'),
      streaming: true,
      streamingText: '',
      runningIds: ['A'],
      plan: [],
      diffs: []
    })
  })

  it('前台会话 token 追加到 streamingText', () => {
    fire('A', { type: 'token', text: '你好' })
    fire('A', { type: 'token', text: '世界' })
    expect(useStore.getState().streamingText).toBe('你好世界')
  })

  it('后台会话 token 只记账，不污染前台 streamingText', () => {
    fire('B', { type: 'token', text: '后台输出' })
    const s = useStore.getState()
    expect(s.streamingText).toBe('') // 前台不受影响
    expect(s.runningIds).toContain('B') // 但记为运行中（侧栏圆点/徽标依赖）
  })

  it('后台会话 done 不清前台 streaming 状态', () => {
    fire('B', { type: 'token', text: 'x' })
    fire('B', { type: 'done' })
    const s = useStore.getState()
    expect(s.streaming).toBe(true) // 前台 A 仍在跑
    expect(s.runningIds).toEqual(['A']) // B 已出列
  })

  it('前台 done 结束 streaming 并出列', () => {
    fire('A', { type: 'done' })
    const s = useStore.getState()
    expect(s.streaming).toBe(false)
    expect(s.runningIds).toEqual([])
  })

  it('前台 assistant 消息落地后清空流式缓冲', () => {
    fire('A', { type: 'token', text: '生成中' })
    fire('A', {
      type: 'message',
      message: { id: 'm1', role: 'assistant', content: '完整回答', createdAt: 2 }
    })
    const s = useStore.getState()
    expect(s.streamingText).toBe('')
    expect(s.active?.messages.map((m) => m.id)).toEqual(['m1'])
  })

  it('后台会话的消息不追加进前台 active', () => {
    fire('B', {
      type: 'message',
      message: { id: 'mB', role: 'assistant', content: 'B 的回答', createdAt: 2 }
    })
    expect(useStore.getState().active?.messages).toHaveLength(0)
  })
})
