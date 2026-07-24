import type { ReactNode } from 'react'

// 设置/扩展页共用的一套视觉基元（对齐 Codex 的干净风格），确保各页风格一致。

// iOS 风格胶囊开关：开=蓝，关=分隔线色，白色滑块。
export function Toggle({
  on,
  onChange,
  title
}: {
  on: boolean
  onChange: () => void
  title?: string
}): JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={on}
      title={title}
      onClick={onChange}
      className={`relative inline-flex h-[26px] w-[44px] shrink-0 items-center rounded-full transition-colors ${
        on ? 'bg-[#3b82f6]' : 'bg-line'
      }`}
    >
      <span
        className={`inline-block h-[22px] w-[22px] transform rounded-full bg-white shadow-sm transition-transform ${
          on ? 'translate-x-[20px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  )
}

// 圆角方形图标容器：品牌图标(emoji)放白底；通用/系统项放浅灰底 + 线性图标。
export function AppIcon({
  children,
  muted
}: {
  children: ReactNode
  muted?: boolean
}): JSX.Element {
  return (
    <div
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] border border-line text-[22px] shadow-sm ${
        muted ? 'bg-surface-2 text-muted' : 'bg-surface'
      }`}
    >
      {children}
    </div>
  )
}

// 状态小圆点：统一 6px 圆点 + 克制色。
export function StatusDot({ tone }: { tone: 'ok' | 'warn' | 'off' }): JSX.Element {
  const c = tone === 'ok' ? 'bg-emerald-500' : tone === 'warn' ? 'bg-amber-500' : 'bg-rose-400'
  return <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${c}`} />
}
