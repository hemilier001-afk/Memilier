import { useState } from 'react'
import type { Routine } from '@shared/types'
import { useStore } from '../store'
import { useT } from '../i18n'

const SPACE_LABEL: Record<string, string> = { chat: 'Chats', cowork: 'Cowork', code: 'Code' }
type SchedKind = NonNullable<Routine['scheduleKind']>

function blankRoutine(kind: Routine['kind']): Routine {
  return {
    id: '',
    name: '',
    kind,
    prompt: '',
    intervalMinutes: 60,
    enabled: true,
    scheduleKind: 'interval',
    atTime: '09:00',
    weekday: 1,
    retries: 0,
    createdAt: 0
  }
}

// 一键自动化模板（对齐工作流工具的 recipe 库）：点了填进表单，用户确认后保存
const TEMPLATES: { key: string; make: (kind: Routine['kind']) => Routine }[] = [
  {
    key: 'tplErrorSummary',
    make: (kind) => ({
      ...blankRoutine(kind),
      name: '每日错误汇总',
      scheduleKind: 'daily',
      atTime: '18:00',
      reportToFile: true,
      prompt:
        '扫描工作区里最近的日志（如 logs/ 目录或 *.log 文件），汇总今天出现的错误与告警，按出现频次排序，写一份简明摘要。'
    })
  },
  {
    key: 'tplDepCheck',
    make: (kind) => ({
      ...blankRoutine(kind),
      name: '依赖更新检查',
      scheduleKind: 'weekly',
      weekday: 1,
      atTime: '09:00',
      reportToFile: true,
      prompt:
        '检查本项目的依赖（package.json 等）是否有新版本可升级，列出可升级项、当前版本→最新版本，以及可能的破坏性变更提示。不要自动升级。'
    })
  },
  {
    key: 'tplFileTidy',
    make: (kind) => ({
      ...blankRoutine(kind),
      name: '新文件自动整理',
      scheduleKind: 'fileChange',
      watchDir: 'inbox',
      prompt:
        '有新文件进入 inbox 目录时，识别其类型并整理：按类别/日期归类，必要时重命名，给出整理说明。操作前先说明计划。'
    })
  }
]

const WEEKDAY_KEYS = ['wdSun', 'wdMon', 'wdTue', 'wdWed', 'wdThu', 'wdFri', 'wdSat'] as const

