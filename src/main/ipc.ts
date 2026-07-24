import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { existsSync, statSync, promises as fsp } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { app, BrowserWindow, clipboard, dialog, ipcMain, session, shell } from 'electron'
import type {
  AgentEvent,
  Conversation,
  FsEntry,
  GitFile,
  GitStatus,
  MemoryType,
  PermissionRequest,
  Settings,
  ApprovalMode
} from '@shared/types'

/** 在工作区跑一条 git 命令（core.quotepath=false：中文等非 ASCII 文件名按原样输出，不做八进制转义） */
function git(
  cwd: string,
  args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const fullArgs = ['-c', 'core.quotepath=false', ...args]
  return new Promise((resolve) => {
    execFile('git', fullArgs, { cwd, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code =
        err && typeof (err as NodeJS.ErrnoException).code === 'number'
          ? ((err as unknown as { code: number }).code ?? 1)
          : err
            ? 1
            : 0
      resolve({ code, stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' })
    })
  })
}

function parseGitStatus(out: string): { branch: string; files: GitFile[] } {
  const lines = out.split('\n').filter(Boolean)
  let branch = ''
  const files: GitFile[] = []
  for (const line of lines) {
    if (line.startsWith('## ')) {
      const head = line.slice(3)
      if (head.startsWith('No commits yet on ')) branch = head.slice('No commits yet on '.length)
      else branch = head.split('...')[0].split(' ')[0]
      continue
    }
    const x = line[0]
    const y = line[1]
    let path = line.slice(3)
    if (path.includes(' -> ')) path = path.split(' -> ')[1]
    files.push({ path, x, y, staged: x !== ' ' && x !== '?' })
  }
  return { branch, files }
}
import { runAgent } from './agent/loop'
import { PermissionManager } from './agent/permission'
import { imageStore } from './images'
import { mcpManager, mcpSignature } from './mcp/manager'
import { MCP_CATALOG } from './mcp/catalog'
import { searchRegistry } from './mcp/registry'
import type { McpSearchResult } from '@shared/types'
import { pluginManager } from './plugins/manager'
import { skillManager } from './skills/manager'
import { agentManager } from './agent/agents/manager'
import { memory } from './memory'
import { randomUUID } from 'node:crypto'
import { bareModel, listAllModels, resolveProvider } from './providers/registry'
import { routineManager } from './routines/manager'
import { resolveInWorkspace } from './security'
import { store } from './store'
import { netFetch } from './providers/netfetch'
import { auditPath, listAudit } from './audit'
import { extractAny, isOfficeFile } from './office/extract'

/** 按设置应用网络代理：空=跟随系统代理（多数国内代理软件会设系统代理）；填了=固定服务器 */
function applyProxy(url?: string): void {
  const rules = (url ?? '').trim()
  void session.defaultSession.setProxy(rules ? { proxyRules: rules } : { mode: 'system' })
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const sendToRenderer = (channel: string, payload: unknown): void => {
    getWindow()?.webContents.send(channel, payload)
  }
  applyProxy(store.getSettings().proxyUrl) // 启动即应用代理
  const permission = new PermissionManager(
    (req: PermissionRequest) => sendToRenderer('permission:request', req),
    () => store.getSettings()
  )

  const aborters = new Map<string, AbortController>()
  // 每个会话正在进行的运行（声明在前，供 delete 等 handler 引用；赋值逻辑见下方 runConversation）
  const running = new Map<string, Promise<void>>()

  ipcMain.handle('ollama:listModels', () => listAllModels(store.getSettings()))

  // API Key 不出主进程：发给渲染端时统一掩码；渲染端回传掩码时还原为已存的真实 Key。
  // 这样即使渲染进程被攻破也拿不到明文密钥（safeStorage 只保护落盘，这里保护运行时）。
  const KEY_MASK = '••••••••'
  const maskSettings = (s: Settings): Settings => ({
    ...s,
    providers: (s.providers ?? []).map((p) => ({ ...p, apiKey: p.apiKey ? KEY_MASK : '' }))
  })
  ipcMain.handle('settings:get', () => maskSettings(store.getSettings()))
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    if (patch.providers) {
      const current = store.getSettings().providers ?? []
      patch = {
        ...patch,
        providers: patch.providers.map((p) =>
          p.apiKey === KEY_MASK
            ? { ...p, apiKey: current.find((c) => c.id === p.id)?.apiKey ?? '' }
            : p
        )
      }
    }
    const saved = store.setSettings(patch)
    if ('proxyUrl' in patch) applyProxy(saved.proxyUrl)
    return maskSettings(saved)
  })

  // 列表只回轻量摘要（不带 messages）：侧栏只需标题/时间等，避免整库消息反复过 IPC
  ipcMain.handle('conversations:list', () =>
    store.listConversations().map((c) => ({ ...c, messages: [] }))
  )
  ipcMain.handle('conversations:get', (_e, id: string) => store.getConversation(id))
  ipcMain.handle('conversations:search', (_e, q: string) => store.searchConversations(q))
  ipcMain.handle('data:export', async () => {
    const win = getWindow()
    const res = await dialog.showSaveDialog(win ?? undefined!, {
      title: '导出备份',
      defaultPath: `hemilier-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false }
    await fsp.writeFile(res.filePath, JSON.stringify(store.exportAll(), null, 2), 'utf8')
    return { ok: true, path: res.filePath }
  })
  ipcMain.handle('data:import', async () => {
    const win = getWindow()
    const res = await dialog.showOpenDialog(win ?? undefined!, {
      title: '导入备份',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePaths[0]) return { ok: false }
    try {
      const data = JSON.parse(await fsp.readFile(res.filePaths[0], 'utf8'))
      const r = store.importAll(data)
      sendToRenderer('conversations:updated', null)
      return { ok: true, ...r }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle(
    'conversations:create',
    (_e, kind: 'chat' | 'cowork' | 'code' = 'chat', projectId?: string) =>
      store.createConversation(kind, projectId)
  )
  ipcMain.handle('conversations:setProject', (_e, id: string, projectId: string | null) =>
    store.setConversationProject(id, projectId)
  )
  ipcMain.handle('projects:list', () => store.listProjects())
  ipcMain.handle('projects:create', (_e, name: string, kind: 'chat' | 'cowork' | 'code') =>
    store.createProject(name, kind)
  )
  ipcMain.handle('projects:rename', (_e, id: string, name: string) => store.renameProject(id, name))
  ipcMain.handle('projects:delete', (_e, id: string) => store.deleteProject(id))
  ipcMain.handle('conversations:delete', async (_e, id: string) => {
    // 若该会话正在运行，先中止并等其收尾，避免在跑的循环把刚删的会话重新写回（“诈尸”）
    aborters.get(id)?.abort()
    await running.get(id)?.catch(() => {})
    store.deleteConversation(id)
    imageStore.deleteConversation(id) // 一并清理该会话的图片文件
  })
  ipcMain.handle('images:read', (_e, ref: string) => imageStore.resolve(ref))
  // 原生剪贴板（比 navigator.clipboard 在 Electron 沙箱下更可靠）
  ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(text))
  ipcMain.handle('conversations:rename', (_e, id: string, title: string) =>
    store.renameConversation(id, title)
  )
  ipcMain.handle('conversations:setModel', (_e, id: string, model: string) =>
    store.setConversationModel(id, model)
  )
  ipcMain.handle('conversations:setMode', (_e, id: string, mode: 'auto' | 'plan' | 'chat') =>
    store.setConversationMode(id, mode)
  )
  ipcMain.handle('conversations:setApproval', (_e, id: string, mode: ApprovalMode) =>
    store.setConversationApproval(id, mode)
  )
  ipcMain.handle('audit:list', (_e, limit?: number) => listAudit(limit ?? 200))
  ipcMain.handle('audit:open', () => shell.showItemInFolder(auditPath()))
  ipcMain.handle('conversations:setWorkspace', (_e, id: string, dir: string) =>
    store.setConversationWorkspace(id, dir)
  )

  ipcMain.handle('dialog:pickWorkspace', async () => {
    const win = getWindow()
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })

  // 选择任意本地文件，读入文本作为对话上下文（截断 100k）
  ipcMain.handle('dialog:pickFile', async () => {
    const win = getWindow()
    const opts = { properties: ['openFile' as const] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    const fp = res.filePaths[0]
    // 旧版二进制格式没有解析器：给明确指引而不是把二进制按 utf8 读成乱码
    if (/\.(doc|xls|ppt)$/i.test(fp)) {
      return {
        name: basename(fp),
        content:
          '（旧版二进制格式（.doc/.xls/.ppt）不支持：请先在 Office/WPS 里另存为 .docx/.xlsx/.pptx 再上传）'
      }
    }
    try {
      // Office/PDF 附件：先提取纯文本再入对话（否则二进制读出来是乱码）
      const raw = isOfficeFile(fp)
        ? await extractAny(fp, await fsp.readFile(fp))
        : await fsp.readFile(fp, 'utf8')
      const content = raw.length > 100_000 ? `${raw.slice(0, 100_000)}\n…（已截断）` : raw
      return { name: basename(fp), content }
    } catch (e) {
      return { name: basename(fp), content: `（无法读取：${String(e)}）` }
    }
  })
  // 右栏预览 / 渲染端按需提取（工作区内文件）
  ipcMain.handle('office:extract', async (_e, ws: string, rel: string) => {
    const abs = resolveInWorkspace(ws, rel)
    return await extractAny(rel, await fsp.readFile(abs))
  })
  // 拖拽附件（绝对路径来自用户亲手拖入的文件，等同 pickFile 的用户授权语义）
  ipcMain.handle('office:extractPath', async (_e, absPath: string) => {
    const st = statSync(absPath)
    if (!st.isFile()) throw new Error('不是文件')
    return await extractAny(absPath, await fsp.readFile(absPath))
  })

  // 选择本地图片，读成 data URL（供视觉模型）
  ipcMain.handle('dialog:pickImage', async () => {
    const win = getWindow()
    const opts = {
      properties: ['openFile' as const],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    const fp = res.filePaths[0]
    const ext = (fp.split('.').pop() || 'png').toLowerCase()
    const mime = ext === 'jpg' ? 'jpeg' : ext
    const buf = await fsp.readFile(fp)
    return {
      name: basename(fp),
      dataUrl: `data:image/${mime};base64,${buf.toString('base64')}`
    }
  })

  ipcMain.handle('permission:respond', (_e, id: string, approved: boolean, remember: boolean) =>
    permission.respond(id, approved, remember)
  )

  ipcMain.handle('workspace:readDir', async (_e, workspaceDir: string, relPath: string) => {
    const abs = resolveInWorkspace(workspaceDir, relPath || '.')
    const entries = await fsp.readdir(abs, { withFileTypes: true })
    return entries
      .map((e): FsEntry => ({ name: e.name, isDir: e.isDirectory() }))
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
  })

  ipcMain.handle('workspace:readFile', async (_e, workspaceDir: string, relPath: string) => {
    const abs = resolveInWorkspace(workspaceDir, relPath)
    const content = await fsp.readFile(abs, 'utf8')
    return content.length > 200_000 ? `${content.slice(0, 200_000)}\n…（已截断）` : content
  })

  // 应用内编辑器：把内容写回工作区文件（沙箱内，自动建父目录）
  ipcMain.handle(
    'workspace:writeFile',
    async (_e, workspaceDir: string, relPath: string, content: string) => {
      const abs = resolveInWorkspace(workspaceDir, relPath)
      await fsp.mkdir(dirname(abs), { recursive: true })
      await fsp.writeFile(abs, content, 'utf8')
    }
  )

  // 工作区文件平铺列表（供 @ 引用），跳过常见大目录，最多 800 条
  ipcMain.handle('workspace:listFiles', async (_e, workspaceDir: string) => {
    const skip = new Set(['node_modules', '.git', 'out', 'dist', '.next', 'build', '.hemilier'])
    const out: string[] = []
    const walk = async (rel: string): Promise<void> => {
      if (out.length >= 800) return
      let entries: import('node:fs').Dirent[]
      try {
        entries = await fsp.readdir(resolveInWorkspace(workspaceDir, rel || '.'), {
          withFileTypes: true
        })
      } catch {
        return
      }
      for (const e of entries) {
        if (out.length >= 800) return
        const childRel = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) {
          if (!skip.has(e.name) && !e.name.startsWith('.')) await walk(childRel)
        } else {
          out.push(childRel)
        }
      }
    }
    await walk('')
    return out.sort()
  })

  // ——— Git 集成 ———
  ipcMain.handle('git:status', async (_e, ws: string): Promise<GitStatus> => {
    const probe = await git(ws, ['rev-parse', '--is-inside-work-tree'])
    if (probe.code !== 0) return { isRepo: false, branch: '', files: [] }
    const r = await git(ws, ['status', '--porcelain=v1', '-b'])
    return { isRepo: true, ...parseGitStatus(r.stdout) }
  })
  ipcMain.handle('git:diff', async (_e, ws: string, path: string, staged: boolean) => {
    const args = staged ? ['diff', '--cached', '--', path] : ['diff', '--', path]
    const r = await git(ws, args)
    return r.stdout || ''
  })
  ipcMain.handle('git:stage', async (_e, ws: string, path: string) => {
    await git(ws, ['add', '--', path])
  })
  ipcMain.handle('git:unstage', async (_e, ws: string, path: string) => {
    await git(ws, ['restore', '--staged', '--', path])
  })
  ipcMain.handle('git:commit', async (_e, ws: string, message: string) => {
    const r = await git(ws, ['commit', '-m', message])
    return { ok: r.code === 0, message: (r.stdout + r.stderr).trim() }
  })
  ipcMain.handle('git:init', async (_e, ws: string) => {
    await git(ws, ['init'])
  })

  // ——— 项目记忆（治理：类型/来源/时间/可删除） ———
  ipcMain.handle('memory:list', (_e, ws: string) => memory.listAll(ws))
  ipcMain.handle('memory:resolvePending', (_e, ws: string, id: string, adopt: boolean) =>
    memory.resolvePending(ws, id, adopt)
  )
  // 记忆整理：让模型通读某一层的全部条目，产出合并/去重/修订后的新列表（仅提案，确认后 apply）
  ipcMain.handle('memory:consolidate', async (_e, ws: string, scope: 'global' | 'project') => {
    const entries = await memory.list(ws, scope)
    if (entries.length < 2) return { ok: false, error: '条目太少，无需整理' }
    const settings = store.getSettings()
    const modelId = settings.defaultModel
    if (!bareModel(modelId)) return { ok: false, error: '尚未选择模型' }
    try {
      const provider = resolveProvider(modelId, settings)
      const listing = entries
        .map((e) => `- [${e.type}] ${e.text}`)
        .join('\n')
        .slice(0, 12_000)
      const { content } = await provider.chat({
        model: bareModel(modelId),
        messages: [
          {
            id: 's',
            role: 'system',
            content:
              '你是记忆整理器。合并重复/相近条目、删除明显过时或互相矛盾的旧条目、保留有长期价值的信息，逐条重写得更简洁。只输出 JSON 数组，每项形如 {"text":"…","type":"fact|preference|decision|pitfall|todo"}，不要输出其它任何文字。',
            createdAt: 0
          },
          { id: 'u', role: 'user', content: listing, createdAt: 0 }
        ]
      })
      const m = content.match(/\[[\s\S]*\]/)
      if (!m) return { ok: false, error: '模型未返回有效 JSON' }
      const arr = JSON.parse(m[0]) as { text?: string; type?: string }[]
      const TYPES = new Set(['fact', 'preference', 'decision', 'pitfall', 'todo'])
      const now = Date.now()
      const proposed = arr
        .filter((x) => typeof x.text === 'string' && x.text.trim())
        .map((x) => ({
          id: randomUUID(),
          text: x.text!.trim(),
          type: (TYPES.has(x.type ?? '') ? x.type : 'fact') as MemoryType,
          source: '记忆整理',
          createdAt: now,
          updatedAt: now
        }))
      if (!proposed.length) return { ok: false, error: '整理结果为空，已放弃' }
      return { ok: true, before: entries.length, proposed }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle(
    'memory:applyConsolidation',
    async (_e, ws: string, scope: 'global' | 'project', entries: unknown) => {
      if (!Array.isArray(entries)) return
      await memory.replace(ws, scope, entries)
      sendToRenderer('memory:updated', null)
    }
  )
  ipcMain.handle(
    'memory:add',
    (_e, ws: string, text: string, type: MemoryType, scope?: 'global' | 'project') =>
      memory.add(ws, text, type, 'user', scope ?? 'project')
  )
  ipcMain.handle('memory:addLegacy', (_e, ws: string, text: string, type: MemoryType) =>
    memory.add(ws, text, type, 'user')
  )
  ipcMain.handle('memory:forget', (_e, ws: string, id: string) => memory.forget(ws, id))

  ipcMain.handle('conversations:truncateFrom', (_e, id: string, messageId: string) =>
    store.truncateFrom(id, messageId)
  )

  ipcMain.handle('conversations:export', async (_e, id: string) => {
    const conv = store.getConversation(id)
    if (!conv) return
    const md = [`# ${conv.title}`, '']
    for (const m of conv.messages) {
      if (m.role === 'user') md.push(`## 🧑 用户`, '', m.content, '')
      else if (m.role === 'assistant') {
        md.push(`## 🤖 助手`, '', m.content || '', '')
        for (const tc of m.toolCalls ?? []) md.push(`> 🛠 调用工具 \`${tc.name}\``, '')
      } else if (m.role === 'tool') md.push('```', m.content, '```', '')
    }
    const win = getWindow()
    const opts = {
      defaultPath: `${conv.title.replace(/[/\\:*?"<>|]/g, '_')}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (!res.canceled && res.filePath) await fsp.writeFile(res.filePath, md.join('\n'), 'utf8')
  })

  // 语音转写：把渲染层录的音频发到 ASR 端点（OpenAI 兼容 /audio/transcriptions）
  ipcMain.handle('asr:transcribe', async (_e, bytes: Uint8Array, mime: string) => {
    const s = store.getSettings()
    const provider = (s.providers ?? []).find((p) => p.id === s.asrProviderId)
    if (!provider) throw new Error('尚未配置语音转写提供方，请在设置 → 语音转写中选择。')
    const model = s.asrModel || 'whisper-1'
    const ext = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'webm'
    const form = new FormData()
    form.append('model', model)
    form.append('file', new Blob([bytes], { type: mime }), `audio.${ext}`)
    const res = await netFetch(`${provider.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {},
      body: form
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`转写失败 (${res.status})${txt ? `：${txt.slice(0, 200)}` : ''}`)
    }
    const data = (await res.json()) as { text?: string }
    return data.text ?? ''
  })

  ipcMain.handle('commands:list', async (_e, ws: string) => {
    const dir = join(ws, '.hemilier', 'commands')
    const { parseFrontmatter, stripFrontmatter } = await import('./skills/frontmatter')
    try {
      const entries = await fsp.readdir(dir)
      const out: { name: string; description: string; body: string }[] = []
      for (const f of entries) {
        if (!f.endsWith('.md')) continue
        const raw = await fsp.readFile(join(dir, f), 'utf8')
        const fm = parseFrontmatter(raw)
        out.push({
          name: fm.name || f.replace(/\.md$/, ''),
          description: fm.description || '',
          body: stripFrontmatter(raw).trim()
        })
      }
      return out
    } catch {
      return []
    }
  })
  ipcMain.handle('agents:list', async (_e, ws: string) =>
    (await agentManager.list(ws)).map((a) => ({
      name: a.name,
      description: a.description,
      source: a.source
    }))
  )
  ipcMain.handle('skills:list', async () => {
    const ws = store.getSettings().workspaceDir
    const pluginDirs = pluginManager.activePlugins().flatMap((p) => p.skillDirs)
    const skills = await skillManager.listSkills(ws, pluginDirs)
    return skills.map((s) => ({ name: s.name, description: s.description, source: s.source }))
  })

  ipcMain.handle('plugins:list', () =>
    pluginManager.listPlugins().map((p) => ({
      name: p.name,
      description: p.description,
      enabled: p.enabled,
      mcpCount: Object.keys(p.mcpServers).length,
      hasSkills: p.skillDirs.length > 0
    }))
  )
  ipcMain.handle('plugins:setEnabled', (_e, name: string, enabled: boolean) =>
    pluginManager.setEnabled(name, enabled)
  )
  ipcMain.handle('plugins:openDir', () => shell.openPath(pluginManager.dir()))
  ipcMain.handle('plugins:catalog', () => pluginManager.catalog())
  ipcMain.handle('plugins:installCatalog', (_e, id: string) => pluginManager.installFromCatalog(id))
  ipcMain.handle('plugins:uninstall', (_e, id: string) => pluginManager.uninstall(id))
  ipcMain.handle('plugins:install', async () => {
    const res = await dialog.showOpenDialog({
      title: '选择插件文件夹（含 plugin.json）',
      properties: ['openDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return { ok: false }
    return pluginManager.installFromDir(res.filePaths[0])
  })

  // 验证某个云端 Provider 的可用性（拉 /models，8s 超时；401=密钥错，404=端点不支持列表）
  ipcMain.handle('providers:test', async (_e, providerId: string) => {
    const cfg = (store.getSettings().providers ?? []).find((p) => p.id === providerId)
    if (!cfg) return { ok: false, error: '未找到该提供方' }
    try {
      const res = await netFetch(`${cfg.baseUrl}/models`, {
        headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
        signal: AbortSignal.timeout(8000)
      })
      if (res.status === 401) return { ok: false, error: 'API Key 无效（401）' }
      if (res.status === 404)
        return { ok: true, note: '端点不提供 /models 列表，但地址可达；请直接对话验证' }
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
      const data = (await res.json().catch(() => null)) as { data?: unknown[] } | null
      return { ok: true, note: `连接成功，可用模型 ${data?.data?.length ?? 0} 个` }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '网络错误' }
    }
  })

  // 用系统浏览器打开链接（仅 http/https，防任意协议注入）
  ipcMain.handle('shell:openUrl', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  // 渲染进程错误上报：白屏/异常写入 userData/main.log（console.error 已被 setupLogging 挂钩）
  ipcMain.on('log:renderer', (_e, msg: string) => {
    console.error('[renderer]', String(msg).slice(0, 4000))
  })

  ipcMain.handle('conversations:setPinned', (_e, id: string, pinned: boolean) =>
    store.setConversationPinned(id, pinned)
  )

  // MCP 连接状态探测（用户配置 + 启用插件提供的 server）
  ipcMain.handle('mcp:status', async () => {
    const s = store.getSettings()
    const pluginMcp = pluginManager.mcpServers(pluginManager.activePlugins())
    const merged = { ...pluginMcp, ...s.mcpServers }
    const trusted = new Set(s.trustedMcp ?? [])
    const trustedServers: Record<string, (typeof merged)[string]> = {}
    const untrusted: { name: string; ok: false; toolCount: 0; error: string; untrusted: true }[] =
      []
    for (const [name, cfg] of Object.entries(merged)) {
      if (trusted.has(mcpSignature(name, cfg))) trustedServers[name] = cfg
      else
        untrusted.push({
          name,
          ok: false,
          toolCount: 0,
          error: '需要信任后才连接',
          untrusted: true
        })
    }
    // 只探活已信任的（未信任的绝不连接/执行）
    const statuses = await mcpManager.status(trustedServers)
    // 标注来源：user=设置里配置的（可启停/删除），plugin=插件提供的（在插件页管理）
    const sourceOf = (name: string): 'user' | 'plugin' =>
      s.mcpServers && name in s.mcpServers ? 'user' : 'plugin'
    // enabled：用户配置的 server 读 cfg.enabled（缺省视为启用），供开关显示当前态
    const enabledOf = (name: string): boolean => s.mcpServers?.[name]?.enabled !== false
    return [...statuses, ...untrusted].map((st) => ({
      ...st,
      source: sourceOf(st.name),
      enabled: enabledOf(st.name)
    }))
  })
  ipcMain.handle('clipboard:read', () => clipboard.readText())
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('mcp:catalog', () => {
    const installed = new Set(Object.keys(store.getSettings().mcpServers ?? {}))
    return MCP_CATALOG.map(({ command: _c, args: _a, ...pub }) => ({
      ...pub,
      installed: installed.has(pub.id)
    }))
  })
  ipcMain.handle('mcp:search', async (_e, query: string) => {
    const s = store.getSettings()
    const installed = new Set(Object.keys(s.mcpServers ?? {}))
    const q = (query ?? '').trim().toLowerCase()
    // A 层：内置种子目录（离线可用）
    const builtin: McpSearchResult[] = MCP_CATALOG.filter(
      (c) => !q || `${c.name} ${c.description} ${c.category} ${c.id}`.toLowerCase().includes(q)
    ).map((c) => ({
      key: c.id,
      name: c.name,
      description: c.description,
      source: 'builtin' as const,
      icon: c.icon,
      category: c.category,
      installed: installed.has(c.id),
      envFields: c.envFields,
      argFields: c.argFields
    }))
    // B 层：在线注册中心（≥2 字符才查；失败则仅返回种子）
    let registry: McpSearchResult[] = []
    let registryOk = true
    if (q.length >= 2) {
      try {
        const builtinKeys = new Set(builtin.map((b) => b.key))
        registry = (await searchRegistry(q, 30, s.proxyUrl))
          .filter((r) => !builtinKeys.has(r.key))
          .map((r) => ({ ...r, installed: installed.has(r.key) }))
      } catch (e) {
        registryOk = false
        console.error('[mcp:search] 注册中心失败：', e instanceof Error ? e.message : e)
      }
    }
    return { results: [...builtin, ...registry], registryOk }
  })
  ipcMain.handle(
    'mcp:installRegistry',
    (_e, entry: McpSearchResult, input: { env?: Record<string, string>; extraArgs?: string[] }) => {
      if (!entry?.command && !entry?.url) return { ok: false, error: '该条目缺少可运行信息' }
      for (const f of entry.envFields ?? []) {
        if (f.required && !input.env?.[f.key]?.trim())
          return { ok: false, error: `缺少 ${f.label}` }
      }
      if ((entry.argFields ?? []).some((f, i) => f.required && !input.extraArgs?.[i]?.trim())) {
        return { ok: false, error: '缺少必填参数' }
      }
      const s = store.getSettings()
      // 远程 server 配 { url, type }；本地包配 { command, args, env }
      const cfg = entry.url
        ? { url: entry.url, type: entry.transport ?? 'http' }
        : {
            command: entry.command!,
            args: [...(entry.args ?? []), ...(input.extraArgs ?? []).filter(Boolean)],
            ...(input.env && Object.keys(input.env).length ? { env: input.env } : {})
          }
      // 注册中心=第三方来源：只写配置、不自动授信（列表里显式「信任并启用」，与剪贴板导入一致）
      store.setSettings({ mcpServers: { ...(s.mcpServers ?? {}), [entry.key]: cfg } })
      return { ok: true }
    }
  )
  ipcMain.handle(
    'mcp:connect',
    (_e, id: string, input: { env?: Record<string, string>; extraArgs?: string[] }) => {
      const def = MCP_CATALOG.find((c) => c.id === id)
      if (!def) return { ok: false, error: '未知连接器' }
      // 必填校验
      for (const f of def.envFields ?? []) {
        if (f.required && !input.env?.[f.key]?.trim())
          return { ok: false, error: `缺少 ${f.label}` }
      }
      if ((def.argFields ?? []).some((f, i) => f.required && !input.extraArgs?.[i]?.trim())) {
        return { ok: false, error: '缺少必填参数' }
      }
      const s = store.getSettings()
      const cfg = {
        command: def.command,
        args: [...def.args, ...(input.extraArgs ?? []).filter(Boolean)],
        ...(input.env && Object.keys(input.env).length ? { env: input.env } : {})
      }
      const servers = { ...(s.mcpServers ?? {}), [def.id]: cfg }
      // 内置目录接入 = 用户亲手操作的可信来源 → 自动授信
      const sig = mcpSignature(def.id, cfg)
      const trusted = s.trustedMcp ?? []
      store.setSettings({
        mcpServers: servers,
        trustedMcp: trusted.includes(sig) ? trusted : [...trusted, sig]
      })
      return { ok: true }
    }
  )
  ipcMain.handle('mcp:setEnabled', (_e, name: string, enabled: boolean) => {
    const s = store.getSettings()
    const cfg = s.mcpServers?.[name]
    if (!cfg) return
    store.setSettings({ mcpServers: { ...s.mcpServers, [name]: { ...cfg, enabled } } })
  })
  ipcMain.handle('mcp:remove', (_e, name: string) => {
    const s = store.getSettings()
    if (!s.mcpServers?.[name]) return
    const sig = mcpSignature(name, s.mcpServers[name])
    const servers = { ...s.mcpServers }
    delete servers[name]
    store.setSettings({
      mcpServers: servers,
      trustedMcp: (s.trustedMcp ?? []).filter((x) => x !== sig)
    })
  })
  ipcMain.handle('mcp:import', (_e, text: string) => {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      // 兼容 { mcpServers: {...} }（Claude Desktop/Cursor 格式）与裸 {...} 两种
      const src = (
        parsed && typeof parsed === 'object' && 'mcpServers' in parsed
          ? (parsed as { mcpServers: unknown }).mcpServers
          : parsed
      ) as Record<string, { command?: unknown; url?: unknown }>
      if (!src || typeof src !== 'object' || Array.isArray(src)) {
        return { ok: false, error: '不是有效的 mcpServers JSON' }
      }
      const s = store.getSettings()
      const servers = { ...(s.mcpServers ?? {}) }
      let added = 0
      for (const [name, cfg] of Object.entries(src)) {
        if (!cfg || typeof cfg !== 'object') continue
        if (typeof cfg.command !== 'string' && typeof cfg.url !== 'string') continue
        servers[name] = cfg as (typeof servers)[string]
        added++
      }
      if (!added) return { ok: false, error: '未找到可导入的 server（需含 command 或 url）' }
      // 导入来源是网上教程/剪贴板 → 不自动授信，须在列表里显式「信任并启用」
      store.setSettings({ mcpServers: servers })
      return { ok: true, added }
    } catch {
      return { ok: false, error: 'JSON 解析失败' }
    }
  })
  ipcMain.handle('mcp:trust', (_e, name: string) => {
    const s = store.getSettings()
    const merged = { ...pluginManager.mcpServers(pluginManager.activePlugins()), ...s.mcpServers }
    const cfg = merged[name]
    if (!cfg) return
    const sig = mcpSignature(name, cfg)
    const list = s.trustedMcp ?? []
    if (!list.includes(sig)) store.setSettings({ trustedMcp: [...list, sig] })
  })

  ipcMain.handle('agent:abort', (_e, id: string) => {
    aborters.get(id)?.abort()
  })

  // ——— 终端：在工作区内执行命令并把输出流式推回渲染进程 ———
  const termProcs = new Map<string, ChildProcess>()
  // 杀整个进程组（POSIX detached）/ 进程树（Windows taskkill /T），不留管道残余
  const killTerm = (conversationId: string): void => {
    const child = termProcs.get(conversationId)
    termProcs.delete(conversationId)
    if (!child || child.killed || child.pid == null) return
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'])
      } else {
        process.kill(-child.pid, 'SIGTERM')
      }
    } catch {
      try {
        child.kill()
      } catch {
        /* 忽略 */
      }
    }
  }
  ipcMain.handle(
    'terminal:run',
    (_e, conversationId: string, workspaceDir: string, command: string) => {
      // 校验工作目录必须是已存在的目录，避免任意/非法 cwd
      if (!workspaceDir || !existsSync(workspaceDir) || !statSync(workspaceDir).isDirectory()) {
        sendToRenderer('terminal:event', {
          conversationId,
          type: 'err',
          data: `工作目录无效：${workspaceDir}`
        })
        return
      }
      killTerm(conversationId)
      const isWin = process.platform === 'win32'
      const child = spawn(command, {
        cwd: workspaceDir,
        shell: isWin ? true : '/bin/sh',
        detached: !isWin // POSIX：独立进程组，kill 时能连管道/子进程一起杀
      })
      termProcs.set(conversationId, child)
      const emit = (type: 'out' | 'err' | 'exit', data?: string, code?: number | null): void =>
        sendToRenderer('terminal:event', { conversationId, type, data, code })
      child.stdout?.on('data', (d) => emit('out', d.toString()))
      child.stderr?.on('data', (d) => emit('err', d.toString()))
      child.on('error', (err) => emit('err', err.message))
      child.on('close', (code) => {
        termProcs.delete(conversationId)
        emit('exit', undefined, code)
      })
    }
  )
  ipcMain.handle('terminal:kill', (_e, conversationId: string) => {
    killTerm(conversationId)
  })
  // 应用退出时清掉所有仍在跑的终端进程（不留孤儿）
  app.on('before-quit', () => {
    for (const id of [...termProcs.keys()]) killTerm(id)
  })

  // ——— 例程 / 后台任务 ———
  const emitAgent = (conversationId: string, event: AgentEvent): void =>
    sendToRenderer('agent:event', { conversationId, event })
  const emitTasks = (t: unknown): void => sendToRenderer('tasks:update', t)

  ipcMain.handle('routines:list', () => routineManager.list())
  ipcMain.handle('routines:save', (_e, r) => routineManager.save(r))
  ipcMain.handle('routines:delete', (_e, id: string) => routineManager.delete(id))
  ipcMain.handle('routines:runNow', (_e, id: string) =>
    routineManager.run(id, emitAgent, emitTasks)
  )
  ipcMain.handle('tasks:list', () => routineManager.listTasks())
  ipcMain.handle('tasks:cancel', (_e, taskId: string) => routineManager.cancelTask(taskId))

  routineManager.startScheduler(emitAgent, emitTasks)

  // 同一会话的运行严格串行（不并发改同一份 messages）。
  // 注意：新任务必须「同步」写入 running，否则两个并发调用会 await 同一个 prev 后并行执行。
  const DEFAULT_TITLES = new Set(['新对话', 'New chat'])
  async function autoTitle(id: string): Promise<void> {
    const conv = store.getConversation(id)
    if (!conv || !DEFAULT_TITLES.has(conv.title)) return
    const firstUser = conv.messages.find((m) => m.role === 'user' && m.content)
    const firstAssistant = conv.messages.find((m) => m.role === 'assistant' && m.content)
    if (!firstUser || !firstAssistant) return
    const settings = store.getSettings()
    const modelId = conv.model || settings.defaultModel
    if (!bareModel(modelId)) return
    try {
      const provider = resolveProvider(modelId, settings)
      const lang = settings.language === 'en' ? '英文' : '中文'
      const { content } = await provider.chat({
        model: bareModel(modelId),
        messages: [
          {
            id: 's',
            role: 'system',
            content: `你是标题生成器。用${lang}给这段对话起一个不超过 12 个字的短标题，只输出标题本身，不要引号、句号或任何解释。`,
            createdAt: 0
          },
          {
            id: 'u',
            role: 'user',
            content: `用户：${firstUser.content.slice(0, 300)}\n助手：${firstAssistant.content.slice(0, 300)}`,
            createdAt: 0
          }
        ]
      })
      const title = content
        .split('\n')[0]
        .replace(/["'「」『』<>《》。，!？?！]/g, '')
        .trim()
        .slice(0, 24)
      // 起名期间用户可能已手动改名——再核对一次仍是默认值才写入
      if (title && DEFAULT_TITLES.has(store.getConversation(id)?.title ?? '')) {
        store.renameConversation(id, title)
        sendToRenderer('conversations:updated', null)
      }
    } catch {
      /* 起名失败无妨，保留默认标题 */
    }
  }

  // 自动沉淀：较长的对话结束后，让模型提炼 0-3 条候选记忆进「待采纳」区（每会话一次；
  // 不直接写正式记忆——保持"记忆写入须经人"的安全红线，用户在 Memory 面板一键采纳/忽略）
  async function autoDistill(id: string): Promise<void> {
    const conv = store.getConversation(id)
    if (!conv || conv.distilled) return
    const turns = conv.messages.filter((m) => m.role === 'user' || m.role === 'assistant').length
    if (turns < 6) return
    const settings = store.getSettings()
    const modelId = conv.model || settings.defaultModel
    if (!bareModel(modelId)) return
    store.setConversationDistilled(id) // 先标记，失败也不重试（避免每轮都花一次调用）
    try {
      const provider = resolveProvider(modelId, settings)
      const transcript = conv.messages
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content)
        .map((m) => `【${m.role === 'user' ? '用户' : '助手'}】${m.content.slice(0, 600)}`)
        .join('\n')
        .slice(0, 16_000)
      const { content } = await provider.chat({
        model: bareModel(modelId),
        messages: [
          {
            id: 's',
            role: 'system',
            content:
              '从对话中提炼对该项目/用户【长期有用】的信息：稳定事实、用户偏好、重要决策、踩过的坑。没有就不提。只输出 JSON 数组（最多 3 项），每项 {"text":"一句话","type":"fact|preference|decision|pitfall"}，不要输出其它文字。',
            createdAt: 0
          },
          { id: 'u', role: 'user', content: transcript, createdAt: 0 }
        ]
      })
      const m = content.match(/\[[\s\S]*\]/)
      if (!m) return
      const arr = JSON.parse(m[0]) as { text?: string; type?: string }[]
      const TYPES = new Set(['fact', 'preference', 'decision', 'pitfall', 'todo'])
      const items = arr
        .filter((x) => typeof x.text === 'string' && x.text!.trim())
        .slice(0, 3)
        .map((x) => ({
          text: x.text!.trim(),
          type: (TYPES.has(x.type ?? '') ? x.type : 'fact') as MemoryType
        }))
      if (items.length) {
        await memory.addPending(conv.workspaceDir, items, conv.title)
        sendToRenderer('memory:updated', null)
      }
    } catch {
      /* 沉淀失败无妨 */
    }
  }

  const runConversation = (
    conversationId: string,
    userContent?: string,
    images?: string[],
    userMessageId?: string,
    /** 在上一轮真正结束后、本轮开始前执行（如「重新生成」的历史裁剪，避免与在跑的循环抢 messages） */
    beforeRun?: () => void
  ): Promise<void> => {
    aborters.get(conversationId)?.abort()
    const prev = running.get(conversationId)
    const box: { task?: Promise<void> } = {} // 供 finally 里做身份比对（避免自引用的 TDZ）
    const task: Promise<void> = (async () => {
      // 等上一轮真正结束后再开始，避免两个 runAgent 同时修改同一个对话对象
      if (prev) await prev.catch(() => {})
      beforeRun?.()
      const ac = new AbortController()
      aborters.set(conversationId, ac)
      const settings = store.getSettings()
      const modelId = store.getConversation(conversationId)?.model || settings.defaultModel
      const provider = resolveProvider(modelId, settings)
      try {
        await runAgent({
          conversationId,
          userContent,
          images,
          userMessageId,
          provider,
          permission,
          signal: ac.signal,
          send: (event: AgentEvent) => sendToRenderer('agent:event', { conversationId, event })
        })
      } finally {
        if (aborters.get(conversationId) === ac) aborters.delete(conversationId)
        if (running.get(conversationId) === box.task) running.delete(conversationId)
      }
    })()
    box.task = task
    running.set(conversationId, task)
    // 运行结束后（若标题仍是默认值）让模型给会话起个短标题
    void task
      .then(() => Promise.allSettled([autoTitle(conversationId), autoDistill(conversationId)]))
      .catch(() => {})
    return task
  }

  ipcMain.handle(
    'agent:send',
    (_e, conversationId: string, content: string, images?: string[], userMessageId?: string) =>
      runConversation(conversationId, content, images, userMessageId)
  )

  ipcMain.handle('agent:regenerate', (_e, conversationId: string) =>
    // 历史裁剪放到上一轮结束后执行，避免与在跑的循环并发修改同一 messages 数组
    runConversation(conversationId, undefined, undefined, undefined, () =>
      store.trimToLastUser(conversationId)
    )
  )

  // /compact：把较早的对话历史压缩成摘要，只保留最近几条 + 摘要，腾出上下文窗口
  ipcMain.handle('conversations:compact', async (_e, id: string) => {
    if (running.get(id)) return { ok: false, error: '正在生成中，请先停止再压缩' }
    // 压缩期间占住 running 槽位：若用户此刻点发送，runConversation 会先 await 我们再开始，
    // 避免运行中的循环持有被替换前的旧 messages 数组（丢/重消息）
    const box: { done?: () => void } = {}
    running.set(
      id,
      new Promise<void>((resolve) => {
        box.done = resolve
      })
    )
    try {
      return await compactConversation(id)
    } finally {
      running.delete(id)
      box.done?.()
    }
  })

  async function compactConversation(
    id: string
  ): Promise<{ ok: boolean; conversation?: Conversation; error?: string }> {
    const conv = store.getConversation(id)
    if (!conv) return { ok: false, error: '对话不存在' }
    const KEEP = 4 // 保留最近 4 条原文
    if (conv.messages.length <= KEEP + 2) return { ok: false, error: '对话还很短，暂不需要压缩' }
    const settings = store.getSettings()
    const modelId = conv.model || settings.defaultModel
    if (!bareModel(modelId)) return { ok: false, error: '尚未选择模型' }
    const provider = resolveProvider(modelId, settings)

    const old = conv.messages.slice(0, -KEEP)
    const kept = conv.messages.slice(-KEEP)
    while (kept.length && kept[0].role === 'tool') kept.shift() // 保住工具配对
    const transcript = old
      .filter((m) => m.content)
      .map((m) => {
        const role = m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : '工具结果'
        return `【${role}】${m.content.slice(0, 2000)}`
      })
      .join('\n')
      .slice(0, 40_000)

    try {
      const { content } = await provider.chat({
        model: bareModel(modelId),
        messages: [
          {
            id: 's',
            role: 'system',
            content:
              '你是对话压缩器。把给定的对话历史压缩成一份简洁但信息完整的中文摘要，保留：用户的目标与关键要求、已完成的事项与结论、重要决定、未解决的问题、涉及的文件/路径/命令等关键细节。用要点列出，不要添加评论。',
            createdAt: 0
          },
          { id: 'u', role: 'user', content: transcript, createdAt: 0 }
        ]
      })
      const summaryMsg = {
        id: randomUUID(),
        role: 'assistant' as const,
        content: `📜 **对话已压缩**（此前 ${old.length} 条消息的摘要）：\n\n${content}`,
        createdAt: Date.now()
      }
      conv.messages = [summaryMsg, ...kept]
      conv.updatedAt = Date.now()
      store.saveConversation(conv)
      store.flush()
      return { ok: true, conversation: conv }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
}
