// MCP Registry 搜索（对齐 Claude/Codex 的"搜索即用"）：查询官方开放注册中心
// registry.modelcontextprotocol.io，把服务器条目映射成可一键接入的搜索结果。
// 网络出口统一走 netFetch（跟随系统/设置代理）；离线/超时由调用方优雅降级到内置种子目录。
// 安全：注册中心来源=第三方，接入后不自动授信（须在列表显式信任），与剪贴板导入同一底线。
import { netFetch } from '../providers/netfetch'
import type { McpSearchResult } from '../../shared/types'

const REGISTRY_BASE = 'https://registry.modelcontextprotocol.io'

/** 环境变量名看起来像机密就打码显示 */
function looksSecret(name: string): boolean {
  return /token|key|secret|password|pat|credential/i.test(name)
}

// 注册中心的字段命名在不同草案间有 snake_case / camelCase 两版，这里都兼容。
interface RawEnv {
  name?: string
  description?: string
  is_required?: boolean
  isRequired?: boolean
  is_secret?: boolean
  isSecret?: boolean
}
interface RawArg {
  type?: string
  value?: string
  description?: string
  is_required?: boolean
  isRequired?: boolean
}
interface RawPkg {
  registry_name?: string
  registryType?: string
  registry_type?: string
  name?: string
  identifier?: string
  runtime_hint?: string
  runtimeHint?: string
  package_arguments?: RawArg[]
  packageArguments?: RawArg[]
  runtime_arguments?: RawArg[]
  environment_variables?: RawEnv[]
  environmentVariables?: RawEnv[]
}
interface RawRemote {
  type?: string
  url?: string
}
interface RawServer {
  name?: string
  title?: string
  description?: string
  packages?: RawPkg[]
  remotes?: RawRemote[]
  repository?: { url?: string }
}
// 注册中心每个条目是 { server: {...}, _meta: {...} }（2025-12 schema）；老形状可能是扁平的
interface RawItem {
  server?: RawServer
  _meta?: { 'io.modelcontextprotocol.registry/official'?: { status?: string; isLatest?: boolean } }
  name?: string
  description?: string
  packages?: RawPkg[]
  remotes?: RawRemote[]
}

/** 包 → 运行命令。只支持能通用拉起的 npm(npx)/pypi(uvx)；docker/oci 跳过。 */
function runnerFor(pkg: RawPkg): { command: string; base: string[] } | null {
  const reg = (pkg.registry_name ?? pkg.registryType ?? pkg.registry_type ?? '').toLowerCase()
  const id = pkg.identifier ?? pkg.name
  if (!id) return null
  const hint = (pkg.runtime_hint ?? pkg.runtimeHint ?? '').toLowerCase()
  if (reg === 'npm' || hint === 'npx') return { command: 'npx', base: ['-y', id] }
  if (reg === 'pypi' || hint === 'uvx' || hint === 'uv') return { command: 'uvx', base: [id] }
  return null
}

function envFieldsOf(pkg: RawPkg): McpSearchResult['envFields'] {
  const envs = pkg.environment_variables ?? pkg.environmentVariables ?? []
  const out = envs
    .map((e) => ({
      key: String(e.name ?? '').trim(),
      label: String(e.description ?? e.name ?? '').trim(),
      required: !!(e.is_required ?? e.isRequired),
      secret: !!(e.is_secret ?? e.isSecret) || looksSecret(String(e.name ?? ''))
    }))
    .filter((e) => e.key)
  return out.length ? out : undefined
}

/** 单个服务器 → 搜索结果。优先本地包(npx/uvx)，否则远程(http/sse)；都不行则 null。 */
function mapServer(s: RawServer): McpSearchResult | null {
  const full = String(s.name ?? '').trim()
  if (!full) return null
  const short = full.includes('/') ? full.split('/').pop()! : full
  const publisher = full.includes('/')
    ? full
        .split('/')[0]
        .replace(/^io\.github\./, '')
        .replace(/^com\.|^ai\.|^org\./, '')
    : undefined
  const key = (short || full).replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 64)
  if (!key) return null
  const base = {
    key,
    name: s.title?.trim() || short || full,
    description: String(s.description ?? '').trim(),
    source: 'registry' as const,
    publisher,
    installed: false
  }

  // ① 本地包
  for (const p of s.packages ?? []) {
    const runner = runnerFor(p)
    if (!runner) continue
    const posArgs = p.package_arguments ?? p.packageArguments ?? []
    const bakedArgs: string[] = []
    const argFields: { label: string; placeholder: string; required: boolean }[] = []
    for (const a of posArgs) {
      if (a.value != null && a.value !== '') bakedArgs.push(String(a.value))
      else if (a.is_required ?? a.isRequired)
        argFields.push({ label: String(a.description ?? '参数'), placeholder: '', required: true })
    }
    return {
      ...base,
      command: runner.command,
      args: [...runner.base, ...bakedArgs],
      envFields: envFieldsOf(p),
      argFields: argFields.length ? argFields : undefined
    }
  }

  // ② 远程 server（streamable-http / sse）：无需本地安装，配 { url, type }
  for (const r of s.remotes ?? []) {
    if (!r.url) continue
    const type = (r.type ?? '').toLowerCase()
    return {
      ...base,
      url: r.url,
      transport: type === 'sse' ? 'sse' : 'http'
    }
  }
  return null
}

