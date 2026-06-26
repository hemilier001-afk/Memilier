import { create } from 'zustand'
import type {
  AgentEvent,
  BackgroundTask,
  Conversation,
  DiffEntry,
  ModelInfo,
  PermissionRequest,
  PlanStep,
  Project,
  Routine,
  Settings
} from '@shared/types'

// 防止 React StrictMode 下 init 跑两次导致 IPC 监听器重复注册（会造成消息重复）
let listenersAttached = false

function applyTheme(theme: Settings['theme']): void {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export type View = 'chat' | 'cowork' | 'code'
export type ToolView = 'normal' | 'verbose' | 'summary'

interface UIState {
  settings: Settings | null
  models: ModelInfo[]
  conversations: Conversation[]
  projects: Project[]
  activeProjectId: string | null
  active: Conversation | null
  streaming: boolean
  streamingText: string
  permission: PermissionRequest | null
  settingsOpen: boolean
  customizeOpen: boolean
  routinesOpen: boolean
  tasksOpen: boolean
  routines: Routine[]
  tasks: BackgroundTask[]
  view: View
  sidebarCollapsed: boolean
  toolView: ToolView
  rightPanelOpen: boolean
  rightTab: 'files' | 'preview' | 'diff' | 'plan' | 'terminal' | 'git' | 'memory'
  preview: { path: string; content: string } | null
  // 当前对话的工作区数据
  plan: PlanStep[]
  diffs: DiffEntry[]
  terminalOutput: string
  terminalRunning: boolean

  init: () => Promise<void>
  refreshModels: () => Promise<void>
  selectConversation: (id: string) => Promise<void>
  newConversation: () => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  renameConversation: (id: string, title: string) => Promise<void>
  pendingEdit: { id: string; content: string } | null
  send: (content: string, images?: string[]) => void
  regenerate: () => void
  editResend: (messageId: string, content: string) => Promise<void>
  setPendingEdit: (p: { id: string; content: string } | null) => void
  exportActive: () => void
  reflect: () => void
  abort: () => void
  setActiveModel: (model: string) => void
  setActiveMode: (mode: 'auto' | 'plan' | 'chat') => void
  pickActiveWorkspace: () => Promise<void>
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  setSettingsOpen: (open: boolean) => void
  setCustomizeOpen: (open: boolean) => void
  respondPermission: (approved: boolean, remember: boolean) => void
  refreshProjects: () => Promise<void>
  createProject: (name: string) => Promise<void>
  renameProject: (id: string, name: string) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  setActiveProject: (id: string | null) => void
  assignConversation: (convId: string, projectId: string | null) => Promise<void>
  setRoutinesOpen: (open: boolean) => void
  setTasksOpen: (open: boolean) => void
  refreshRoutines: () => Promise<void>
  saveRoutine: (routine: Routine) => Promise<void>
  deleteRoutine: (id: string) => Promise<void>
  runRoutineNow: (id: string) => Promise<void>
  openTaskConversation: (conversationId: string) => Promise<void>
  setView: (view: View) => void
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
  setToolView: (mode: ToolView) => void
  toggleRightPanel: () => void
  setRightTab: (tab: 'files' | 'preview' | 'diff' | 'plan' | 'terminal' | 'git' | 'memory') => void
  openFile: (relPath: string) => Promise<void>
  setPreviewContent: (content: string) => void
  runTerminal: (command: string) => void
  killTerminal: () => void
  clearTerminal: () => void
}

export const useStore = create<UIState>((set, get) => ({
  settings: null,
  models: [],
  conversations: [],
  projects: [],
  activeProjectId: null,
  active: null,
  streaming: false,
  streamingText: '',
  permission: null,
  settingsOpen: false,
  customizeOpen: false,
  pendingEdit: null,
  routinesOpen: false,
  tasksOpen: false,
  routines: [],
  tasks: [],
  view: 'chat',
  sidebarCollapsed: false,
  toolView: 'normal',
  rightPanelOpen: false,
  rightTab: 'files',
  preview: null,
  plan: [],
  diffs: [],
  terminalOutput: '',
  terminalRunning: false,

  init: async () => {
    const [settings, conversations, projects, routines, tasks] = await Promise.all([
      window.api.getSettings(),
      window.api.listConversations(),
      window.api.listProjects(),
      window.api.listRoutines(),
      window.api.listTasks()
    ])
    applyTheme(settings.theme)
    set({ settings, conversations, projects, routines, tasks })
    void get().refreshModels()

    const firstChat = conversations.find((c) => (c.kind ?? 'chat') === 'chat')
    if (firstChat) {
      await get().selectConversation(firstChat.id)
    }

    if (!listenersAttached) {
      listenersAttached = true
      window.api.onAgentEvent(({ conversationId, event }) => {
        handleAgentEvent(conversationId, event, set, get)
      })
      window.api.onPermissionRequest((req) => set({ permission: req }))
      window.api.onTasksUpdate((tasks) => {
        // 后台任务会新建对话，顺带刷新对话列表
        set({ tasks })
        void window.api.listConversations().then((conversations) => set({ conversations }))
      })
      window.api.onTerminalEvent((e) => {
        if (get().active?.id !== e.conversationId) return
        if (e.type === 'exit') {
          set({
            terminalRunning: false,
            terminalOutput: `${get().terminalOutput}\n[进程结束 ${e.code ?? 0}]\n`
          })
        } else if (e.data) {
          set({ terminalOutput: get().terminalOutput + e.data })
        }
      })
    }
  },

  refreshModels: async () => {
    const models = await window.api.listModels()
    set({ models })
    // 若尚未选模型且有可用模型，默认选第一个
    const s = get().settings
    if (s && !s.defaultModel && models.length) {
      await get().updateSettings({ defaultModel: models[0].name })
    }
  },

  selectConversation: async (id) => {
    const conv = await window.api.getConversation(id)
    set({
      active: conv,
      streamingText: '',
      streaming: false,
      plan: conv?.plan ?? [],
      diffs: [],
      terminalOutput: '',
      terminalRunning: false
    })
  },

  newConversation: async () => {
    const conv = await window.api.createConversation(get().view, get().activeProjectId ?? undefined)
    const conversations = await window.api.listConversations()
    set({
      conversations,
      active: conv,
      streamingText: '',
      streaming: false,
      plan: [],
      diffs: [],
      terminalOutput: '',
      terminalRunning: false
    })
  },

  deleteConversation: async (id) => {
    await window.api.deleteConversation(id)
    const conversations = await window.api.listConversations()
    const active = get().active
    set({ conversations })
    if (active?.id === id) {
      const view = get().view
      const next = conversations.find((c) => (c.kind ?? 'chat') === view)
      if (next) await get().selectConversation(next.id)
      else set({ active: null })
    }
  },

  renameConversation: async (id, title) => {
    const name = title.trim()
    if (!name) return
    await window.api.renameConversation(id, name)
    const active = get().active
    set({
      conversations: get().conversations.map((c) => (c.id === id ? { ...c, title: name } : c)),
      active: active?.id === id ? { ...active, title: name } : active
    })
  },

  send: (content, images) => {
    const active = get().active
    if (!active || (!content.trim() && !images?.length)) return
    const userMsg = {
      id: crypto.randomUUID(),
      role: 'user' as const,
      content,
      images: images?.length ? images : undefined,
      createdAt: Date.now()
    }
    set({
      active: { ...active, messages: [...active.messages, userMsg] },
      streaming: true,
      streamingText: ''
    })
    void window.api.sendMessage(active.id, content, images)
  },

  regenerate: () => {
    const active = get().active
    if (!active || get().streaming) return
    // 回退到最后一条 user 消息（去掉末尾的 assistant/tool），与主进程一致
    const messages = [...active.messages]
    while (messages.length && messages[messages.length - 1].role !== 'user') messages.pop()
    if (!messages.length) return
    set({ active: { ...active, messages }, streaming: true, streamingText: '' })
    void window.api.regenerate(active.id)
  },

  editResend: async (messageId, content) => {
    const active = get().active
    if (!active || get().streaming) return
    await window.api.truncateFrom(active.id, messageId)
    const idx = active.messages.findIndex((m) => m.id === messageId)
    const truncated = idx >= 0 ? active.messages.slice(0, idx) : active.messages
    set({ active: { ...active, messages: truncated } })
    get().send(content)
  },

  setPendingEdit: (p) => set({ pendingEdit: p }),

  exportActive: () => {
    const active = get().active
    if (active) void window.api.exportConversation(active.id)
  },

  reflect: () => {
    const active = get().active
    if (!active || get().streaming) return
    get().send(
      '请回顾本次对话并做沉淀：1) 把对项目长期有用的事实/约定/坑/决策/用户偏好用 add_memory 各记一条（先参考已有记忆，避免重复）；2) 如果出现了可复用的操作流程，用 save_skill 沉淀为技能；3) 用一两句话说明你记了什么、沉淀了什么。'
    )
  },

  abort: () => {
    const active = get().active
    if (active) void window.api.abort(active.id)
    set({ streaming: false, streamingText: '' })
  },

  setActiveModel: (model) => {
    const active = get().active
    if (!active) return
    set({ active: { ...active, model } })
    void window.api.setConversationModel(active.id, model)
    // 同步为后续新对话的默认模型
    void get().updateSettings({ defaultModel: model })
  },

  setActiveMode: (mode) => {
    const active = get().active
    if (!active) return
    set({ active: { ...active, mode } })
    void window.api.setConversationMode(active.id, mode)
  },

  pickActiveWorkspace: async () => {
    const active = get().active
    if (!active) return
    const dir = await window.api.pickWorkspace()
    if (!dir) return
    set({ active: { ...active, workspaceDir: dir } })
    await window.api.setConversationWorkspace(active.id, dir)
  },

  updateSettings: async (patch) => {
    const settings = await window.api.setSettings(patch)
    if (patch.theme) applyTheme(settings.theme)
    set({ settings })
  },

  setSettingsOpen: (open) => set({ settingsOpen: open }),

  setCustomizeOpen: (open) => set({ customizeOpen: open }),

  refreshProjects: async () => {
    set({ projects: await window.api.listProjects() })
  },

  createProject: async (name) => {
    const p = await window.api.createProject(name, get().view)
    set({ projects: await window.api.listProjects(), activeProjectId: p.id })
  },

  renameProject: async (id, name) => {
    await window.api.renameProject(id, name)
    set({ projects: await window.api.listProjects() })
  },

  deleteProject: async (id) => {
    await window.api.deleteProject(id)
    const [projects, conversations] = await Promise.all([
      window.api.listProjects(),
      window.api.listConversations()
    ])
    set({
      projects,
      conversations,
      activeProjectId: get().activeProjectId === id ? null : get().activeProjectId
    })
  },

  setActiveProject: (id) => set({ activeProjectId: id }),

  assignConversation: async (convId, projectId) => {
    await window.api.setConversationProject(convId, projectId)
    set({ conversations: await window.api.listConversations() })
  },

  setRoutinesOpen: (open) => set({ routinesOpen: open }),
  setTasksOpen: (open) => set({ tasksOpen: open }),

  refreshRoutines: async () => {
    set({ routines: await window.api.listRoutines() })
  },

  saveRoutine: async (routine) => {
    await window.api.saveRoutine(routine)
    set({ routines: await window.api.listRoutines() })
  },

  deleteRoutine: async (id) => {
    await window.api.deleteRoutine(id)
    set({ routines: await window.api.listRoutines() })
  },

  runRoutineNow: async (id) => {
    await window.api.runRoutineNow(id)
  },

  openTaskConversation: async (conversationId) => {
    set({ tasksOpen: false })
    await get().selectConversation(conversationId)
  },

  respondPermission: (approved, remember) => {
    const req = get().permission
    if (!req) return
    void window.api.respondPermission(req.id, approved, remember)
    set({ permission: null })
  },

  setView: (view) => {
    // 切换空间时载入该空间自己的最近对话，互不干扰
    const next = get().conversations.find((c) => (c.kind ?? 'chat') === view)
    set({
      view,
      activeProjectId: null,
      rightPanelOpen: view !== 'chat',
      rightTab: 'files',
      active: next ?? null,
      streaming: false,
      streamingText: '',
      plan: next?.plan ?? [],
      diffs: [],
      terminalOutput: '',
      terminalRunning: false
    })
  },

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  setToolView: (mode) => set({ toolView: mode }),

  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),

  setRightTab: (tab) => set({ rightTab: tab }),

  openFile: async (relPath) => {
    const active = get().active
    if (!active) return
    try {
      const content = await window.api.readWorkspaceFile(active.workspaceDir, relPath)
      set({ preview: { path: relPath, content }, rightTab: 'preview', rightPanelOpen: true })
    } catch (e) {
      set({
        preview: {
          path: relPath,
          content: `读取失败：${e instanceof Error ? e.message : String(e)}`
        },
        rightTab: 'preview',
        rightPanelOpen: true
      })
    }
  },

  setPreviewContent: (content) => {
    const p = get().preview
    if (p) set({ preview: { ...p, content } })
  },

  runTerminal: (command) => {
    const active = get().active
    if (!active || !command.trim()) return
    set({
      terminalRunning: true,
      terminalOutput: `${get().terminalOutput}$ ${command}\n`
    })
    void window.api.runTerminal(active.id, active.workspaceDir, command)
  },

  killTerminal: () => {
    const active = get().active
    if (active) void window.api.killTerminal(active.id)
    set({ terminalRunning: false })
  },

  clearTerminal: () => set({ terminalOutput: '' })
}))

