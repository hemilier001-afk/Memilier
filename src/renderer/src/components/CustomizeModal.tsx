import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useT } from '../i18n'

const SPACE_LABEL: Record<string, string> = { chat: 'Chats', cowork: 'Cowork', code: 'Code' }

export function CustomizeModal(): JSX.Element | null {
  const t = useT()
  const open = useStore((s) => s.customizeOpen)
  const setOpen = useStore((s) => s.setCustomizeOpen)
  const view = useStore((s) => s.view)
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const [text, setText] = useState('')

  useEffect(() => {
    if (open) setText(useStore.getState().settings?.customInstructions?.[view] ?? '')
  }, [open, view])

  if (!open || !settings) return null

  const save = (): void => {
    void update({ customInstructions: { ...settings.customInstructions, [view]: text } })
    setOpen(false)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="w-[520px] rounded-xl border border-line bg-surface p-6 text-fg shadow-xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {t('customizeTitle')} · {SPACE_LABEL[view]}
          </h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-fg">
            ✕
          </button>
        </div>
        <p className="mb-3 text-xs text-muted">
          {t('customizeHintA')} <b>{SPACE_LABEL[view]}</b> {t('customizeHintB')}
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={t('customizePh')}
          className="w-full rounded-lg border border-line bg-transparent p-3 text-sm outline-none focus:border-accent"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => setOpen(false)}
            className="rounded-lg px-4 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-fg"
          >
            {t('cancel')}
          </button>
          <button
            onClick={save}
            className="rounded-lg bg-accent px-4 py-2 text-sm text-white transition hover:bg-accent-hover"
          >
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  )
}
