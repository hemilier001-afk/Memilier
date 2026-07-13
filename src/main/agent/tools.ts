import { exec } from 'node:child_process'
import dns from 'node:dns/promises'
import { promises as fs } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { z } from 'zod'
import type { PlanStep, ToolDef } from '@shared/types'
import { isDangerousCommand, isPrivateIp } from './safety'
import { resolveInWorkspace } from '../security'
import { skillManager } from '../skills/manager'
import { memory } from '../memory'
import { store } from '../store'

export interface ToolContext {
  workspace: string
  /** 当前对话 id（recall 检索时排除自身） */
  conversationId?: string
  /** 插件提供的额外技能目录，供 load_skill 查找 */
  skillDirs?: string[]
  /** 记录一次文件改动（供 Diff 面板展示） */
  recordDiff?: (path: string, before: string, after: string) => void
  /** 更新执行计划（供 Plan 面板展示） */
  setPlan?: (steps: PlanStep[]) => void
}

export interface Tool {
  name: string
  description: string
  /** 副作用级别，决定是否需要用户授权 */
  sideEffect: 'none' | 'write' | 'exec'
  schema: z.ZodTypeAny
  /** 传给模型的 JSON Schema */
  parameters: Record<string, unknown>
  execute(args: any, ctx: ToolContext): Promise<string>
}

