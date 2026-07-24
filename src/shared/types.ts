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
  /** 仅 assistant：模型的推理链（如 deepseek-reasoner），可折叠展示 */
  reasoning?: string
  createdAt: number
}

/** 三个互相独立的工作空间 */
export type ConversationKind = 'chat' | 'cowork' | 'code'

/** 智能体运行模式：auto 放开工具 / plan 只读产出计划 / chat 纯对话不调工具 */
export type AgentMode = 'auto' | 'plan' | 'chat'

/** 权限预设（对齐 Codex 的四类审批口径）：
 *  ask=请求批准（写/执行逐项确认）；auto=替我审批（工作区内常规操作自动批，MCP/危险仍问）；
 *  full=完全访问（除危险命令外全部自动批，命令不进沙箱）；custom=按类别自定义 */
export type ApprovalMode = 'ask' | 'auto' | 'full' | 'custom'
/** 权限策略类别（自定义模式下逐类设 auto/ask） */
export type PolicyCategory = 'read' | 'fileWrite' | 'command' | 'network' | 'memorySkill' | 'mcp'
export type CustomPolicy = Partial<Record<Exclude<PolicyCategory, 'read'>, 'auto' | 'ask'>>

/** 审计日志条目（userData/audit.log，JSONL 追加） */
export interface AuditEntry {
  ts: number
  conv: string
  tool: string
  /** 入参摘要（截断） */
  args: string
  effect: 'none' | 'write' | 'exec'
  /** 放行/拒绝的依据：rule-allow/rule-deny/preset/readonly/remembered/user/user-deny/unattended/hook-block */
  decision: string
  ok?: boolean
  error?: string
  ms?: number
  sandbox?: boolean
  source?: 'chat' | 'subagent'
}

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

/** 例程的一次运行记录（运行历史） */
export interface RoutineRun {
  at: number
  status: 'done' | 'error'
  error?: string
  conversationId: string
  durationMs: number
}