export function RoutinesModal(): JSX.Element | null {
  const t = useT() as unknown as (k: string) => string
  const open = useStore((s) => s.routinesOpen)
  const setOpen = useStore((s) => s.setRoutinesOpen)
  const view = useStore((s) => s.view)
  const routines = useStore((s) => s.routines)
  const models = useStore((s) => s.models)
  const saveRoutine = useStore((s) => s.saveRoutine)
  const deleteRoutine = useStore((s) => s.deleteRoutine)
  const runRoutineNow = useStore((s) => s.runRoutineNow)
  const [editing, setEditing] = useState<Routine | null>(null)

  if (!open) return null

  const list = routines.filter((r) => r.kind === view)
  const kind: SchedKind = editing?.scheduleKind ?? 'interval'
  const inputCls = 'w-full rounded-md border border-line bg-transparent px-2 py-1.5'

  const save = (): void => {
    if (!editing || !editing.name.trim() || !editing.prompt.trim()) return
    void saveRoutine(editing)
    setEditing(null)
  }

  // 例程的触发方式摘要（列表用）
  const triggerSummary = (r: Routine): string => {
    const k = r.scheduleKind ?? 'interval'
    if (k === 'interval') return t('routineEveryMin').replace('{n}', String(r.intervalMinutes))
    if (k === 'daily') return `${t('trigDaily')} ${r.atTime ?? ''}`
    if (k === 'weekly') return `${t(WEEKDAY_KEYS[r.weekday ?? 1])} ${r.atTime ?? ''}`
    return `${t('trigFileChange')}: ${r.watchDir ?? ''}`
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="max-h-[85vh] w-[560px] overflow-y-auto rounded-xl border border-line bg-surface p-6 text-fg shadow-xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {t('routinesTitle')} · {SPACE_LABEL[view]}
          </h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-fg">
            ✕
          </button>
        </div>
        <p className="mb-4 text-xs text-muted">{t('routinesHint')}</p>

        {editing ? (
          <div className="space-y-3 text-sm">
            <div>
              <label className="mb-1 block font-medium">{t('routineName')}</label>
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1 block font-medium">{t('routinePrompt')}</label>
              <textarea
                value={editing.prompt}
                onChange={(e) => setEditing({ ...editing, prompt: e.target.value })}
                rows={4}
                placeholder={t('routinePromptPh')}
                className="w-full rounded-md border border-line bg-transparent p-2"
              />
            </div>

            {/* 触发方式 */}
            <div>
              <label className="mb-1 block font-medium">{t('routineTrigger')}</label>
              <select
                value={kind}
                onChange={(e) =>
                  setEditing({ ...editing, scheduleKind: e.target.value as SchedKind })
                }
                className={inputCls}
              >
                <option value="interval">{t('trigInterval')}</option>
                <option value="daily">{t('trigDaily')}</option>
                <option value="weekly">{t('trigWeekly')}</option>
                <option value="fileChange">{t('trigFileChange')}</option>
              </select>
            </div>

            <div className="flex gap-3">
              {kind === 'interval' && (
                <div className="flex-1">
                  <label className="mb-1 block font-medium">{t('routineInterval')}</label>
                  <input
                    type="number"
                    min={1}
                    value={editing.intervalMinutes}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        intervalMinutes: Math.max(1, Number(e.target.value))
                      })
                    }
                    className={inputCls}
                  />
                </div>
              )}
              {kind === 'weekly' && (
                <div className="flex-1">
                  <label className="mb-1 block font-medium">{t('routineWeekday')}</label>
                  <select
                    value={editing.weekday ?? 1}
                    onChange={(e) => setEditing({ ...editing, weekday: Number(e.target.value) })}
                    className={inputCls}
                  >
                    {WEEKDAY_KEYS.map((k, i) => (
                      <option key={k} value={i}>
                        {t(k)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {(kind === 'daily' || kind === 'weekly') && (
                <div className="flex-1">
                  <label className="mb-1 block font-medium">{t('routineAtTime')}</label>
                  <input
                    type="time"
                    value={editing.atTime ?? '09:00'}
                    onChange={(e) => setEditing({ ...editing, atTime: e.target.value })}
                    className={inputCls}
                  />
                </div>
              )}
              {kind === 'fileChange' && (
                <div className="flex-1">
                  <label className="mb-1 block font-medium">{t('routineWatchDir')}</label>
                  <input
                    value={editing.watchDir ?? ''}
                    onChange={(e) => setEditing({ ...editing, watchDir: e.target.value })}
                    placeholder="inbox"
                    className={inputCls}
                  />
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="mb-1 block font-medium">{t('routineModel')}</label>
                <select
                  value={editing.model ?? ''}
                  onChange={(e) => setEditing({ ...editing, model: e.target.value || undefined })}
                  className={inputCls}
                >
                  <option value="">{t('routineDefaultModel')}</option>
                  {models.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.label ?? m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-28">
                <label className="mb-1 block font-medium">{t('routineRetries')}</label>
                <input
                  type="number"
                  min={0}
                  max={5}
                  value={editing.retries ?? 0}
                  onChange={(e) =>
                    setEditing({ ...editing, retries: Math.max(0, Number(e.target.value)) })
                  }
                  className={inputCls}
                />
              </div>
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={editing.reportToFile ?? false}
                onChange={(e) => setEditing({ ...editing, reportToFile: e.target.checked })}
              />
              {t('routineReportToFile')}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={editing.enabled}
                onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
              />
              {t('routineEnabled')}
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setEditing(null)}
                className="rounded-lg px-4 py-2 text-sm text-muted hover:bg-surface-2 hover:text-fg"
              >
                {t('cancel')}
              </button>
              <button
                onClick={save}
                className="rounded-lg border border-line bg-surface-2 px-4 py-2 text-sm text-fg transition hover:bg-accent-soft"
              >
                {t('save')}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* 自动化模板 */}
            <div className="mb-3">
              <p className="mb-1 text-xs font-medium text-muted">{t('routineTemplates')}</p>
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.key}
                    onClick={() => setEditing(tpl.make(view))}
                    className="rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-fg transition hover:bg-accent-soft"
                  >
                    + {t(tpl.key)}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={() => setEditing(blankRoutine(view))}
              className="mb-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg transition hover:bg-accent-soft"
            >
              {t('routineNew')}
            </button>
            {list.length === 0 ? (
              <p className="text-sm text-muted">{t('routinesEmpty')}</p>
            ) : (
              <ul className="space-y-2">
                {list.map((r) => {
                  const last = r.history?.[0]
                  return (
                    <li key={r.id} className="rounded-lg border border-line px-3 py-2 text-sm">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{r.name}</span>
                            {!r.enabled && (
                              <span className="text-xs text-muted">{t('routineDisabled')}</span>
                            )}
                          </div>
                          <div className="truncate text-xs text-muted">
                            {triggerSummary(r)} · {r.prompt}
                          </div>
                          {last && (
                            <div className="mt-0.5 text-[11px] text-muted">
                              {t('routineLastRun')}：
                              <span
                                className={
                                  last.status === 'done' ? 'text-green-500' : 'text-red-500'
                                }
                              >
                                {last.status === 'done' ? '✓' : '✗'}
                              </span>{' '}
                              {new Date(last.at).toLocaleString()}
                              {last.error ? ` · ${last.error.slice(0, 40)}` : ''}
                            </div>
                          )}
                        </div>
                        <div className="ml-2 flex shrink-0 items-center gap-2 text-xs">
                          <button
                            onClick={() => void runRoutineNow(r.id)}
                            className="text-muted hover:text-accent"
                            title={t('routineRunNowTip')}
                          >
                            {t('routineRunNow')}
                          </button>
                          <button
                            onClick={() => setEditing(r)}
                            className="text-muted hover:text-fg"
                          >
                            {t('edit')}
                          </button>
                          <button
                            onClick={() => void deleteRoutine(r.id)}
                            className="text-muted hover:text-red-500"
                          >
                            {t('deleteChat')}
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}
