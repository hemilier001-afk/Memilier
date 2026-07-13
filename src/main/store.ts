import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import type { Conversation, ConversationKind, Message, Project, Settings } from '@shared/types'
import { imageStore } from './images'

// 被移除消息里引用的图片文件一并清理，避免孤儿文件在 userData/images 里越积越多
function cleanupImages(removed: Message[]): void {
  const refs = removed.flatMap((m) => m.images ?? []).filter((v) => imageStore.isRef(v))
  if (refs.length) imageStore.deleteRefs(refs)
}

// API Key 等机密的本地加密（用系统钥匙串；不可用时退回明文）。落盘加密、内存明文。
const ENC_PREFIX = 'safe:'
function encSecret(s: string | undefined): string | undefined {
  if (!s || s.startsWith(ENC_PREFIX)) return s
  try {
    if (safeStorage.isEncryptionAvailable())
      return ENC_PREFIX + safeStorage.encryptString(s).toString('base64')
  } catch {
    /* 加密不可用则保持明文 */
  }
  return s
}
function decSecret(s: string | undefined): string | undefined {
  if (!s || !s.startsWith(ENC_PREFIX)) return s
  try {
    return safeStorage.decryptString(Buffer.from(s.slice(ENC_PREFIX.length), 'base64'))
  } catch {
    return ''
  }
}
function withEncryptedKeys(s: Settings): Settings {
  return {
    ...s,
    providers: (s.providers ?? []).map((p) => ({ ...p, apiKey: encSecret(p.apiKey) }))
  }
}
function withDecryptedKeys(s: Settings): Settings {
  return {
    ...s,
    providers: (s.providers ?? []).map((p) => ({ ...p, apiKey: decSecret(p.apiKey) }))
  }
}

let loaded = false
let settingsPath = ''
let convPath = ''
let projectsPath = ''
let settings: Settings
let conversations: Record<string, Conversation> = {}
let projects: Record<string, Project> = {}

function defaults(): Settings {
  return {
    ollamaBaseUrl: 'http://localhost:11434',
    defaultModel: '',
    workspaceDir: app.getPath('home'),
    theme: 'system',
    language: 'zh',
    autoApproveReadOnly: true,
    submitKey: 'enter',
    mcpServers: {},
    providers: [],
    customInstructions: {}
  }
}

function readJSON<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch (e) {
    // 文件存在但解析失败（损坏）→ 备份后再用空值，避免后续写入静默覆盖、彻底丢数据
    if (existsSync(file)) {
      try {
        renameSync(file, `${file}.corrupt-${Date.now()}.bak`)
        console.error(`[store] ${file} 解析失败，已备份为 .corrupt.bak：`, e)
      } catch {
        /* 备份失败也继续 */
      }
    }
    return fallback
  }
}

// 原子写：先写临时文件再 rename，避免写入中途崩溃损坏原文件（丢失全部数据）
function writeJSON(file: string, data: unknown): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, file)
}

function ensure(): void {
  if (loaded) return
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  settingsPath = path.join(dir, 'settings.json')
  convPath = path.join(dir, 'conversations.json')
  projectsPath = path.join(dir, 'projects.json')
  settings = withDecryptedKeys({ ...defaults(), ...readJSON<Partial<Settings>>(settingsPath, {}) })
  conversations = readJSON<Record<string, Conversation>>(convPath, {})
  projects = readJSON<Record<string, Project>>(projectsPath, {})
  loaded = true
  migrateModelIds()
}

// 旧版模型 id 是裸名（如 "qwen2.5"），统一加上 "ollama::" 前缀以适配多提供方路由
function migrateModelIds(): void {
  let changed = false
  const fix = (m: string): string => (m && !m.includes('::') ? `ollama::${m}` : m)
  if (settings.defaultModel && !settings.defaultModel.includes('::')) {
    settings.defaultModel = fix(settings.defaultModel)
    writeJSON(settingsPath, withEncryptedKeys(settings))
  }
  for (const c of Object.values(conversations)) {
    const next = fix(c.model)
    if (next !== c.model) {
      c.model = next
      changed = true
    }
    if (!c.kind) {
      c.kind = 'chat' // 旧对话归入 Chat 空间
      changed = true
    }
  }
  if (changed) writeJSON(convPath, conversations)
}

