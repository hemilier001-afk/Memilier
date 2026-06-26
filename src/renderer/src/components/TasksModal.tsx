import { useStore } from '../store'

const STATUS: Record<string, { label: string; cls: string }> = {
  running: { label: '运行中', cls: 'text-amber-500' },
  done: { label: '已完成', cls: 'text-green-500' },
  error: { label: '失败', cls: 'text-red-500' }
}

function when(ts: number): string {
  return new Date(ts).toLocaleString()
}

export function TasksModal(): JSX.Element | null {
  const open = useStore((s) => s.tasksOpen)
  const setOpen = useStore((s) => s.setTasksOpen)
  const tasks = useStore((s) => s.tasks)
  const openConv = useStore((s) => s.openTaskConversation)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="max-h-[85vh] w-[560px] overflow-y-auto rounded-xl border border-line bg-surface p-6 text-fg shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">后台任务</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-fg">
            ✕
          </button>
        </div>

        {tasks.length === 0 ? (
          <p className="text-sm text-muted">还没有后台任务。例程触发或手动运行后会出现在这里。</p>
        ) : (
          <ul className="space-y-2">
            {tasks.map((t) => {
              const s = STATUS[t.status]
              return (
                <li
                  key={t.id}
                  onClick={() => void openConv(t.conversationId)}
                  className="flex cursor-pointer items-center justify-between rounded-lg border border-line px-3 py-2 text-sm transition hover:bg-surface-2"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{t.title}</div>
                    <div className="text-xs text-muted">
                      {when(t.startedAt)}
                      {t.error ? ` · ${t.error}` : ''}
                    </div>
                  </div>
                  <span className={`ml-2 shrink-0 text-xs ${s.cls}`}>{s.label}</span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
