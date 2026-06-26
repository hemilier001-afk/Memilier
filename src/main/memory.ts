import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { MemoryEntry, MemoryType } from '@shared/types'

// 项目记忆带治理元数据：类型(置信度) / 来源 / 时间 / 可删除 / 过期标记。
// 存为 <workspace>/.hemilier/memory.json（JSON 可读、可 diff、可 git）。

const STALE_MS = 30 * 86_400_000 // 超过 30 天标记“较旧，请核实”
const TYPE_LABEL: Record<MemoryType, string> = {
  fact: '事实',
  preference: '偏好',
  decision: '决策',
  pitfall: '坑',
  todo: '待办'
}

function file(workspace: string): string {
  return path.join(workspace, '.hemilier', 'memory.json')
}

export const memory = {
  async list(workspace: string): Promise<MemoryEntry[]> {
    try {
      const data = JSON.parse(await fs.readFile(file(workspace), 'utf8'))
      return Array.isArray(data) ? data : []
    } catch {
      return []
    }
  },

  async save(workspace: string, entries: MemoryEntry[]): Promise<void> {
    await fs.mkdir(path.join(workspace, '.hemilier'), { recursive: true })
    await fs.writeFile(file(workspace), JSON.stringify(entries, null, 2), 'utf8')
  },

  async add(
    workspace: string,
    text: string,
    type: MemoryType,
    source?: string
  ): Promise<MemoryEntry> {
    const entries = await this.list(workspace)
    const now = Date.now()
    const entry: MemoryEntry = {
      id: randomUUID(),
      text: text.trim(),
      type,
      source,
      createdAt: now,
      updatedAt: now
    }
    entries.push(entry)
    await this.save(workspace, entries)
    return entry
  },

  /** 按 id 前缀删除（提示里只展示短 id，故支持前缀匹配） */
  async forget(workspace: string, id: string): Promise<void> {
    const entries = (await this.list(workspace)).filter((e) => !e.id.startsWith(id))
    await this.save(workspace, entries)
  },

  /** 渲染成注入系统提示的文本（含类型、时间、过期标记、来源、短 id） */
  async renderForPrompt(workspace: string): Promise<string> {
    const entries = await this.list(workspace)
    if (!entries.length) return ''
    const now = Date.now()
    return entries
      .slice(0, 50)
      .map((e) => {
        const d = new Date(e.createdAt).toLocaleDateString()
        const stale = now - e.createdAt > STALE_MS ? ' ⚠较旧请核实' : ''
        const src = e.source ? ` 来源:${e.source}` : ''
        return `- [${TYPE_LABEL[e.type] ?? e.type}·${d}${stale}${src}] ${e.text} (id:${e.id.slice(0, 8)})`
      })
      .join('\n')
  }
}
