import { useEffect, useMemo, useRef, useState } from 'react'
import type { McpSearchResult, PluginCatalogItem, PluginInfo } from '@shared/types'
import { useT } from '../i18n'
import { SearchIcon, BlocksIcon } from './icons'
import { AppIcon, StatusDot, Toggle } from './ui'

type Tab = 'apps' | 'mcp' | 'plugins'
type Server = Awaited<ReturnType<typeof window.api.mcpStatus>>[number]

// 一行扩展条目：左图标 + 名称/描述，右侧控件。无分割线，靠留白分隔（对齐 Codex）。
function Row({
  icon,
  iconMuted,
  name,
  desc,
  badge,
  right
}: {
  icon: React.ReactNode
  iconMuted?: boolean
  name: string
  desc?: string
  badge?: React.ReactNode
  right: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center gap-3.5 py-2.5">
      <AppIcon muted={iconMuted}>{icon}</AppIcon>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold text-fg">{name}</span>
          {badge}
        </div>
        {desc ? <div className="truncate text-[13px] text-muted">{desc}</div> : null}
      </div>
      <div className="shrink-0">{right}</div>
    </div>
  )
}

export function ExtensionsPanel(): JSX.Element {
  const t = useT() as unknown as (k: string) => string
  const [tab, setTab] = useState<Tab>('apps')
  const [query, setQuery] = useState('')

  const [results, setResults] = useState<McpSearchResult[]>([])
  const [registryOk, setRegistryOk] = useState(true)
  const [searching, setSearching] = useState(false)

  const [servers, setServers] = useState<Server[]>([])
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [pcatalog, setPcatalog] = useState<PluginCatalogItem[]>([])

  // 接入表单（需要填 env/参数的条目）
  const [formKey, setFormKey] = useState<string | null>(null)
  const [formEnv, setFormEnv] = useState<Record<string, string>>({})
  const [formArgs, setFormArgs] = useState<string[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [advOpen, setAdvOpen] = useState(false)

  const reloadServers = async (): Promise<void> => setServers(await window.api.mcpStatus())
  const reloadPlugins = async (): Promise<void> => setPlugins(await window.api.listPlugins())

  useEffect(() => {
    void reloadServers()
    void reloadPlugins()
    void window.api.pluginCatalog().then(setPcatalog)
  }, [])

  // 应用 tab：搜索（防抖）——空词返回内置种子，≥2 字符并查在线注册中心
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (tab !== 'apps') return
    setSearching(true)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      const r = await window.api.mcpSearch(query)
      setResults(r.results)
      setRegistryOk(r.registryOk)
      setSearching(false)
    }, 250)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [query, tab])

  const installedKeys = useMemo(() => new Set(servers.map((s) => s.name)), [servers])

  const beginInstall = (r: McpSearchResult): void => {
    if (!(r.envFields?.length || r.argFields?.length)) {
      void doInstall(r, {})
      return
    }
    setFormKey(r.key)
    setFormEnv({})
    setFormArgs([])
    setMsg(null)
  }
  const doInstall = async (
    r: McpSearchResult,
    input: { env?: Record<string, string>; extraArgs?: string[] }
  ): Promise<void> => {
    setMsg(null)
    const res =
      r.source === 'builtin'
        ? await window.api.mcpConnect(r.key, input)
        : await window.api.mcpInstallRegistry(r, input)
    if (!res.ok) {
      setMsg(res.error ?? 'failed')
      return
    }
    setFormKey(null)
    await reloadServers()
    // 刷新结果里的 installed 标记
    const rr = await window.api.mcpSearch(query)
    setResults(rr.results)
  }

  const importClipboard = async (): Promise<void> => {
    setMsg(null)
    const text = await window.api.readClipboardText()
    const r = await window.api.mcpImport(text)
    setMsg(r.ok ? `✓ ${t('mcpImported').replace('{n}', String(r.added ?? 0))}` : `✗ ${r.error}`)
    if (r.ok) await reloadServers()
  }

  const q = query.trim().toLowerCase()
  const shownServers = q ? servers.filter((s) => s.name.toLowerCase().includes(q)) : servers
  const shownPlugins = q
    ? plugins.filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(q))
    : plugins
  // 插件 tab 的搜索也覆盖插件市场（不只是已装）；已装的从市场列表里排除
  const installedPluginNames = new Set(plugins.map((p) => p.name))
  const shownCatalog = pcatalog
    .filter((c) => !installedPluginNames.has(c.name))
    .filter((c) => !q || `${c.name} ${c.description} ${c.category}`.toLowerCase().includes(q))

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'apps', label: t('extApps'), count: results.length },
    { key: 'mcp', label: t('extMcp'), count: servers.length },
    { key: 'plugins', label: t('extPlugins'), count: plugins.length }
  ]

  const userServers = shownServers.filter((m) => m.source !== 'plugin')
  const pluginServers = shownServers.filter((m) => m.source === 'plugin')
  const catIconFor = (name: string): string => pcatalog.find((c) => c.name === name)?.icon ?? '🧩'

  return (
    <div>
      {/* 副标题（弹窗头部已显示「扩展」，这里只给一行说明，避免标题重复） */}
      <p className="-mt-1 mb-5 text-sm text-muted">{t('extSubtitle')}</p>

      {/* tab 行 + 搜索框 */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          {TABS.map((tb) => (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className={`rounded-lg px-3 py-1.5 text-sm transition ${
                tab === tb.key ? 'bg-surface-2 font-semibold text-fg' : 'text-muted hover:text-fg'
              }`}
            >
              {tb.label} <span className="ml-0.5 text-xs text-muted">{tb.count}</span>
            </button>
          ))}
        </div>
        <div className="relative w-64">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              tab === 'apps'
                ? t('extSearchApps')
                : tab === 'mcp'
                  ? t('extSearchMcp')
                  : t('extSearchPlugins')
            }
            className="w-full rounded-full border border-line bg-surface/60 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-accent focus:bg-surface"
          />
        </div>
      </div>

      {/* ---------- 应用（搜索 + 接入 MCP） ---------- */}
      {tab === 'apps' && (
        <div>
          {!registryOk && q.length >= 2 && (
            <p className="pb-1 text-xs text-amber-600">{t('extRegistryOffline')}</p>
          )}
          {searching && results.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">{t('extSearching')}</p>
          ) : results.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">{t('extNoResults')}</p>
          ) : (
            results.map((r) => {
              const installed = r.installed || installedKeys.has(r.key)
              return (
                <div key={`${r.source}:${r.key}`}>
                  <Row
                    icon={r.icon ?? <BlocksIcon className="h-5 w-5" />}
                    iconMuted={!r.icon}
                    name={r.name}
                    desc={r.description}
                    badge={
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                        {r.source === 'registry'
                          ? r.publisher
                            ? `${t('extRegistry')} · ${r.publisher}`
                            : t('extRegistry')
                          : t('extBuiltin')}
                      </span>
                    }
                    right={
                      installed ? (
                        <span className="text-sm text-muted">{t('extInstalled')}</span>
                      ) : (
                        <button
                          onClick={() => beginInstall(r)}
                          className="rounded-lg border border-line px-3.5 py-1.5 text-sm text-fg transition hover:bg-accent-soft hover:text-accent"
                        >
                          {t('extConnect')}
                        </button>
                      )
                    }
                  />
                  {/* 内联接入表单：填 env / 参数 */}
                  {formKey === r.key && (
                    <div className="mb-3 ml-[58px] space-y-2 rounded-xl border border-line bg-surface-2 p-3">
                      {(r.envFields ?? []).map((f) => (
                        <div key={f.key}>
                          <label className="mb-0.5 block text-xs text-muted">
                            {f.label}
                            {f.required ? ' *' : ''}
                          </label>
                          <input
                            type={f.secret ? 'password' : 'text'}
                            value={formEnv[f.key] ?? ''}
                            onChange={(e) => setFormEnv({ ...formEnv, [f.key]: e.target.value })}
                            className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent"
                          />
                        </div>
                      ))}
                      {(r.argFields ?? []).map((f, i) => (
                        <div key={i}>
                          <label className="mb-0.5 block text-xs text-muted">
                            {f.label}
                            {f.required ? ' *' : ''}
                          </label>
                          <input
                            value={formArgs[i] ?? ''}
                            placeholder={f.placeholder}
                            onChange={(e) => {
                              const next = [...formArgs]
                              next[i] = e.target.value
                              setFormArgs(next)
                            }}
                            className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent"
                          />
                        </div>
                      ))}
                      {msg && <p className="text-xs text-red-500">{msg}</p>}
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setFormKey(null)}
                          className="rounded-lg px-2.5 py-1 text-xs text-muted hover:text-fg"
                        >
                          {t('cancel')}
                        </button>
                        <button
                          onClick={() => void doInstall(r, { env: formEnv, extraArgs: formArgs })}
                          className="rounded-lg border border-line bg-surface px-3 py-1 text-xs text-fg hover:bg-accent-soft"
                        >
                          {t('extConnect')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* ---------- MCP（卡片分组：服务器 / 来自插件，对齐 Codex） ---------- */}
      {tab === 'mcp' && (
        <div className="space-y-6">
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-fg">{t('extServers')}</h3>
              <button
                onClick={() => setAdvOpen((v) => !v)}
                className="flex items-center gap-1 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-fg transition hover:bg-accent-soft"
              >
                <span className="text-sm leading-none">＋</span> {t('extAddServer')}
              </button>
            </div>
            {/* 添加服务器：剪贴板导入 + 高级 JSON */}
            {advOpen && (
              <div className="mb-3 space-y-2 rounded-xl border border-line bg-surface-2 p-3">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => void importClipboard()}
                    className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg hover:bg-accent-soft"
                  >
                    {t('mcpImportClipboard')}
                  </button>
                  {msg && <span className="text-xs text-muted">{msg}</span>}
                </div>
                <p className="whitespace-pre-wrap break-all text-xs text-muted">
                  {
                    'stdio: { "fs": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "PATH"] } }\n'
                  }
                  {'http: { "remote": { "url": "https://example.com/mcp", "type": "http" } }'}
                </p>
              </div>
            )}
            {userServers.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line py-8 text-center text-sm text-muted">
                {t('extNoServers')}
              </p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-line">
                {userServers.map((m, i) => (
                  <div
                    key={m.name}
                    className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-line' : ''}`}
                  >
                    <StatusDot tone={m.untrusted ? 'warn' : m.ok ? 'ok' : 'off'} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-fg">{m.name}</div>
                      <div className="truncate text-xs text-muted">
                        {m.untrusted
                          ? t('mcpNeedsTrust')
                          : m.ok
                            ? `${t('extTools')} × ${m.toolCount}`
                            : m.error}
                      </div>
                    </div>
                    {m.untrusted ? (
                      <button
                        onClick={() =>
                          void window.api.trustMcp(m.name).then(() => void reloadServers())
                        }
                        className="rounded-lg border border-line px-3 py-1 text-sm text-fg hover:bg-accent-soft"
                      >
                        {t('mcpTrust')}
                      </button>
                    ) : (
                      <div className="flex items-center gap-3.5">
                        <button
                          onClick={() =>
                            void window.api.mcpRemove(m.name).then(() => void reloadServers())
                          }
                          className="text-xs text-muted transition hover:text-rose-500"
                        >
                          {t('deleteChat')}
                        </button>
                        <Toggle
                          on={m.enabled !== false}
                          onChange={() =>
                            void window.api
                              .mcpSetEnabled(m.name, m.enabled === false)
                              .then(() => void reloadServers())
                          }
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {pluginServers.length > 0 && (
            <div>
              <h3 className="mb-2.5 text-[13px] font-semibold text-fg">
                {t('extFromPluginsSection')}
              </h3>
              <div className="overflow-hidden rounded-xl border border-line">
                {pluginServers.map((m, i) => (
                  <div
                    key={m.name}
                    className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-line' : ''}`}
                  >
                    <StatusDot tone={m.ok ? 'ok' : 'off'} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                      {m.name}
                    </span>
                    <span className="text-xs text-muted">{t('extManageInPlugins')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------- 插件（已安装 + 插件市场） ---------- */}
      {tab === 'plugins' && (
        <div className="space-y-6">
          <div>
            {shownPlugins.length > 0 && (
              <h3 className="mb-1.5 text-[13px] font-semibold text-fg">
                {t('extInstalledSection')}
              </h3>
            )}
            {shownPlugins.length === 0 && shownCatalog.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted">{t('extNoPlugins')}</p>
            ) : (
              shownPlugins.map((p) => (
                <Row
                  key={p.name}
                  icon={catIconFor(p.name)}
                  name={p.name}
                  desc={p.description}
                  badge={
                    <>
                      {p.mcpCount ? (
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                          MCP×{p.mcpCount}
                        </span>
                      ) : null}
                      {/* 僵尸插件：内容已被内置技能覆盖，装着不生效 */}
                      {p.superseded && (
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                          {t('extSuperseded')}
                        </span>
                      )}
                      {!p.superseded && p.latestVersion && p.version !== p.latestVersion && (
                        <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">
                          {t('extUpdatable')}
                        </span>
                      )}
                    </>
                  }
                  right={
                    <div className="flex items-center gap-3">
                      {p.superseded ? (
                        <button
                          onClick={() => {
                            if (!window.confirm(t('extRemoveSuperseded').replace('{n}', p.name)))
                              return
                            void window.api
                              .uninstallPlugin(p.catalogId ?? p.name)
                              .then(() => void reloadPlugins())
                          }}
                          className="text-xs text-muted hover:text-red-500"
                        >
                          {t('extRemove')}
                        </button>
                      ) : p.latestVersion && p.version !== p.latestVersion ? (
                        <button
                          onClick={() =>
                            void window.api
                              .uninstallPlugin(p.catalogId ?? p.name)
                              .then(() => window.api.installCatalogPlugin(p.catalogId ?? p.name))
                              .then(() => void reloadPlugins())
                          }
                          className="rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-xs text-fg hover:bg-accent-soft"
                        >
                          {t('extUpdate')}
                        </button>
                      ) : null}
                      <Toggle
                        on={p.enabled}
                        onChange={() =>
                          void window.api
                            .setPluginEnabled(p.name, !p.enabled)
                            .then(() => void reloadPlugins())
                        }
                      />
                    </div>
                  }
                />
              ))
            )}
          </div>
          {/* 插件市场（一键安装内置技能包）——随搜索过滤 */}
          {shownCatalog.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-[13px] font-semibold text-fg">{t('extMarketplace')}</h3>
              {shownCatalog.map((c) => (
                <Row
                  key={c.id}
                  icon={c.icon ?? '📦'}
                  name={c.name}
                  desc={c.description}
                  right={
                    <button
                      onClick={() =>
                        void window.api.installCatalogPlugin(c.id).then(() => void reloadPlugins())
                      }
                      className="rounded-lg border border-line px-3.5 py-1.5 text-sm text-fg transition hover:bg-accent-soft hover:text-accent"
                    >
                      {t('extInstall')}
                    </button>
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
