import { useMemo, useState } from 'react'
import type { Conversation } from '@shared/types'
import { useStore, type View } from '../store'
import { useT } from '../i18n'

const NAV: { key: View; label: string; icon: string }[] = [
  { key: 'chat', label: 'Chats', icon: '💬' },
  { key: 'cowork', label: 'Cowork', icon: '🤝' },
  { key: 'code', label: 'Code', icon: '💻' }
]

type TimeKey = 'today' | 'yesterday' | 'last7' | 'older'

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function groupByTime(convs: Conversation[]): { key: TimeKey; items: Conversation[] }[] {
  const today = startOfDay(new Date())
  const yesterday = today - 86_400_000
  const week = today - 7 * 86_400_000
  const buckets: Record<TimeKey, Conversation[]> = {
    today: [],
    yesterday: [],
    last7: [],
    older: []
  }
  for (const c of convs) {
    const t = c.updatedAt || c.createdAt
    if (t >= today) buckets.today.push(c)
    else if (t >= yesterday) buckets.yesterday.push(c)
    else if (t >= week) buckets.last7.push(c)
    else buckets.older.push(c)
  }
  return (['today', 'yesterday', 'last7', 'older'] as TimeKey[])
    .filter((k) => buckets[k].length > 0)
    .map((key) => ({ key, items: buckets[key] }))
}

function ConvRow({ c }: { c: Conversation }): JSX.Element {
  const active = useStore((s) => s.active)
  const running = useStore((s) => s.runningIds.includes(c.id))
  const activeProjectId = useStore((s) => s.activeProjectId)
  const selectConversation = useStore((s) => s.selectConversation)
  const deleteConversation = useStore((s) => s.deleteConversation)
  const renameConversation = useStore((s) => s.renameConversation)
  const assignConversation = useStore((s) => s.assignConversation)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(c.title)

  const inActiveProject = activeProjectId != null && c.projectId === activeProjectId

  const startEdit = (): void => {
    setName(c.title)
    setEditing(true)
  }
  const commit = (): void => {
    setEditing(false)
    if (name.trim() && name.trim() !== c.title) void renameConversation(c.id, name.trim())
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
        className="mb-0.5 w-full rounded-lg border border-accent bg-surface px-2 py-1.5 text-sm outline-none"
      />
    )
  }

  return (
    <div
      onClick={() => void selectConversation(c.id)}
      onDoubleClick={startEdit}
      className={`group flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-sm transition ${
        active?.id === c.id ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-surface-2'
      }`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {running && (
          <span
            title="正在生成"
            className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent"
          />
        )}
        <span className="truncate">{c.title}</span>
      </span>
      <span className="ml-2 hidden shrink-0 items-center gap-1 group-hover:flex">
        <button
          onClick={(e) => {
            e.stopPropagation()
            startEdit()
          }}
          className="text-muted hover:text-accent"
          title="重命名"
        >
          ✎
        </button>
        {activeProjectId != null && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              void assignConversation(c.id, inActiveProject ? null : activeProjectId)
            }}
            className="text-muted hover:text-accent"
            title={inActiveProject ? '移出当前项目' : '移入当前项目'}
          >
            {inActiveProject ? '📤' : '📁'}
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            void window.api.setConversationPinned(c.id, !c.pinned).then(() => {
              useStore.setState((s) => ({
                conversations: s.conversations.map((x) =>
                  x.id === c.id ? { ...x, pinned: !c.pinned } : x
                )
              }))
            })
          }}
          className={c.pinned ? 'text-accent' : 'text-muted hover:text-accent'}
          title={c.pinned ? '取消置顶' : '置顶'}
        >
          📌
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (window.confirm(`删除对话「${c.title}」？此操作不可撤销。`))
              void deleteConversation(c.id)
          }}
          className="text-muted hover:text-red-500"
          title="删除"
        >
          ✕
        </button>
      </span>
    </div>
  )
}

