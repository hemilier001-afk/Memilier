import { useEffect, useMemo, useRef, useState } from 'react'
import type { Message as MsgType } from '@shared/types'
import { useStore, type ToolView } from '../store'
import { useT } from '../i18n'
import { MessageView, StreamingBubble } from './Message'
import {
  FolderIcon,
  ImageIcon,
  FileIcon,
  BlocksIcon,
  ZapIcon,
  ListChecksIcon,
  MessageIcon,
  MicIcon,
  SearchIcon,
  PencilIcon,
  SparklesIcon,
  GearIcon
} from './icons'

const STARTERS = ['starter1', 'starter2', 'starter3', 'starter4'] as const
const STARTER_ICONS = [
  <FolderIcon key="s1" />,
  <SearchIcon key="s2" />,
  <PencilIcon key="s3" />,
  <SparklesIcon key="s4" />
]

function StarterPrompts(): JSX.Element {
  const send = useStore((s) => s.send)
  const t = useT()
  const settings = useStore((s) => s.settings)
  const view = useStore((s) => s.view)
  const active = useStore((s) => s.active)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const pickWs = useStore((s) => s.pickActiveWorkspace)

  // 首次使用：还没配任何模型 → 欢迎引导卡（替代“发消息才报错”）
  const unconfigured = settings && !settings.defaultModel && !(settings.providers ?? []).length
  if (unconfigured) {
    return (
      <div className="text-center">
        <p className="font-display mb-2 text-3xl text-fg">{t('welcomeTitle')}</p>
        <p className="mb-5 text-sm text-muted">{t('welcomeSub')}</p>
        <ol className="mx-auto mb-5 max-w-md space-y-2 text-left text-sm text-muted">
          <li>{t('welcomeStep1')}</li>
          <li>{t('welcomeStep2')}</li>
          <li>
            {t('welcomeStep3A')} <code className="text-accent">deepseek-chat</code>{' '}
            {t('welcomeStep3B')}
          </li>
        </ol>
        <button
          onClick={() => setSettingsOpen(true)}
          className="rounded-lg border border-line bg-surface-2 text-fg hover:bg-accent-soft px-4 py-2 text-sm transition"
        >
          {t('openSettings')}
        </button>
      </div>
    )
  }

  return (
    <div className="text-center">
      {/* Claude 式衬线问候语 */}
      <p className="font-display mb-6 text-3xl text-fg">{t('starterHint')}</p>
      {view !== 'chat' && (
        <div className="mx-auto mb-4 max-w-xl rounded-lg border border-line bg-surface-2 px-4 py-2 text-xs text-muted">
          {t('curWorkspace')}
          <span className="font-mono">{active?.workspaceDir || t('notSet')}</span>
          <button onClick={() => void pickWs()} className="ml-2 text-accent hover:underline">
            {t('wsChangeBtn')}
          </button>
          <span className="ml-2">
            {t('agentsMdTip')} <code>AGENTS.md</code> {t('agentsMdTipB')}
          </span>
        </div>
      )}
      <div className="mx-auto grid max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
        {STARTERS.map((key, i) => (
          <button
            key={key}
            onClick={() => send(t(key))}
            className="rounded-xl border border-line bg-surface px-4 py-3 text-left text-sm text-fg transition hover:border-accent hover:text-accent"
          >
            <span className="mr-2">{STARTER_ICONS[i]}</span>
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  )
}

const TOOL_VIEWS = [
  { key: 'summary', label: 'viewSummary', title: 'viewSummaryTip' },
  { key: 'normal', label: 'viewNormal', title: 'viewNormalTip' },
  { key: 'verbose', label: 'viewVerbose', title: 'viewVerboseTip' }
] as const

function ModelSelector(): JSX.Element {
  const t = useT()
  const models = useStore((s) => s.models)
  const active = useStore((s) => s.active)
  const settings = useStore((s) => s.settings)
  const setActiveModel = useStore((s) => s.setActiveModel)
  const refreshModels = useStore((s) => s.refreshModels)

  // 按提供方分组展示
  const groups = models.reduce<Record<string, typeof models>>((acc, m) => {
    const key = m.provider ?? t('modelGroup')
    ;(acc[key] ??= []).push(m)
    return acc
  }, {})

  return (
    <div className="flex items-center gap-2">
      <select
        value={active?.model || settings?.defaultModel || ''}
        onChange={(e) => setActiveModel(e.target.value)}
        className="max-w-[180px] cursor-pointer rounded-md bg-transparent px-1 py-0.5 text-xs text-muted outline-none transition hover:text-fg"
      >
        {models.length === 0 && <option value="">{t('noModels')}</option>}
        {Object.entries(groups).map(([provider, list]) => (
          <optgroup key={provider} label={provider}>
            {list.map((m) => (
              <option key={m.name} value={m.name}>
                {m.label ?? m.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <button
        onClick={() => void refreshModels()}
        title={t('refreshModels')}
        className="text-xs text-muted transition hover:text-fg"
      >
        ↻
      </button>
    </div>
  )
}

function TokenMeter(): JSX.Element | null {
  const active = useStore((s) => s.active)
  const compact = useStore((s) => s.compact)
  const streaming = useStore((s) => s.streaming)
  const t = useT()
  if (!active || active.messages.length === 0) return null
  const chars = active.messages.reduce((n, m) => n + (m.content?.length ?? 0), 0)
  const tokens = Math.ceil(chars / 3) // 粗估：CJK 偏保守
  const near = chars > 40_000 // 接近 48k 字符的历史预算
  const label = tokens >= 1000 ? `~${(tokens / 1000).toFixed(1)}k` : `~${tokens}`
  if (near) {
    // 偏长时给出直接出口：点击即压缩（等价 /compact）
    return (
      <button
        onClick={() => !streaming && void compact()}
        title={t('tokenLongTip')}
        className="rounded-md border border-line px-1.5 py-0.5 text-xs text-muted transition hover:bg-surface-2 hover:text-fg"
      >
        {label} tokens ⚠ {t('compressBtn')}
      </button>
    )
  }
  return (
    <span title={t('tokenTip')} className="text-xs text-muted">
      {label} tokens
    </span>
  )
}

// 把连续的「过程消息」（带工具调用的 assistant + tool 结果）聚合成一个「工作了 N 步」组，
// 多步任务不再刷屏一串过程行；单步则按原样渲染
function renderGrouped(
  messages: MsgType[],
  streaming: boolean,
  lastAssistantId: string | null,
  regenerate: () => void,
  t: (key: never) => string
): JSX.Element[] {
  const items: JSX.Element[] = []
  let buf: MsgType[] = []
  const flush = (): void => {
    if (!buf.length) return
    const steps = buf.filter((m) => m.role === 'assistant')
    if (steps.length > 1) {
      const counts: Record<string, number> = {}
      for (const s of steps)
        for (const tc of s.toolCalls ?? []) counts[tc.name] = (counts[tc.name] ?? 0) + 1
      const stat = Object.entries(counts)
        .map(([n, c]) => (c > 1 ? `${n} ×${c}` : n))
        .slice(0, 4)
        .join('、')
      const group = [...buf]
      items.push(
        <details key={`grp-${group[0].id}`} className="pl-10">
          <summary className="flex cursor-pointer list-none items-center gap-2 py-0.5 text-xs text-muted transition hover:text-fg [&::-webkit-details-marker]:hidden">
            <GearIcon className="h-3.5 w-3.5" />
            <span className="truncate">
              {(t as (k: string) => string)('workedSteps')
                .replace('{n}', String(steps.length))
                .replace('{s}', stat)}
            </span>
            <span className="shrink-0 opacity-60">▸</span>
          </summary>
          <div className="-ml-9 mt-1 space-y-1">
            {group.map((m) => (
              <MessageView key={m.id} message={m} />
            ))}
          </div>
        </details>
      )
    } else {
      for (const m of buf) items.push(<MessageView key={m.id} message={m} />)
    }
    buf = []
  }
  for (const m of messages) {
    const isProc = m.role === 'tool' || (m.role === 'assistant' && !!m.toolCalls?.length)
    if (isProc) {
      buf.push(m)
    } else {
      flush()
      items.push(
        <MessageView
          key={m.id}
          message={m}
          isLast={!streaming && m.id === lastAssistantId}
          onRegenerate={regenerate}
        />
      )
    }
  }
  flush()
  return items
}

// 其它会话正在后台生成时的头部徽标：并行任务一眼可见，点击跳转过去（跨空间自动切换）
function RunningBadge(): JSX.Element | null {
  const t = useT()
  const runningIds = useStore((s) => s.runningIds)
  const active = useStore((s) => s.active)
  const conversations = useStore((s) => s.conversations)
  const view = useStore((s) => s.view)
  const others = runningIds.filter((id) => id !== active?.id)
  if (others.length === 0) return null

  const jump = (): void => {
    const target = conversations.find((c) => c.id === others[0])
    if (!target) return
    const st = useStore.getState()
    if ((target.kind ?? 'chat') !== view)
      st.setView(target.kind ?? 'chat', { skipAutoSelect: true })
    void st.selectConversation(target.id)
  }
  return (
    <button
      onClick={jump}
      title={t('sessionsRunningTip')}
      className="flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent-soft px-2.5 py-0.5 text-xs text-accent transition hover:border-accent"
    >
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
      {t('sessionsRunning').replace('{n}', String(others.length))}
    </button>
  )
}

// 头部「⋯」溢出菜单：收纳低频操作，避免图标堆挤
function HeaderMenu({
  disabled,
  streaming
}: {
  disabled: boolean
  streaming: boolean
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const t = useT()
  const toolView = useStore((s) => s.toolView)
  const item =
    'block w-full px-3 py-1.5 text-left text-xs text-fg transition hover:bg-surface-2 disabled:opacity-40'
  const run = (fn: () => void): void => {
    setOpen(false)
    fn()
  }
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={t('moreActions')}
        className="rounded-md border border-line px-2 py-1 text-sm text-muted transition hover:text-fg"
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-lg border border-line bg-surface py-1 shadow-lg">
            <button
              className={item}
              disabled={disabled || streaming}
              onClick={() => run(() => void useStore.getState().compact())}
            >
              {t('hmCompact')}
            </button>
            <button
              className={item}
              disabled={disabled || streaming}
              onClick={() => run(() => useStore.getState().reflect())}
            >
              {t('hmReflect')}
            </button>
            <button className={item} onClick={() => run(() => useStore.getState().exportActive())}>
              {t('hmExport')}
            </button>
            <div className="my-1 border-t border-line" />
            <p className="px-3 py-1 text-[10px] uppercase tracking-wide text-muted">
              {t('viewDensity')}
            </p>
            {TOOL_VIEWS.map((v) => (
              <button
                key={v.key}
                title={t(v.title)}
                className={item}
                onClick={() => run(() => useStore.getState().setToolView(v.key as ToolView))}
              >
                <span className="inline-block w-4 text-accent">
                  {toolView === v.key ? '✓' : ''}
                </span>
                {t(v.label)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function PanelToggle(): JSX.Element {
  const t = useT()
  const open = useStore((s) => s.rightPanelOpen)
  const toggle = useStore((s) => s.toggleRightPanel)
  return (
    <button
      onClick={toggle}
      title={open ? t('panelHide') : t('panelShow')}
      className={`rounded-md border px-2 py-1 text-sm transition ${
        open ? 'border-accent text-accent' : 'border-line text-muted hover:text-fg'
      }`}
    >
      ▥
    </button>
  )
}

function WorkspacePicker({ dir }: { dir: string }): JSX.Element {
  const pickActiveWorkspace = useStore((s) => s.pickActiveWorkspace)
  const t = useT()
  const clean = dir.replace(/[/\\]+$/, '')
  // 主目录显示为 ~（避免家目录名与品牌名混淆，如 memilier vs hemilier）
  const name = clean === window.api.home ? '~' : clean.split(/[/\\]/).pop() || dir

  return (
    <button
      onClick={() => void pickActiveWorkspace()}
      title={t('wsTip').replace('{d}', dir)}
      className="flex max-w-[200px] items-center gap-1.5 rounded-md border border-line px-2 py-1 text-sm text-muted transition hover:border-accent hover:text-accent"
    >
      <FolderIcon className="h-3.5 w-3.5" />
      <span className="truncate">{name}</span>
    </button>
  )
}

const MODES: { key: 'auto' | 'plan' | 'chat'; label: string; icon: JSX.Element; desc: string }[] = [
  {
    key: 'auto',
    label: 'modeAuto',
    icon: <ZapIcon className="h-3.5 w-3.5" />,
    desc: 'modeAutoDesc'
  },
  {
    key: 'plan',
    label: 'modePlan',
    icon: <ListChecksIcon className="h-3.5 w-3.5" />,
    desc: 'modePlanDesc'
  },
  {
    key: 'chat',
    label: 'modeChat',
    icon: <MessageIcon className="h-3.5 w-3.5" />,
    desc: 'modeChatDesc'
  }
]

function ModeMenu(): JSX.Element {
  const active = useStore((s) => s.active)
  const setActiveMode = useStore((s) => s.setActiveMode)
  const [open, setOpen] = useState(false)
  const t = useT() as unknown as (k: string) => string
  const cur = MODES.find((m) => m.key === (active?.mode ?? 'auto')) ?? MODES[0]
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted transition hover:bg-surface-2 hover:text-fg"
        title={t('modeTitle')}
      >
        {cur.icon} {t(cur.label)} <span className="text-[10px]">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-20 mb-1 w-56 rounded-lg border border-line bg-surface py-1 shadow-lg">
            {MODES.map((m) => (
              <button
                key={m.key}
                onClick={() => {
                  setActiveMode(m.key)
                  setOpen(false)
                }}
                className={`block w-full px-3 py-1.5 text-left text-xs transition hover:bg-surface-2 ${
                  cur.key === m.key ? 'text-accent' : 'text-fg'
                }`}
              >
                <div className="flex items-center gap-1.5 font-medium">
                  {m.icon} {t(m.label)}
                </div>
                <div className="text-muted">{t(m.desc)}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function AttachMenu({
  onInsert,
  onImage
}: {
  onInsert: (text: string) => void
  onImage: (dataUrl: string) => void
}): JSX.Element {
  const pickActiveWorkspace = useStore((s) => s.pickActiveWorkspace)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const [open, setOpen] = useState(false)
  const t = useT()

  const uploadFile = async (): Promise<void> => {
    setOpen(false)
    const f = await window.api.pickFile()
    if (f) onInsert(`\n\n[附加文件：${f.name}]\n\`\`\`\n${f.content}\n\`\`\`\n`)
  }

  const uploadImage = async (): Promise<void> => {
    setOpen(false)
    const img = await window.api.pickImage()
    if (img) onImage(img.dataUrl)
  }

  const item = 'block w-full px-3 py-1.5 text-left text-xs text-fg transition hover:bg-surface-2'
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-base text-muted transition hover:bg-surface-2 hover:text-fg"
        title={t('attach')}
      >
        +
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-20 mb-1 w-44 rounded-lg border border-line bg-surface py-1 shadow-lg">
            <button onClick={() => void uploadImage()} className={item}>
              <span className="mr-1.5">
                <ImageIcon className="h-3.5 w-3.5" />
              </span>
              {t('attachImage')}
            </button>
            <button onClick={() => void uploadFile()} className={item}>
              <span className="mr-1.5">
                <FileIcon className="h-3.5 w-3.5" />
              </span>
              {t('attachFile')}
            </button>
            <button
              onClick={() => {
                setOpen(false)
                void pickActiveWorkspace()
              }}
              className={item}
            >
              <span className="mr-1.5">
                <FolderIcon className="h-3.5 w-3.5" />
              </span>
              {t('attachWorkspace')}
            </button>
            <button
              onClick={() => {
                setOpen(false)
                setSettingsOpen(true)
              }}
              className={item}
            >
              <span className="mr-1.5">
                <BlocksIcon className="h-3.5 w-3.5" />
              </span>
              {t('attachPlugins')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

type MicStatus = 'idle' | 'recording' | 'transcribing' | 'error'

function MicButton({ onAppend }: { onAppend: (text: string) => void }): JSX.Element {
  const [status, setStatus] = useState<MicStatus>('idle')
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const asrConfigured = useStore((s) => !!s.settings?.asrProviderId)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)

  const start = async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      chunksRef.current = []
      mr.ondataavailable = (e): void => {
        if (e.data.size) chunksRef.current.push(e.data)
      }
      mr.onstop = async (): Promise<void> => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
        setStatus('transcribing')
        try {
          const buf = new Uint8Array(await blob.arrayBuffer())
          const text = await window.api.transcribeAudio(buf, blob.type)
          if (text.trim()) onAppend(text.trim())
          setStatus('idle')
        } catch {
          setStatus('error')
          setTimeout(() => setStatus('idle'), 3000)
        }
      }
      recRef.current = mr
      mr.start()
      setStatus('recording')
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 3000)
    }
  }

  const toggle = (): void => {
    if (!asrConfigured) {
      setSettingsOpen(true)
      return
    }
    if (status === 'recording') recRef.current?.stop()
    else if (status === 'idle' || status === 'error') void start()
  }

  const icon: React.ReactNode =
    status === 'recording' ? (
      <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
    ) : status === 'transcribing' ? (
      '…'
    ) : status === 'error' ? (
      '!'
    ) : (
      <MicIcon className="h-4 w-4" />
    )
  const t = useT()
  const title = !asrConfigured
    ? t('micSetup')
    : status === 'recording'
      ? t('micStop')
      : status === 'transcribing'
        ? t('micBusy')
        : t('micStart')

  return (
    <button
      onClick={toggle}
      disabled={status === 'transcribing'}
      title={title}
      className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm transition disabled:opacity-60 ${
        status === 'recording'
          ? 'bg-accent text-white'
          : 'text-muted hover:bg-surface-2 hover:text-fg'
      }`}
    >
      {icon}
    </button>
  )
}

function Composer(): JSX.Element {
  const t = useT()
  const [text, setText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [files, setFiles] = useState<string[]>([])
  const [images, setImages] = useState<string[]>([])
  const [atQuery, setAtQuery] = useState<string | null>(null)
  const [selIdx, setSelIdx] = useState(0) // 斜杠/@ 菜单的键盘高亮项
  const streaming = useStore((s) => s.streaming)
  const send = useStore((s) => s.send)
  const editResend = useStore((s) => s.editResend)
  const abort = useStore((s) => s.abort)
  const active = useStore((s) => s.active)
  const pendingEdit = useStore((s) => s.pendingEdit)
  const setPendingEdit = useStore((s) => s.setPendingEdit)
  const ref = useRef<HTMLTextAreaElement>(null)

  // 斜杠命令（输入框以 / 开头且未含空格时弹出）
  const slashQuery = /^\/(\S*)$/.exec(text)?.[1] ?? null
  const SLASH_COMMANDS: { id: string; label: string; desc: string; run: () => void }[] = [
    {
      id: 'new',
      label: '/new',
      desc: t('slashNew'),
      run: () => void useStore.getState().newConversation()
    },
    {
      id: 'compact',
      label: '/compact',
      desc: t('slashCompact'),
      run: () => void useStore.getState().compact()
    },
    {
      id: 'plan',
      label: '/plan',
      desc: t('slashPlan'),
      run: () => useStore.getState().setActiveMode('plan')
    },
    {
      id: 'auto',
      label: '/auto',
      desc: t('slashAuto'),
      run: () => useStore.getState().setActiveMode('auto')
    },
    {
      id: 'chat',
      label: '/chat',
      desc: t('slashChat'),
      run: () => useStore.getState().setActiveMode('chat')
    },
    {
      id: 'export',
      label: '/export',
      desc: t('slashExport'),
      run: () => useStore.getState().exportActive()
    },
    {
      id: 'reflect',
      label: '/reflect',
      desc: t('slashReflect'),
      run: () => useStore.getState().reflect()
    },
    {
      id: 'settings',
      label: '/settings',
      desc: t('slashSettings'),
      run: () => useStore.getState().setSettingsOpen(true)
    }
  ]
  const slashMatches =
    slashQuery === null
      ? []
      : SLASH_COMMANDS.filter((c) => c.id.startsWith(slashQuery.toLowerCase()))
  const runSlash = (cmd: (typeof SLASH_COMMANDS)[number]): void => {
    setText('')
    if (ref.current) ref.current.style.height = 'auto'
    cmd.run()
  }

  const resize = (): void => {
    const el = ref.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`
    }
  }

  // 接收来自消息「编辑」的注入
  useEffect(() => {
    if (pendingEdit) {
      setText(pendingEdit.content)
      setEditingId(pendingEdit.id)
      setPendingEdit(null)
      setTimeout(() => {
        ref.current?.focus()
        resize()
      }, 0)
    }
  }, [pendingEdit, setPendingEdit])

  // 切换对话时载入文件列表（供 @ 引用）
  useEffect(() => {
    if (active)
      window.api
        .listFiles(active.workspaceDir)
        .then(setFiles)
        .catch(() => setFiles([]))
    setEditingId(null)
    setText('')
    setImages([])
    // 仅在切换对话/工作区时重置，不随消息追加（active 引用变化）而重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.workspaceDir])

  const addImagesFromFiles = (fileList: FileList | File[]): void => {
    for (const f of Array.from(fileList)) {
      if (!f.type.startsWith('image/')) continue
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string')
          setImages((prev) => [...prev, reader.result as string])
      }
      reader.readAsDataURL(f)
    }
  }

  const onChange = (v: string): void => {
    setText(v)
    const m = /@([^\s@]*)$/.exec(v)
    setAtQuery(m ? m[1] : null)
    setSelIdx(0)
    resize()
  }

  const pickFile = (path: string): void => {
    setText((t) => t.replace(/@([^\s@]*)$/, `@${path} `))
    setAtQuery(null)
    ref.current?.focus()
  }

  const submit = (): void => {
    if (streaming || (!text.trim() && images.length === 0)) return
    if (editingId) {
      void editResend(editingId, text)
      setEditingId(null)
    } else {
      send(text, images)
    }
    setText('')
    setImages([])
    setAtQuery(null)
    if (ref.current) ref.current.style.height = 'auto'
  }

  const matches =
    atQuery === null
      ? []
      : files.filter((f) => f.toLowerCase().includes(atQuery.toLowerCase())).slice(0, 8)

  return (
    // Claude 式无缝输入区：不加分隔线，输入卡片直接悬浮在纸面底色上
    <div
      className="bg-paper px-3 pb-4 pt-1"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const dropped = Array.from(e.dataTransfer.files)
        addImagesFromFiles(dropped) // 图片 → 缩略图附件
        // 非图片文件：仅接受文本类文件（按 MIME/扩展名白名单），避免二进制读成乱码插入
        const TEXT_EXT =
          /\.(md|txt|json|csv|tsv|log|js|ts|tsx|jsx|py|java|c|cpp|h|html?|css|xml|ya?ml|toml|ini|sh|sql|rs|go|rb|vue|svelte)$/i
        for (const f of dropped) {
          if (f.type.startsWith('image/') || f.size > 5 * 1024 * 1024) continue
          if (!f.type.startsWith('text/') && !TEXT_EXT.test(f.name)) continue
          const reader = new FileReader()
          reader.onload = () => {
            if (typeof reader.result !== 'string') return
            const content =
              reader.result.length > 100_000
                ? `${reader.result.slice(0, 100_000)}\n…（已截断）`
                : reader.result
            setText((t) => `${t}\n\n[附加文件：${f.name}]\n\`\`\`\n${content}\n\`\`\`\n`)
            resize()
          }
          reader.readAsText(f)
        }
      }}
    >
      <div className="relative mx-auto max-w-3xl">
        {slashMatches.length > 0 && (
          <div className="absolute bottom-full left-0 mb-1 w-full overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg">
            {slashMatches.map((c, i) => (
              <button
                key={c.id}
                onClick={() => runSlash(c)}
                onMouseEnter={() => setSelIdx(i)}
                className={`flex w-full items-baseline gap-3 px-3 py-1.5 text-left text-xs hover:bg-surface-2 ${i === selIdx ? 'bg-surface-2' : ''}`}
              >
                <span className="font-mono font-semibold text-accent">{c.label}</span>
                <span className="text-muted">{c.desc}</span>
              </button>
            ))}
          </div>
        )}
        {matches.length > 0 && (
          <div className="absolute bottom-full left-0 mb-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
            {matches.map((f, i) => (
              <button
                key={f}
                onClick={() => pickFile(f)}
                onMouseEnter={() => setSelIdx(i)}
                className={`block w-full truncate px-3 py-1 text-left font-mono text-xs text-fg hover:bg-surface-2 ${i === selIdx ? 'bg-surface-2' : ''}`}
              >
                {f}
              </button>
            ))}
          </div>
        )}

        {editingId && (
          <div className="mb-1 flex items-center justify-between rounded-lg bg-accent-soft px-3 py-1 text-xs text-accent">
            <span>{t('editingBanner')}</span>
            <button
              onClick={() => {
                setEditingId(null)
                setText('')
              }}
              className="hover:underline"
            >
              {t('cancel')}
            </button>
          </div>
        )}

        <div className="rounded-2xl border border-line bg-surface px-3 py-2.5 shadow-sm transition focus-within:border-accent focus-within:shadow-md">
          {images.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {images.map((src, i) => (
                <div key={i} className="relative">
                  <img
                    src={src}
                    alt=""
                    className="h-16 w-16 rounded-lg border border-line object-cover"
                  />
                  <button
                    onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-neutral-700 text-[10px] text-white"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={ref}
            value={text}
            disabled={!active}
            rows={1}
            placeholder={active ? t('composerPh') : t('composerNoConv')}
            onChange={(e) => onChange(e.target.value)}
            onPaste={(e) => {
              const imgs = Array.from(e.clipboardData.files).filter((f) =>
                f.type.startsWith('image/')
              )
              if (imgs.length) {
                e.preventDefault()
                addImagesFromFiles(imgs)
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && atQuery !== null) {
                setAtQuery(null)
                return
              }
              // 菜单键盘导航：↑↓ 移动高亮，Enter 选中（斜杠与 @ 两个菜单共用）
              const menuLen = slashMatches.length || (atQuery !== null ? matches.length : 0)
              if (menuLen > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault()
                setSelIdx((i) => (i + (e.key === 'ArrowDown' ? 1 : menuLen - 1)) % menuLen)
                return
              }
              if (slashMatches.length > 0) {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  runSlash(slashMatches[Math.min(selIdx, slashMatches.length - 1)])
                  return
                }
                if (e.key === 'Escape') {
                  setText('')
                  return
                }
              }
              if (atQuery !== null && matches.length > 0 && e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                pickFile(matches[Math.min(selIdx, matches.length - 1)])
                return
              }
              if (e.key === 'Enter' && atQuery === null) {
                const mode = useStore.getState().settings?.submitKey ?? 'enter'
                const shouldSend =
                  mode === 'mod-enter' ? e.metaKey || e.ctrlKey : !e.shiftKey && !e.metaKey
                if (shouldSend) {
                  e.preventDefault()
                  submit()
                }
              }
            }}
            className="max-h-[200px] w-full resize-none bg-transparent py-1 text-sm text-fg outline-none placeholder:text-muted"
          />
          <div className="mt-1 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <AttachMenu
                onInsert={(t) => onChange(text + t)}
                onImage={(url) => setImages((prev) => [...prev, url])}
              />
              <ModeMenu />
              <MicButton onAppend={(t) => onChange(text + t)} />
            </div>
            <div className="flex items-center gap-2">
              <ModelSelector />
              {streaming ? (
                <button
                  onClick={abort}
                  title={t('stop')}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-fg transition hover:bg-surface-2"
                >
                  <span className="block h-2.5 w-2.5 rounded-[2px] bg-current" />
                </button>
              ) : (
                <button
                  onClick={submit}
                  title={editingId ? t('resend') : t('send')}
                  disabled={!active || (!text.trim() && images.length === 0)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white transition hover:bg-accent-hover disabled:opacity-40"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M12 19V5M12 5l-6 6M12 5l6 6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ChatView(): JSX.Element {
  const t = useT()
  const active = useStore((s) => s.active)
  const view = useStore((s) => s.view)
  const streaming = useStore((s) => s.streaming)
  const streamingText = useStore((s) => s.streamingText)
  const regenerate = useStore((s) => s.regenerate)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // 是否「贴在底部」：贴底时才跟随输出向下滚；用户往上翻则停止跟随，方便阅读历史
  const stickRef = useRef(true)
  const [showJump, setShowJump] = useState(false)

  const lastAssistantId = useMemo(() => {
    const msgs = active?.messages ?? []
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') return msgs[i].id
    }
    return null
  }, [active?.messages])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickRef.current = distFromBottom < 80 // 距底 < 80px 视为贴底
    setShowJump(!stickRef.current)
  }

  // 用户向上滚（滚轮/触控板）→ 立即停止跟随，避免流式输出时被自动拽回底部
  const onWheel = (e: React.WheelEvent): void => {
    if (e.deltaY < 0 && stickRef.current) {
      stickRef.current = false
      setShowJump(true)
    }
  }

  const jumpToBottom = (): void => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight })
    stickRef.current = true
    setShowJump(false)
  }

  // 跟随输出：贴底时自动下滚；刚发送(最后一条是 user)时强制回到底部并恢复跟随
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const msgs = active?.messages ?? []
    if (msgs[msgs.length - 1]?.role === 'user') {
      stickRef.current = true
      setShowJump(false)
    }
    if (stickRef.current) el.scrollTo({ top: el.scrollHeight })
  }, [active?.messages, streamingText, streaming])

  // 监听内容高度变化（代码块/公式/图片渲染完才撑高），贴底时持续跟随——比只依赖 token 更稳
  useEffect(() => {
    const el = scrollRef.current
    const content = contentRef.current
    if (!el || !content) return
    const ro = new ResizeObserver(() => {
      if (stickRef.current) el.scrollTo({ top: el.scrollHeight })
    })
    ro.observe(content)
    return () => ro.disconnect()
  }, [])

  // 切换对话：回到底部并重置跟随
  useEffect(() => {
    stickRef.current = true
    setShowJump(false)
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ top: scrollRef.current?.scrollHeight ?? 0 })
    )
  }, [active?.id])

  if (!active) {
    return (
      <main className="relative flex flex-1 items-center justify-center text-muted">
        <div className="region-drag absolute inset-x-0 top-0 h-10" />
        <div className="text-center">
          <p className="text-lg text-fg">{t('appTagline')}</p>
          <p className="mt-1 text-sm">{t('emptySubtitle')}</p>
        </div>
      </main>
    )
  }

  const showStreaming = streaming

  return (
    <main className="relative flex flex-1 flex-col bg-paper">
      <header className="region-drag flex items-center justify-between gap-3 border-b border-line px-4 py-2 pt-10">
        <h1 className="min-w-0 truncate text-sm font-medium text-fg">{active.title}</h1>
        <div className="flex items-center gap-3">
          <RunningBadge />
          <TokenMeter />
          {view === 'chat' && <WorkspacePicker dir={active.workspaceDir} />}
          <HeaderMenu disabled={active.messages.length === 0} streaming={streaming} />
          {view !== 'chat' && <PanelToggle />}
        </div>
      </header>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        onWheel={onWheel}
        className="flex-1 overflow-y-auto px-4 py-6"
      >
        <div
          ref={contentRef}
          className={`mx-auto flex w-full max-w-3xl flex-col gap-6 ${
            active.messages.length === 0 && !showStreaming ? 'h-full justify-center' : ''
          }`}
        >
          {active.messages.length === 0 && !showStreaming ? (
            <StarterPrompts />
          ) : (
            renderGrouped(active.messages, streaming, lastAssistantId, regenerate, t as never)
          )}
          {showStreaming && <StreamingBubble text={streamingText} />}
        </div>
      </div>

      {showJump && (
        <button
          onClick={jumpToBottom}
          className="absolute bottom-28 left-1/2 -translate-x-1/2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-fg shadow-lg transition hover:bg-surface-2"
        >
          {t('scrollToBottom')}
        </button>
      )}

      <Composer />
    </main>
  )
}
