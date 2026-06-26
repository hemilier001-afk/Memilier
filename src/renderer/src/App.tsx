import { useEffect } from 'react'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { RightPanel } from './components/RightPanel'
import { PermissionDialog } from './components/PermissionDialog'
import { SettingsModal } from './components/SettingsModal'
import { CustomizeModal } from './components/CustomizeModal'
import { RoutinesModal } from './components/RoutinesModal'
import { TasksModal } from './components/TasksModal'

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
    </div>
  )
}
