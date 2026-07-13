// 主进程 / preload / 渲染进程共享的类型契约。

export type Role = 'user' | 'assistant' | 'system' | 'tool'

export type ToolStatus = 'pending' | 'running' | 'done' | 'error' | 'denied'

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  status: ToolStatus
  result?: string
  error?: string
}

export interface Message {
  id: string
  role: Role
  content: string
  /** 仅 user：随消息附带的图片（data URL，供视觉模型） */
  images?: string[]
  /** 仅 assistant：本轮发起的工具调用 */
  toolCalls?: ToolCall[]
  /** 仅 tool：对应的 toolCall id */
  toolCallId?: string
  createdAt: number
}

/** 三个互相独立的工作空间 */
export type ConversationKind = 'chat' | 'cowork' | 'code'

/** 智能体运行模式：auto 放开工具 / plan 只读产出计划 / chat 纯对话不调工具 */
export type AgentMode = 'auto' | 'plan' | 'chat'

/** 计划清单中的一步（Plan 面板） */
export interface PlanStep {
  title: string
  status: 'pending' | 'in_progress' | 'done'
}

/** 智能体对一个文件的一次改动（Diff 面板） */
export interface DiffEntry {
  id: string
  path: string
  before: string
  after: string
  at: number
}

/** 项目：在某个空间内对对话分组 */
export interface Project {
  id: string
  name: string
  kind: ConversationKind
  createdAt: number
}

/** 例程：按固定间隔自动触发的后台任务 */
export interface Routine {
  id: string
  name: string
  kind: ConversationKind
  /** 触发时发送给智能体的指令 */
  prompt: string
  /** 每隔多少分钟运行一次 */
  intervalMinutes: number
  enabled: boolean
  /** 运行所用的工作区与模型；留空则用全局默认 */
  workspaceDir?: string
  model?: string
  createdAt: number
  lastRunAt?: number
}

/** 一条带治理元数据的项目记忆 */
export type MemoryType = 'fact' | 'preference' | 'decision' | 'pitfall' | 'todo'
export interface MemoryEntry {
  id: string
  text: string
  /** 类型 = 置信度/类别：事实 / 偏好 / 决策 / 坑 / 待办 */
  type: MemoryType
  /** 来源：对话标题或 'user'（手动添加） */
  source?: string
  createdAt: number
  updatedAt: number
}

/** 一次后台运行的记录（Background tasks） */
export interface BackgroundTask {
  id: string
  title: string
  conversationId: string
  routineId?: string
  status: 'running' | 'done' | 'error'
  startedAt: number
  endedAt?: number
  error?: string
}

export interface Conversation {
  id: string
  title: string
  model: string
  /** 所属空间；旧数据缺失时按 'chat' 处理 */
  kind: ConversationKind
  /** 运行模式；旧数据缺失时按 'auto' 处理 */
  mode?: AgentMode
  /** 所属项目（可选） */
  projectId?: string
  /** 智能体维护的执行计划 */
  plan?: PlanStep[]
  messages: Message[]
  workspaceDir: string
  createdAt: number
  updatedAt: number
}

/** 单个 MCP server 配置（stdio 方式启动，采用通用的 MCP 配置格式） */
export interface McpServerConfig {
  /** stdio 传输：可执行命令与参数（与 url 二选一） */
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** 远程传输：server 的 URL（与 command 二选一） */
  url?: string
  /** 传输类型；默认 stdio。有 url 时未指定则按 http(streamable) 处理 */
  type?: 'stdio' | 'http' | 'sse'
  /** 默认启用；设为 false 可临时停用 */
  enabled?: boolean
}

/** 云端 / 自建模型提供方（OpenAI 兼容端点：DeepSeek、MiniMax、OpenAI 等） */
export interface ProviderConfig {
  /** 唯一标识，用于把模型路由到此提供方（模型 id 形如 <provider>::<model>） */
  id: string
  /** 显示名 */
  label: string
  /** 协议类型：ollama 走本地；openai 走 /v1/chat/completions 兼容端点 */
  kind: 'ollama' | 'openai'
  /** 基础地址，如 https://api.deepseek.com/v1 */
  baseUrl: string
  /** openai 类型需要的 API Key */
  apiKey?: string
  /** 手动列出的可用模型名（云端无法统一列举时使用） */
  models?: string[]
}

