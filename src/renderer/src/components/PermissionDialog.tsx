import { useState } from 'react'
import { lineDiff } from '@shared/diff'
import { useStore } from '../store'

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
  const respond = useStore((s) => s.respondPermission)
  const [remember, setRemember] = useState(false)

  if (!permission) return null

  const handle = (approved: boolean): void => {
    respond(approved, remember)
    setRemember(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-[520px] max-w-[92vw] rounded-xl border border-line bg-surface p-5 text-fg shadow-xl">
        <h2 className="text-base font-semibold">需要授权</h2>
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
          本会话内记住此类操作
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => handle(false)}
            className="rounded-lg px-4 py-2 text-sm text-muted transition hover:bg-surface-2 hover:text-fg"
          >
            拒绝
          </button>
          <button
            onClick={() => handle(true)}
            className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover"
          >
            允许
          </button>
        </div>
      </div>
    </div>
  )
}
