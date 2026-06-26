import React from 'react'
import ReactDOM from 'react-dom/client'
import 'highlight.js/styles/github-dark.css'
import 'katex/dist/katex.min.css'
import './index.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'

// 标记运行平台，供 CSS 做平台相关微调（如 macOS 红绿灯预留位）
document.documentElement.dataset.platform = window.api.platform

// 全局兜底：未处理的 Promise 拒绝 / 运行时错误不再静默
window.addEventListener('unhandledrejection', (e) => {
  console.error('[renderer] 未处理的 Promise 拒绝：', e.reason)
})
window.addEventListener('error', (e) => {
  console.error('[renderer] 运行时错误：', e.error ?? e.message)
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