function Projects(): JSX.Element {
  const t = useT()
  const view = useStore((s) => s.view)
  const projects = useStore((s) => s.projects)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const setActiveProject = useStore((s) => s.setActiveProject)
  const createProject = useStore((s) => s.createProject)
  const deleteProject = useStore((s) => s.deleteProject)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  const list = projects.filter((p) => p.kind === view)

  const submit = (): void => {
    if (name.trim()) void createProject(name.trim())
    setName('')
    setCreating(false)
  }

  return (
    <div className="px-2">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Projects</span>
        <button
          onClick={() => setCreating((v) => !v)}
          className="text-muted hover:text-accent"
          title={t('newProject')}
        >
          +
        </button>
      </div>

      {creating && (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') setCreating(false)
          }}
          onBlur={submit}
          placeholder={t('projectNamePh')}
          className="mb-1 w-full rounded-md border border-line bg-surface px-2 py-1 text-sm outline-none focus:border-accent"
        />
      )}

      {list.map((p) => (
        <div
          key={p.id}
          onClick={() => setActiveProject(activeProjectId === p.id ? null : p.id)}
          className={`group flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-sm transition ${
            activeProjectId === p.id ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-surface-2'
          }`}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span>📁</span>
            <span className="truncate">{p.name}</span>
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (confirm(`删除项目「${p.name}」？其对话会变为未分组。`)) void deleteProject(p.id)
            }}
            className="ml-2 hidden shrink-0 text-muted hover:text-red-500 group-hover:block"
            title="删除项目"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}

