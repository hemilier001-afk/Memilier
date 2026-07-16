import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import type { Message as Msg, ToolCall } from '@shared/types'
import { useStore } from '../store'
import { useT } from '../i18n'

// 图片可能是内联 data URL（乐观回显/旧数据）或文件引用（himg:），后者经 IPC 还原为 data URL
function MessageImage({ source }: { source: string }): JSX.Element | null {
  const [src, setSrc] = useState(source.startsWith('data:') ? source : '')
  useEffect(() => {
    if (source.startsWith('data:')) {
      setSrc(source)
      return
    }
    let alive = true
    window.api.readImage(source).then((d) => {
      if (alive) setSrc(d)
    })
    return () => {
      alive = false
    }
  }, [source])
  if (!src) return null
  return (
    <img src={src} alt="" className="max-h-40 rounded-lg border border-white/30 object-contain" />
  )
}

const STATUS_KEY = {
  pending: 'stPending',
  running: 'stRunning',
  done: 'stDone',
  error: 'stError',
  denied: 'stDenied'
} as const

const STATUS_COLOR: Record<ToolCall['status'], string> = {
  pending: 'text-muted',
  running: 'text-muted',
  done: 'text-green-500',
  error: 'text-red-500',
  denied: 'text-muted'
}

function CopyButton({
  getText,
  className,
  label
}: {
  getText: () => string
  className?: string
  label?: string
}): JSX.Element {
  const [copied, setCopied] = useState(false)
  const t = useT()
  return (
    <button
      onClick={async () => {
        const text = getText()
        try {
          // 优先用 Electron 原生剪贴板（沙箱下最可靠），失败再退回浏览器 API
          await window.api.copyText(text)
        } catch {
          try {
            await navigator.clipboard.writeText(text)
          } catch {
            /* 两者都不可用时静默 */
          }
        }
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
      className={className}
    >
      {copied ? t('copied') : (label ?? t('copy'))}
    </button>
  )
}

// 代码块：悬停显示「复制」按钮
function Pre({ node: _node, children, ...props }: any): JSX.Element {
  const ref = useRef<HTMLPreElement>(null)
  // 从子 code 元素的 className（language-xxx）提取语言名，显示在头部栏
  const child = Array.isArray(children) ? children[0] : children
  const lang = /language-([\w-]+)/.exec(child?.props?.className ?? '')?.[1] ?? ''
  return (
    <div className="code-block">
      <div className="code-head">
        <span>{lang || 'code'}</span>
        <CopyButton
          getText={() => ref.current?.innerText ?? ''}
          className="rounded px-1.5 py-0.5 transition hover:bg-black/10 hover:text-black"
        />
      </div>
      <pre ref={ref} {...props}>
        {children}
      </pre>
    </div>
  )
}

export function Markdown({ text }: { text: string }): JSX.Element {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeHighlight, rehypeKatex]}
        components={{ pre: Pre }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

function ToolCallCard({ tc }: { tc: ToolCall }): JSX.Element | null {
  const mode = useStore((s) => s.toolView)
  const t = useT()
  if (mode === 'summary') return null // 精简模式只看结论

  return (
    <details
      open={mode === 'verbose'}
      className="my-2 rounded-lg border border-line bg-surface-2 text-sm"
    >
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2">
        <span className="font-mono text-xs text-accent">🛠 {tc.name}</span>
        <span className={`text-xs ${STATUS_COLOR[tc.status]}`}>{t(STATUS_KEY[tc.status])}</span>
      </summary>
      <div className="space-y-2 px-3 pb-3">
        <pre className="overflow-x-auto rounded bg-paper p-2 text-xs">
          {JSON.stringify(tc.args, null, 2)}
        </pre>
        {tc.result && (
          <pre className="max-h-64 overflow-auto rounded bg-paper p-2 text-xs">{tc.result}</pre>
        )}
        {tc.error && <p className="text-xs text-red-500">{tc.error}</p>}
      </div>
    </details>
  )
}

export function MessageView({
  message,
  isLast,
  onRegenerate
}: {
  message: Msg
  isLast?: boolean
  onRegenerate?: () => void
}): JSX.Element | null {
  const setPendingEdit = useStore((s) => s.setPendingEdit)
  const toolView = useStore((s) => s.toolView)
  const t = useT()
  if (message.role === 'tool') return null // 工具结果显示在 assistant 的工具卡片里

  // 过程步骤（带工具调用的 assistant 消息）：仿 Claude 收纳成弱化的可折叠块，
  // 不以正式回复形态平铺；只有最终回答（无工具调用）保持正常回复样式。
  if (message.role === 'assistant' && message.toolCalls?.length) {
    const firstLine = (message.content || '').split('\n')[0].slice(0, 80)
    const running = message.toolCalls.some(
      (tc) => tc.status === 'running' || tc.status === 'pending'
    )
    return (
      <details open={toolView === 'verbose'} className="pl-10">
        <summary className="flex cursor-pointer list-none items-center gap-2 py-0.5 text-xs text-muted transition hover:text-fg [&::-webkit-details-marker]:hidden">
          <span className={running ? 'animate-pulse' : ''}>⚙️</span>
          <span className="truncate">
            {firstLine || t('runningTools')} ·{' '}
            {t('toolCallsCount').replace('{n}', String(message.toolCalls.length))}
          </span>
          <span className="shrink-0 opacity-60">▸</span>
        </summary>
        <div className="my-1 ml-1 border-l-2 border-line pl-3">
          {message.content && (
            <div className="text-sm text-muted">
              <Markdown text={message.content} />
            </div>
          )}
          {message.toolCalls.map((tc) => (
            <ToolCallCard key={tc.id} tc={tc} />
          ))}
        </div>
      </details>
    )
  }

  // 用户消息：右对齐气泡（品牌珊瑚色）
  if (message.role === 'user') {
    return (
      <div className="group flex flex-col items-end">
        {message.images?.length ? (
          <div className="mb-2 flex flex-wrap justify-end gap-2">
            {message.images.map((src, i) => (
              <MessageImage key={i} source={src} />
            ))}
          </div>
        ) : null}
        {message.content && (
          // Claude 式用户气泡：浅暖灰底 + 正文色文字（低调），而非重色块
          <div className="max-w-[85%] rounded-2xl border border-line bg-surface-2 px-4 py-2.5 text-fg">
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>
        )}
        <div className="mt-1 flex gap-3 px-1 opacity-0 transition group-hover:opacity-100">
          <button
            onClick={() => setPendingEdit({ id: message.id, content: message.content })}
            className="text-xs text-muted transition hover:text-fg"
          >
            {t('edit')}
          </button>
          <CopyButton
            getText={() => message.content}
            className="text-xs text-muted transition hover:text-fg"
          />
        </div>
      </div>
    )
  }

  // 助手消息：无气泡、全宽排版（像文章），左侧头像 + 名称
  return (
    <div className="group flex gap-3">
      <AssistantAvatar />
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-xs font-semibold text-muted">hemilier</div>
        {message.content && <Markdown text={message.content} />}
        {message.toolCalls?.map((tc) => (
          <ToolCallCard key={tc.id} tc={tc} />
        ))}
        {message.content && (
          <div className="mt-1.5 flex gap-3 opacity-0 transition group-hover:opacity-100">
            <CopyButton
              getText={() => message.content}
              className="text-xs text-muted transition hover:text-fg"
            />
            {isLast && onRegenerate && (
              <button
                onClick={onRegenerate}
                className="text-xs text-muted transition hover:text-fg"
              >
                {t('regenerate')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function AssistantAvatar({ active = false }: { active?: boolean }): JSX.Element {
  // 与 APP 图标同一份绘制（同比例、同色值），保证品牌一致；active 时圆环做「呼吸」缩放
  return (
    <svg viewBox="0 0 100 100" className="mt-0.5 h-7 w-7 shrink-0" aria-hidden="true">
      <rect x="6" y="6" width="88" height="88" rx="22" fill="#d2552c" />
      <circle
        className={active ? 'ring-pulse' : undefined}
        cx="50"
        cy="50"
        r="29"
        fill="none"
        stroke="#fbf3ea"
        strokeWidth="12"
      />
    </svg>
  )
}

export function StreamingBubble({ text }: { text: string }): JSX.Element {
  const t = useT()
  return (
    <div className="flex gap-3">
      <AssistantAvatar active />
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-xs font-semibold text-muted">hemilier</div>
        {text ? (
          <div className="relative">
            <Markdown text={text} />
            <span className="cursor-blink text-accent" />
          </div>
        ) : (
          <span className="text-sm text-muted">{t('thinking')}</span>
        )}
      </div>
    </div>
  )
}