function handleAgentEvent(
  conversationId: string,
  event: AgentEvent,
  set: (partial: Partial<UIState>) => void,
  get: () => UIState
): void {
  const active = get().active
  if (!active || active.id !== conversationId) {
    if (event.type === 'done' || event.type === 'error') set({ streaming: false })
    return
  }

  switch (event.type) {
    case 'token':
      set({ streamingText: get().streamingText + event.text })
      break

    case 'message': {
      const isAssistant = event.message.role === 'assistant'
      set({
        active: { ...active, messages: [...active.messages, event.message] },
        streamingText: isAssistant ? '' : get().streamingText
      })
      break
    }

    case 'plan':
      set({ plan: event.plan })
      break

    case 'diff':
      set({ diffs: [...get().diffs, event.entry], rightTab: 'diff', rightPanelOpen: true })
      break

    case 'tool_call_result': {
      const messages = active.messages.map((m) => {
        if (!m.toolCalls?.some((tc) => tc.id === event.id)) return m
        return {
          ...m,
          toolCalls: m.toolCalls.map((tc) =>
            tc.id === event.id
              ? { ...tc, status: event.status, result: event.result, error: event.error }
              : tc
          )
        }
      })
      set({ active: { ...active, messages } })
      break
    }

    case 'done':
      set({ streaming: false, streamingText: '' })
      void window.api.listConversations().then((conversations) => set({ conversations }))
      break

    case 'error':
      set({
        streaming: false,
        streamingText: '',
        active: {
          ...active,
          messages: [
            ...active.messages,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: `⚠️ 出错：${event.error}`,
              createdAt: Date.now()
            }
          ]
        }
      })
      break

    // tool_call_start：assistant message 事件已携带 pending 工具调用，无需额外处理
    default:
      break
  }
}
