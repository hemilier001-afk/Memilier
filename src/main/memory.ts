import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { MemoryEntry, MemoryType } from '@shared/types'

// 记忆分两层（对齐 Claude 的用户层/项目层）：
// - 全局记忆：userData/memory.json —— 跨所有工作区生效（用户是谁、通用偏好）
// - 项目记忆：<workspace>/.hemilier/memory.json —— 随项目走、可进版本库
// 另有「待采纳」暂存区：自动沉淀的候选记忆先进这里，用户一键采纳/忽略后才生效
// （保持"记忆写入须经人"的安全红线，同时获得 Claude 式的自动捕获体验）。

export type MemoryScope = 'global' | 'project'

const STALE_MS = 30 * 86_400_000 // 超过 30 天标记“较旧，请核实”
const TYPE_LABEL: Record<MemoryType, string> = {
  fact: '事实',
  preference: '偏好',
  decision: '决策',
  pitfall: '坑',
  todo: '待办'
}

function projectFile(workspace: string): string {
  return path.join(workspace, '.hemilier', 'memory.json')
}
function globalFile(): string {
  // 惰性取 electron.app：单测在纯 Node 环境跑（无 Electron 主进程），退回临时目录
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron')
    return path.join(app.getPath('userData'), 'memory.json')
  } catch {
    return path.join(os.tmpdir(), 'hemilier-global-memory.json')
  }
}
function pendingFile(workspace: string): string {
  return path.join(workspace, '.hemilier', 'memory-pending.json')
}

