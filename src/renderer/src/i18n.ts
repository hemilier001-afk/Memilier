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