/** 例程：自动触发的后台任务（定时间隔 / 每天 / 每周 / 文件变化） */
export interface Routine {
  id: string
  name: string
  kind: ConversationKind
  /** 触发时发送给智能体的指令 */
  prompt: string
  /** 每隔多少分钟运行一次（scheduleKind='interval' 时用） */
  intervalMinutes: number
  enabled: boolean
  /** 运行所用的工作区与模型；留空则用全局默认 */
  workspaceDir?: string
  model?: string
  createdAt: number
  lastRunAt?: number
  /** 触发方式；缺省=interval（沿用 intervalMinutes） */
  scheduleKind?: 'interval' | 'daily' | 'weekly' | 'fileChange'
  /** daily/weekly：触发时刻 "HH:MM"（24h） */
  atTime?: string
  /** weekly：星期几 0=周日 … 6=周六 */
  weekday?: number
  /** fileChange：监听的目录（相对工作区或绝对；变化即去抖触发） */
  watchDir?: string
  /** 失败自动重试次数（默认 0） */
  retries?: number
  /** 把每次运行的结果摘要写入 <ws>/.hemilier/routine-reports/ */
  reportToFile?: boolean
  /** 最近运行历史（最多 10 条） */
  history?: RoutineRun[]
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
  /** 会话级权限预设；缺省用 Settings.approvalMode */
  approvalMode?: ApprovalMode
  /** 所属项目（可选） */
  projectId?: string
  /** 置顶（侧栏排序优先） */
  pinned?: boolean
  /** 本会话已做过自动记忆沉淀（每会话只做一次） */
  distilled?: boolean
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
  /** 本地个人资料（昵称用于问候语；仅存本机，将来可替换为云端账号体系） */
  profile?: { name?: string; email?: string }
  /** 采样温度（0-2，作用于所有对话；省略=端点默认） */
  temperature?: number
  /** 最大生成 token（省略=端点默认） */
  maxTokens?: number
  /** 网络代理地址，如 http://127.0.0.1:7890（空=跟随系统代理）。作用于所有云端/本地 API 请求 */
  proxyUrl?: string
  /** 已信任的 MCP server 签名（name::config）。未信任的 server 不会自动连接/执行（防供应链） */
  trustedMcp?: string[]
  /** 启用生命周期钩子：.hemilier/hooks.json 里的 shell 命令会在工具执行前后/运行结束时触发。
   *  默认关闭（防止克隆来的不可信仓库里的 hooks 被自动执行）。 */
  enableHooks?: boolean
  /** 全局默认权限预设（默认 ask=请求批准） */
  approvalMode?: ApprovalMode
  /** custom 预设下各类别的放行策略 */
  customPolicy?: CustomPolicy
  /** run_command 是否包 Seatbelt 沙箱（仅 macOS 生效；默认开；full 模式不沙箱） */
  sandboxCommands?: boolean
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

/** MCP 连接器目录条目（内置精选，一键接入） */
export interface McpConnectorInfo {
  id: string
  name: string
  icon: string
  category: string
  description: string
  envFields?: { key: string; label: string; required: boolean; secret?: boolean }[]
  argFields?: { label: string; placeholder: string; required: boolean }[]
  installed: boolean
}

/** 统一搜索结果：内置种子目录（builtin）+ MCP 注册中心（registry）。 */
export interface McpSearchResult {
  /** 唯一键（也用作 mcpServers 的键名）：builtin=目录 id，registry=服务器短名 */
  key: string
  name: string
  description: string
  source: 'builtin' | 'registry'
  icon?: string
  category?: string
  publisher?: string
  installed: boolean
  envFields?: { key: string; label: string; required: boolean; secret?: boolean }[]
  argFields?: { label: string; placeholder: string; required: boolean }[]
  /** registry 本地包结果的运行命令（builtin 经 mcpConnect(id) 接入，无需带） */
  command?: string
  args?: string[]
  /** registry 远程 server（streamable-http / sse）：无需本地安装，直连 URL */
  url?: string
  transport?: 'http' | 'sse'
}

/** 提供给设置界面展示的子 agent（多 agent 编排）信息 */
export interface AgentInfo {
  name: string
  description: string
  source: 'builtin' | 'workspace' | 'global'
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
  | { type: 'reasoning'; text: string }
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
  /** 用户主目录（工作区显示 ~ 用） */
  home: string
  /** 会话列表在主进程侧变化（如自动命名）时触发 */
  onConversationsUpdated(cb: () => void): () => void
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
  setConversationApproval(id: string, mode: ApprovalMode): Promise<void>
  /** 最近的审计日志（新→旧） */
  auditList(limit?: number): Promise<AuditEntry[]>
  /** 在文件管理器里显示审计日志文件 */
  auditOpen(): Promise<void>
  /** 提取工作区内 Office/PDF 文档的文本（.docx/.xlsx/.pptx/.pdf） */
  extractDocument(workspaceDir: string, relPath: string): Promise<string>
  /** 提取任意绝对路径的 Office/PDF 文本（拖拽附件用） */
  extractDocumentPath(absPath: string): Promise<string>
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
  /** 把较早历史压缩成摘要（/compact），返回更新后的完整会话 */
  compactConversation(
    conversationId: string
  ): Promise<{ ok: boolean; conversation?: Conversation; error?: string }>
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
  listMemory(
    workspaceDir: string
  ): Promise<{ global: MemoryEntry[]; project: MemoryEntry[]; pending: MemoryEntry[] }>
  addMemory(
    workspaceDir: string,
    text: string,
    type: MemoryType,
    scope?: 'global' | 'project'
  ): Promise<void>
  forgetMemory(workspaceDir: string, id: string): Promise<void>
  /** 采纳/忽略一条自动沉淀的候选记忆 */
  resolvePendingMemory(workspaceDir: string, id: string, adopt: boolean): Promise<void>
  /** 记忆整理：返回合并去重后的提案（不落盘） */
  consolidateMemory(
    workspaceDir: string,
    scope: 'global' | 'project'
  ): Promise<{ ok: boolean; before?: number; proposed?: MemoryEntry[]; error?: string }>
  /** 应用整理提案（整批替换该层） */
  applyConsolidation(
    workspaceDir: string,
    scope: 'global' | 'project',
    entries: MemoryEntry[]
  ): Promise<void>
  /** 记忆库变化（自动沉淀/整理应用）时触发 */
  onMemoryUpdated(cb: () => void): () => void
  readWorkspaceFile(workspaceDir: string, relPath: string): Promise<string>
  writeWorkspaceFile(workspaceDir: string, relPath: string, content: string): Promise<void>
  listSkills(): Promise<SkillInfo[]>
  /** 列出可派生的子 agent 类型（内置 + 工作区 + 全局） */
  listAgents(workspaceDir: string): Promise<AgentInfo[]>
  /** 列出工作区自定义斜杠命令（.hemilier/commands/*.md） */
  listCommands(workspaceDir: string): Promise<{ name: string; description: string; body: string }[]>
  /** 全局搜索会话（标题 + 消息正文） */
  searchConversations(query: string): Promise<{ id: string; title: string; snippet: string }[]>
  /** 导出全部数据为备份文件 */
  exportData(): Promise<{ ok: boolean; path?: string }>
  /** 从备份文件导入 */
  importData(): Promise<{ ok: boolean; conversations?: number; projects?: number; error?: string }>
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
  mcpStatus(): Promise<
    {
      name: string
      ok: boolean
      toolCount: number
      error?: string
      untrusted?: boolean
      source?: 'user' | 'plugin'
      enabled?: boolean
    }[]
  >
  /** 信任并启用一个 MCP server（把其签名加入 trustedMcp） */
  trustMcp(name: string): Promise<void>
  /** MCP 连接器目录（内置精选） */
  mcpCatalog(): Promise<McpConnectorInfo[]>
  /** 统一搜索：内置种子目录 + 在线 MCP 注册中心（离线时仅返回种子，registryOk=false） */
  mcpSearch(query: string): Promise<{ results: McpSearchResult[]; registryOk: boolean }>
  /** 接入一个注册中心搜索结果（第三方来源，不自动授信，须在列表显式信任） */
  mcpInstallRegistry(
    entry: McpSearchResult,
    input: { env?: Record<string, string>; extraArgs?: string[] }
  ): Promise<{ ok: boolean; error?: string }>
  /** 一键接入一个目录连接器（自动写配置 + 授信） */
  mcpConnect(
    id: string,
    input: { env?: Record<string, string>; extraArgs?: string[] }
  ): Promise<{ ok: boolean; error?: string }>
  /** 启停某个用户配置的 MCP server */
  mcpSetEnabled(name: string, enabled: boolean): Promise<void>
  /** 删除某个用户配置的 MCP server（连带移除信任） */
  mcpRemove(name: string): Promise<void>
  /** 从剪贴板文本导入标准 mcpServers JSON 片段（导入后仍需显式信任） */
  mcpImport(text: string): Promise<{ ok: boolean; added?: number; error?: string }>
  /** 读取系统剪贴板文本（主进程代理，绕过渲染端权限限制） */
  readClipboardText(): Promise<string>
  /** 当前应用版本（app.getVersion） */
  appVersion(): Promise<string>
  runTerminal(conversationId: string, workspaceDir: string, command: string): Promise<void>
  killTerminal(conversationId: string): Promise<void>
  listRoutines(): Promise<Routine[]>
  saveRoutine(routine: Routine): Promise<Routine>
  deleteRoutine(id: string): Promise<void>
  runRoutineNow(id: string): Promise<void>
  listTasks(): Promise<BackgroundTask[]>
  /** 中止一个正在运行的后台任务 */
  cancelTask(taskId: string): Promise<void>
  /** 置顶/取消置顶会话 */
  setConversationPinned(id: string, pinned: boolean): Promise<void>
  /** 验证云端 Provider 可用性 */
  testProvider(providerId: string): Promise<{ ok: boolean; note?: string; error?: string }>
  /** 渲染端错误写入主进程日志（fire-and-forget） */
  logError(msg: string): void
  /** 用系统浏览器打开 http/https 链接 */
  openUrl(url: string): Promise<void>
  /** 有新版本可下载时触发（打包环境启动时检查 GitHub Release） */
  onUpdateAvailable(cb: (info: { version: string; url: string }) => void): () => void
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
