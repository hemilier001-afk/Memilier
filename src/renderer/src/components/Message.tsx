import { memo, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import type { Message as Msg, ToolCall } from '@shared/types'
import { useStore } from '../store'
import { StatusDot } from './ui'
import { useT } from '../i18n'
import { GearIcon } from './icons'

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

// memo：仅当 text 变化才重解析。历史消息 text 稳定→零重解析；
// 流式期间配合 StreamingBubble 的节流，把「每 token 全量重解析」降到 ~8 次/秒。
export const Markdown = memo(function Markdown({ text }: { text: string }): JSX.Element {
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
})

// 节流：流式高频更新（可达 50~100 token/秒）时，把送进 Markdown 的文本合并到 ~8 次/秒，
// 避免 ReactMarkdown 对累积全文的 O(n²) 重复解析导致长回复末段卡顿。尾随更新保证最终文本不丢。
function useThrottledValue<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value)
  const lastAt = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const now = Date.now()
    const elapsed = now - lastAt.current
    if (elapsed >= ms) {
      lastAt.current = now
      setShown(value)
    } else {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        lastAt.current = Date.now()
        setShown(value)
      }, ms - elapsed)
    }
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [value, ms])
  return shown
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
        <StatusDot
          tone={
            tc.status === 'error' || tc.status === 'denied'
              ? 'off'
              : tc.status === 'done'
                ? 'ok'
                : 'warn'
          }
        />
        <span className="font-mono text-xs text-muted">{tc.name}</span>
        <span className="text-xs text-muted">{t(STATUS_KEY[tc.status])}</span>
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

function MessageViewImpl({
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
          <span className={running ? 'animate-pulse' : ''}>
            <GearIcon className="h-3.5 w-3.5" />
          </span>
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
        <div className="mt-1 flex gap-3 px-1 opacity-40 transition group-hover:opacity-100">
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
        {message.reasoning ? <ReasoningBlock text={message.reasoning} /> : null}
        {message.content && <Markdown text={message.content} />}
        {message.toolCalls?.map((tc) => (
          <ToolCallCard key={tc.id} tc={tc} />
        ))}
        {message.content && (
          <div className="mt-1.5 flex gap-3 opacity-40 transition group-hover:opacity-100">
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

// memo：历史消息 props（message 引用 / isLast / onRegenerate 均稳定）不变时不重渲染，
// 流式每 token 只更新流式气泡，不再把已有消息的 Markdown 全部重新解析（长对话性能关键）
export const MessageView = memo(MessageViewImpl)

function AssistantAvatar({ active = false }: { active?: boolean }): JSX.Element {
  // 配色反转（参照 Claude）：方块底透明融入 app 背景，只留珊瑚色圆环——
  // 界面里只看见圆环本身，active 时它「呼吸」缩放，动态更纯粹、更突出。
  return (
    <svg viewBox="0 0 100 100" className="mt-0.5 h-7 w-7 shrink-0" aria-hidden="true">
      <circle
        className={active ? 'ring-pulse' : undefined}
        cx="50"
        cy="50"
        r="29"
        fill="none"
        stroke="#d2552c"
        strokeWidth="12"
      />
    </svg>
  )
}

// 推理链（思考过程）可折叠块：Claude 式，默认折叠，弱化展示
function ReasoningBlock({ text, open = false }: { text: string; open?: boolean }): JSX.Element {
  const t = useT()
  return (
    <details open={open} className="mb-1.5">
      <summary className="cursor-pointer list-none text-xs text-muted transition hover:text-fg [&::-webkit-details-marker]:hidden">
        {t('reasoningLabel')} ▸
      </summary>
      <div className="my-1 whitespace-pre-wrap border-l-2 border-line pl-3 text-xs leading-relaxed text-muted">
        {text}
      </div>
    </details>
  )
}

export function StreamingBubble({
  text,
  reasoning
}: {
  text: string
  reasoning?: string
}): JSX.Element {
  const t = useT()
  // 流式文本节流后再解析 Markdown（视觉上 8 次/秒足够顺滑，光标闪烁提供实时感）
  const shownText = useThrottledValue(text, 120)
  return (
    <div className="flex gap-3">
      <AssistantAvatar active />
      <div className="min-w-0 flex-1">
        {reasoning ? <ReasoningBlock text={reasoning} open={!text} /> : null}
        {shownText ? (
          <Markdown text={shownText} />
        ) : reasoning ? null : (
          <span className="text-sm text-muted">{t('thinking')}</span>
        )}
      </div>
    </div>
  )
}
