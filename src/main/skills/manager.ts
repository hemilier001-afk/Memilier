import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { parseFrontmatter, stripFrontmatter } from './frontmatter'
import { BUILTIN_SKILLS } from './builtin'

export interface SkillMeta {
  name: string
  description: string
  source: 'global' | 'workspace' | 'plugin' | 'builtin'
  /** 磁盘技能的文件路径；内置技能没有文件（正文见 body） */
  file?: string
  /** 内置技能的正文（免磁盘读取） */
  body?: string
}

/** 扫描一个目录：支持 <skill>/SKILL.md 或顶层 <name>.md 两种形式 */
async function scanDir(dir: string, source: SkillMeta['source']): Promise<SkillMeta[]> {
  const out: SkillMeta[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    let file: string | null = null
    if (e.isDirectory()) {
      const candidate = path.join(dir, e.name, 'SKILL.md')
      try {
        await fs.access(candidate)
        file = candidate
      } catch {
        /* 该目录没有 SKILL.md，跳过 */
      }
    } else if (e.isFile() && e.name.endsWith('.md')) {
      file = path.join(dir, e.name)
    }
    if (!file) continue
    try {
      const fm = parseFrontmatter(await fs.readFile(file, 'utf8'))
      const name = fm.name || (e.isDirectory() ? e.name : e.name.replace(/\.md$/, ''))
      out.push({ name, description: fm.description || '', source, file })
    } catch {
      /* 读取失败则跳过 */
    }
  }
  return out
}

export const skillManager = {
  globalDir(): string {
    return path.join(app.getPath('userData'), 'skills')
  },
  workspaceSkillDir(workspace: string): string {
    return path.join(workspace, '.hemilier', 'skills')
  },

  /** 汇总 工作区 > 全局 > 内置 > 插件 的技能（同名以先出现者为准）。
   *  内置排在插件之前：用户早先从市场装过的同名旧副本不会盖掉随版本更新的内置说明书；
   *  但工作区/全局的自定义技能仍可覆盖内置（那是用户明确的意图）。 */
  async listSkills(workspace: string, pluginDirs: string[] = []): Promise<SkillMeta[]> {
    const all: SkillMeta[] = []
    const seen = new Set<string>()
    const push = (skill: SkillMeta): void => {
      if (seen.has(skill.name)) return
      seen.add(skill.name)
      all.push(skill)
    }

    for (const { dir, src } of [
      { dir: this.workspaceSkillDir(workspace), src: 'workspace' as const },
      { dir: this.globalDir(), src: 'global' as const }
    ]) {
      for (const skill of await scanDir(dir, src)) push(skill)
    }
    // 内置技能：随应用发布，全新安装（尤其 Windows）开箱即有，不依赖用户手动安装
    for (const b of BUILTIN_SKILLS) {
      push({ name: b.name, description: b.description, source: 'builtin', body: b.body })
    }
    for (const dir of pluginDirs) {
      for (const skill of await scanDir(dir, 'plugin')) push(skill)
    }
    return all
  },

  /** 返回某个技能去除 frontmatter 后的完整正文 */
  async loadSkill(workspace: string, name: string, pluginDirs: string[] = []): Promise<string> {
    const skill = (await this.listSkills(workspace, pluginDirs)).find((s) => s.name === name)
    if (!skill) throw new Error(`未找到技能：${name}`)
    if (skill.body != null) return skill.body // 内置技能：正文在代码里，无需读盘
    return stripFrontmatter(await fs.readFile(skill.file!, 'utf8'))
  }
}
