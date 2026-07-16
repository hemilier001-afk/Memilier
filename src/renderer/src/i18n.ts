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
  setSkills: { zh: '技能与插件', en: 'Skills & Plugins' },
  setShortcuts: { zh: '快捷键', en: 'Shortcuts' },
  setAbout: { zh: '关于', en: 'About' },
  submitKey: { zh: '发送方式', en: 'Send with' },
  submitEnter: { zh: '回车发送（Shift+Enter 换行）', en: 'Enter (Shift+Enter = newline)' },
  submitMod: { zh: '⌘/Ctrl + 回车 发送', en: '⌘/Ctrl + Enter' },

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

  // 设置 - 技能/插件
  skillsTitle: { zh: '技能（Skills）', en: 'Skills' },
  pluginsTitle: { zh: '插件（Plugins）', en: 'Plugins' },
  openPluginsDir: { zh: '打开插件目录', en: 'Open plugins folder' },
  installPlugin: { zh: '从文件夹…', en: 'From folder…' },
  marketplace: { zh: '插件市场', en: 'Marketplace' },
  install: { zh: '安装', en: 'Install' },
  installed: { zh: '已安装', en: 'Installed' },
  uninstall: { zh: '卸载', en: 'Uninstall' },

  // 关于
  aboutDesc: {
    zh: '桌面智能体：对话 + 工具调用 + 文件/命令操作，由本地 Ollama 或云端模型驱动。',
    en: 'A desktop agent: chat + tool use + file/command actions, powered by local Ollama or cloud models.'
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
