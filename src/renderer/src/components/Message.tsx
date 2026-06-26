import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import type { Message as Msg, ToolCall } from '@shared/types'
import { useStore } from '../store'

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

const STATUS_LABEL: Record<ToolCall['status'], string> = {
  pending: '待执行',
  running: '执行中…',
  done: '完成',
  error: '失败',
  denied: '已拒绝'
}

const STATUS_COLOR: Record<ToolCall['status'], string> = {
  pending: 'text-muted',
  running: 'text-amber-500',
  done: 'text-green-500',
  error: 'text-red-500',
  denied: 'text-muted'
}

function CopyButton({
  getText,
  className,
  label = '复制'
}: {
  getText: () => string
  className?: string
  label?: string
}): JSX.Element {
  const [copied, setCopied] = useState(false)
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
      {copied ? '已复制' : label}
    </button>
  )
}

// 代码块：悬停显示「复制」按钮
function Pre({ node: _node, ...props }: any): JSX.Element {
  const ref = useRef<HTMLPreElement>(null)
  return (
    <div className="group/code relative">
      <CopyButton
        getText={() => ref.current?.innerText ?? ''}
        className="absolute right-2 top-2 rounded bg-black/50 px-2 py-0.5 text-xs text-white opacity-0 transition group-hover/code:opacity-100"
      />
      <pre ref={ref} {...props} />
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
  if (mode === 'summary') return null // 精简模式只看结论

  return (
    <details
      open={mode === 'verbose'}
      className="my-2 rounded-lg border border-line bg-surface-2 text-sm"
    >
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2">
        <span className="font-mono text-xs text-accent">🛠 {tc.name}</span>
        <span className={`text-xs ${STATUS_COLOR[tc.status]}`}>{STATUS_LABEL[tc.status]}</span>
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
  if (message.role === 'tool') return null // 工具结果显示在 assistant 的工具卡片里

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
          <div className="max-w-[85%] rounded-2xl bg-accent px-4 py-2.5 text-white">
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>
        )}
        <div className="mt-1 flex gap-3 px-1 opacity-0 transition group-hover:opacity-100">
          <button
            onClick={() => setPendingEdit({ id: message.id, content: message.content })}
            className="text-xs text-muted transition hover:text-fg"
          >
            编辑
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
                重新生成
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function AssistantAvatar(): JSX.Element {
  return (
    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-accent">
      {/* 与 APP 图标一致的奶白圆环 */}
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
        <circle cx="12" cy="12" r="7" fill="none" stroke="#FBF3EA" strokeWidth="3.6" />
      </svg>
    </div>
  )
}

export function StreamingBubble({ text }: { text: string }): JSX.Element {
  return (
    <div className="flex gap-3">
      <AssistantAvatar />
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-xs font-semibold text-muted">hemilier</div>
        {text ? (
          <div className="relative">
            <Markdown text={text} />
            <span className="cursor-blink text-accent" />
          </div>
        ) : (
          <span className="text-sm text-muted">思考中…</span>
        )}
      </div>
    </div>
  )
}
