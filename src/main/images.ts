import { randomUUID } from 'node:crypto'
import { existsSync, promises as fs, rmSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

// 图片以文件形式存储在 userData/images/<会话id>/<uuid>.<ext>，消息里只存引用 "himg:<相对路径>"。
// 这样 conversations.json 不再内联庞大的 base64，保存对话不必每次重写大文件。
const PREFIX = 'himg:'

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
}

function baseDir(): string {
  return path.join(app.getPath('userData'), 'images')
}

// 防路径穿越：解析后必须仍在 images 基目录之内（拒绝 ../、绝对路径等）
function safeJoin(rel: string): string | null {
  if (!rel || rel.includes('\0')) return null
  const base = baseDir()
  const abs = path.resolve(base, rel)
  if (abs !== base && !abs.startsWith(base + path.sep)) return null
  return abs
}

export const imageStore = {
  isRef(v: string): boolean {
    return v.startsWith(PREFIX)
  },

  /** 把 data URL 落盘为文件并返回引用；若传入的不是 data URL（可能已是引用）则原样返回 */
  async save(conversationId: string, dataUrl: string): Promise<string> {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl)
    if (!m) return dataUrl
    const ext = EXT_BY_MIME[m[1].toLowerCase()] ?? 'bin'
    const rel = `${conversationId}/${randomUUID()}.${ext}`
    const abs = path.join(baseDir(), rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, Buffer.from(m[2], 'base64'))
    return PREFIX + rel
  },

  /** 引用 → data URL；非引用（旧数据里的内联 data URL）原样返回；文件缺失返回空串 */
  async resolve(ref: string): Promise<string> {
    if (!ref.startsWith(PREFIX)) return ref
    const abs = safeJoin(ref.slice(PREFIX.length))
    if (!abs) return '' // 引用越界（如 ../..）一律拒绝
    try {
      const buf = await fs.readFile(abs)
      const ext = path.extname(abs).slice(1).toLowerCase()
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext || 'png'}`
      return `data:${mime};base64,${buf.toString('base64')}`
    } catch {
      return ''
    }
  },

  /** 删除一批图片引用对应的文件（消息被截断/编辑重发时清理，避免孤儿文件泄漏） */
  deleteRefs(refs: string[]): void {
    for (const ref of refs) {
      if (!ref.startsWith(PREFIX)) continue
      const abs = safeJoin(ref.slice(PREFIX.length))
      if (!abs) continue
      try {
        rmSync(abs, { force: true })
      } catch {
        /* 清理失败忽略 */
      }
    }
  },

  /** 删除某会话的全部图片（会话被删除时清理）。id 必须是单层目录名，防 ../ 越界删除 */
  deleteConversation(conversationId: string): void {
    if (!conversationId || /[\\/]|\.\./.test(conversationId)) return
    const dir = safeJoin(conversationId)
    if (!dir) return
    try {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    } catch {
      /* 清理失败忽略 */
    }
  }
}
