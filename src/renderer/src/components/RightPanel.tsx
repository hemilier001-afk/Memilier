import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { FsEntry, GitStatus, MemoryEntry, MemoryType } from '@shared/types'
import { diffStat, lineDiff } from '@shared/diff'
import { useStore } from '../store'
import { Markdown } from './Message'
import { FolderIcon, FolderOpenIcon, FileIcon } from './icons'
import { useT } from '../i18n'

type RightTab = 'files' | 'preview' | 'diff' | 'plan' | 'terminal' | 'git' | 'memory'

const MEM_TYPES: { key: MemoryType; label: string }[] = [
  { key: 'fact', label: 'memFact' },
  { key: 'preference', label: 'memPreference' },
  { key: 'decision', label: 'memDecision' },
  { key: 'pitfall', label: 'memPitfall' },
  { key: 'todo', label: 'memTodo' }
]
const MEM_LABEL: Record<string, string> = Object.fromEntries(MEM_TYPES.map((t) => [t.key, t.label]))
const STALE_MS = 30 * 86_400_000

function MemoryView(): JSX.Element {
  const t = useT() as unknown as (k: string) => string
  const active = useStore((s) => s.active)
  const ws = active?.workspaceDir
  const [data, setData] = useState<{
    global: MemoryEntry[]
    project: MemoryEntry[]
    pending: MemoryEntry[]
  }>({ global: [], project: [], pending: [] })
  const [scope, setScope] = useState<'project' | 'global'>('project')
  const [text, setText] = useState('')
  const [type, setType] = useState<MemoryType>('fact')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!ws) return
    setData(await window.api.listMemory(ws))
  }, [ws])

  useEffect(() => {
    void refresh()
  }, [refresh])
  // 自动沉淀/整理应用后实时刷新
  useEffect(() => window.api.onMemoryUpdated(() => void refresh()), [refresh])

  if (!active) return <div className="p-4 text-sm text-muted">{t('openConvFirst')}</div>

  const entries = scope === 'project' ? data.project : data.global

  const add = async (): Promise<void> => {
    if (!text.trim() || !ws) return
    await window.api.addMemory(ws, text.trim(), type, scope)
    setText('')
    await refresh()
  }
  const forget = async (id: string): Promise<void> => {
    if (!ws) return
    await window.api.forgetMemory(ws, id)
    await refresh()
  }
  const resolvePending = async (id: string, adopt: boolean): Promise<void> => {
    if (!ws) return
    await window.api.resolvePendingMemory(ws, id, adopt)
    await refresh()
  }
  const consolidate = async (): Promise<void> => {
    if (!ws || busy) return
    setBusy(true)
    try {
      const r = await window.api.consolidateMemory(ws, scope)
      if (r.ok && r.proposed) {
        const msg = t('memConsolidateConfirm')
          .replace('{a}', String(r.before ?? '?'))
          .replace('{b}', String(r.proposed.length))
        if (window.confirm(msg)) {
          await window.api.applyConsolidation(ws, scope, r.proposed)
          await refresh()
        }
      } else if (r.error) {
        window.alert(r.error)
      }
    } finally {
      setBusy(false)
    }
  }

  const now = Date.now()
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-3 py-1.5 text-[11px] text-muted">{t('memHint')}</div>

      {/* 待采纳区：自动沉淀的候选记忆，采纳后才进入正式记忆 */}
      {data.pending.length > 0 && (
        <div className="border-b border-line p-2">
          <p className="mb-1 px-1 text-[11px] font-medium text-muted">{t('memPending')}</p>
          {data.pending.map((e) => (
            <div key={e.id} className="mb-1 rounded-lg border border-accent/40 px-2 py-1.5 text-xs">
              <div className="whitespace-pre-wrap break-words text-fg">{e.text}</div>
              <div className="mt-1 flex items-center gap-2 text-[11px]">
                <span className="rounded bg-accent-soft px-1.5 text-accent">
                  {t(MEM_LABEL[e.type] ?? e.type)}
                </span>
                {e.source && <span className="truncate text-muted">{e.source}</span>}
                <button
                  onClick={() => void resolvePending(e.id, true)}
                  className="ml-auto rounded border border-line px-2 py-0.5 text-fg hover:bg-accent-soft"
                >
                  {t('memAdopt')}
                </button>
                <button
                  onClick={() => void resolvePending(e.id, false)}
                  className="rounded px-2 py-0.5 text-muted hover:text-fg"
                >
                  {t('memIgnore')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 层级切换 + 整理 */}
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        {(['project', 'global'] as const).map((sc) => (
          <button
            key={sc}
            onClick={() => setScope(sc)}
            className={`rounded-md px-2 py-0.5 text-xs transition ${
              scope === sc ? 'bg-accent-soft text-accent' : 'text-muted hover:text-fg'
            }`}
          >
            {t(sc === 'project' ? 'memScopeProject' : 'memScopeGlobal')} (
            {(sc === 'project' ? data.project : data.global).length})
          </button>
        ))}
        <button
          onClick={() => void consolidate()}
          disabled={busy || entries.length < 2}
          className="ml-auto rounded-md border border-line px-2 py-0.5 text-xs text-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40"
        >
          {busy ? t('memConsolidating') : t('memConsolidate')}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {entries.length === 0 && (
          <p className="p-3 text-center text-xs text-muted">{t('memEmpty')}</p>
        )}
        {entries.map((e) => {
          const stale = now - e.createdAt > STALE_MS
          return (
            <div
              key={e.id}
              className="group mb-1 rounded-lg border border-line px-2 py-1.5 text-xs"
            >
              <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                <span className="rounded bg-accent-soft px-1.5 text-accent">
                  {t(MEM_LABEL[e.type] ?? e.type)}
                </span>
                <span>{new Date(e.createdAt).toLocaleDateString()}</span>
                {stale && <span className="text-muted">{t('memStale')}</span>}
                {e.source && <span className="truncate">· {e.source}</span>}
                <button
                  onClick={() => void forget(e.id)}
                  className="ml-auto hidden text-muted hover:text-red-500 group-hover:inline"
                  title={t('deleteChat')}
                >
                  ✕
                </button>
              </div>
              <div className="whitespace-pre-wrap break-words text-fg">{e.text}</div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center gap-1 border-t border-line p-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as MemoryType)}
          className="shrink-0 rounded-md border border-line bg-transparent px-1 py-1 text-xs"
        >
          {MEM_TYPES.map((m) => (
            <option key={m.key} value={m.key}>
              {t(m.label)}
            </option>
          ))}
        </select>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add()
          }}
          placeholder={t('memAddPh')}
          className="flex-1 rounded-md border border-line bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
        />
        <button
          onClick={() => void add()}
          className="shrink-0 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-fg hover:bg-accent-soft"
        >
          {t('memAdd')}
        </button>
      </div>
    </div>
  )
}

function DirView({
  workspace,
  dir,
  depth
}: {
  workspace: string
  dir: string
  depth: number
}): JSX.Element {
  const t = useT()
  const [entries, setEntries] = useState<FsEntry[] | null>(null)

  useEffect(() => {
    let alive = true
    window.api
      .readDir(workspace, dir)
      .then((e) => alive && setEntries(e))
      .catch(() => alive && setEntries([]))
    return () => {
      alive = false
    }
  }, [workspace, dir])

  if (!entries)
    return (
      <div style={{ paddingLeft: 8 + depth * 12 }} className="py-1 text-xs text-muted">
        …
      </div>
    )
  if (entries.length === 0)
    return (
      <div style={{ paddingLeft: 8 + depth * 12 }} className="py-1 text-xs text-muted">
        {t('emptyDir')}
      </div>
    )

  return (
    <>
      {entries.map((e) => (
        <Entry key={e.name} workspace={workspace} parent={dir} entry={e} depth={depth} />
      ))}
    </>
  )
}

function Entry({
  workspace,
  parent,
  entry,
  depth
}: {
  workspace: string
  parent: string
  entry: FsEntry
  depth: number
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const openFile = useStore((s) => s.openFile)
  const preview = useStore((s) => s.preview)
  const rel = parent === '.' ? entry.name : `${parent}/${entry.name}`
  const pad = { paddingLeft: 8 + depth * 12 }
  const isSelected = !entry.isDir && preview?.path === rel

  if (entry.isDir) {
    return (
      <div>
        <button
          style={pad}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-1 py-1 text-left text-sm hover:bg-surface-2"
        >
          {open ? (
            <FolderOpenIcon className="h-3.5 w-3.5 text-muted" />
          ) : (
            <FolderIcon className="h-3.5 w-3.5 text-muted" />
          )}
          <span className="truncate">{entry.name}</span>
        </button>
        {open && <DirView workspace={workspace} dir={rel} depth={depth + 1} />}
      </div>
    )
  }

  return (
    <button
      style={pad}
      onClick={() => void openFile(rel)}
      className={`flex w-full items-center gap-1 py-1 text-left text-sm hover:bg-surface-2 ${
        isSelected ? 'bg-accent-soft text-accent' : ''
      }`}
    >
      <FileIcon className="h-3.5 w-3.5 text-muted" />
      <span className="truncate">{entry.name}</span>
    </button>
  )
}

function PreviewView(): JSX.Element {
  const t = useT()
  const preview = useStore((s) => s.preview)
  const active = useStore((s) => s.active)
  const setPreviewContent = useStore((s) => s.setPreviewContent)
  const [mode, setMode] = useState<'view' | 'edit' | 'render'>('view')
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraft(preview?.content ?? '')
    // HTML 文件默认渲染出来看效果（截断的大文件除外），其余文件默认源码视图
    const e = preview?.path.split('.').pop()?.toLowerCase() ?? ''
    const canRender =
      (e === 'html' || e === 'htm') && !(preview?.content.includes('…（已截断）') ?? false)
    setMode(canRender ? 'render' : 'view')
  }, [preview?.path, preview?.content])

  if (!preview) {
    return <div className="p-4 text-sm text-muted">{t('previewHint')}</div>
  }

  const ext = preview.path.split('.').pop()?.toLowerCase() ?? ''
  const isMd = ext === 'md' || ext === 'markdown'
  const isHtml = ext === 'html' || ext === 'htm'
  const truncated = preview.content.includes('…（已截断）')
  const dirty = draft !== preview.content
  const text = isMd ? preview.content : `\`\`\`${ext}\n${preview.content}\n\`\`\``

  const save = async (): Promise<void> => {
    if (!active) return
    setSaving(true)
    try {
      await window.api.writeWorkspaceFile(active.workspaceDir, preview.path, draft)
      setPreviewContent(draft)
    } catch {
      /* 写入失败静默，内容保留在编辑框 */
    }
    setSaving(false)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
        <span className="truncate font-mono text-xs text-muted">{preview.path}</span>
        <div className="flex shrink-0 items-center gap-1 text-xs">
          {mode === 'edit' && (
            <button
              onClick={() => void save()}
              disabled={!dirty || saving}
              className="rounded-md border border-line bg-surface-2 text-fg hover:bg-accent-soft px-2 py-0.5 transition disabled:opacity-40"
            >
              {saving ? t('saving') : dirty ? t('save') : t('saved')}
            </button>
          )}
          {isHtml && !truncated && mode !== 'edit' && (
            <button
              onClick={() => setMode(mode === 'render' ? 'view' : 'render')}
              className="rounded-md border border-line px-2 py-0.5 text-muted transition hover:text-fg"
            >
              {mode === 'render' ? t('sourceBtn') : t('renderBtn')}
            </button>
          )}
          <button
            onClick={() =>
              setMode(mode === 'edit' ? (isHtml && !truncated ? 'render' : 'view') : 'edit')
            }
            disabled={truncated}
            title={truncated ? t('tooLargeToEdit') : ''}
            className="rounded-md border border-line px-2 py-0.5 text-muted transition hover:text-fg disabled:opacity-40"
          >
            {mode === 'edit' ? t('previewBtn') : t('editBtn')}
          </button>
        </div>
      </div>

      {mode === 'edit' ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none bg-paper p-3 font-mono text-xs text-fg outline-none"
        />
      ) : mode === 'render' ? (
        // 沙箱 iframe 渲染（allow-scripts 但无 same-origin，页面拿不到应用上下文）。
        // 注意：打包版受应用 CSP（script-src 'self'）约束，srcDoc 继承之 → 内联脚本不执行，
        // 即静态渲染（样式正常）；开发模式无 CSP，脚本可运行。带 JS 的页面用 browser_open 看。
        <iframe
          title="html-preview"
          sandbox="allow-scripts"
          srcDoc={preview.content}
          className="min-h-0 flex-1 border-0 bg-white"
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="md text-sm">
            <Markdown text={text} />
          </div>
        </div>
      )}
    </div>
  )
}

function DiffView(): JSX.Element {
  const t = useT()
  const diffs = useStore((s) => s.diffs)
  if (!diffs.length) {
    return <div className="p-4 text-sm text-muted">{t('diffEmpty')}</div>
  }
  return (
    <div className="space-y-3 p-2">
      {diffs
        .slice()
        .reverse()
        .map((d) => {
          const lines = lineDiff(d.before, d.after)
          const { added, removed } = diffStat(lines)
          return (
            <div key={d.id} className="overflow-hidden rounded-lg border border-line">
              <div className="flex items-center justify-between bg-surface px-2 py-1 text-xs">
                <span className="truncate font-mono">{d.path}</span>
                <span className="shrink-0 font-mono">
                  <span className="text-green-500">+{added}</span>{' '}
                  <span className="text-red-500">-{removed}</span>
                </span>
              </div>
              <pre className="max-h-72 overflow-auto bg-paper text-xs leading-5">
                {lines.map((l, i) => (
                  <div
                    key={i}
                    className={
                      l.type === 'add'
                        ? 'bg-green-500/10 text-green-700 dark:text-green-300'
                        : l.type === 'del'
                          ? 'bg-red-500/10 text-red-700 dark:text-red-300'
                          : 'text-muted'
                    }
                  >
                    <span className="select-none px-2 opacity-60">
                      {l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}
                    </span>
                    {l.text || ' '}
                  </div>
                ))}
              </pre>
            </div>
          )
        })}
    </div>
  )
}

const PLAN_ICON: Record<string, string> = { pending: '○', in_progress: '◐', done: '●' }

function PlanView(): JSX.Element {
  const t = useT()
  const plan = useStore((s) => s.plan)
  if (!plan.length) {
    return <div className="p-4 text-sm text-muted">{t('planEmpty')}</div>
  }
  return (
    <ul className="space-y-2 p-3 text-sm">
      {plan.map((s, i) => (
        <li key={i} className="flex gap-2">
          <span
            className={
              s.status === 'done'
                ? 'text-green-500'
                : s.status === 'in_progress'
                  ? 'text-accent'
                  : 'text-muted'
            }
          >
            {PLAN_ICON[s.status]}
          </span>
          <span className={s.status === 'done' ? 'text-muted line-through' : 'text-fg'}>
            {s.title}
          </span>
        </li>
      ))}
    </ul>
  )
}

function TerminalView(): JSX.Element {
  const t = useT()
  const output = useStore((s) => s.terminalOutput)
  const running = useStore((s) => s.terminalRunning)
  const run = useStore((s) => s.runTerminal)
  const kill = useStore((s) => s.killTerminal)
  const clear = useStore((s) => s.clearTerminal)
  const [cmd, setCmd] = useState('')
  const ref = useRef<HTMLPreElement>(null)

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight })
  }, [output])

  const submit = (): void => {
    if (!cmd.trim()) return
    run(cmd)
    setCmd('')
  }

  return (
    <div className="flex h-full flex-col">
      <pre
        ref={ref}
        className="flex-1 overflow-auto whitespace-pre-wrap bg-paper p-2 font-mono text-xs text-fg"
      >
        {output || t('termHint')}
      </pre>
      <div className="flex items-center gap-1 border-t border-line p-2">
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={t('termPh')}
          className="flex-1 rounded-md border border-line bg-surface px-2 py-1 font-mono text-xs outline-none focus:border-accent"
        />
        {running ? (
          <button
            onClick={kill}
            className="rounded-md border border-line px-2 py-1 text-xs text-fg hover:bg-surface-2"
          >
            {t('termStop')}
          </button>
        ) : (
          <button
            onClick={submit}
            className="rounded-md border border-line bg-surface-2 text-fg hover:bg-accent-soft px-2 py-1 text-xs transition"
          >
            {t('termRun')}
          </button>
        )}
        <button
          onClick={clear}
          title={t('termClearTip')}
          className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-fg"
        >
          {t('termClear')}
        </button>
      </div>
    </div>
  )
}

