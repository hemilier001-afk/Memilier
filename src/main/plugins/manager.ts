import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { McpServerConfig } from '@shared/types'
import { CATALOG, type CatalogPlugin } from './catalog'

export interface PluginMeta {
  name: string
  description: string
  dir: string
  enabled: boolean
  mcpServers: Record<string, McpServerConfig>
  /** 解析出的技能目录（若插件提供 skills 子目录） */
  skillDirs: string[]
}

function pluginsDir(): string {
  const dir = path.join(app.getPath('userData'), 'plugins')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function statePath(): string {
  return path.join(app.getPath('userData'), 'plugins-state.json')
}

function readState(): Record<string, boolean> {
  try {
    return JSON.parse(readFileSync(statePath(), 'utf8'))
  } catch {
    return {}
  }
}

function writeState(state: Record<string, boolean>): void {
  const file = statePath()
  const tmp = `${file}.tmp` // 原子写，避免写入中途崩溃损坏
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  renameSync(tmp, file)
}

/**
 * 扫描 plugins 目录。每个插件是一个子文件夹，内含 plugin.json：
 * { name, description?, mcpServers?: {...}, skills?: "技能子目录名（默认 skills）" }
 */
function readPlugins(): PluginMeta[] {
  const base = pluginsDir()
  const state = readState()
  const out: PluginMeta[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(base, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const dir = path.join(base, e.name)
    const manifestPath = path.join(dir, 'plugin.json')
    if (!existsSync(manifestPath)) continue
    let manifest: {
      name?: string
      description?: string
      mcpServers?: Record<string, McpServerConfig>
      skills?: string
    }
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch {
      continue
    }
    const name = manifest.name || e.name
    const skillDir = path.join(dir, manifest.skills || 'skills')
    out.push({
      name,
      description: manifest.description || '',
      dir,
      enabled: state[name] !== false,
      mcpServers: manifest.mcpServers || {},
      skillDirs: existsSync(skillDir) ? [skillDir] : []
    })
  }
  return out
}

export const pluginManager = {
  dir: pluginsDir,
  listPlugins(): PluginMeta[] {
    return readPlugins()
  },
  activePlugins(): PluginMeta[] {
    return readPlugins().filter((p) => p.enabled)
  },
  setEnabled(name: string, enabled: boolean): void {
    const state = readState()
    state[name] = enabled
    writeState(state)
  },
  /** 插件市场目录（含是否已安装标记） */
  catalog(): (CatalogPlugin & { installed: boolean })[] {
    return CATALOG.map((c) => ({
      ...c,
      installed: existsSync(path.join(pluginsDir(), c.id))
    }))
  },
  /** 从内置市场一键安装：写入 plugin.json + skills/<id>/SKILL.md */
  installFromCatalog(id: string): { ok: boolean; name?: string; error?: string } {
    const entry = CATALOG.find((c) => c.id === id)
    if (!entry) return { ok: false, error: '未知插件' }
    const dir = path.join(pluginsDir(), entry.id)
    if (existsSync(dir)) return { ok: false, error: '已安装' }
    try {
      const skillDir = path.join(dir, 'skills', entry.id)
      mkdirSync(skillDir, { recursive: true })
      writeFileSync(
        path.join(dir, 'plugin.json'),
        JSON.stringify(
          { name: entry.name, description: entry.description, skills: 'skills' },
          null,
          2
        )
      )
      const md = `---\nname: ${entry.id}\ndescription: ${entry.skill.description}\n---\n\n${entry.skill.body}\n`
      writeFileSync(path.join(skillDir, 'SKILL.md'), md)
      return { ok: true, name: entry.name }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '写入失败' }
    }
  },
  /** 卸载插件（删除其目录） */
  uninstall(idOrName: string): void {
    const state = readState()
    // 目录名可能是 catalog id，也可能是手动安装时的文件夹名
    for (const dirName of [idOrName]) {
      const dir = path.join(pluginsDir(), dirName)
      if (existsSync(dir)) {
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {
          /* 忽略 */
        }
      }
    }
    delete state[idOrName]
    writeState(state)
  },
  /** 从文件夹安装插件：校验 plugin.json 后整目录拷贝进 plugins 目录 */
  installFromDir(src: string): { ok: boolean; name?: string; error?: string } {
    const manifestPath = path.join(src, 'plugin.json')
    if (!existsSync(manifestPath)) return { ok: false, error: '所选文件夹缺少 plugin.json' }
    let manifest: { name?: string }
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch {
      return { ok: false, error: 'plugin.json 解析失败（不是合法 JSON）' }
    }
    const folder = manifest.name || path.basename(src)
    const dest = path.join(pluginsDir(), folder)
    if (existsSync(dest)) return { ok: false, error: `插件「${folder}」已存在` }
    try {
      cpSync(src, dest, { recursive: true })
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '拷贝失败' }
    }
    return { ok: true, name: folder }
  },
  /** 合并启用插件的 MCP server（按 <插件名>_<键> 命名以避免冲突） */
  mcpServers(plugins: PluginMeta[]): Record<string, McpServerConfig> {
    const merged: Record<string, McpServerConfig> = {}
    for (const p of plugins) {
      for (const [key, cfg] of Object.entries(p.mcpServers)) {
        merged[`${p.name}_${key}`] = cfg
      }
    }
    return merged
  }
}
