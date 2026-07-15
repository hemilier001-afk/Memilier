import React from 'react'
import ReactDOM from 'react-dom/client'
import 'highlight.js/styles/github.css'
import 'katex/dist/katex.min.css'
import './index.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

// 标记运行平台，供 CSS 做平台相关微调（如 macOS 红绿灯预留位）
document.documentElement.dataset.platform = window.api.platform

// 全局兜底：未处理的 Promise 拒绝 / 运行时错误不再静默，并同步写入主进程日志
// （userData/main.log）——用户报告"白屏/异常"时有据可查
window.addEventListener('unhandledrejection', (e) => {
  console.error('[renderer] 未处理的 Promise 拒绝：', e.reason)
  window.api.logError(`未处理的 Promise 拒绝：${String(e.reason?.stack ?? e.reason)}`)
})
window.addEventListener('error', (e) => {
  console.error('[renderer] 运行时错误：', e.error ?? e.message)
  window.api.logError(`运行时错误：${String(e.error?.stack ?? e.message)}`)
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