export function Sidebar(): JSX.Element {
  const t = useT()
  const conversations = useStore((s) => s.conversations)
  const view = useStore((s) => s.view)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const projects = useStore((s) => s.projects)
  const setView = useStore((s) => s.setView)
  const newConversation = useStore((s) => s.newConversation)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const setCustomizeOpen = useStore((s) => s.setCustomizeOpen)
  const setRoutinesOpen = useStore((s) => s.setRoutinesOpen)
  const setTasksOpen = useStore((s) => s.setTasksOpen)
  const tasks = useStore((s) => s.tasks)
  const settings = useStore((s) => s.settings)
  const active = useStore((s) => s.active)
  const collapsed = useStore((s) => s.sidebarCollapsed)
  const setCollapsed = useStore((s) => s.setSidebarCollapsed)
  const [query, setQuery] = useState('')
  const runningIds = useStore((s) => s.runningIds)

  const sorted = useMemo(
    () =>
      [...conversations]
        .filter((c) => (c.kind ?? 'chat') === view)
        .filter((c) => (activeProjectId ? c.projectId === activeProjectId : true))
        .sort(
          (a, b) =>
            // 运行中的会话置顶（并行任务一眼可见），其次置顶标记，再按最近更新
            Number(runningIds.includes(b.id)) - Number(runningIds.includes(a.id)) ||
            Number(!!b.pinned) - Number(!!a.pinned) ||
            (b.updatedAt || 0) - (a.updatedAt || 0)
        ),
    [conversations, view, activeProjectId, runningIds]
  )
  const filtered = useMemo(
    () =>
      query.trim()
        ? sorted.filter((c) => c.title.toLowerCase().includes(query.trim().toLowerCase()))
        : sorted,
    [sorted, query]
  )
  const groups = useMemo(() => groupByTime(filtered), [filtered])
  const activeProjectName = projects.find((p) => p.id === activeProjectId)?.name
  const runningTasks = tasks.filter((t) => t.status === 'running').length

  if (collapsed) {
    return (
      <aside className="region-drag flex w-14 flex-col items-center gap-1 border-r border-line bg-paper pb-2 pt-10">
        <button
          onClick={() => setCollapsed(false)}
          title="展开侧栏"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg"
        >
          ☰
        </button>
        <button
          onClick={() => void newConversation()}
          title={t('newChat')}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg"
        >
          ✎
        </button>
        {NAV.map((n) => (
          <button
            key={n.key}
            onClick={() => setView(n.key)}
            title={n.label}
            className={`flex h-10 w-10 items-center justify-center rounded-lg transition ${
              view === n.key
                ? 'bg-accent-soft text-accent'
                : 'text-muted hover:bg-surface-2 hover:text-fg'
            }`}
          >
            {n.icon}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => setSettingsOpen(true)}
          title={t('settings')}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg"
        >
          ⚙
        </button>
      </aside>
    )
  }

  return (
    <aside className="flex w-64 flex-col border-r border-line bg-paper">
      <div className="region-drag flex items-center justify-between px-3 pb-1 pt-10">
        <span className="px-1 text-sm font-semibold text-fg">hemilier 智能体</span>
        <button
          onClick={() => setCollapsed(true)}
          title="折叠侧栏"
          className="rounded-md p-1 text-muted transition hover:bg-surface-2 hover:text-fg"
        >
          ☰
        </button>
      </div>

      <div className="px-3 pt-1">
        <button
          onClick={() => void newConversation()}
          className="flex w-full items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition hover:bg-accent-hover"
        >
          <span className="text-base leading-none">✎</span> {t('newChat')}
        </button>
      </div>

      <div className="px-3 pt-2">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1.5">
          <span className="text-sm text-muted">🔍</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchChats')}
            className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-muted"
          />
        </div>
      </div>

      <nav className="mt-3 px-2">
        {NAV.map((n) => (
          <button
            key={n.key}
            onClick={() => setView(n.key)}
            className={`mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition ${
              view === n.key ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-surface-2'
            }`}
          >
            <span>{n.icon}</span>
            {n.label}
          </button>
        ))}
        <button
          onClick={() => setCustomizeOpen(true)}
          className="mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-fg transition hover:bg-surface-2"
        >
          <span>✨</span> Customize
        </button>
        <button
          onClick={() => setRoutinesOpen(true)}
          className="mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-fg transition hover:bg-surface-2"
        >
          <span>⏰</span> Routines
        </button>
        <button
          onClick={() => setTasksOpen(true)}
          className="mb-0.5 flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-sm text-fg transition hover:bg-surface-2"
        >
          <span className="flex items-center gap-2.5">
            <span>🔄</span> Tasks
          </span>
          {runningTasks > 0 && (
            <span className="rounded-full bg-accent px-1.5 text-xs text-white">{runningTasks}</span>
          )}
        </button>
      </nav>

      <div className="mt-2 flex-1 overflow-y-auto pb-2">
        <Projects />

        <div className="mt-2 px-2">
          <div className="flex items-center justify-between px-2 pb-1 pt-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
              {query.trim()
                ? t('searchResults')
                : activeProjectName
                  ? activeProjectName
                  : t('recents')}
            </span>
            {activeProjectId && (
              <button
                onClick={() => useStore.getState().setActiveProject(null)}
                className="text-[11px] text-muted hover:text-accent"
              >
                {t('all')}
              </button>
            )}
          </div>
          {filtered.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-muted">
              {query.trim() ? t('noMatches') : t('noConversations')}
            </p>
          )}
          {groups.map((g) => (
            <div key={g.key} className="mb-2">
              {!query.trim() && <div className="px-2 py-1 text-[11px] text-muted">{t(g.key)}</div>}
              {g.items.map((c) => (
                <ConvRow key={c.id} c={c} />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-line p-2">
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm text-fg transition hover:bg-surface-2"
        >
          <span className="flex items-center gap-2">
            <span>⚙</span> {t('settings')}
          </span>
          {(active?.model || settings?.defaultModel) && (
            <span className="max-w-[110px] truncate text-xs text-muted">
              {(active?.model || settings?.defaultModel || '').split('::').pop()}
            </span>
          )}
        </button>
      </div>
    </aside>
  )
}
