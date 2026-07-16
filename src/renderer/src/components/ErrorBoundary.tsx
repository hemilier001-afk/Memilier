import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

// 顶层错误边界：渲染层抛错时给出可恢复的提示，而不是整页白屏
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[renderer] 未捕获的渲染错误：', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-paper p-6 text-center text-fg">
        <div className="text-lg font-semibold">界面出现错误</div>
        <p className="max-w-md break-words text-sm text-muted">{error.message}</p>
        <div className="flex gap-2">
          <button
            onClick={() => location.reload()}
            className="rounded-md border border-line bg-surface-2 text-fg hover:bg-accent-soft px-3 py-1.5 text-sm"
          >
            重新加载
          </button>
          <button
            onClick={() => this.setState({ error: null })}
            className="rounded-md bg-surface-2 px-3 py-1.5 text-sm"
          >
            忽略并继续
          </button>
        </div>
      </div>
    )
  }
}