export interface Settings {
  ollamaBaseUrl: string
  defaultModel: string
  workspaceDir: string
  theme: 'light' | 'dark' | 'system'
  /** 界面语言 */
  language: 'zh' | 'en'
  /** 只读工具（read/list/grep）是否自动放行 */
  autoApproveReadOnly: boolean
  /** MCP server 配置，键为 server 名（工具会以 mcp__<server>__<tool> 暴露给模型） */
  mcpServers: Record<string, McpServerConfig>
  /** 用户添加的云端/自建模型提供方（Ollama 内置，不在此列） */
  providers: ProviderConfig[]
  /** 每个空间（chat/cowork/code）的自定义指令，注入到系统提示 */
  customInstructions: Partial<Record<ConversationKind, string>>
  /** 语音转写（ASR）：复用某个 provider 的端点 + 模型 */
  asrProviderId?: string
  asrModel?: string
  /** 输入框发送方式：enter=回车发送(Shift+Enter 换行)；mod-enter=⌘/Ctrl+Enter 发送 */
  submitKey?: 'enter' | 'mod-enter'
}

export interface ModelInfo {
  /** 路由用的模型 id：<provider>::<model> */
  name: string
  /** 展示用的纯模型名 */
  label?: string
  /** 所属提供方显示名 */
  provider?: string
  size?: number
}

/** 工作区文件树的一个条目 */
export interface FsEntry {
  name: string
  isDir: boolean
}

/** Git 改动的一个文件（x=暂存区状态，y=工作区状态） */
export interface GitFile {
  path: string
  x: string
  y: string
  staged: boolean
}

export interface GitStatus {
  isRepo: boolean
  branch: string
  files: GitFile[]
}

/** 提供给设置界面展示的技能信息 */
export interface SkillInfo {
  name: string
  description: string
  source: 'global' | 'workspace' | 'plugin'
}

/** 提供给设置界面展示的插件信息 */
export interface PluginInfo {
  name: string
  description: string
  enabled: boolean
  mcpCount: number
  hasSkills: boolean
}

/** 插件市场条目 */
export interface PluginCatalogItem {
  id: string
  name: string
  description: string
  category: string
  icon: string
  installed: boolean
}

/** 传给模型的工具定义（JSON Schema 形式） */
export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** 主进程 → 渲染进程的流式智能体事件 */
export type AgentEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_call_start'; toolCall: ToolCall }
  | {
      type: 'tool_call_result'
      id: string
      status: ToolStatus
      result?: string
      error?: string
    }
  | { type: 'message'; message: Message }
  | { type: 'plan'; plan: PlanStep[] }
  | { type: 'diff'; entry: DiffEntry }
  | { type: 'done' }
  | { type: 'error'; error: string }

/** 主进程 → 渲染进程的终端输出事件 */
export interface TerminalEvent {
  conversationId: string
  type: 'out' | 'err' | 'exit'
  data?: string
  code?: number | null
}

/** 主进程 → 渲染进程的权限请求 */
export interface PermissionRequest {
  id: string
  toolName: string
  args: Record<string, unknown>
  description: string
}

