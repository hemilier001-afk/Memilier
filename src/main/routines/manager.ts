import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Notification, app } from 'electron'
import type { AgentEvent, BackgroundTask, Message, Routine } from '@shared/types'
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
    return next
  },

  delete(id: string): void {
    ensure()
    delete routines[id]
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

    try {
      await runAgent({
        conversationId: conv.id,
        userContent: r.prompt,
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
      }
    } catch (e) {
      task.status = 'error'
      task.error = e instanceof Error ? e.message : String(e)
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
    }
  },

  /** 启动调度器：每 30 秒检查一次到点的例程 */
  startScheduler(emitAgent: EmitAgent, emitTasks: EmitTasks): void {
    ensure()
    setInterval(() => {
      const now = Date.now()
      for (const r of Object.values(routines)) {
        if (!r.enabled || running.has(r.id)) continue
        const due = (r.lastRunAt ?? 0) + r.intervalMinutes * 60_000
        if (now >= due) void this.run(r.id, emitAgent, emitTasks)
      }
    }, 30_000)
  }
}

function notify(task: BackgroundTask): void {
  if (!Notification.isSupported()) return
  new Notification({
    title: task.status === 'done' ? `例程完成：${task.title}` : `例程失败：${task.title}`,
    body: task.error ?? '后台任务已结束，点开对应对话查看结果。'
  }).show()
}