/** 纯函数：注册中心响应 + 查询词 → 结果列表（便于单测，无网络）。
 *  兼容 { servers:[{ server, _meta }] } 新结构与扁平老结构；同名去重(保留最新)、跳过已删除。 */
export function mapRegistryResponse(data: unknown, query: string): McpSearchResult[] {
  const raw = (data as { servers?: unknown })?.servers
  const items: RawItem[] = Array.isArray(raw) ? (raw as RawItem[]) : []
  const byName = new Map<string, McpSearchResult>()
  for (const it of items) {
    const meta = it._meta?.['io.modelcontextprotocol.registry/official']
    if (meta?.status && meta.status !== 'active' && meta.status !== 'deprecated') continue
    const srv: RawServer = it.server ?? {
      name: it.name,
      description: it.description,
      packages: it.packages,
      remotes: it.remotes
    }
    const r = mapServer(srv)
    if (!r) continue
    // 同名多版本：isLatest 优先，否则后者覆盖
    if (!byName.has(r.name) || meta?.isLatest) byName.set(r.name, r)
  }
  const mapped = [...byName.values()]
  const q = query.trim().toLowerCase()
  if (!q) return mapped
  return mapped.filter((r) =>
    `${r.name} ${r.description} ${r.publisher ?? ''}`.toLowerCase().includes(q)
  )
}

/** 注册中心是公开主机、多数可直连；而国内用户的**系统代理常会 reset 到它的连接**
 *  （实测 net::ERR_CONNECTION_CLOSED）。故先直连（独立 session，不动全局代理），
 *  直连失败再走配置/系统代理（覆盖注册中心确被墙、必须走代理的少数用户）。 */
// 主进程的全局 fetch 与 netFetch 都走 defaultSession=系统代理，而国内用户的代理(如 Clash)
// 常会 reset 到注册中心的连接(实测 ERR_CONNECTION_CLOSED)；独立 session 在本环境 TLS 又失败。
// 唯一稳的路径：临时把 defaultSession 切「直连」取数据、拿完立刻恢复用户原代理。
// 用锁串行化，避免并发时代理状态互相踩；直连失败再退回代理通道(注册中心确被墙的用户)。
let regLock: Promise<unknown> = Promise.resolve()

async function registryGet(url: string, restoreProxy?: string): Promise<unknown> {
  const headers = { 'User-Agent': 'hemilier-desktop', Accept: 'application/json' }
  let electron: typeof import('electron') | undefined
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    electron = require('electron') as typeof import('electron')
  } catch {
    /* 无 electron（单测）*/
  }
  const net = electron?.net
  const session = electron?.session
  if (net?.fetch && session?.defaultSession) {
    const run = regLock.then(async () => {
      const ds = session.defaultSession
      try {
        await ds.setProxy({ mode: 'direct' })
        // 直连重试：注册中心域名常被概率性 RST（ERR_CONNECTION_CLOSED），多试几次显著提升成功率
        let lastErr: unknown
        for (let i = 0; i < 3; i++) {
          try {
            const res = await net.fetch(url, { headers, signal: AbortSignal.timeout(12000) })
            if (!res.ok) throw new Error(`注册中心返回 ${res.status}`)
            return await res.json()
          } catch (e) {
            lastErr = e
            await new Promise((r) => setTimeout(r, 400))
          }
        }
        throw lastErr
      } finally {
        // 恢复用户原本的代理设置（有 proxyUrl 用之，否则跟随系统）
        const rules = (restoreProxy ?? '').trim()
        await ds.setProxy(rules ? { proxyRules: rules } : { mode: 'system' })
      }
    })
    regLock = run.then(
      () => {},
      () => {}
    )
    return run
  }
  // 无 electron：退回 netFetch（单测/异常环境）
  const res = await netFetch(url, { headers, signal: AbortSignal.timeout(12000) })
  if (!res.ok) throw new Error(`注册中心返回 ${res.status}`)
  return res.json()
}

/** 在线搜索 MCP 注册中心；失败（离线/超时/非 200）抛错，由调用方降级到种子目录。
 *  restoreProxy：用户配置的 proxyUrl（直连取数据后据此恢复 defaultSession 代理）。 */
export async function searchRegistry(
  query: string,
  limit = 30,
  restoreProxy?: string
): Promise<McpSearchResult[]> {
  const q = query.trim()
  // 优先用服务端 search 参数；同时客户端再过滤一遍（服务端不支持时也能筛）
  const url = `${REGISTRY_BASE}/v0/servers?limit=100${q ? `&search=${encodeURIComponent(q)}` : ''}`
  const data = await registryGet(url, restoreProxy)
  return mapRegistryResponse(data, q).slice(0, limit)
}
