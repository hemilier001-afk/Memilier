import { useState } from 'react'
import type { Routine } from '@shared/types'
import { useStore } from '../store'
import { useT } from '../i18n'

const SPACE_LABEL: Record<string, string> = { chat: 'Chats', cowork: 'Cowork', code: 'Code' }

function blankRoutine(kind: Routine['kind']): Routine {
  return {
    id: '',
    name: '',
    kind,
    prompt: '',
    intervalMinutes: 60,
    enabled: true,
    createdAt: 0
  }
}

export function RoutinesModal(): JSX.Element | null {
  const t = useT()
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

  const save = (): void => {
    if (!editing || !editing.name.trim() || !editing.prompt.trim()) return
    void saveRoutine(editing)
    setEditing(null)
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
                className="w-full rounded-md border border-line bg-transparent px-2 py-1.5"
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
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="mb-1 block font-medium">{t('routineInterval')}</label>
                <input
                  type="number"
                  min={1}
                  value={editing.intervalMinutes}
                  onChange={(e) =>
                    setEditing({ ...editing, intervalMinutes: Math.max(1, Number(e.target.value)) })
                  }
                  className="w-full rounded-md border border-line bg-transparent px-2 py-1.5"
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block font-medium">{t('routineModel')}</label>
                <select
                  value={editing.model ?? ''}
                  onChange={(e) => setEditing({ ...editing, model: e.target.value || undefined })}
                  className="w-full rounded-md border border-line bg-transparent px-2 py-1.5"
                >
                  <option value="">{t('routineDefaultModel')}</option>
                  {models.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.label ?? m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
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
                className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover"
              >
                {t('save')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              onClick={() => setEditing(blankRoutine(view))}
              className="mb-3 rounded-lg bg-accent px-3 py-2 text-sm text-white hover:bg-accent-hover"
            >
              {t('routineNew')}
            </button>
            {list.length === 0 ? (
              <p className="text-sm text-muted">{t('routinesEmpty')}</p>
            ) : (
              <ul className="space-y-2">
                {list.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.name}</span>
                        {!r.enabled && (
                          <span className="text-xs text-muted">{t('routineDisabled')}</span>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted">
                        {t('routineEveryMin').replace('{n}', String(r.intervalMinutes))} ·{' '}
                        {r.prompt}
                      </div>
                    </div>
                    <div className="ml-2 flex shrink-0 items-center gap-2 text-xs">
                      <button
                        onClick={() => void runRoutineNow(r.id)}
                        className="text-muted hover:text-accent"
                        title={t('routineRunNowTip')}
                      >
                        {t('routineRunNow')}
                      </button>
                      <button onClick={() => setEditing(r)} className="text-muted hover:text-fg">
                        {t('edit')}
                      </button>
                      <button
                        onClick={() => void deleteRoutine(r.id)}
                        className="text-muted hover:text-red-500"
                      >
                        {t('deleteChat')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}
