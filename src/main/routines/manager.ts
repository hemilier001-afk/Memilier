import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  watch,
  type FSWatcher
} from 'node:fs'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { Notification, app } from 'electron'
import type { AgentEvent, BackgroundTask, Message, Routine, RoutineRun } from '@shared/types'
import { runAgent } from '../agent/loop'
import { PermissionManager } from '../agent/permission'
import { resolveProvider } from '../providers/registry'
import { store } from '../store'
import { createWorktree, finalizeWorktree } from './worktree'

type EmitAgent = (conversationId: string, event: AgentEvent) => void
type EmitTasks = (tasks: BackgroundTask[]) => void

let loaded = false
let filePath = ''
let routines: Record<string, Routine> = {}
const tasks: BackgroundTask[] = []
const MAX_TASKS = 100 // 任务列表只留最近 N 条，防止长时间运行无限增长
const running = new Set<string>() // 正在运行的 routineId，防止重叠
const taskAborters = new Map<string, AbortController>() // 按任务 id 可中止
const RUN_CAP_MS = 30 * 60_000 // 单次例程运行的墙钟上限，防失控
const watchers = new Map<string, FSWatcher>() // fileChange 例程的文件监听器
const watchDebounce = new Map<string, ReturnType<typeof setTimeout>>()
let sched: { emitAgent: EmitAgent; emitTasks: EmitTasks } | null = null // 调度器回调（供 watcher 触发）
// 文件变化例程：本次触发中变动过的文件名（run 时取出、随 prompt 交给智能体）
const pendingChanges = new Map<string, Set<string>>()
let schedTimer: ReturnType<typeof setInterval> | null = null // 30s 轮询句柄（可清理，防重复注册）

/** 到点判定：interval 用间隔；daily/weekly 用时刻（含"错过补跑"）；fileChange 由监听器触发不走轮询 */
function isDue(r: Routine, now: number): boolean {
  const kind = r.scheduleKind ?? 'interval'
  if (kind === 'fileChange') return false
  if (kind === 'interval') return now >= (r.lastRunAt ?? 0) + r.intervalMinutes * 60_000
  const [h, m] = (r.atTime ?? '09:00').split(':').map(Number)
  const d = new Date(now)
  if (kind === 'weekly' && d.getDay() !== (r.weekday ?? 1)) return false
  const scheduled = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h || 0, m || 0).getTime()
  // 到点后、且本"计划时刻"尚未跑过 → 触发（关机错过的下次启动会补跑一次）
  return now >= scheduled && (r.lastRunAt ?? 0) < scheduled
}

/** 重建 fileChange 例程的文件监听器（save/delete/启动时调用） */
function refreshWatchers(): void {
  if (!sched) return
  for (const [id, w] of watchers) {
    if (routines[id]?.scheduleKind !== 'fileChange' || !routines[id]?.enabled) {
      w.close()
      watchers.delete(id)
    }
  }
  for (const r of Object.values(routines)) {
    if (r.scheduleKind !== 'fileChange' || !r.enabled || watchers.has(r.id)) continue
    const base = r.workspaceDir || store.getSettings().workspaceDir
    const dir = path.isAbsolute(r.watchDir ?? '') ? r.watchDir! : path.join(base, r.watchDir ?? '.')
    try {
      const w = watch(dir, { recursive: true }, (_ev, filename) => {
        // 攒下这批变化的文件名，随 prompt 一起交给智能体——
        // 否则例程只知道"目录里有东西变了"，还得自己重扫整个目录。
        if (filename) {
          const set = pendingChanges.get(r.id) ?? new Set<string>()
          if (set.size < 50) set.add(String(filename))
          pendingChanges.set(r.id, set)
        }
        // 去抖 2s：一批写入只触发一次
        clearTimeout(watchDebounce.get(r.id))
        watchDebounce.set(
          r.id,
          setTimeout(() => {
            if (sched && !running.has(r.id))
              void routineManager.run(r.id, sched.emitAgent, sched.emitTasks)
          }, 2000)
        )
      })
      watchers.set(r.id, w)
    } catch {
      /* 目录不存在等：忽略，用户修好路径后再存一次即可 */
    }
  }
}