const MAX_FILE_CHARS = 50_000
const MAX_OUTPUT_CHARS = 20_000
const MAX_GREP_RESULTS = 200
const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', '.next', 'build'])

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n…（已截断，共 ${s.length} 字符）` : s
}

const readFile: Tool = {
  name: 'read_file',
  description: '读取工作区内某个文件的文本内容。修改文件前应先读取。',
  sideEffect: 'none',
  schema: z.object({ path: z.string() }),
  parameters: {
    type: 'object',
    properties: { path: { type: 'string', description: '相对工作区的文件路径' } },
    required: ['path']
  },
  async execute({ path: p }, ctx) {
    const abs = resolveInWorkspace(ctx.workspace, p)
    const content = await fs.readFile(abs, 'utf8')
    return truncate(content, MAX_FILE_CHARS)
  }
}

const writeFile: Tool = {
  name: 'write_file',
  description: '把内容写入工作区内的文件（覆盖已存在的文件，自动创建目录）。',
  sideEffect: 'write',
  schema: z.object({ path: z.string(), content: z.string() }),
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对工作区的文件路径' },
      content: { type: 'string', description: '要写入的完整文本内容' }
    },
    required: ['path', 'content']
  },
  async execute({ path: p, content }, ctx) {
    const abs = resolveInWorkspace(ctx.workspace, p)
    const before = await fs.readFile(abs, 'utf8').catch(() => '')
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, 'utf8')
    ctx.recordDiff?.(p, before, content)
    return `已写入 ${p}（${content.length} 字符）`
  }
}

const editFile: Tool = {
  name: 'edit_file',
  description:
    '对文件做精确字符串替换。old_string 必须在文件中唯一出现，否则报错。适合小范围修改。',
  sideEffect: 'write',
  schema: z.object({
    path: z.string(),
    old_string: z.string(),
    new_string: z.string(),
    replace_all: z.boolean().optional()
  }),
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对工作区的文件路径' },
      old_string: { type: 'string', description: '要被替换的原文本（默认需唯一）' },
      new_string: { type: 'string', description: '替换后的新文本' },
      replace_all: { type: 'boolean', description: '为 true 时替换所有出现处（不要求唯一）' }
    },
    required: ['path', 'old_string', 'new_string']
  },
  async execute({ path: p, old_string, new_string, replace_all }, ctx) {
    const abs = resolveInWorkspace(ctx.workspace, p)
    const content = await fs.readFile(abs, 'utf8')
    const occurrences = content.split(old_string).length - 1
    if (occurrences === 0) throw new Error('未找到要替换的 old_string')
    if (occurrences > 1 && !replace_all)
      throw new Error(
        `old_string 出现 ${occurrences} 次，不唯一；请提供更精确的上下文或设 replace_all=true`
      )
    const after = replace_all
      ? content.split(old_string).join(new_string)
      : content.replace(old_string, new_string)
    await fs.writeFile(abs, after, 'utf8')
    ctx.recordDiff?.(p, content, after)
    return replace_all ? `已编辑 ${p}（替换 ${occurrences} 处）` : `已编辑 ${p}`
  }
}

const listDir: Tool = {
  name: 'list_dir',
  description: '列出工作区内某个目录下的文件与子目录。',
  sideEffect: 'none',
  schema: z.object({ path: z.string().optional() }),
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '相对工作区的目录路径，默认为工作区根目录' }
    }
  },
  async execute({ path: p }, ctx) {
    const abs = resolveInWorkspace(ctx.workspace, p || '.')
    const entries = await fs.readdir(abs, { withFileTypes: true })
    if (!entries.length) return '(空目录)'
    return entries
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()))
      .map((e) => (e.isDirectory() ? `📁 ${e.name}/` : `📄 ${e.name}`))
      .join('\n')
  }
}

function globToRegExp(glob: string): RegExp {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '(?:.*/)?') // **/  → 任意层目录（含 0 层）
    .replace(/\*\*/g, '.*') // **   → 任意
    .replace(/\*/g, '[^/]*') // *    → 段内任意
    .replace(/\?/g, '[^/]')
  return new RegExp(`^${re}$`)
}

const glob: Tool = {
  name: 'glob',
  description:
    '按 glob 模式查找工作区内的文件路径（如 **/*.ts、src/**/*.tsx、package.json）。返回匹配的相对路径列表。比 list_dir 更适合"找某类文件"。',
  sideEffect: 'none',
  schema: z.object({ pattern: z.string() }),
  parameters: {
    type: 'object',
    properties: { pattern: { type: 'string', description: 'glob 模式，相对工作区' } },
    required: ['pattern']
  },
  async execute({ pattern }, ctx) {
    const re = globToRegExp(pattern)
    const out: string[] = []
    const walk = async (dir: string, rel: string): Promise<void> => {
      if (out.length >= 300) return
      let entries: import('node:fs').Dirent[]
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (out.length >= 300) return
        const childRel = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) await walk(path.join(dir, e.name), childRel)
        } else if (re.test(childRel)) {
          out.push(childRel)
        }
      }
    }
    await walk(resolveInWorkspace(ctx.workspace, '.'), '')
    return out.length ? out.sort().join('\n') : '无匹配'
  }
}

const grep: Tool = {
  name: 'grep',
  description: '在工作区内按正则递归搜索文件内容，返回匹配的 文件:行号:内容。',
  sideEffect: 'none',
  schema: z.object({ pattern: z.string(), path: z.string().optional() }),
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: '正则表达式' },
      path: { type: 'string', description: '搜索起点目录，默认为工作区根目录' }
    },
    required: ['pattern']
  },
  async execute({ pattern, path: p }, ctx) {
    const start = resolveInWorkspace(ctx.workspace, p || '.')
    const re = new RegExp(pattern)
    const results: string[] = []
    // 时间预算：防止模型给出灾难性回溯正则把主进程 CPU 顶死
    const deadline = Date.now() + 5_000
    let timedOut = false

    const walk = async (dir: string): Promise<void> => {
      if (results.length >= MAX_GREP_RESULTS || timedOut) return
      const entries = await fs.readdir(dir, { withFileTypes: true })
      for (const e of entries) {
        if (results.length >= MAX_GREP_RESULTS) return
        if (Date.now() > deadline) {
          timedOut = true
          return
        }
        if (e.isSymbolicLink()) continue // 不跟随符号链接，防止越出工作区读取外部文件
        const full = path.join(dir, e.name)
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) await walk(full)
          continue
        }
        try {
          const stat = await fs.stat(full)
          if (stat.size > 1_000_000) continue
          const lines = (await fs.readFile(full, 'utf8')).split('\n')
          lines.forEach((line, i) => {
            if (re.test(line) && results.length < MAX_GREP_RESULTS) {
              results.push(
                `${path.relative(ctx.workspace, full)}:${i + 1}: ${line.trim().slice(0, 200)}`
              )
            }
          })
        } catch {
          // 跳过二进制 / 无法读取的文件
        }
      }
    }

    const stat = await fs.stat(start)
    if (stat.isDirectory()) await walk(start)
    const note = timedOut ? '\n…（搜索超时，结果可能不完整；请用更精确的正则）' : ''
    return results.length ? results.join('\n') + note : timedOut ? '（搜索超时）' : '无匹配'
  }
}

const runCommand: Tool = {
  name: 'run_command',
  description: '在工作区目录下执行一条 shell 命令并返回输出（超时 60 秒）。',
  sideEffect: 'exec',
  schema: z.object({ command: z.string() }),
  parameters: {
    type: 'object',
    properties: { command: { type: 'string', description: '要执行的 shell 命令' } },
    required: ['command']
  },
  execute({ command }, ctx) {
    return new Promise<string>((resolve) => {
      exec(
        command,
        { cwd: ctx.workspace, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout, stderr) => {
          let out = ''
          if (stdout) out += stdout
          if (stderr) out += (out ? '\n' : '') + stderr
          // 给模型明确的成败信号，否则它分不清命令是否真的成功
          if (err) {
            const status = err.killed
              ? '[命令超过 60s 超时被终止]'
              : typeof err.code === 'number'
                ? `[退出码 ${err.code}]`
                : !stdout && !stderr
                  ? err.message
                  : ''
            if (status) out += (out ? '\n' : '') + status
          }
          resolve(truncate(out || '(无输出)', MAX_OUTPUT_CHARS))
        }
      )
    })
  }
}

async function assertPublicUrl(url: string): Promise<void> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new Error('URL 无效')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('仅支持 http/https URL')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.local')) throw new Error('禁止访问本地/内网地址')
  const addrs = net.isIP(host)
    ? [host]
    : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address)
  if (!addrs.length) throw new Error('无法解析主机')
  if (addrs.some(isPrivateIp)) throw new Error('禁止访问本地/内网地址')
}

// 手动跟随重定向，每一跳都重新做 SSRF 校验（防止 302 跳到 localhost / 云元数据）
async function safeFetch(url: string): Promise<Response> {
  let current = url
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicUrl(current)
    const res = await fetch(current, {
      signal: AbortSignal.timeout(15_000),
      redirect: 'manual'
    })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return res
      current = new URL(loc, current).toString() // 解析相对跳转
      continue
    }
    return res
  }
  throw new Error('重定向次数过多')
}

const fetchUrl: Tool = {
  name: 'fetch_url',
  description:
    '获取一个网页/URL 的文本内容（自动去除 HTML 标签，返回纯文本，截断）。用于查文档、读网页、取在线资料。',
  sideEffect: 'exec', // 联网请求，需用户授权
  schema: z.object({ url: z.string() }),
  parameters: {
    type: 'object',
    properties: { url: { type: 'string', description: '完整 URL（http/https）' } },
    required: ['url']
  },
  async execute({ url }) {
    const res = await safeFetch(url)
    if (!res.ok) throw new Error(`请求失败 (${res.status})`)
    const ct = res.headers.get('content-type') ?? ''
    // 流式读取并设 2MB 硬上限：防止超大/无限响应把主进程内存撑爆
    const MAX_BODY = 2 * 1024 * 1024
    let raw = ''
    if (res.body) {
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let bytes = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        raw += decoder.decode(value, { stream: true })
        if (bytes >= MAX_BODY) {
          void reader.cancel().catch(() => {})
          raw += '\n…（响应过大，已截断到 2MB）'
          break
        }
      }
    } else {
      raw = await res.text()
    }
    const text = /html/i.test(ct)
      ? raw
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : raw
    return truncate(text || '(无内容)', MAX_OUTPUT_CHARS)
  }
}

// 极简 HTML 解码 + 去标签（用于解析搜索结果片段）
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const webSearch: Tool = {
  name: 'web_search',
  description:
    '联网搜索（DuckDuckGo，免密钥）。输入关键词，返回若干条网页结果的标题/链接/摘要。需要最新信息或不知道具体网址时先用它搜，再用 fetch_url 读取感兴趣的链接。',
  sideEffect: 'exec', // 联网请求，需用户授权
  schema: z.object({
    query: z.string(),
    count: z.coerce.number().int().min(1).max(10).optional()
  }),
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词' },
      count: { type: 'number', description: '返回结果条数（1-10，默认 5）' }
    },
    required: ['query']
  },
  async execute({ query, count }) {
    const n = Math.min(Math.max(count ?? 5, 1), 10)
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; hemilier/0.1)' }
    })
    if (!res.ok) throw new Error(`搜索请求失败 (${res.status})`)
    const html = await res.text()

    // 解析结果：result__a 给标题+链接（DDG 跳转链需取 uddg 参数还原真实 URL），result__snippet 给摘要
    const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
    const snipRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
    const snippets: string[] = []
    let sm: RegExpExecArray | null
    while ((sm = snipRe.exec(html))) snippets.push(stripHtml(sm[1]))

    const out: string[] = []
    let lm: RegExpExecArray | null
    let i = 0
    while ((lm = linkRe.exec(html)) && out.length < n) {
      let href = lm[1]
      if (href.startsWith('//')) href = 'https:' + href
      try {
        const u = new URL(href)
        const real = u.searchParams.get('uddg')
        if (real) href = decodeURIComponent(real)
      } catch {
        /* 保持原样 */
      }
      const title = stripHtml(lm[2])
      const snippet = snippets[i] ?? ''
      out.push(`${out.length + 1}. ${title}\n   ${href}${snippet ? `\n   ${snippet}` : ''}`)
      i++
    }
    return out.length ? out.join('\n\n') : '未找到结果（换个关键词或稍后再试）。'
  }
}

const loadSkill: Tool = {
  name: 'load_skill',
  description:
    '加载某个技能（skill）的完整说明。当系统提示里列出的某个可用技能与当前任务相关时调用，以获取其详细操作指引。',
  sideEffect: 'none',
  schema: z.object({ name: z.string() }),
  parameters: {
    type: 'object',
    properties: { name: { type: 'string', description: '技能名称（见可用技能列表）' } },
    required: ['name']
  },
  async execute({ name }, ctx) {
    return skillManager.loadSkill(ctx.workspace, name, ctx.skillDirs ?? [])
  }
}

const updatePlan: Tool = {
  name: 'update_plan',
  description:
    '维护当前任务的执行计划（步骤清单）。开始多步骤任务时先用它列出步骤；每完成一步就把对应步骤标为 done，并把下一步标为 in_progress。',
  sideEffect: 'none',
  schema: z.object({
    steps: z.array(
      z.object({
        title: z.string(),
        status: z.enum(['pending', 'in_progress', 'done']).optional()
      })
    )
  }),
  parameters: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        description: '步骤清单',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: '步骤描述' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'done'],
              description: '步骤状态'
            }
          },
          required: ['title']
        }
      }
    },
    required: ['steps']
  },
  async execute({ steps }, ctx) {
    const normalized: PlanStep[] = (steps as { title: string; status?: PlanStep['status'] }[]).map(
      (s) => ({ title: s.title, status: s.status ?? 'pending' })
    )
    ctx.setPlan?.(normalized)
    return `计划已更新：\n${normalized
      .map((s) => `- [${s.status === 'done' ? 'x' : ' '}] ${s.title}（${s.status}）`)
      .join('\n')}`
  }
}

const addMemory: Tool = {
  name: 'add_memory',
  description:
    '把对当前项目长期有用的一条信息记入项目记忆（跨对话生效）。只记"下次必然有用"的稳定信息，一次一条、简洁。type 标明类别/置信度：fact(事实) / preference(用户偏好) / decision(决策) / pitfall(坑) / todo(待办)。记前可参考已注入的现有记忆，避免重复。',
  // 写盘且内容会注入未来对话的系统提示，必须经用户确认（防提示注入持久化）
  sideEffect: 'write',
  schema: z.object({
    text: z.string(),
    type: z.enum(['fact', 'preference', 'decision', 'pitfall', 'todo']).optional()
  }),
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '记忆内容（一句话）' },
      type: {
        type: 'string',
        enum: ['fact', 'preference', 'decision', 'pitfall', 'todo'],
        description: '类别/置信度'
      }
    },
    required: ['text']
  },
  async execute({ text, type }, ctx) {
    const source = ctx.conversationId
      ? (store.getConversation(ctx.conversationId)?.title ?? undefined)
      : undefined
    const e = await memory.add(ctx.workspace, text, type ?? 'fact', source)
    return `已记入记忆（${e.type}，id:${e.id.slice(0, 8)}）`
  }
}

const forgetMemory: Tool = {
  name: 'forget_memory',
  description:
    '删除一条过时/错误的项目记忆（按记忆条目的短 id 前缀）。当某条记忆已被证伪或不再适用时使用，避免错误记忆长期影响判断。',
  sideEffect: 'write',
  schema: z.object({ id: z.string().min(4, 'id 至少 4 个字符（防止误删全部记忆）') }),
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '记忆条目的 id（系统提示里括号中的短 id 即可）' }
    },
    required: ['id']
  },
  async execute({ id }, ctx) {
    await memory.forget(ctx.workspace, id)
    return `已删除记忆 ${id}`
  }
}

const saveSkill: Tool = {
  name: 'save_skill',
  description:
    '把一个可复用的操作流程沉淀为「技能」，写入工作区 .hemilier/skills/<name>/SKILL.md。当某类任务的做法已稳定、未来可能重复时使用；以后可用 load_skill 调用。body 写清触发场景与分步做法。',
  // 写盘且技能描述会注入未来对话的系统提示，必须经用户确认（防提示注入持久化）
  sideEffect: 'write',
  schema: z.object({ name: z.string(), description: z.string(), body: z.string() }),
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '技能名（简短）' },
      description: { type: 'string', description: '一句话说明何时用这个技能' },
      body: { type: 'string', description: '技能正文（Markdown）：触发场景 + 分步操作' }
    },
    required: ['name', 'description', 'body']
  },
  async execute({ name, description, body }, ctx) {
    const slug =
      name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9一-龥]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'skill'
    const dir = path.join(ctx.workspace, '.hemilier', 'skills', slug)
    await fs.mkdir(dir, { recursive: true })
    // name/description 都清洗换行，防止 frontmatter 行注入
    const safeName = name.replace(/[\r\n]+/g, ' ').trim()
    const md = `---\nname: ${safeName}\ndescription: ${description.replace(/[\r\n]+/g, ' ')}\n---\n\n${body}\n`
    await fs.writeFile(path.join(dir, 'SKILL.md'), md, 'utf8')
    return `已沉淀技能：${name}（.hemilier/skills/${slug}/SKILL.md），以后可用 load_skill 调用`
  }
}

const recall: Tool = {
  name: 'recall',
  description:
    '在你过去所有对话里按关键词检索（跨 session 的历史召回）。当用户提到"之前/上次/我们讨论过"，或你需要过去的背景/决策时使用；返回最相关的历史片段。',
  sideEffect: 'none',
  schema: z.object({ query: z.string() }),
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: '检索关键词（可多个，空格分隔）' } },
    required: ['query']
  },
  async execute({ query }, ctx) {
    return store.searchHistory(query, ctx.conversationId)
  }
}

const ALL: Tool[] = [
  readFile,
  writeFile,
  editFile,
  listDir,
  glob,
  grep,
  runCommand,
  fetchUrl,
  webSearch,
  loadSkill,
  updatePlan,
  addMemory,
  forgetMemory,
  recall,
  saveSkill
]
const REGISTRY = new Map(ALL.map((t) => [t.name, t]))

// 模型常把工具叫成别的名字（尤其能力较弱的模型）；做高置信度归一化，减少“未知工具”失败
const ALIASES: Record<string, string> = {
  bash: 'run_command',
  sh: 'run_command',
  zsh: 'run_command',
  shell: 'run_command',
  terminal: 'run_command',
  exec: 'run_command',
  execute: 'run_command',
  cmd: 'run_command',
  command: 'run_command',
  run_shell: 'run_command',
  shell_command: 'run_command',
  cat: 'read_file',
  read: 'read_file',
  open_file: 'read_file',
  view_file: 'read_file',
  ls: 'list_dir',
  dir: 'list_dir',
  list_directory: 'list_dir',
  create_file: 'write_file',
  save_file: 'write_file',
  str_replace: 'edit_file',
  replace_in_file: 'edit_file',
  apply_patch: 'edit_file',
  websearch: 'web_search',
  search_web: 'web_search',
  fetch: 'fetch_url',
  http_get: 'fetch_url',
  open_url: 'fetch_url',
  find_files: 'glob',
  search_code: 'grep',
  ripgrep: 'grep'
}

export function getTool(name: string): Tool | undefined {
  const lower = (name ?? '').toLowerCase()
  return REGISTRY.get(name) ?? REGISTRY.get(lower) ?? REGISTRY.get(ALIASES[lower] ?? '')
}

/** 当前内置工具名列表（用于“未知工具”时提示模型可用项） */
export function toolNames(): string[] {
  return ALL.map((t) => t.name)
}

export function listToolDefs(readOnlyOnly = false): ToolDef[] {
  return ALL.filter((t) => !readOnlyOnly || t.sideEffect === 'none').map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters
  }))
}

export { isDangerousCommand }

export function describeTool(tool: Tool, args: Record<string, unknown>): string {
  if (tool.name === 'run_command') {
    const cmd = String(args.command ?? '')
    return (isDangerousCommand(cmd) ? '⚠️ 危险命令 · ' : '') + `执行命令：${cmd}`
  }
  if (tool.name === 'web_search') return `联网搜索：${String(args.query)}`
  if (tool.name === 'fetch_url') return `读取网页：${String(args.url)}`
  if (tool.name === 'add_memory') return `写入项目记忆：${String(args.text ?? '')}`
  if (tool.name === 'forget_memory') return `删除项目记忆：${String(args.id ?? '')}`
  if (tool.name === 'save_skill') return `沉淀技能：${String(args.name ?? '')}`
  if (tool.sideEffect === 'write' && args.path != null) return `${tool.name} → ${String(args.path)}`
  return tool.name
}
