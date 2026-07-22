import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync
} from 'node:fs'
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
let convSaveTimer: ReturnType<typeof setTimeout> | null = null
let settingsPath = ''
let convPath = ''
let convDir = ''
let projectsPath = ''
let settings: Settings
let conversations: Record<string, Conversation> = {}
let projects: Record<string, Project> = {}
// 防抖期间累积的"待落盘会话 id"：只重写变化的那几个会话文件，而非整库（旧单文件方案的性能天花板）
const dirtyConvIds = new Set<string>()

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

// ——— 会话按文件持久化：一会话一文件 <convDir>/<id>.json ———
function convFile(id: string): string {
  return path.join(convDir, `${id}.json`)
}
/** 落盘单个会话（原子写）；只有它变化时才重写它的文件，不动其它会话 */
function persistConv(c: Conversation): void {
  try {
    writeJSON(convFile(c.id), c)
  } catch (e) {
    console.error(`[store] 保存会话 ${c.id} 失败：`, e)
  }
}
/** 把脏集里的会话逐个落盘 */
function flushDirtyConvs(): void {
  convSaveTimer = null
  for (const id of dirtyConvIds) {
    const c = conversations[id]
    if (c) persistConv(c)
  }
  dirtyConvIds.clear()
}
function removeConvFile(id: string): void {
  try {
    if (existsSync(convFile(id))) renameSync(convFile(id), `${convFile(id)}.deleted`)
  } catch {
    /* 删除失败忽略：下次启动会作为孤儿被跳过 */
  }
}
/** 从会话目录加载全部会话；单个文件损坏只跳过它（不连累整库，比旧单文件方案更稳） */
function loadConvDir(): Record<string, Conversation> {
  const out: Record<string, Conversation> = {}
  let files: string[] = []
  try {
    files = readdirSync(convDir)
  } catch {
    return out
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    try {
      const c = JSON.parse(readFileSync(path.join(convDir, f), 'utf8')) as Conversation
      if (c && c.id) out[c.id] = c
    } catch (e) {
      console.error(`[store] 会话文件 ${f} 损坏，已跳过：`, e)
    }
  }
  return out
}

function ensure(): void {
  if (loaded) return
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  settingsPath = path.join(dir, 'settings.json')
  convPath = path.join(dir, 'conversations.json')
  convDir = path.join(dir, 'conversations')
  projectsPath = path.join(dir, 'projects.json')
  settings = withDecryptedKeys({ ...defaults(), ...readJSON<Partial<Settings>>(settingsPath, {}) })
  projects = readJSON<Record<string, Project>>(projectsPath, {})

  // 会话存储迁移：旧版单文件 conversations.json → 一会话一文件目录。
  // 迁移时把旧文件重命名为 .migrated.bak（保留原始数据，绝不删除，杜绝数据丢失）。
  if (!existsSync(convDir)) {
    mkdirSync(convDir, { recursive: true })
    if (existsSync(convPath)) {
      const old = readJSON<Record<string, Conversation>>(convPath, {})
      for (const c of Object.values(old)) if (c && c.id) persistConv(c)
      try {
        renameSync(convPath, `${convPath}.migrated-${Date.now()}.bak`)
      } catch {
        /* 备份改名失败也无妨，数据已在新目录 */
      }
    }
  }
  conversations = loadConvDir()
  loaded = true
  migrateModelIds()
  migrateTrustedMcp()
}