function ensure(): void {
  if (loaded) return
  filePath = path.join(app.getPath('userData'), 'routines.json')
  if (!existsSync(path.dirname(filePath))) mkdirSync(path.dirname(filePath), { recursive: true })
  try {
    routines = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    // 文件存在但损坏 → 先备份再以空配置启动，避免静默覆盖丢数据
    if (existsSync(filePath)) {
      try {
        renameSync(filePath, `${filePath}.corrupt-${Date.now()}.bak`)
      } catch {
        /* 备份失败也继续 */
      }
    }
    routines = {}
  }
  loaded = true
}

// 原子写：临时文件 + rename，避免写入中途崩溃损坏 routines.json
function persist(): void {
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, JSON.stringify(routines, null, 2), 'utf8')
  renameSync(tmp, filePath)
}

export const routineManager = {
  list(): Routine[] {
    ensure()
    return Object.values(routines).sort((a, b) => b.createdAt - a.createdAt)
  },

  save(r: Routine): Routine {
    ensure()
    const existing = routines[r.id]
    const next: Routine = {
      ...r,
      id: r.id || randomUUID(),
      createdAt: existing?.createdAt ?? Date.now(),
      // 新建时把 lastRunAt 设为现在，使首次触发发生在一个间隔之后
      lastRunAt: existing?.lastRunAt ?? Date.now()
    }
    routines[next.id] = next
    persist()
    refreshWatchers()
    return next
  },

  delete(id: string): void {
    ensure()
    delete routines[id]
    watchers.get(id)?.close()
    watchers.delete(id)
    persist()
  },

  listTasks(): BackgroundTask[] {
    return tasks
  },

  /** 中止一个正在运行的后台任务（按任务 id） */
  cancelTask(taskId: string): void {
    taskAborters.get(taskId)?.abort()
  },

  /** 立即运行一个例程（也用于到点触发） */
  async run(id: string, emitAgent: EmitAgent, emitTasks: EmitTasks): Promise<void> {
    ensure()
    const r = routines[id]
    if (!r || running.has(id)) return
    running.add(id)
    r.lastRunAt = Date.now()
    persist()

    // 文件变化触发：把这批变动的文件名交给智能体（支持 {{changed_files}} 占位符）
    const changed = [...(pendingChanges.get(id) ?? [])]
    pendingChanges.delete(id)
    const changedText = changed.length ? changed.join('、') : ''
    const promptWithChanges = r.prompt.includes('{{changed_files}}')
      ? r.prompt.replace(/\{\{changed_files\}\}/g, changedText || '（未捕获到具体文件名）')
      : changedText
        ? `${r.prompt}\n\n本次检测到变动的文件：${changedText}`
        : r.prompt

    // 为这次运行新建一个对话
    const conv = store.createConversation(r.kind)
    conv.title = `⏰ ${r.name}`
    if (r.model) conv.model = r.model
    if (r.workspaceDir) conv.workspaceDir = r.workspaceDir

    // 后台任务在隔离的 git worktree 里运行：改动不碰用户当前工作树（非 git 仓库则原地运行）
    const baseWs = conv.workspaceDir || store.getSettings().workspaceDir
    const wt = createWorktree(baseWs, r.name)
    if (wt) conv.workspaceDir = wt.dir
    store.saveConversation(conv)

    const task: BackgroundTask = {
      id: randomUUID(),
      title: r.name,
      conversationId: conv.id,
      routineId: r.id,
      status: 'running',
      startedAt: Date.now()
    }
    tasks.unshift(task)
    if (tasks.length > MAX_TASKS) tasks.length = MAX_TASKS
    emitTasks(tasks)

    const settings = store.getSettings()
    const provider = resolveProvider(conv.model || settings.defaultModel, settings)
    const permission = new PermissionManager(
      () => {},
      () => settings,
      true // 后台自动放行（危险命令仍会被拒绝，见 PermissionManager）
    )

    // 可中止 + 墙钟上限：失控的例程不再只能等它跑完
    const ac = new AbortController()
    taskAborters.set(task.id, ac)
    const capTimer = setTimeout(() => ac.abort(), RUN_CAP_MS)

    const startedAt = task.startedAt
    try {
      // 失败自动重试：最多 1 + retries 次
      const maxAttempts = 1 + Math.max(0, r.retries ?? 0)
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await runAgent({
            conversationId: conv.id,
            userContent:
              attempt === 1
                ? promptWithChanges
                : `（自动重试 第 ${attempt} 次）\n${promptWithChanges}`,
            provider,
            permission,
            signal: ac.signal,
            send: (event) => emitAgent(conv.id, event)
          })
          if (ac.signal.aborted) {
            task.status = 'error'
            task.error = '已停止（手动取消或超过 30 分钟上限）'
          } else {
            task.status = 'done'
            task.error = undefined
          }
        } catch (e) {
          task.status = 'error'
          task.error = e instanceof Error ? e.message : String(e)
        }
        if (task.status === 'done' || ac.signal.aborted || attempt >= maxAttempts) break
      }
    } finally {
      clearTimeout(capTimer)
      taskAborters.delete(task.id)
      // 收尾隔离 worktree：提交改动到隔离分支并移除 worktree，把对话工作区还原回真实仓库
      if (wt) {
        const res = finalizeWorktree(wt)
        conv.workspaceDir = baseWs
        const note: Message = {
          id: randomUUID(),
          role: 'assistant',
          content: res.committed
            ? `🔒 本次在隔离分支 \`${res.branch}\` 中运行，改动已提交（你的工作树未受影响）。可用 \`git checkout ${res.branch}\` 或 \`git merge ${res.branch}\` 查看/合并。`
            : res.keptDir
              ? `⚠️ 本次运行有文件改动，但提交到隔离分支失败。**改动已保留在** \`${res.keptDir}\`，请手动查看/取回后删除该目录。`
              : '🔒 本次在隔离 worktree 中运行，无文件改动。',
          createdAt: Date.now()
        }
        conv.messages.push(note)
        store.saveConversation(conv)
        emitAgent(conv.id, { type: 'message', message: note })
      }
      task.endedAt = Date.now()
      running.delete(id)
      emitTasks(tasks)
      notify(task)

      // 运行历史：每个例程存最近 10 次
      const run: RoutineRun = {
        at: startedAt,
        status: task.status === 'done' ? 'done' : 'error',
        error: task.error,
        conversationId: conv.id,
        durationMs: (task.endedAt ?? Date.now()) - startedAt
      }
      r.history = [run, ...(r.history ?? [])].slice(0, 10)
      persist()

      // 结果落地：把最后一条助手消息摘要写入 <ws>/.hemilier/routine-reports/
      if (r.reportToFile && task.status === 'done') {
        void writeReport(baseWs, r.name, conv).catch(() => {})
      }
    }
  },

  /** 启动调度器：每 30 秒检查一次到点的例程（interval/daily/weekly）+ 建立文件监听 */
  startScheduler(emitAgent: EmitAgent, emitTasks: EmitTasks): void {
    ensure()
    sched = { emitAgent, emitTasks }
    refreshWatchers()
    if (schedTimer) clearInterval(schedTimer) // 幂等：重复调用不叠加定时器
    schedTimer = setInterval(() => {
      const now = Date.now()
      for (const r of Object.values(routines)) {
        if (!r.enabled || running.has(r.id)) continue
        if (isDue(r, now)) void this.run(r.id, emitAgent, emitTasks)
      }
    }, 30_000)
  }
}

/** 把本次运行的结果（最后一条助手消息）写成报告文件，便于无人值守时查阅 */
async function writeReport(
  workspace: string,
  name: string,
  conv: { messages: Message[] }
): Promise<void> {
  const last = [...conv.messages].reverse().find((m) => m.role === 'assistant' && m.content)
  if (!last) return
  const dir = path.join(workspace, '.hemilier', 'routine-reports')
  await fsp.mkdir(dir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const safeName = name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)
  const file = path.join(dir, `${safeName}-${ts}.md`)
  await fsp.writeFile(
    file,
    `# ${name}\n\n运行时间：${new Date().toLocaleString()}\n\n---\n\n${last.content}\n`,
    'utf8'
  )
}

function notify(task: BackgroundTask): void {
  if (!Notification.isSupported()) return
  new Notification({
    title: task.status === 'done' ? `例程完成：${task.title}` : `例程失败：${task.title}`,
    body: task.error ?? '后台任务已结束，点开对应对话查看结果。'
  }).show()
}
