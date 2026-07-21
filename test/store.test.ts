import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 临时 userData：验证会话按文件持久化 + 旧单文件迁移，不碰真实数据
const tmp = mkdtempSync(path.join(os.tmpdir(), 'hemilier-store-'))
// 预置一个旧版 conversations.json（触发迁移路径）
writeFileSync(
  path.join(tmp, 'conversations.json'),
  JSON.stringify({
    old1: {
      id: 'old1',
      title: '旧会话',
      model: 'ollama::m',
      kind: 'chat',
      messages: [{ id: 'm1', role: 'user', content: '苹果香蕉', createdAt: 1 }],
      workspaceDir: '/tmp',
      createdAt: 1,
      updatedAt: 1
    }
  }),
  'utf8'
)

vi.mock('electron', () => ({
  app: { getPath: () => tmp },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../src/main/images', () => ({
  imageStore: { isRef: () => false, deleteRefs: vi.fn() }
}))

const { store } = await import('../src/main/store')

describe('store 会话按文件持久化', () => {
  it('迁移旧 conversations.json：数据保留 + 生成 conversations/ 目录 + 旧文件备份', () => {
    const list = store.listConversations() // 首次调用触发 ensure() 迁移
    expect(list.some((c) => c.id === 'old1')).toBe(true)
    expect(existsSync(path.join(tmp, 'conversations'))).toBe(true)
    expect(existsSync(path.join(tmp, 'conversations', 'old1.json'))).toBe(true)
    // 旧文件被改名为 .migrated.bak（保留，不删）
    expect(readdirSync(tmp).some((f) => f.startsWith('conversations.json.migrated'))).toBe(true)
  })

  it('新建会话写成独立文件；保存后可读回', () => {
    const c = store.createConversation('chat')
    expect(existsSync(path.join(tmp, 'conversations', `${c.id}.json`))).toBe(true)
    c.messages.push({ id: 'x', role: 'user', content: '橙子', createdAt: 2 } as never)
    store.saveConversation(c)
    store.flush()
    expect(store.getConversation(c.id)?.messages.length).toBe(1)
  })

  it('内容搜索命中消息正文', () => {
    const hits = store.searchConversations('苹果')
    expect(hits.some((h) => h.id === 'old1')).toBe(true)
  })

  it('删除会话：文件移除 + 列表不含', () => {
    store.deleteConversation('old1')
    expect(existsSync(path.join(tmp, 'conversations', 'old1.json'))).toBe(false)
    expect(store.listConversations().some((c) => c.id === 'old1')).toBe(false)
  })
})
