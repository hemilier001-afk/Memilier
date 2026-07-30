import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseFrontmatter, stripFrontmatter } from '../../skills/frontmatter'

// 子 agent（subagent）定义：对齐 Claude 的 .claude/agents/*.md。
// 每个定义 = frontmatter(name/description/tools/model) + 正文(system prompt)。
// 主 agent 用 spawn_agent 按 name 派生一个专注的子 agent；子 agent 有独立上下文、
// 自己的工具白名单与（可选）模型，做完把最终报告返回主 agent。

export interface AgentDef {
  name: string
  description: string
  /** 允许的工具名（逗号分隔解析成数组）；'*' 或空 = 全部（内置，除派生类工具外） */
  tools?: string[]
  /** 覆盖模型（<provider>::<model> 或裸名）；空 = 沿用主对话模型 */
  model?: string
  /** system prompt 正文 */
  prompt: string
  source: 'builtin' | 'workspace' | 'global' | 'plugin'
}

// 内置子 agent 类型：开箱即用的常用角色（用户可在 .hemilier/agents/ 覆盖或新增）
const BUILTIN: AgentDef[] = [
  {
    name: 'explore',
    description:
      '只读代码库调研员：在大量文件里搜索、定位、梳理，返回结论而不改动任何东西。需要"先摸清代码在哪、怎么组织的"时派它，尤其适合多个并行探查。',
    tools: ['read_file', 'list_dir', 'glob', 'grep', 'recall', 'fetch_url', 'web_search'],
    prompt:
      '你是只读调研子 agent。你的职责是**只读地**搜索与理解，不修改任何文件、不执行有副作用的命令。用 grep/glob/list_dir/read_file 定位相关代码，读懂后向主 agent 返回一份**结论性**报告：涉及的关键文件与行号、组织方式、以及对所问问题的直接回答。不要罗列无关细节。',
    source: 'builtin'
  },
  {
    name: 'code',
    description:
      '实现型子 agent：拿到明确的编码子任务后，读相关文件、做修改、必要时跑命令验证，返回改了什么。适合把一个大任务拆成的可独立完成的实现片段。',
    prompt:
      '你是实现型子 agent。专注完成分配给你的这一个编码子任务：先 read_file 看真实内容，再用 edit_file/write_file 精确修改，需要时用 run_command 验证。写文件/执行命令仍会请求用户授权。完成后向主 agent 简洁报告：改了哪些文件、做了什么、验证结果。',
    source: 'builtin'
  },
  {
    name: 'review',
    description:
      '代码审查子 agent：只读地审查改动或某段代码，找 bug、边界问题、可简化处，返回分级发现清单。不修改代码。',
    tools: ['read_file', 'list_dir', 'glob', 'grep'],
    prompt:
      '你是代码审查子 agent。只读地审查指定的改动或文件，找出正确性 bug、边界/并发问题、明显可简化或重复之处。返回一份按严重度排序的发现清单，每条给出文件:行号 + 问题 + 建议。不修改任何文件。',
    source: 'builtin'
  }
]

function parseTools(raw?: string): string[] | undefined {
  if (!raw || raw.trim() === '*' || raw.trim().toLowerCase() === 'all') return undefined
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

async function scanDir(dir: string, source: AgentDef['source']): Promise<AgentDef[]> {
  const out: AgentDef[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue
    const file = path.join(dir, e.name)
    try {
      const raw = await fs.readFile(file, 'utf8')
      const fm = parseFrontmatter(raw)
      const name = fm.name || e.name.replace(/\.md$/, '')
      out.push({
        name,
        description: fm.description || '',
        tools: parseTools(fm.tools),
        model: fm.model || undefined,
        prompt: stripFrontmatter(raw).trim(),
        source
      })
    } catch {
      /* 跳过读取失败的定义 */
    }
  }
  return out
}

export const agentManager = {
  globalDir(): string {
    // 惰性取 electron.app：单测在纯 Node 环境跑（无 Electron 主进程），退回临时目录
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { app } = require('electron') as typeof import('electron')
      return path.join(app.getPath('userData'), 'agents')
    } catch {
      return path.join(os.tmpdir(), 'hemilier-agents')
    }
  },
  workspaceDir(workspace: string): string {
    return path.join(workspace, '.hemilier', 'agents')
  },

  /** 汇总内置 + 插件 + 全局 + 工作区（同名以 工作区 > 全局 > 插件 > 内置 为准） */
  async list(workspace: string, pluginDirs: string[] = []): Promise<AgentDef[]> {
    const ws = await scanDir(this.workspaceDir(workspace), 'workspace')
    const gl = await scanDir(this.globalDir(), 'global')
    // 插件带来的角色：插件此前只能带 MCP+技能，现在也能带子 agent 定义
    const pl: AgentDef[] = []
    for (const d of pluginDirs) pl.push(...(await scanDir(d, 'plugin')))
    const merged = new Map<string, AgentDef>()
    for (const a of BUILTIN) merged.set(a.name, a)
    for (const a of pl) merged.set(a.name, a)
    for (const a of gl) merged.set(a.name, a)
    for (const a of ws) merged.set(a.name, a) // 工作区优先级最高
    return [...merged.values()]
  },

  async get(
    workspace: string,
    name: string,
    pluginDirs: string[] = []
  ): Promise<AgentDef | undefined> {
    return (await this.list(workspace, pluginDirs)).find((a) => a.name === name)
  },

  /** 保存自定义子 agent 为 .md（frontmatter + 正文）。scope=workspace 随项目走，global 跨项目。 */
  async save(
    workspace: string,
    scope: 'workspace' | 'global',
    def: { name: string; description: string; tools?: string; model?: string; prompt: string }
  ): Promise<void> {
    const name = def.name.trim()
    // 文件名即 agent 名：限制字符集，防路径穿越与非法文件名
    if (!/^[A-Za-z0-9_\u4e00-\u9fff-]{1,40}$/.test(name)) {
      throw new Error('名称只能用中英文、数字、下划线、连字符（1-40 字）')
    }
    if (!def.prompt.trim()) throw new Error('系统提示（正文）不能为空')
    const dir = scope === 'global' ? this.globalDir() : this.workspaceDir(workspace)
    await fs.mkdir(dir, { recursive: true })
    const fm = [
      '---',
      `name: ${name}`,
      `description: ${def.description.trim().replace(/\n/g, ' ')}`,
      ...(def.tools?.trim() ? [`tools: ${def.tools.trim()}`] : []),
      ...(def.model?.trim() ? [`model: ${def.model.trim()}`] : []),
      '---',
      ''
    ].join('\n')
    await fs.writeFile(path.join(dir, `${name}.md`), fm + def.prompt.trim() + '\n', 'utf8')
  },

  /** 删除自定义子 agent（内置的删不掉——文件不存在，如实报错） */
  async remove(workspace: string, scope: 'workspace' | 'global', name: string): Promise<void> {
    if (!/^[A-Za-z0-9_\u4e00-\u9fff-]{1,40}$/.test(name)) throw new Error('名称不合法')
    const dir = scope === 'global' ? this.globalDir() : this.workspaceDir(workspace)
    await fs.rm(path.join(dir, `${name}.md`), { force: true })
  },

  /** 读取某个自定义 agent 的原始字段（供编辑界面回填；内置的返回其定义但不可保存到原处） */
  async raw(workspace: string, name: string): Promise<AgentDef | undefined> {
    return this.get(workspace, name)
  }
}
