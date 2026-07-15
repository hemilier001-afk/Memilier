import { useEffect, useState } from 'react'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { RightPanel } from './components/RightPanel'
import { PermissionDialog } from './components/PermissionDialog'
import { SettingsModal } from './components/SettingsModal'
import { CustomizeModal } from './components/CustomizeModal'
import { RoutinesModal } from './components/RoutinesModal'
import { TasksModal } from './components/TasksModal'

// 新版本提示：打包环境启动时主进程检查 GitHub Release，有新版弹出角标横幅
function UpdateBanner(): JSX.Element | null {
  const [info, setInfo] = useState<{ version: string; url: string } | null>(null)
  useEffect(() => window.api.onUpdateAvailable(setInfo), [])
  if (!info) return null
  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm shadow-lg">
      <span>
        🎉 新版本 <span className="font-semibold text-accent">v{info.version}</span> 可用
      </span>
      <button
        onClick={() => void window.api.openUrl(info.url)}
        className="rounded-lg bg-accent px-3 py-1 text-xs text-white transition hover:bg-accent-hover"
      >
        去下载
      </button>
      <button onClick={() => setInfo(null)} className="text-muted hover:text-fg" title="忽略">
        ✕
      </button>
    </div>
  )
}

export default function App(): JSX.Element {
  const init = useStore((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  // Esc 停止生成（⌘/Ctrl+N 等由原生菜单的加速键负责，避免重复触发）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && useStore.getState().streaming) {
        useStore.getState().abort()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 原生菜单动作 → 分发到 store
  useEffect(() => {
    return window.api.onMenuAction((action) => {
      const s = useStore.getState()
      switch (action) {
        case 'new-chat':
          void s.newConversation()
          break
        case 'export':
          s.exportActive()
          break
        case 'settings':
          s.setSettingsOpen(true)
          break
        case 'toggle-sidebar':
          s.toggleSidebar()
          break
        case 'reflect':
          s.reflect()
          break
        case 'space:chat':
          s.setView('chat')
          break
        case 'space:cowork':
          s.setView('cowork')
          break
        case 'space:code':
          s.setView('code')
          break
      }
    })
  }, [])

  return (
    <div className="flex h-full bg-paper text-fg">
      <Sidebar />
      <ChatView />
      <RightPanel />
      <PermissionDialog />
      <SettingsModal />
      <CustomizeModal />
      <RoutinesModal />
      <TasksModal />
      <UpdateBanner />
    </div>
  )
}
