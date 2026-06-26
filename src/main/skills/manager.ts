import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { parseFrontmatter, stripFrontmatter } from './frontmatter'

export interface SkillMeta {
  name: string
  description: string
  source: 'global' | 'workspace' | 'plugin'
  file: string
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

  /** 汇总全局 + 工作区 + 插件提供的技能（同名以先出现者为准） */
  async listSkills(workspace: string, pluginDirs: string[] = []): Promise<SkillMeta[]> {
    const sources: { dir: string; src: SkillMeta['source'] }[] = [
      { dir: this.workspaceSkillDir(workspace), src: 'workspace' },
      { dir: this.globalDir(), src: 'global' },
      ...pluginDirs.map((d) => ({ dir: d, src: 'plugin' as const }))
    ]
    const all: SkillMeta[] = []
    const seen = new Set<string>()
    for (const { dir, src } of sources) {
      for (const skill of await scanDir(dir, src)) {
        if (seen.has(skill.name)) continue
        seen.add(skill.name)
        all.push(skill)
      }
    }
    return all
  },

  /** 返回某个技能去除 frontmatter 后的完整正文 */
  async loadSkill(workspace: string, name: string, pluginDirs: string[] = []): Promise<string> {
    const skill = (await this.listSkills(workspace, pluginDirs)).find((s) => s.name === name)
    if (!skill) throw new Error(`未找到技能：${name}`)
    return stripFrontmatter(await fs.readFile(skill.file, 'utf8'))
  }
}
