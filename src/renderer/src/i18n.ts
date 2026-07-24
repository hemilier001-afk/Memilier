import { useStore } from './store'

type Lang = 'zh' | 'en'
type Dict = Record<string, { zh: string; en: string }>

// 界面文案词典（产品名 Chats/Cowork/Code/Projects/Routines/Tasks 等保持原样不翻译）
const DICT: Dict = {
  // 侧栏
  newChat: { zh: '新对话', en: 'New chat' },
  searchChats: { zh: '搜索对话', en: 'Search chats' },
  settings: { zh: '设置', en: 'Settings' },
  recents: { zh: 'Recents', en: 'Recents' },
  searchResults: { zh: '搜索结果', en: 'Search results' },
  noConversations: { zh: '还没有对话', en: 'No conversations yet' },
  noMatches: { zh: '没有匹配的对话', en: 'No matching chats' },
  today: { zh: '今天', en: 'Today' },
  yesterday: { zh: '昨天', en: 'Yesterday' },
  last7: { zh: '前 7 天', en: 'Previous 7 days' },
  older: { zh: '更早', en: 'Older' },
  all: { zh: '全部', en: 'All' },
  newProject: { zh: '新建项目', en: 'New project' },
  projectNamePh: { zh: '项目名，回车创建', en: 'Project name, Enter to create' },

  // 输入框
  composerPh: {
    zh: '给智能体发消息…（@ 引用文件，可粘贴图片，Enter 发送）',
    en: 'Message the agent…  (@ to reference files, paste images, Enter to send)'
  },
  composerNoConv: { zh: '请先新建对话', en: 'Create a conversation first' },
  send: { zh: '发送', en: 'Send' },
  resend: { zh: '重发', en: 'Resend' },
  stop: { zh: '停止', en: 'Stop' },
  cancel: { zh: '取消', en: 'Cancel' },
  editingBanner: {
    zh: '正在编辑消息，发送将从此处重新生成',
    en: 'Editing — sending regenerates from here'
  },

  // 对话区
  emptySubtitle: {
    zh: '新建一个对话开始，模型由本地 Ollama 或云端 API 驱动',
    en: 'Start a new conversation — powered by local Ollama or cloud APIs'
  },
  starterHint: { zh: '想让智能体做点什么？', en: 'What should the agent do?' },

  // 设置 - 菜单
  setGeneral: { zh: '通用', en: 'General' },
  setModels: { zh: '模型', en: 'Models' },
  setVoice: { zh: '语音', en: 'Voice' },
  setMcp: { zh: 'MCP', en: 'MCP' },
  setSkills: { zh: '技能', en: 'Skills' },
  setShortcuts: { zh: '快捷键', en: 'Shortcuts' },
  setAbout: { zh: '关于', en: 'About' },
  submitKey: { zh: '发送方式', en: 'Send with' },
  submitEnter: { zh: '回车发送（Shift+Enter 换行）', en: 'Enter (Shift+Enter = newline)' },
  submitMod: { zh: '⌘/Ctrl + 回车 发送', en: '⌘/Ctrl + Enter' },

  // 采样 / 代理
  temperatureLabel: {
    zh: '采样温度（留空=端点默认；低=严谨，高=发散）',
    en: 'Temperature (blank = endpoint default; low = precise, high = creative)'
  },
  maxTokensLabel: {
    zh: '最大生成 token（留空=端点默认）',
    en: 'Max output tokens (blank = endpoint default)'
  },
  proxyLabel: { zh: '网络代理', en: 'Network proxy' },
  proxyHint: {
    zh: '如 http://127.0.0.1:7890。留空=跟随系统代理。作用于所有云端/本地模型请求（国内接海外 API 时用）。',
    en: 'e.g. http://127.0.0.1:7890. Blank = follow system proxy. Applies to all model requests.'
  },

  // 设置 - 通用
  language: { zh: '语言', en: 'Language' },
  theme: { zh: '主题', en: 'Theme' },
  themeSystem: { zh: '跟随系统', en: 'System' },
  themeLight: { zh: '浅色', en: 'Light' },
  themeDark: { zh: '深色', en: 'Dark' },
  workspaceDir: { zh: '工作区目录', en: 'Workspace folder' },
  choose: { zh: '选择…', en: 'Choose…' },
  workspaceHint: {
    zh: '智能体的所有文件 / 命令操作都限定在此目录内。',
    en: 'All file/command actions are confined to this folder.'
  },
  autoApprove: {
    zh: '自动放行只读操作（读文件 / 列目录 / 搜索）',
    en: 'Auto-approve read-only actions (read / list / search)'
  },

  // 设置 - 模型
  ollamaUrl: { zh: 'Ollama 地址', en: 'Ollama URL' },
  defaultModel: { zh: '默认模型', en: 'Default model' },
  noModels: { zh: '无可用模型', en: 'No models available' },
  cloudProviders: { zh: '模型提供方（云端 API）', en: 'Model providers (cloud API)' },
  cloudProvidersHint: {
    zh: '接入 DeepSeek / MiniMax / OpenAI 等 OpenAI 兼容端点，填入 API Key 即可，无需本地模型。',
    en: 'Add OpenAI-compatible endpoints (DeepSeek / MiniMax / OpenAI). Just paste an API key — no local model needed.'
  },
  displayName: { zh: '显示名', en: 'Display name' },
  remove: { zh: '删除', en: 'Remove' },
  modelsCsvPh: {
    zh: '模型名，逗号分隔，如 deepseek-chat,deepseek-reasoner',
    en: 'Model names, comma-separated, e.g. deepseek-chat,deepseek-reasoner'
  },

  // 设置 - 语音
  asrTitle: { zh: '语音转写（ASR）', en: 'Speech-to-text (ASR)' },
  asrHint: {
    zh: '麦克风语音输入用：选一个支持音频转写的提供方（如 OpenAI，模型 whisper-1）。录音在本机进行，转写请求由主进程直连。',
    en: 'For mic input: pick a provider that supports audio transcription (e.g. OpenAI, model whisper-1). Recording is local; transcription runs from the main process.'
  },
  asrOff: { zh: '未启用', en: 'Disabled' },
  asrModelPh: { zh: '模型，如 whisper-1', en: 'Model, e.g. whisper-1' },

  // 设置 - MCP
  mcpTitle: { zh: 'MCP 服务器', en: 'MCP servers' },
  save: { zh: '保存', en: 'Save' },
  scrollToBottom: { zh: '↓ 回到底部', en: '↓ Jump to latest' },
  testConnection: { zh: '测试连接', en: 'Test' },
  mcpTesting: { zh: '测试中…', en: 'Testing…' },
  mcpNeedsTrust: { zh: '需信任后才连接', en: 'needs trust to connect' },
  mcpCatalogTitle: { zh: '连接器目录', en: 'Connector directory' },
  mcpCatalogHint: {
    zh: '一键接入主流 MCP 能力（需本机已装 Node.js/npx，首次调用会自动下载）。目录接入自动信任。',
    en: 'One-click popular MCP servers (requires Node.js/npx; downloads on first use). Directory installs are auto-trusted.'
  },
  mcpConnect: { zh: '接入', en: 'Connect' },
  mcpConnected: { zh: '已接入', en: 'Connected' },
  mcpImport: { zh: '从剪贴板导入', en: 'Import from clipboard' },
  mcpImportTip: {
    zh: '粘贴板里放一段标准 mcpServers JSON（Claude Desktop / Cursor 格式均可），导入后需逐个信任',
    en: 'Copy a standard mcpServers JSON (Claude Desktop / Cursor format), then import; each server still needs trusting'
  },
  mcpImported: {
    zh: '已导入 {n} 个 server（信任后生效）',
    en: 'Imported {n} server(s) — trust to activate'
  },
  mcpAdvanced: { zh: '高级：手动编辑 JSON 配置', en: 'Advanced: edit JSON config' },
  mcpFromPlugin: { zh: '插件', en: 'plugin' },
  mcpNone: { zh: '（未配置 MCP server）', en: '(no MCP servers configured)' },
  mcpTools: { zh: '工具×{n}', en: 'tools ×{n}' },
  mcpDisabled: { zh: '已停用', en: 'disabled' },
  mcpEnabledTip: {
    zh: '启用/停用（停用后保留配置但不连接）',
    en: 'Enable/disable (config kept, not connected)'
  },
  mcpRemoveConfirm: { zh: '删除 MCP server「{name}」？', en: 'Remove MCP server "{name}"?' },
  mcpTrust: { zh: '信任并启用', en: 'Trust & enable' },
  // 扩展中心（插件 / 应用 / MCP 统一页，对齐 Codex）
  extTitle: { zh: '扩展', en: 'Extensions' },
  extSubtitle: { zh: '管理应用、MCP 与插件', en: 'Manage apps, MCP and plugins' },
  extApps: { zh: '应用', en: 'Apps' },
  extMcp: { zh: 'MCP', en: 'MCP' },
  extPlugins: { zh: '插件', en: 'Plugins' },
  extSearchApps: { zh: '搜索应用 / MCP…', en: 'Search apps / MCP…' },
  extSearchMcp: { zh: '筛选已装 MCP…', en: 'Filter installed MCP…' },
  extSearchPlugins: { zh: '筛选插件…', en: 'Filter plugins…' },
  extSearching: { zh: '搜索中…', en: 'Searching…' },
  extNoResults: { zh: '没有匹配的应用', en: 'No matching apps' },
  extRegistryOffline: {
    zh: '注册中心暂时离线，仅显示内置精选',
    en: 'Registry offline — showing built-in only'
  },
  extRegistry: { zh: '注册中心', en: 'Registry' },
  extBuiltin: { zh: '内置', en: 'Built-in' },
  extInstalled: { zh: '已接入', en: 'Installed' },
  extConnect: { zh: '接入', en: 'Connect' },
  extInstall: { zh: '安装', en: 'Install' },
  extNoServers: { zh: '尚未配置任何 MCP server', en: 'No MCP servers configured yet' },
  extTools: { zh: '工具', en: 'tools' },
  extFromPlugin: { zh: '来自插件', en: 'from plugin' },
  extManageInPlugins: { zh: '在插件页管理', en: 'manage in Plugins' },
  extNoPlugins: { zh: '尚未安装插件', en: 'No plugins installed' },
  extSkills: { zh: '技能', en: 'skills' },
  extMarketplace: { zh: '插件市场', en: 'Marketplace' },
  extServers: { zh: '服务器', en: 'Servers' },
  extAddServer: { zh: '添加服务器', en: 'Add server' },
  extFromPluginsSection: { zh: '来自插件', en: 'From plugins' },
  extInstalledSection: { zh: '已安装', en: 'Installed' },
  extAdvanced: { zh: '高级（JSON 格式）', en: 'Advanced (JSON format)' },
  mcpImportClipboard: { zh: '从剪贴板导入', en: 'Import from clipboard' },
  // 界面兜底与侧栏提示（英文模式补齐）
  errBoundaryTitle: { zh: '界面出现错误', en: 'Something went wrong' },
  errReload: { zh: '重新加载', en: 'Reload' },
  errDismiss: { zh: '忽略并继续', en: 'Dismiss and continue' },
  sbExpand: { zh: '展开侧栏', en: 'Expand sidebar' },
  sbCollapse: { zh: '折叠侧栏', en: 'Collapse sidebar' },
  projMoveIn: { zh: '移入当前项目', en: 'Add to current project' },
  projMoveOut: { zh: '移出当前项目', en: 'Remove from current project' },
  projDelete: { zh: '删除项目', en: 'Delete project' },
  projDeleteConfirm: {
    zh: '删除项目「{n}」？其对话会变为未分组。',
    en: 'Delete project "{n}"? Its chats become ungrouped.'
  },
  customCmd: { zh: '自定义命令', en: 'Custom command' },
  // 例程模板的 prompt 正文（名称复用 tpl* 键）
  tplErrorSummaryPrompt: {
    zh: '扫描工作区里最近的日志（如 logs/ 目录或 *.log 文件），汇总今天出现的错误与告警，按出现频次排序，写一份简明摘要。',
    en: 'Scan recent logs in the workspace (e.g. logs/ or *.log), summarize today’s errors and warnings ranked by frequency, and write a concise digest.'
  },
  tplDepCheckPrompt: {
    zh: '检查本项目的依赖（package.json 等）是否有新版本可升级，列出可升级项、当前版本→最新版本，以及可能的破坏性变更提示。不要自动升级。',
    en: 'Check whether this project’s dependencies (package.json, etc.) have upgrades; list upgradable items, current→latest versions, and possible breaking changes. Do not upgrade automatically.'
  },
  tplFileTidyPrompt: {
    zh: '有新文件进入 inbox 目录时，识别其类型并整理：按类别/日期归类，必要时重命名，给出整理说明。操作前先说明计划。',
    en: 'When new files land in the inbox folder, identify their type and organize them by category/date, renaming if needed, with an explanation. State the plan before acting.'
  },
  // 权限预设（四挡）与安全页
  setSecurity: { zh: '安全', en: 'Security' },
  apTitle: { zh: '权限', en: 'Permissions' },
  apAsk: { zh: '请求批准', en: 'Request approval' },
  apAskDesc: { zh: '写入/执行逐项确认', en: 'Confirm each write/exec' },
  apAuto: { zh: '替我审批', en: 'Approve for me' },
  apAutoDesc: {
    zh: '工作区内常规操作自动批；MCP 与危险命令仍确认',
    en: 'Auto-approve routine ops; MCP & dangerous still ask'
  },
  apFull: { zh: '完全访问', en: 'Full access' },
  apFullDesc: {
    zh: '全部自动批（危险命令除外），命令不进沙箱',
    en: 'Auto-approve all (except dangerous); no sandbox'
  },
  apCustom: { zh: '自定义', en: 'Custom' },
  apCustomDesc: {
    zh: '按类别设置放行策略（见设置-安全）',
    en: 'Per-category policy (Settings → Security)'
  },
  apDefaultLabel: { zh: '默认权限模式', en: 'Default permission mode' },
  apDefaultHint: {
    zh: '新会话与未单独设置的会话使用此默认；会话内可在输入框「模式」菜单单独切换。危险命令与工作区 deny 规则在任何模式下都不放行。',
    en: 'Used unless a conversation overrides it in the composer mode menu. Dangerous commands and workspace deny rules always require confirmation.'
  },
  polTitle: { zh: '自定义策略（按类别）', en: 'Custom policy (per category)' },
  polFileWrite: { zh: '文件写入', en: 'File writes' },
  polCommand: { zh: '命令执行', en: 'Commands' },
  polNetwork: { zh: '联网工具（抓取/搜索/浏览器）', en: 'Network (fetch/search/browser)' },
  polMemorySkill: { zh: '记忆与技能写入', en: 'Memory & skill writes' },
  polMcp: { zh: 'MCP 工具', en: 'MCP tools' },
  polAuto: { zh: '自动放行', en: 'Auto-approve' },
  polAsk: { zh: '每次询问', en: 'Ask' },
  sandboxLabel: { zh: '命令沙箱（macOS）', en: 'Command sandbox (macOS)' },
  sandboxHint: {
    zh: 'run_command 包 Seatbelt 沙箱：读取不限，文件写入限定在 工作区+临时目录+构建缓存。完全访问模式或 Windows 下不生效。',
    en: 'Wraps run_command in Seatbelt: reads unrestricted; writes limited to workspace + temp + build caches. Off in Full access mode and on Windows.'
  },
  auditTitle: { zh: '审计日志', en: 'Audit log' },
  auditHint: {
    zh: '每次工具执行的「谁批的、批没批、成没成」都会追加记录到 audit.log（自动放行越多，事后可查越重要）。',
    en: 'Every tool run is appended to audit.log — who approved it, and whether it succeeded.'
  },
  auditRefresh: { zh: '刷新', en: 'Refresh' },
  auditOpenFile: { zh: '打开日志文件', en: 'Open log file' },
  auditEmpty: { zh: '（暂无记录）', en: '(no entries yet)' },
  adPreset: { zh: '预设放行', en: 'preset' },
  adRuleAllow: { zh: '规则放行', en: 'rule allow' },
  adRuleDeny: { zh: '规则拒绝', en: 'rule deny' },
  adReadonly: { zh: '只读自动', en: 'read-only' },
  adRemembered: { zh: '已记住', en: 'remembered' },
  adUser: { zh: '用户批准', en: 'user approved' },
  adUserDeny: { zh: '用户拒绝', en: 'user denied' },
  adUnattended: { zh: '例程自动', en: 'unattended' },
  adHookBlock: { zh: '钩子拦截', en: 'hook blocked' },

  // 设置 - 技能/插件
  skillsTitle: { zh: '技能（Skills）', en: 'Skills' },
  pluginsTitle: { zh: '插件（Plugins）', en: 'Plugins' },
  openPluginsDir: { zh: '打开插件目录', en: 'Open plugins folder' },
  installPlugin: { zh: '从文件夹…', en: 'From folder…' },
  marketplace: { zh: '插件市场', en: 'Marketplace' },
  install: { zh: '安装', en: 'Install' },
  installed: { zh: '已安装', en: 'Installed' },
  uninstall: { zh: '卸载', en: 'Uninstall' },

  // 快捷键页
  scNew: { zh: '新建对话', en: 'New chat' },
  scExport: { zh: '导出对话', en: 'Export chat' },
  scSettings: { zh: '设置', en: 'Settings' },
  scSidebar: { zh: '显示/隐藏侧栏', en: 'Toggle sidebar' },
  scSpaces: { zh: '切到 Chat / Cowork / Code', en: 'Switch to Chat / Cowork / Code' },
  scStop: { zh: '停止生成', en: 'Stop generating' },
  scSend: { zh: '发送', en: 'Send' },
  scNewline: { zh: '换行', en: 'Newline' },
  scAtFile: { zh: '@ 引用文件', en: '@ reference file' },

  // 子 agent（多 agent）
  agentsTitle: { zh: '子 agent（多 agent 编排）', en: 'Subagents (multi-agent)' },
  agentsHint: {
    zh: '主 agent 可派生这些子 agent 并行处理专注子任务；在 .hemilier/agents/ 放 .md 可新增。',
    en: 'The main agent spawns these for focused subtasks; add more via .md in .hemilier/agents/.'
  },

  // Skills / Plugins 页补充
  skillsHint: {
    zh: '模型按需加载的能力包；放在 .hemilier/skills/ 或 userData/skills。',
    en: 'Capability packs the model loads on demand; under .hemilier/skills/ or userData/skills.'
  },
  skillsInstalledHint: {
    zh: '安装后模型即可处理对应文件类型（部分需本机有 Python 环境）。',
    en: 'Once installed the model can handle these file types (some require local Python).'
  },
  verifying: { zh: '验证中…', en: 'Verifying…' },
  verifyOk: { zh: '连接成功', en: 'Connected' },
  pluginInstalled: { zh: '已安装「{n}」', en: 'Installed “{n}”' },

  // 关于
  aboutDesc: {
    zh: '一个运行在桌面端的 AI 智能体：多轮对话 + 自主工具调用（读写文件、执行命令、联网搜索、可视浏览器、Office 文档读写、MCP 扩展），由本地 Ollama 或云端 OpenAI 兼容模型（DeepSeek / MiniMax / OpenAI 等）驱动。内置权限四挡审批、命令沙箱与审计日志，安全可控。',
    en: 'A desktop AI agent: multi-turn chat with autonomous tool use (files, commands, web search, a managed browser, Office document read/write, MCP extensions), powered by local Ollama or OpenAI-compatible cloud models (DeepSeek / MiniMax / OpenAI). Ships with four-tier approval presets, a command sandbox, and an audit log.'
  },
  aboutFeatures: {
    zh: '对话 · 智能体 · 多模型 · 办公文档 · 扩展中心 · 安全管控',
    en: 'Chat · Agent · Multi-model · Office docs · Extensions · Security'
  },

  // 视图模式
  viewSummary: { zh: '精简', en: 'Summary' },
  viewNormal: { zh: '标准', en: 'Normal' },
  viewVerbose: { zh: '详尽', en: 'Verbose' },
  viewSummaryTip: { zh: '隐藏工具调用，仅看结论', en: 'Hide tool calls, results only' },
  viewNormalTip: { zh: '工具调用折叠显示', en: 'Tool calls collapsed' },
  viewVerboseTip: { zh: '展开全部工具调用细节', en: 'Expand all tool call details' },
  viewDensity: { zh: '工具过程详略', en: 'Detail level' },
  brandName: { zh: 'hemilier 智能体', en: 'hemilier' },
  modeTitle: { zh: '运行模式', en: 'Mode' },
  modeAuto: { zh: '自动', en: 'Auto' },
  modeAutoDesc: {
    zh: '放开工具，自主读写文件 / 执行命令',
    en: 'Full tools — read/write files, run commands'
  },
  modePlan: { zh: '计划', en: 'Plan' },
  modePlanDesc: {
    zh: '只读调研，产出分步计划，不做修改',
    en: 'Read-only research, step-by-step plan'
  },
  modeChat: { zh: '对话', en: 'Chat' },
  modeChatDesc: { zh: '纯聊天，不调用任何工具', en: 'Plain chat, no tools' },
  attach: { zh: '附加', en: 'Attach' },
  attachImage: { zh: '上传图片', en: 'Upload image' },
  attachFile: { zh: '上传本地文件', en: 'Upload file' },
  attachWorkspace: { zh: '选择工作区文件夹', en: 'Choose workspace folder' },
  attachPlugins: { zh: '管理插件 / MCP', en: 'Manage plugins / MCP' },
  wsTip: { zh: '工作区：{d}（点击切换文件夹）', en: 'Workspace: {d} (click to change)' },
  micSetup: { zh: '点此到设置配置语音转写（ASR）', en: 'Set up speech-to-text (ASR) in Settings' },
  micStop: { zh: '停止并转写', en: 'Stop & transcribe' },
  micBusy: { zh: '转写中…', en: 'Transcribing…' },
  micStart: { zh: '语音输入', en: 'Voice input' },
  appTagline: { zh: 'hemilier 桌面智能体', en: 'hemilier desktop agent' },

  // 头部
  compressBtn: { zh: '压缩', en: 'Compress' },
  tokenLongTip: {
    zh: '对话较长，较早消息将被自动裁剪。点击把早期历史压缩成摘要（/compact）',
    en: 'Long conversation — older messages get trimmed. Click to compact history into a summary (/compact)'
  },
  tokenTip: { zh: '当前对话上下文的 token 粗估', en: 'Rough token estimate of this conversation' },
  sessionsRunning: { zh: '{n} 个会话运行中', en: '{n} sessions running' },
  sessionsRunningTip: {
    zh: '其它会话正在生成，点击跳转查看',
    en: 'Other sessions are generating — click to jump'
  },
  moreActions: { zh: '更多操作', en: 'More' },
  hmCompact: { zh: '📜 压缩上下文（/compact）', en: '📜 Compact context (/compact)' },
  hmReflect: { zh: '🧠 反思沉淀（记忆/技能）', en: '🧠 Reflect (memory / skills)' },
  hmExport: { zh: '⬇ 导出对话为 Markdown', en: '⬇ Export as Markdown' },
  refreshModels: { zh: '刷新模型列表', en: 'Refresh model list' },

  // 消息区
  copy: { zh: '复制', en: 'Copy' },
  copied: { zh: '已复制', en: 'Copied' },
  edit: { zh: '编辑', en: 'Edit' },
  regenerate: { zh: '重新生成', en: 'Regenerate' },
  thinking: { zh: '思考中…', en: 'Thinking…' },
  reasoningLabel: { zh: '💭 思考过程', en: '💭 Reasoning' },
  queuedLabel: {
    zh: '已排队（当前任务结束后发送）',
    en: 'Queued (sends when current run finishes)'
  },
  runningTools: { zh: '执行工具', en: 'Running tools' },
  toolCallsCount: { zh: '{n} 个工具调用', en: '{n} tool calls' },
  workedSteps: { zh: '工作了 {n} 步（{s}）', en: 'Worked {n} steps ({s})' },
  stPending: { zh: '待执行', en: 'Pending' },
  stRunning: { zh: '执行中…', en: 'Running…' },
  stDone: { zh: '完成', en: 'Done' },
  stError: { zh: '失败', en: 'Failed' },
  stDenied: { zh: '已拒绝', en: 'Denied' },

  // 授权卡
  permTitle: { zh: '🔐 需要授权', en: '🔐 Approval required' },
  permQueue: { zh: '还有 {n} 个待处理', en: '{n} more pending' },
  permRemember: { zh: '本会话内记住此类操作', en: 'Remember for this session' },
  permAllow: { zh: '允许', en: 'Allow' },
  permDeny: { zh: '拒绝', en: 'Deny' },

  // 侧栏行操作
  rename: { zh: '重命名', en: 'Rename' },
  pin: { zh: '置顶', en: 'Pin' },
  unpin: { zh: '取消置顶', en: 'Unpin' },
  deleteChat: { zh: '删除', en: 'Delete' },
  confirmDeleteChat: {
    zh: '删除对话「{t}」？此操作不可撤销。',
    en: 'Delete "{t}"? This cannot be undone.'
  },
  generating: { zh: '正在生成', en: 'Generating' },

  // 备份 / 搜索
  backupTitle: { zh: '数据备份', en: 'Backup' },
  exportBtn: { zh: '导出全部数据…', en: 'Export all data…' },
  importBtn: { zh: '导入备份…', en: 'Import backup…' },
  backupHint: {
    zh: '导出会话/项目/设置为一个 JSON 文件（不含 API Key，安全）；换机或发朋友时导入恢复。',
    en: 'Export conversations/projects/settings to one JSON (no API keys); import to restore on another machine.'
  },
  exportedToast: { zh: '✓ 已导出', en: '✓ Exported' },
  importedToast: { zh: '✓ 已导入 {c} 个会话', en: '✓ Imported {c} conversations' },
  contentMatches: { zh: '内容匹配', en: 'In messages' },
  diffRevert: { zh: '撤销此改动', en: 'Revert' },

  // 后台任务弹窗
  tasksTitle: { zh: '后台任务', en: 'Background tasks' },
  tasksEmpty: {
    zh: '还没有后台任务。例程触发或手动运行后会出现在这里。',
    en: 'No background tasks yet. They appear here when routines fire or you run one manually.'
  },
  taskRunning: { zh: '运行中', en: 'Running' },
  taskDone: { zh: '已完成', en: 'Done' },
  taskError: { zh: '失败', en: 'Failed' },
  taskStop: { zh: '停止', en: 'Stop' },

  // 例程弹窗
  routinesTitle: { zh: '例程', en: 'Routines' },
  routinesHint: {
    zh: '按固定间隔自动触发的后台任务：到点会自动新建一个对话、用所给指令运行智能体，完成后发系统通知。后台运行会自动放行工具调用，请仅用于你信任的指令。',
    en: 'Scheduled background tasks: at each interval a new conversation runs your prompt and sends a system notification when done. Background runs auto-approve tool calls — use only prompts you trust.'
  },
  routineName: { zh: '名称', en: 'Name' },
  routinePrompt: { zh: '指令（prompt）', en: 'Prompt' },
  routinePromptPh: {
    zh: '例如：总结今天 logs 目录下的错误并写入 report.md',
    en: 'e.g. Summarize today’s errors in the logs folder into report.md'
  },
  routineInterval: { zh: '每隔（分钟）', en: 'Every (minutes)' },
  routineModel: { zh: '模型（可选）', en: 'Model (optional)' },
  routineDefaultModel: { zh: '默认模型', en: 'Default model' },
  routineEnabled: { zh: '启用（定时触发）', en: 'Enabled (runs on schedule)' },
  routineNew: { zh: '+ 新建例程', en: '+ New routine' },
  routinesEmpty: { zh: '当前空间还没有例程。', en: 'No routines in this space yet.' },
  routineDisabled: { zh: '（已停用）', en: '(disabled)' },
  routineEveryMin: { zh: '每 {n} 分钟', en: 'Every {n} min' },
  routineRunNowTip: { zh: '立即运行一次', en: 'Run once now' },
  routineRunNow: { zh: '▶运行', en: '▶Run' },
  routineTrigger: { zh: '触发方式', en: 'Trigger' },
  trigInterval: { zh: '固定间隔', en: 'Interval' },
  trigDaily: { zh: '每天', en: 'Daily' },
  trigWeekly: { zh: '每周', en: 'Weekly' },
  trigFileChange: { zh: '文件变化', en: 'File change' },
  routineAtTime: { zh: '时刻', en: 'At time' },
  routineWeekday: { zh: '星期', en: 'Weekday' },
  routineWatchDir: { zh: '监听目录', en: 'Watch folder' },
  routineRetries: { zh: '失败重试', en: 'Retries' },
  routineReportToFile: {
    zh: '结果写入报告文件（.hemilier/routine-reports/）',
    en: 'Write result to a report file (.hemilier/routine-reports/)'
  },
  routineLastRun: { zh: '上次运行', en: 'Last run' },
  routineTemplates: { zh: '自动化模板（点击填入）', en: 'Templates (click to fill)' },
  tplErrorSummary: { zh: '每日错误汇总', en: 'Daily error digest' },
  tplDepCheck: { zh: '依赖更新检查', en: 'Dependency update check' },
  tplFileTidy: { zh: '新文件自动整理', en: 'Auto-tidy new files' },
  wdSun: { zh: '周日', en: 'Sun' },
  wdMon: { zh: '周一', en: 'Mon' },
  wdTue: { zh: '周二', en: 'Tue' },
  wdWed: { zh: '周三', en: 'Wed' },
  wdThu: { zh: '周四', en: 'Thu' },
  wdFri: { zh: '周五', en: 'Fri' },
  wdSat: { zh: '周六', en: 'Sat' },
  hooksLabel: {
    zh: '启用生命周期钩子（.hemilier/hooks.json）',
    en: 'Enable lifecycle hooks (.hemilier/hooks.json)'
  },
  hooksHint: {
    zh: '开启后，工作区 .hemilier/hooks.json 里的 shell 命令会在工具执行前后 / 运行结束时自动触发（如改完文件自动格式化、危险工具拦截）。默认关，避免克隆来的不可信仓库里的钩子被自动执行。',
    en: 'When on, shell commands in the workspace .hemilier/hooks.json run automatically before/after tools and on stop (e.g. auto-format after edits, block risky tools). Off by default so hooks from cloned repos don’t auto-run.'
  },

  // 自定义指令弹窗
  customizeTitle: { zh: '自定义', en: 'Customize' },
  customizeHintA: {
    zh: '这里的指令会注入到',
    en: 'These instructions are injected into every conversation in the'
  },
  customizeHintB: {
    zh: '空间所有对话的系统提示中，用于设定语气、角色、约束等。仅对当前空间生效。',
    en: 'space (system prompt) — set tone, role, constraints. Applies to this space only.'
  },
  customizePh: {
    zh: '例如：你是一名资深前端工程师，回答尽量简洁，代码优先用 TypeScript。',
    en: 'e.g. You are a senior front-end engineer. Keep answers concise; prefer TypeScript.'
  },

  // 欢迎卡 / 空间提示 / 其它
  welcomeTitle: { zh: '👋 欢迎使用 hemilier', en: '👋 Welcome to hemilier' },
  welcomeSub: {
    zh: '开始对话前，先接入一个模型（三步，约 1 分钟）',
    en: 'Before chatting, connect a model (3 steps, ~1 minute)'
  },
  welcomeStep1: {
    zh: '1. 打开设置 → 模型，添加提供方（推荐 DeepSeek）',
    en: '1. Open Settings → Models, add a provider (DeepSeek recommended)'
  },
  welcomeStep2: {
    zh: '2. 粘贴你自己的 API Key（本机加密保存）',
    en: '2. Paste your own API key (encrypted locally)'
  },
  welcomeStep3A: { zh: '3. 回到这里，顶部选择', en: '3. Come back and pick' },
  welcomeStep3B: { zh: '即可开聊', en: 'to start chatting' },
  openSettings: { zh: '⚙ 打开设置', en: '⚙ Open Settings' },
  curWorkspace: { zh: '当前工作区：', en: 'Workspace: ' },
  notSet: { zh: '(未设置)', en: '(not set)' },
  wsChangeBtn: { zh: '更换', en: 'Change' },
  agentsMdTip: { zh: '· 提示：在工作区放一个', en: '· Tip: put an' },
  agentsMdTipB: {
    zh: '可为该项目定制智能体行为',
    en: 'in the workspace to customize agent behavior for this project'
  },
  panelShow: {
    zh: '显示右侧面板（Files / Preview）',
    en: 'Show workspace panel (Files / Preview)'
  },
  panelHide: { zh: '隐藏右侧面板', en: 'Hide workspace panel' },
  modelGroup: { zh: '模型', en: 'Models' },
  slashNew: { zh: '新建对话', en: 'New conversation' },
  slashCompact: {
    zh: '压缩较早历史为摘要，腾出上下文',
    en: 'Compact older history into a summary'
  },
  slashPlan: { zh: '切到计划模式（只读调研）', en: 'Switch to Plan mode (read-only)' },
  slashAuto: { zh: '切到自动模式（全部工具）', en: 'Switch to Auto mode (all tools)' },
  slashChat: { zh: '切到纯对话模式（不用工具）', en: 'Switch to Chat mode (no tools)' },
  slashExport: { zh: '导出对话为 Markdown', en: 'Export conversation as Markdown' },
  slashReflect: {
    zh: '回顾本次对话，沉淀记忆/技能',
    en: 'Reflect: save memories / skills from this chat'
  },
  slashSettings: { zh: '打开设置', en: 'Open Settings' },

  // 个人资料
  profileSection: { zh: '个人资料', en: 'Profile' },
  profileName: { zh: '昵称', en: 'Name' },
  profileNamePh: {
    zh: '填写后问候语变为「你好，XX。」',
    en: 'Shown in the greeting, e.g. “Hello, XX.”'
  },
  profileEmail: { zh: '邮箱（可选）', en: 'Email (optional)' },
  greetHello: { zh: '你好，{n}。', en: 'Hello, {n}.' },

  // 起步提示
  starter1: { zh: '列出当前工作区的文件结构', en: 'List the files in my workspace' },
  starter2: { zh: '在工作区里搜索 TODO 注释', en: 'Search the workspace for TODO comments' },
  starter3: { zh: '创建一个 hello.txt，写入一句问候', en: 'Create hello.txt with a greeting' },
  // 右侧工作区
  wsPanel: { zh: '工作区', en: 'Workspace' },
  wsChange: { zh: '切换', en: 'Change' },
  closePanel: { zh: '关闭面板', en: 'Close panel' },
  openConvFirst: { zh: '请先打开一个对话。', en: 'Open a conversation first.' },
  emptyDir: { zh: '（空）', en: '(empty)' },
  previewHint: {
    zh: '在 Files 中点击一个文件查看预览。',
    en: 'Click a file in Files to preview it.'
  },
  saving: { zh: '保存中', en: 'Saving' },
  saved: { zh: '已保存', en: 'Saved' },
  sourceBtn: { zh: '源码', en: 'Source' },
  renderBtn: { zh: '渲染', en: 'Render' },
  previewBtn: { zh: '预览', en: 'Preview' },
  editBtn: { zh: '编辑', en: 'Edit' },
  tooLargeToEdit: { zh: '文件过大已截断，不能编辑', en: 'File truncated — too large to edit' },
  diffEmpty: {
    zh: '本次会话还没有文件改动。智能体写入/编辑文件后会在这里显示 diff。',
    en: 'No file changes yet. Diffs appear here when the agent writes or edits files.'
  },
  diffBinary: {
    zh: '无 diff（可能是未跟踪的新文件，或二进制文件）。',
    en: 'No diff (new untracked file or binary).'
  },
  planEmpty: {
    zh: '还没有计划。面对多步骤任务时，智能体会用 update_plan 列出步骤并在此实时更新。',
    en: 'No plan yet. For multi-step tasks the agent lists steps via update_plan and updates them here.'
  },
  termHint: {
    zh: '在当前对话的工作区执行命令，输出显示在这里。',
    en: 'Run commands in this conversation’s workspace; output shows here.'
  },
  termPh: { zh: '输入命令，回车执行', en: 'Type a command, Enter to run' },
  termRun: { zh: '运行', en: 'Run' },
  termStop: { zh: '停止', en: 'Stop' },
  termClear: { zh: '清空', en: 'Clear' },
  termClearTip: { zh: '清空输出', en: 'Clear output' },
  gitReading: { zh: '读取 Git 状态…', en: 'Reading Git status…' },
  gitNotRepo: { zh: '当前工作区不是 Git 仓库。', en: 'This workspace is not a Git repository.' },
  gitInit: { zh: '初始化 Git 仓库', en: 'Initialize Git repository' },
  gitBranch: { zh: '分支', en: 'Branch' },
  gitRefresh: { zh: '刷新', en: 'Refresh' },
  gitClean: { zh: '工作区干净，没有改动。', en: 'Working tree clean — no changes.' },
  gitStaged: { zh: '已暂存', en: 'Staged' },
  gitChanges: { zh: '更改', en: 'Changes' },
  gitStage: { zh: '暂存', en: 'Stage' },
  gitUnstage: { zh: '取消暂存', en: 'Unstage' },
  gitMsgPh: { zh: '提交信息…', en: 'Commit message…' },
  gitCommitting: { zh: '提交中…', en: 'Committing…' },
  gitCommit: { zh: '提交', en: 'Commit' },
  gitCommitFail: { zh: '提交失败', en: 'Commit failed' },
  memHint: {
    zh: '项目记忆（跨对话长期条目，每次注入给智能体；智能体也会用 add_memory / forget_memory 维护）',
    en: 'Project memory — long-lived entries injected into every run; the agent also maintains them via add_memory / forget_memory.'
  },
  memEmpty: { zh: '还没有记忆条目。', en: 'No memory entries yet.' },
  memStale: { zh: '⚠较旧', en: '⚠ stale' },
  memAddPh: { zh: '新增一条记忆，回车保存', en: 'Add a memory, Enter to save' },
  memAdd: { zh: '添加', en: 'Add' },
  memScopeProject: { zh: '本项目', en: 'Project' },
  memScopeGlobal: { zh: '全局', en: 'Global' },
  memPending: { zh: '待采纳（自动沉淀的候选）', en: 'Suggested (auto-distilled)' },
  memAdopt: { zh: '采纳', en: 'Adopt' },
  memIgnore: { zh: '忽略', en: 'Ignore' },
  memConsolidate: { zh: '整理', en: 'Tidy up' },
  memConsolidating: { zh: '整理中…', en: 'Tidying…' },
  memConsolidateConfirm: {
    zh: '整理结果：{a} 条 → {b} 条。应用（整批替换该层）？',
    en: 'Result: {a} → {b} entries. Apply (replaces this scope)?'
  },
  memSavedToast: { zh: '✓ 已存入项目记忆', en: '✓ Saved to project memory' },
  memHashHint: {
    zh: '# 开头：回车直接存入项目记忆',
    en: 'Starts with # — Enter saves to project memory'
  },
  memFact: { zh: '事实', en: 'Fact' },
  memPreference: { zh: '偏好', en: 'Preference' },
  memDecision: { zh: '决策', en: 'Decision' },
  memPitfall: { zh: '坑', en: 'Pitfall' },
  memTodo: { zh: '待办', en: 'To-do' },
  starter4: {
    zh: '这个项目是做什么的？帮我快速梳理一下',
    en: 'What does this project do? Give me a quick tour'
  }
}

export function t(key: keyof typeof DICT, lang: Lang): string {
  const e = DICT[key]
  return e ? e[lang] : (key as string)
}

/** 组件内取翻译函数；语言变化时自动重渲染 */
export function useT(): (key: keyof typeof DICT) => string {
  const lang = useStore((s) => s.settings?.language ?? 'zh')
  return (key) => t(key, lang)
}
