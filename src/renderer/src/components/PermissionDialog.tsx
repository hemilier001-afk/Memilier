import { useState } from 'react'
import { lineDiff } from '@shared/diff'
import { useStore } from '../store'
import { useT } from '../i18n'

function DiffPre({ before, after }: { before: string; after: string }): JSX.Element {
  return (
    <pre className="max-h-56 overflow-auto rounded border border-line bg-surface-2 text-xs leading-5">
      {lineDiff(before, after).map((l, i) => (
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
  )
}

// 把待批准的工具改动渲染成可读预览（写文件看内容、编辑看 diff、命令看命令）
function Preview({ tool, args }: { tool: string; args: Record<string, unknown> }): JSX.Element {
  if (tool === 'edit_file') {
    return (
      <>
        <p className="mb-1 font-mono text-xs text-muted">{String(args.path)}</p>
        <DiffPre before={String(args.old_string ?? '')} after={String(args.new_string ?? '')} />
      </>
    )
  }
  if (tool === 'write_file') {
    return (
      <>
        <p className="mb-1 font-mono text-xs text-muted">{String(args.path)}（写入全文）</p>
        <DiffPre before="" after={String(args.content ?? '')} />
      </>
    )
  }
  if (tool === 'run_command') {
    return (
      <pre className="max-h-56 overflow-auto rounded border border-line bg-surface-2 p-2 font-mono text-xs">
        $ {String(args.command)}
      </pre>
    )
  }
  return (
    <pre className="max-h-56 overflow-auto rounded border border-line bg-surface-2 p-2 text-xs">
      {JSON.stringify(args, null, 2)}
    </pre>
  )
}

export function PermissionDialog(): JSX.Element | null {
  const permission = useStore((s) => s.permission)
  const queue = useStore((s) => s.permissionQueue)
  const respond = useStore((s) => s.respondPermission)
  const [remember, setRemember] = useState(false)
  const t = useT()

  if (!permission) return null

  const handle = (approved: boolean): void => {
    respond(approved, remember)
    setRemember(false)
  }

  // 非模态：固定在输入框上方的卡片，不遮挡对话——可以边看上下文边决定（仿 Claude Code）
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-50 flex justify-center px-4">
      <div className="pointer-events-auto w-[560px] max-w-full rounded-xl border-2 border-accent/60 bg-surface p-4 text-fg shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('permTitle')}</h2>
          {queue.length > 1 && (
            <span className="text-xs text-muted">
              {t('permQueue').replace('{n}', String(queue.length - 1))}
            </span>
          )}
        </div>
        <p className="mt-1 font-mono text-sm text-accent">{permission.description}</p>

        <div className="mt-3">
          <Preview tool={permission.toolName} args={permission.args} />
        </div>

        <label className="mt-3 flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          {t('permRemember')}
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => handle(false)}
            className="rounded-lg px-4 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-fg"
          >
            {t('permDeny')}
          </button>
          <button
            onClick={() => handle(true)}
            className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover"
          >
            {t('permAllow')}
          </button>
        </div>
      </div>
    </div>
  )
}