async function readEntries(file: string): Promise<MemoryEntry[]> {
  try {
    const data = JSON.parse(await fs.readFile(file, 'utf8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}
async function writeEntries(file: string, entries: MemoryEntry[]): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(entries, null, 2), 'utf8')
}

function fileFor(scope: MemoryScope, workspace: string): string {
  return scope === 'global' ? globalFile() : projectFile(workspace)
}

export const memory = {
  async list(workspace: string, scope: MemoryScope = 'project'): Promise<MemoryEntry[]> {
    return readEntries(fileFor(scope, workspace))
  },

  /** 一次取全：全局 + 项目 + 待采纳（Memory 面板用） */
  async listAll(workspace: string): Promise<{
    global: MemoryEntry[]
    project: MemoryEntry[]
    pending: MemoryEntry[]
  }> {
    const [g, p, pd] = await Promise.all([
      readEntries(globalFile()),
      readEntries(projectFile(workspace)),
      readEntries(pendingFile(workspace))
    ])
    return { global: g, project: p, pending: pd }
  },

  async add(
    workspace: string,
    text: string,
    type: MemoryType,
    source?: string,
    scope: MemoryScope = 'project'
  ): Promise<MemoryEntry> {
    const file = fileFor(scope, workspace)
    const entries = await readEntries(file)
    const now = Date.now()
    const trimmed = text.trim()
    // 同文去重（upsert）：内容完全相同的条目刷新时间与类型，而不是堆一条重复记忆
    const existing = entries.find((e) => e.text === trimmed)
    if (existing) {
      existing.type = type
      existing.source = source ?? existing.source
      existing.createdAt = now // 视为“再次确认”，重置过期计时
      existing.updatedAt = now
      await writeEntries(file, entries)
      return existing
    }
    const entry: MemoryEntry = {
      id: randomUUID(),
      text: trimmed,
      type,
      source,
      createdAt: now,
      updatedAt: now
    }
    entries.push(entry)
    await writeEntries(file, entries)
    return entry
  },

  /** 按 id 前缀删除（提示里只展示短 id）。两层都找，命中哪层删哪层。 */
  async forget(workspace: string, id: string): Promise<void> {
    for (const file of [projectFile(workspace), globalFile()]) {
      const entries = await readEntries(file)
      const next = entries.filter((e) => !e.id.startsWith(id))
      if (next.length !== entries.length) await writeEntries(file, next)
    }
  },

  /** 整批替换某一层（记忆整理用；调用方需先经用户确认） */
  async replace(workspace: string, scope: MemoryScope, entries: MemoryEntry[]): Promise<void> {
    await writeEntries(fileFor(scope, workspace), entries)
  },

  // ——— 待采纳（自动沉淀的候选，采纳后才进入正式记忆） ———
  async listPending(workspace: string): Promise<MemoryEntry[]> {
    return readEntries(pendingFile(workspace))
  },

  async addPending(
    workspace: string,
    items: { text: string; type: MemoryType }[],
    source?: string
  ): Promise<void> {
    const file = pendingFile(workspace)
    const entries = await readEntries(file)
    const now = Date.now()
    const existingTexts = new Set(entries.map((e) => e.text))
    // 已在正式记忆里的内容不再重复建议
    const formal = new Set(
      [...(await readEntries(projectFile(workspace))), ...(await readEntries(globalFile()))].map(
        (e) => e.text
      )
    )
    for (const it of items) {
      const text = it.text.trim()
      if (!text || existingTexts.has(text) || formal.has(text)) continue
      entries.push({
        id: randomUUID(),
        text,
        type: it.type,
        source,
        createdAt: now,
        updatedAt: now
      })
      existingTexts.add(text)
    }
    // 待采纳区上限 20 条，最旧的先淘汰
    await writeEntries(file, entries.slice(-20))
  },

  /** 采纳（转入项目记忆）或忽略一条候选 */
  async resolvePending(workspace: string, id: string, adopt: boolean): Promise<void> {
    const file = pendingFile(workspace)
    const entries = await readEntries(file)
    const hit = entries.find((e) => e.id === id)
    await writeEntries(
      file,
      entries.filter((e) => e.id !== id)
    )
    if (hit && adopt) await this.add(workspace, hit.text, hit.type, hit.source)
  },

  /** 关键词检索两层记忆（供 recall 工具；子串匹配，大小写不敏感） */
  async search(workspace: string, query: string, limit = 10): Promise<string> {
    const q = query.toLowerCase()
    const terms = q.split(/\s+/).filter(Boolean)
    if (!terms.length) return ''
    const { global: g, project: p } = await this.listAll(workspace)
    const hits: { scope: string; e: MemoryEntry; score: number }[] = []
    for (const [scope, list] of [
      ['全局', g],
      ['项目', p]
    ] as const) {
      for (const e of list) {
        const text = e.text.toLowerCase()
        const score = terms.reduce((n, t) => n + (text.includes(t) ? 1 : 0), 0)
        if (score > 0) hits.push({ scope, e, score })
      }
    }
    hits.sort((a, b) => b.score - a.score || b.e.updatedAt - a.e.updatedAt)
    return hits
      .slice(0, limit)
      .map(
        ({ scope, e }) =>
          `【记忆·${scope}·${TYPE_LABEL[e.type] ?? e.type}】${e.text} (id:${e.id.slice(0, 8)})`
      )
      .join('\n')
  },

  /** 渲染成注入系统提示的文本：全局在前、项目在后，共享预算（50 条 + ~4000 字符，最新优先） */
  async renderForPrompt(workspace: string): Promise<string> {
    const { global: g, project: p } = await this.listAll(workspace)
    if (!g.length && !p.length) return ''
    const now = Date.now()
    const MAX_CHARS = 4000
    // 合并：带层级标记，仍按“最新优先”收集
    const combined = [
      ...g.map((e) => ({ e, scope: '全局' })),
      ...p.map((e) => ({ e, scope: '项目' }))
    ].sort((a, b) => a.e.createdAt - b.e.createdAt)
    const lines: string[] = []
    let total = 0
    let dropped = 0
    for (let i = combined.length - 1; i >= 0; i--) {
      const { e, scope } = combined[i]
      const d = new Date(e.createdAt).toLocaleDateString()
      const stale = now - e.createdAt > STALE_MS ? ' ⚠较旧请核实' : ''
      const src = e.source ? ` 来源:${e.source}` : ''
      const line = `- [${scope}·${TYPE_LABEL[e.type] ?? e.type}·${d}${stale}${src}] ${e.text} (id:${e.id.slice(0, 8)})`
      if (lines.length >= 50 || total + line.length > MAX_CHARS) {
        dropped = i + 1
        break
      }
      lines.push(line)
      total += line.length
    }
    lines.reverse()
    if (dropped > 0)
      lines.push(`（另有 ${dropped} 条较早记忆未注入，可用 recall 工具检索，或在 Memory 面板查看）`)
    return lines.join('\n')
  }
}