/** preload 暴露到 window.api 的接口 */
export interface Api {
  listModels(): Promise<ModelInfo[]>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  listConversations(): Promise<Conversation[]>
  getConversation(id: string): Promise<Conversation | null>
  createConversation(kind: ConversationKind, projectId?: string): Promise<Conversation>
  deleteConversation(id: string): Promise<void>
  renameConversation(id: string, title: string): Promise<void>
  setConversationProject(id: string, projectId: string | null): Promise<void>
  listProjects(): Promise<Project[]>
  createProject(name: string, kind: ConversationKind): Promise<Project>
  renameProject(id: string, name: string): Promise<void>
  deleteProject(id: string): Promise<void>
  setConversationModel(id: string, model: string): Promise<void>
  setConversationMode(id: string, mode: AgentMode): Promise<void>
  setConversationWorkspace(id: string, dir: string): Promise<void>
  pickFile(): Promise<{ name: string; content: string } | null>
  transcribeAudio(bytes: Uint8Array, mime: string): Promise<string>
  sendMessage(
    conversationId: string,
    content: string,
    images?: string[],
    /** 渲染端乐观消息的 id；主进程沿用它持久化，保证两端 id 一致 */
    userMessageId?: string
  ): Promise<void>
  pickImage(): Promise<{ name: string; dataUrl: string } | null>
  /** 把图片引用（himg:）还原成 data URL 供显示；非引用原样返回 */
  readImage(ref: string): Promise<string>
  regenerate(conversationId: string): Promise<void>
  truncateFrom(conversationId: string, messageId: string): Promise<void>
  exportConversation(conversationId: string): Promise<void>
  listFiles(workspaceDir: string): Promise<string[]>
  abort(conversationId: string): Promise<void>
  respondPermission(id: string, approved: boolean, remember: boolean): Promise<void>
  pickWorkspace(): Promise<string | null>
  readDir(workspaceDir: string, relPath: string): Promise<FsEntry[]>
  gitStatus(workspaceDir: string): Promise<GitStatus>
  gitDiff(workspaceDir: string, path: string, staged: boolean): Promise<string>
  gitStage(workspaceDir: string, path: string): Promise<void>
  gitUnstage(workspaceDir: string, path: string): Promise<void>
  gitCommit(workspaceDir: string, message: string): Promise<{ ok: boolean; message: string }>
  gitInit(workspaceDir: string): Promise<void>
  listMemory(workspaceDir: string): Promise<MemoryEntry[]>
  addMemory(workspaceDir: string, text: string, type: MemoryType): Promise<void>
  forgetMemory(workspaceDir: string, id: string): Promise<void>
  readWorkspaceFile(workspaceDir: string, relPath: string): Promise<string>
  writeWorkspaceFile(workspaceDir: string, relPath: string, content: string): Promise<void>
  listSkills(): Promise<SkillInfo[]>
  listPlugins(): Promise<PluginInfo[]>
  setPluginEnabled(name: string, enabled: boolean): Promise<void>
  openPluginsDir(): Promise<void>
  /** 从文件夹安装插件（弹目录选择框） */
  installPlugin(): Promise<{ ok: boolean; name?: string; error?: string }>
  /** 插件市场目录 */
  pluginCatalog(): Promise<PluginCatalogItem[]>
  /** 从市场一键安装 */
  installCatalogPlugin(id: string): Promise<{ ok: boolean; name?: string; error?: string }>
  /** 卸载插件 */
  uninstallPlugin(id: string): Promise<void>
  /** 探测各 MCP server 的连通性 */
  mcpStatus(): Promise<{ name: string; ok: boolean; toolCount: number; error?: string }[]>
  runTerminal(conversationId: string, workspaceDir: string, command: string): Promise<void>
  killTerminal(conversationId: string): Promise<void>
  listRoutines(): Promise<Routine[]>
  saveRoutine(routine: Routine): Promise<Routine>
  deleteRoutine(id: string): Promise<void>
  runRoutineNow(id: string): Promise<void>
  listTasks(): Promise<BackgroundTask[]>
  onAgentEvent(cb: (payload: { conversationId: string; event: AgentEvent }) => void): () => void
  onPermissionRequest(cb: (req: PermissionRequest) => void): () => void
  onTerminalEvent(cb: (e: TerminalEvent) => void): () => void
  onTasksUpdate(cb: (tasks: BackgroundTask[]) => void): () => void
  /** 原生菜单项触发的动作（new-chat、export、settings、toggle-sidebar、space:chat 等） */
  onMenuAction(cb: (action: string) => void): () => void
  /** 运行平台（darwin/win32/linux），用于平台相关的界面微调 */
  platform: NodeJS.Platform
  /** 用原生剪贴板复制文本（比 navigator.clipboard 在 Electron 下更可靠） */
  copyText(text: string): Promise<void>
}