// 首次引入信任门：对老用户，把他们已手动配置的 mcpServers 直接授信（是本人添加的），
// 避免升级后现有 MCP 突然失效；插件/新来源的 server 仍需显式信任。
function migrateTrustedMcp(): void {
  if (settings.trustedMcp !== undefined) return
  const sigs = Object.entries(settings.mcpServers ?? {}).map(
    ([name, cfg]) =>
      `${name}::${JSON.stringify([cfg.command, cfg.args ?? [], cfg.env ?? {}, cfg.url, cfg.type])}`
  )
  settings.trustedMcp = sigs
  writeJSON(settingsPath, withEncryptedKeys(settings))
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
  if (changed) for (const c of Object.values(conversations)) persistConv(c)
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
  /** 导出全部数据用于备份/迁移（API Key 不导出，安全） */
  exportAll(): {
    version: number
    conversations: Conversation[]
    projects: Project[]
    settings: Settings
  } {
    ensure()
    const safeSettings = {
      ...settings,
      providers: (settings.providers ?? []).map((p) => ({ ...p, apiKey: '' }))
    }
    return {
      version: 1,
      conversations: Object.values(conversations),
      projects: Object.values(projects),
      settings: safeSettings
    }
  },
  /** 从备份导入：合并会话与项目（同 id 覆盖），设置按字段合并（不动已存的 API Key） */
  importAll(data: {
    conversations?: Conversation[]
    projects?: Project[]
    settings?: Partial<Settings>
  }): { conversations: number; projects: number } {
    ensure()
    let nc = 0
    for (const c of data.conversations ?? []) {
      if (c && c.id) {
        conversations[c.id] = c
        nc++
      }
    }
    let np = 0
    for (const p of data.projects ?? []) {
      if (p && p.id) {
        projects[p.id] = p
        np++
      }
    }
    if (nc) for (const c of data.conversations ?? []) if (c && c.id) persistConv(c)
    if (np) writeJSON(projectsPath, projects)
    if (data.settings) {
      // 导入的设置不带 API Key（导出时已抹掉）；保留本机已有的 providers Key
      const incoming = { ...data.settings }
      delete (incoming as { providers?: unknown }).providers
      settings = { ...settings, ...incoming }
      writeJSON(settingsPath, withEncryptedKeys(settings))
    }
    return { conversations: nc, projects: np }
  },
  /** 按关键词检索会话内容（标题 + 消息正文），返回带片段的摘要 */
  searchConversations(query: string, limit = 30): { id: string; title: string; snippet: string }[] {
    ensure()
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!terms.length) return []
    const out: { id: string; title: string; snippet: string; score: number; at: number }[] = []
    for (const c of Object.values(conversations)) {
      let snippet = ''
      let score = terms.reduce((n, t) => n + (c.title.toLowerCase().includes(t) ? 2 : 0), 0)
      for (const m of c.messages) {
        if (!m.content || m.role === 'system') continue
        const lc = m.content.toLowerCase()
        const hit = terms.reduce((n, t) => n + (lc.includes(t) ? 1 : 0), 0)
        if (hit && !snippet) {
          const idx = lc.indexOf(terms[0])
          snippet = m.content.slice(Math.max(0, idx - 30), idx + 90).trim()
        }
        score += hit
      }
      if (score > 0) out.push({ id: c.id, title: c.title, snippet, score, at: c.updatedAt || 0 })
    }
    out.sort((a, b) => b.score - a.score || b.at - a.at)
    return out.slice(0, limit).map(({ id, title, snippet }) => ({ id, title, snippet }))
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
    dirtyConvIds.add(c.id)
    // 防抖合并写：agent 循环里每条消息/每批工具结果都会保存。300ms 内的多次保存合并为一次，
    // 只重写"脏"的那几个会话文件（不再整库重写）；退出前由 flush() 兜底落盘。
    if (convSaveTimer) return
    convSaveTimer = setTimeout(flushDirtyConvs, 300)
  },
  /** 把防抖中的对话立即落盘（应用退出前调用） */
  flush(): void {
    if (convSaveTimer) {
      clearTimeout(convSaveTimer)
      convSaveTimer = null
    }
    flushDirtyConvs()
  },
  createConversation(kind: ConversationKind = 'chat', projectId?: string): Conversation {
    ensure()
    const now = Date.now()
    const c: Conversation = {
      id: randomUUID(),
      title: settings.language === 'en' ? 'New chat' : '新对话',
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
    persistConv(c)
    return c
  },
  deleteConversation(id: string): void {
    ensure()
    delete conversations[id]
    dirtyConvIds.delete(id)
    removeConvFile(id)
  },
  renameConversation(id: string, title: string): void {
    ensure()
    const c = conversations[id]
    if (c) {
      c.title = title
      persistConv(c)
    }
  },
  setConversationModel(id: string, model: string): void {
    ensure()
    const c = conversations[id]
    if (c) {
      c.model = model
      persistConv(c)
    }
  },
  setConversationMode(id: string, mode: 'auto' | 'plan' | 'chat'): void {
    ensure()
    const c = conversations[id]
    if (c) {
      c.mode = mode
      persistConv(c)
    }
  },
  setConversationDistilled(id: string): void {
    ensure()
    const c = conversations[id]
    if (c) {
      c.distilled = true
      persistConv(c)
    }
  },
  setConversationPinned(id: string, pinned: boolean): void {
    ensure()
    const c = conversations[id]
    if (c) {
      c.pinned = pinned || undefined
      persistConv(c)
    }
  },
  setConversationWorkspace(id: string, dir: string): void {
    ensure()
    const c = conversations[id]
    if (c) {
      c.workspaceDir = dir
      persistConv(c)
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
    persistConv(c)
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
      persistConv(c)
    }
  },

  setConversationProject(id: string, projectId: string | null): void {
    ensure()
    const c = conversations[id]
    if (c) {
      c.projectId = projectId ?? undefined
      persistConv(c)
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
    if (changed) for (const c of Object.values(conversations)) persistConv(c)
  }
}