export const store = {
  getSettings(): Settings {
    ensure()
    return settings
  },
  setSettings(patch: Partial<Settings>): Settings {
    ensure()
    settings = { ...settings, ...patch }
    writeJSON(settingsPath, withEncryptedKeys(settings))
    return settings
  },
  listConversations(): Conversation[] {
    ensure()
    return Object.values(conversations).sort((a, b) => b.updatedAt - a.updatedAt)
  },
  /** 跨对话按关键词检索历史（供 recall 工具）；返回最相关的片段文本 */
  searchHistory(query: string, excludeId?: string, limit = 8): string {
    ensure()
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return '（查询为空）'
    const hits: { score: number; conv: Conversation; content: string; role: string }[] = []
    for (const c of Object.values(conversations)) {
      if (c.id === excludeId) continue
      for (const m of c.messages) {
        if (m.role === 'system' || !m.content) continue
        const text = m.content.toLowerCase()
        const score = terms.reduce((n, t) => n + (text.includes(t) ? 1 : 0), 0)
        if (score > 0) hits.push({ score, conv: c, content: m.content, role: m.role })
      }
    }
    hits.sort((a, b) => b.score - a.score || (b.conv.updatedAt || 0) - (a.conv.updatedAt || 0))
    const top = hits.slice(0, limit)
    if (!top.length) return '未找到相关历史。'
    return top
      .map((h) => {
        const date = new Date(h.conv.updatedAt || h.conv.createdAt).toLocaleString()
        const snippet = h.content.length > 320 ? `${h.content.slice(0, 320)}…` : h.content
        return `【${h.conv.title} · ${date} · ${h.role}】\n${snippet}`
      })
      .join('\n\n')
  },
  getConversation(id: string): Conversation | null {
    ensure()
    return conversations[id] ?? null
  },
  saveConversation(c: Conversation): void {
    ensure()
    conversations[c.id] = c
    writeJSON(convPath, conversations)
  },
  createConversation(kind: ConversationKind = 'chat', projectId?: string): Conversation {
    ensure()
    const now = Date.now()
    const c: Conversation = {
      id: randomUUID(),
      title: '新对话',
      model: settings.defaultModel,
      kind,
      mode: 'auto',
      projectId: projectId ?? undefined,
      messages: [],
      workspaceDir: settings.workspaceDir,
      createdAt: now,
      updatedAt: now
    }
    conversations[c.id] = c
    writeJSON(convPath, conversations)
    return c
  },
  deleteConversation(id: string): void {
    ensure()
    delete conversations[id]
    writeJSON(convPath, conversations)
  },
  renameConversation(id: string, title: string): void {
    ensure()
    const c = conversations[id]
    if (c) {
      c.title = title
      writeJSON(convPath, conversations)
    }
  },
  setConversationModel(id: string, model: string): void {
    ensure()
    const c = conversations[id]
    if (c) {
      c.model = model
      writeJSON(convPath, conversations)
    }
  },
  setConversationMode(id: string, mode: 'auto' | 'plan' | 'chat'): void {
    ensure()
    const c = conversations[id]
    if (c) {
      c.mode = mode
      writeJSON(convPath, conversations)
    }
  },
  setConversationWorkspace(id: string, dir: string): void {
    ensure()
    const c = conversations[id]
    if (c) {
      c.workspaceDir = dir
      writeJSON(convPath, conversations)
    }
  },
  /** 删除末尾的 assistant / tool 消息，回退到最后一条 user 消息（用于「重新生成」） */
  trimToLastUser(id: string): void {
    ensure()
    const c = conversations[id]
    if (!c) return
    const removed: Message[] = []
    while (c.messages.length && c.messages[c.messages.length - 1].role !== 'user') {
      removed.push(c.messages.pop()!)
    }
    cleanupImages(removed)
    writeJSON(convPath, conversations)
  },

  /** 截断到某条消息之前（删除该消息及其之后的全部），用于「编辑并重发」 */
  truncateFrom(id: string, messageId: string): void {
    ensure()
    const c = conversations[id]
    if (!c) return
    const idx = c.messages.findIndex((m) => m.id === messageId)
    if (idx >= 0) {
      cleanupImages(c.messages.slice(idx))
      c.messages = c.messages.slice(0, idx)
      writeJSON(convPath, conversations)
    }
  },

  setConversationProject(id: string, projectId: string | null): void {
    ensure()
    const c = conversations[id]
    if (c) {
      c.projectId = projectId ?? undefined
      writeJSON(convPath, conversations)
    }
  },

  // ——— 项目 ———
  listProjects(): Project[] {
    ensure()
    return Object.values(projects).sort((a, b) => b.createdAt - a.createdAt)
  },
  createProject(name: string, kind: ConversationKind): Project {
    ensure()
    const p: Project = {
      id: randomUUID(),
      name: name.trim() || '新项目',
      kind,
      createdAt: Date.now()
    }
    projects[p.id] = p
    writeJSON(projectsPath, projects)
    return p
  },
  renameProject(id: string, name: string): void {
    ensure()
    const p = projects[id]
    if (p) {
      p.name = name.trim() || p.name
      writeJSON(projectsPath, projects)
    }
  },
  deleteProject(id: string): void {
    ensure()
    delete projects[id]
    writeJSON(projectsPath, projects)
    // 把该项目下的对话变为未分组
    let changed = false
    for (const c of Object.values(conversations)) {
      if (c.projectId === id) {
        c.projectId = undefined
        changed = true
      }
    }
    if (changed) writeJSON(convPath, conversations)
  }
}