function GitDiffText({ text }: { text: string }): JSX.Element {
  const t = useT()
  if (!text.trim()) {
    return <div className="p-3 text-xs text-muted">{t('diffBinary')}</div>
  }
  return (
    <pre className="overflow-auto bg-paper p-2 text-xs leading-5">
      {text.split('\n').map((l, i) => {
        const cls =
          l.startsWith('+') && !l.startsWith('+++')
            ? 'text-green-600 dark:text-green-400'
            : l.startsWith('-') && !l.startsWith('---')
              ? 'text-red-600 dark:text-red-400'
              : l.startsWith('@@')
                ? 'text-accent'
                : 'text-muted'
        return (
          <div key={i} className={cls}>
            {l || ' '}
          </div>
        )
      })}
    </pre>
  )
}

function GitView(): JSX.Element {
  const t = useT()
  const active = useStore((s) => s.active)
  const ws = active?.workspaceDir
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [sel, setSel] = useState<{ path: string; staged: boolean } | null>(null)
  const [diff, setDiff] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const refresh = useCallback(async () => {
    if (!ws) return
    setStatus(await window.api.gitStatus(ws))
  }, [ws])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!active) return <div className="p-4 text-sm text-muted">{t('openConvFirst')}</div>
  if (!status) return <div className="p-4 text-sm text-muted">{t('gitReading')}</div>
  if (!status.isRepo) {
    return (
      <div className="p-4 text-sm text-muted">
        {t('gitNotRepo')}
        <button
          onClick={async () => {
            await window.api.gitInit(ws as string)
            await refresh()
          }}
          className="mt-3 block rounded-lg border border-line bg-surface-2 text-fg hover:bg-accent-soft px-3 py-1.5 transition"
        >
          {t('gitInit')}
        </button>
      </div>
    )
  }

  const staged = status.files.filter((f) => f.staged)
  const changes = status.files.filter((f) => !f.staged)
  const badge = (f: { x: string; y: string; staged: boolean }): string => {
    const c = f.staged ? f.x : f.y !== ' ' ? f.y : f.x
    return c === '?' ? 'U' : c
  }

  const view = async (path: string, isStaged: boolean): Promise<void> => {
    setSel({ path, staged: isStaged })
    setDiff(await window.api.gitDiff(ws as string, path, isStaged))
  }
  const stage = async (p: string): Promise<void> => {
    await window.api.gitStage(ws as string, p)
    await refresh()
  }
  const unstage = async (p: string): Promise<void> => {
    await window.api.gitUnstage(ws as string, p)
    await refresh()
  }
  const commit = async (): Promise<void> => {
    if (!msg.trim() || !staged.length) return
    setBusy(true)
    setErr('')
    const r = await window.api.gitCommit(ws as string, msg.trim())
    setBusy(false)
    if (r.ok) {
      setMsg('')
      setSel(null)
      setDiff('')
      await refresh()
    } else {
      setErr(r.message || t('gitCommitFail'))
    }
  }

  const Row = ({ f, isStaged }: { f: GitStatus['files'][0]; isStaged: boolean }): JSX.Element => (
    <div
      onClick={() => void view(f.path, isStaged)}
      className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs transition hover:bg-surface-2 ${
        sel?.path === f.path && sel?.staged === isStaged ? 'bg-accent-soft' : ''
      }`}
    >
      <span className="w-4 shrink-0 text-center font-mono text-accent">{badge(f)}</span>
      <span className="flex-1 truncate font-mono">{f.path}</span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          void (isStaged ? unstage(f.path) : stage(f.path))
        }}
        className="hidden shrink-0 text-muted hover:text-accent group-hover:inline"
      >
        {isStaged ? t('gitUnstage') : t('gitStage')}
      </button>
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-xs">
        <span className="truncate">
          {t('gitBranch')} <span className="font-mono text-accent">{status.branch || '—'}</span>
        </span>
        <button
          onClick={() => void refresh()}
          title={t('gitRefresh')}
          className="text-muted hover:text-fg"
        >
          ↻
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {status.files.length === 0 && <div className="p-3 text-xs text-muted">{t('gitClean')}</div>}

        {staged.length > 0 && (
          <div className="px-2 pt-2">
            <div className="px-2 pb-1 text-[11px] uppercase tracking-wide text-muted">
              {t('gitStaged')} ({staged.length})
            </div>
            {staged.map((f) => (
              <Row key={`s-${f.path}`} f={f} isStaged />
            ))}
          </div>
        )}

        {changes.length > 0 && (
          <div className="px-2 pt-2">
            <div className="px-2 pb-1 text-[11px] uppercase tracking-wide text-muted">
              {t('gitChanges')} ({changes.length})
            </div>
            {changes.map((f) => (
              <Row key={`c-${f.path}`} f={f} isStaged={false} />
            ))}
          </div>
        )}

        {sel && (
          <div className="mt-2 border-t border-line">
            <div className="px-3 py-1 font-mono text-[11px] text-muted">{sel.path}</div>
            <GitDiffText text={diff} />
          </div>
        )}
      </div>

      <div className="border-t border-line p-2">
        {err && <div className="mb-1 text-xs text-red-500">{err}</div>}
        <textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          rows={2}
          placeholder={t('gitMsgPh')}
          className="w-full resize-none rounded-md border border-line bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
        />
        <button
          onClick={() => void commit()}
          disabled={busy || !msg.trim() || staged.length === 0}
          className="mt-1 w-full rounded-md border border-line bg-surface-2 text-fg hover:bg-accent-soft px-3 py-1.5 text-xs transition disabled:opacity-40"
        >
          {busy ? t('gitCommitting') : `${t('gitCommit')} (${staged.length})`}
        </button>
      </div>
    </div>
  )
}

function Tab({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`flex-1 whitespace-nowrap py-2 text-xs transition ${
        active ? 'border-b-2 border-accent text-accent' : 'text-muted hover:text-fg'
      }`}
    >
      {children}
    </button>
  )
}

const TABS: { key: RightTab; label: string }[] = [
  { key: 'files', label: 'Files' },
  { key: 'preview', label: 'Preview' },
  { key: 'diff', label: 'Diff' },
  { key: 'plan', label: 'Plan' },
  { key: 'memory', label: 'Memory' },
  { key: 'git', label: 'Git' },
  { key: 'terminal', label: 'Terminal' }
]

export function RightPanel(): JSX.Element | null {
  const t = useT()
  const open = useStore((s) => s.rightPanelOpen)
  const view = useStore((s) => s.view)
  const tab = useStore((s) => s.rightTab)
  const setTab = useStore((s) => s.setRightTab)
  const toggle = useStore((s) => s.toggleRightPanel)
  const active = useStore((s) => s.active)
  const pickActiveWorkspace = useStore((s) => s.pickActiveWorkspace)
  const diffs = useStore((s) => s.diffs)

  // Chats 为纯对话空间，不使用右侧工作区；仅 Cowork / Code 才有
  if (view === 'chat' || !open) return null

  const folder =
    active?.workspaceDir
      .replace(/[/\\]+$/, '')
      .split(/[/\\]/)
      .pop() || active?.workspaceDir

  return (
    <aside className="flex w-96 flex-col border-l border-line bg-paper">
      <div className="region-drag flex items-center justify-between border-b border-line px-3 pb-1 pt-10">
        <span className="text-sm font-semibold text-fg">{t('wsPanel')}</span>
        <button
          onClick={toggle}
          title={t('closePanel')}
          className="rounded-md p-1 text-muted transition hover:bg-surface-2 hover:text-fg"
        >
          ✕
        </button>
      </div>
      {active && (
        <button
          onClick={() => void pickActiveWorkspace()}
          title={t('wsTip').replace('{d}', active.workspaceDir)}
          className="flex items-center gap-1.5 border-b border-line px-3 py-1.5 text-xs text-muted transition hover:text-accent"
        >
          <FolderIcon className="h-3.5 w-3.5" />
          <span className="truncate">{folder}</span>
          <span className="ml-auto shrink-0 text-[11px]">{t('wsChange')}</span>
        </button>
      )}
      <div className="flex border-b border-line">
        {TABS.map((t) => (
          <Tab key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === 'diff' && diffs.length > 0 ? ` (${diffs.length})` : ''}
          </Tab>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'files' &&
          (active ? (
            <div className="py-1">
              <DirView workspace={active.workspaceDir} dir="." depth={0} />
            </div>
          ) : (
            <div className="p-4 text-sm text-muted">{t('openConvFirst')}</div>
          ))}
        {tab === 'preview' && <PreviewView />}
        {tab === 'diff' && <DiffView />}
        {tab === 'plan' && <PlanView />}
        {tab === 'memory' && <MemoryView />}
        {tab === 'git' && <GitView />}
        {tab === 'terminal' && <TerminalView />}
      </div>
    </aside>
  )
}
