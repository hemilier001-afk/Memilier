import { useEffect, useState } from 'react'
import type { PluginCatalogItem, PluginInfo, ProviderConfig, SkillInfo } from '@shared/types'
import { useStore } from '../store'
import { useT } from '../i18n'

const PROVIDER_PRESETS: Record<string, { label: string; baseUrl: string; models: string }> = {
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: 'deepseek-chat,deepseek-reasoner'
  },
  minimax: {
    label: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/v1',
    models: 'MiniMax-Text-01,abab6.5s-chat'
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: 'gpt-4o,gpt-4o-mini'
  },
  custom: { label: '自定义 / Custom', baseUrl: '', models: '' }
}

type Cat = 'general' | 'models' | 'voice' | 'mcp' | 'skills' | 'shortcuts' | 'about'

const input =
  'w-full rounded-md border border-line bg-transparent px-2 py-1.5 outline-none focus:border-accent'

export function SettingsModal(): JSX.Element | null {
  const t = useT()
  const open = useStore((s) => s.settingsOpen)
  const setOpen = useStore((s) => s.setSettingsOpen)
  const settings = useStore((s) => s.settings)
  const models = useStore((s) => s.models)
  const update = useStore((s) => s.updateSettings)

  const [cat, setCat] = useState<Cat>('general')
  const [mcpText, setMcpText] = useState('')
  const [mcpError, setMcpError] = useState<string | null>(null)
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [mcpStatus, setMcpStatus] = useState<
    { name: string; ok: boolean; toolCount: number; error?: string }[] | null
  >(null)
  const [mcpTesting, setMcpTesting] = useState(false)
  const [pluginMsg, setPluginMsg] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<PluginCatalogItem[]>([])

  useEffect(() => {
    if (open) {
      const s = useStore.getState().settings
      setMcpText(JSON.stringify(s?.mcpServers ?? {}, null, 2))
      setProviders(s?.providers ?? [])
      setMcpError(null)
      void window.api.listSkills().then(setSkills)
      void window.api.listPlugins().then(setPlugins)
      void window.api.pluginCatalog().then(setCatalog)
    }
  }, [open])

  const persistProviders = (next: ProviderConfig[]): void => {
    void update({ providers: next })
    void useStore.getState().refreshModels()
  }
  const addProvider = (preset: keyof typeof PROVIDER_PRESETS): void => {
    const p = PROVIDER_PRESETS[preset]
    const next = [
      ...providers,
      {
        id: `${preset}-${Date.now().toString(36)}`,
        label: p.label,
        kind: 'openai' as const,
        baseUrl: p.baseUrl,
        apiKey: '',
        models: p.models ? p.models.split(',').map((m) => m.trim()) : []
      }
    ]
    setProviders(next)
    persistProviders(next)
  }
  const patchProvider = (id: string, patch: Partial<ProviderConfig>): void => {
    setProviders((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }
  const removeProvider = (id: string): void => {
    const next = providers.filter((p) => p.id !== id)
    setProviders(next)
    persistProviders(next)
  }
  const togglePlugin = async (name: string, enabled: boolean): Promise<void> => {
    await window.api.setPluginEnabled(name, enabled)
    setPlugins(await window.api.listPlugins())
  }

  const [verifyMsg, setVerifyMsg] = useState<Record<string, string>>({})
  const verifyProvider = async (id: string): Promise<void> => {
    setVerifyMsg((m) => ({ ...m, [id]: t('verifying') }))
    const r = await window.api.testProvider(id)
    setVerifyMsg((m) => ({ ...m, [id]: r.ok ? `✓ ${r.note ?? t('verifyOk')}` : `✗ ${r.error}` }))
  }

  const testMcp = async (): Promise<void> => {
    setMcpTesting(true)
    setMcpStatus(null)
    try {
      setMcpStatus(await window.api.mcpStatus())
    } finally {
      setMcpTesting(false)
    }
  }

  const installPlugin = async (): Promise<void> => {
    setPluginMsg(null)
    const r = await window.api.installPlugin()
    if (r.ok) {
      setPluginMsg(`✓ ${t('pluginInstalled').replace('{n}', r.name ?? '')}`)
      setPlugins(await window.api.listPlugins())
    } else if (r.error) {
      setPluginMsg(`✗ ${r.error}`)
    }
  }
  const refreshPluginLists = async (): Promise<void> => {
    setCatalog(await window.api.pluginCatalog())
    setPlugins(await window.api.listPlugins())
  }
  const installCatalog = async (id: string): Promise<void> => {
    setPluginMsg(null)
    const r = await window.api.installCatalogPlugin(id)
    if (r.ok) setPluginMsg(`✓ ${t('pluginInstalled').replace('{n}', r.name ?? '')}`)
    else if (r.error) setPluginMsg(`✗ ${r.error}`)
    await refreshPluginLists()
  }
  const uninstallCatalog = async (id: string): Promise<void> => {
    await window.api.uninstallPlugin(id)
    await refreshPluginLists()
  }
  const pickWorkspace = async (): Promise<void> => {
    const dir = await window.api.pickWorkspace()
    if (dir) await update({ workspaceDir: dir })
  }
  const saveMcp = (): void => {
    try {
      const parsed = JSON.parse(mcpText || '{}')
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('顶层需为 JSON 对象 / top-level must be an object')
      }
      setMcpError(null)
      void update({ mcpServers: parsed })
    } catch (e) {
      setMcpError(e instanceof Error ? e.message : 'JSON error')
    }
  }

  if (!open || !settings) return null

  const CATS: { key: Cat; label: string; icon: string }[] = [
    { key: 'general', label: t('setGeneral'), icon: '⚙' },
    { key: 'models', label: t('setModels'), icon: '🧠' },
    { key: 'voice', label: t('setVoice'), icon: '🎤' },
    { key: 'mcp', label: t('setMcp'), icon: '🧩' },
    { key: 'skills', label: t('setSkills'), icon: '✨' },
    { key: 'shortcuts', label: t('setShortcuts'), icon: '⌨' },
    { key: 'about', label: t('setAbout'), icon: 'ℹ' }
  ]

  const modelGroups = Object.entries(
    models.reduce<Record<string, typeof models>>((acc, m) => {
      ;(acc[m.provider ?? 'model'] ??= []).push(m)
      return acc
    }, {})
  )

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="flex h-[560px] max-h-[88vh] w-[760px] max-w-[94vw] overflow-hidden rounded-xl border border-line bg-surface text-fg shadow-xl">
        {/* 左侧分类菜单 */}
        <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-line bg-surface-2 p-2">
          <div className="px-2 pb-2 pt-1 text-sm font-semibold">{t('settings')}</div>
          {CATS.map((c) => (
            <button
              key={c.key}
              onClick={() => setCat(c.key)}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
                cat === c.key ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-surface'
              }`}
            >
              <span>{c.icon}</span>
              {c.label}
            </button>
          ))}
        </nav>

        {/* 右侧内容 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-base font-semibold">{CATS.find((c) => c.key === cat)?.label}</h2>
            <button onClick={() => setOpen(false)} className="text-muted hover:text-fg">
              ✕
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 text-sm">
            {cat === 'general' && (
              <>
                <div>
                  <label className="mb-1 block font-medium">{t('profileSection')}</label>
                  <div className="flex gap-2">
                    <input
                      key={`pname-${settings.profile?.name ?? ''}`}
                      defaultValue={settings.profile?.name ?? ''}
                      placeholder={t('profileName')}
                      onBlur={(e) =>
                        void update({
                          profile: { ...settings.profile, name: e.target.value.trim() }
                        })
                      }
                      className={input}
                    />
                    <input
                      key={`pmail-${settings.profile?.email ?? ''}`}
                      defaultValue={settings.profile?.email ?? ''}
                      placeholder={t('profileEmail')}
                      onBlur={(e) =>
                        void update({
                          profile: { ...settings.profile, email: e.target.value.trim() }
                        })
                      }
                      className={input}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted">{t('profileNamePh')}</p>
                </div>
                <div>
                  <label className="mb-1 block font-medium">{t('language')}</label>
                  <select
                    value={settings.language}
                    onChange={(e) => void update({ language: e.target.value as 'zh' | 'en' })}
                    className={input}
                  >
                    <option value="zh">中文</option>
                    <option value="en">English</option>
                  </select>
                  <p className="mt-1 text-xs text-muted">
                    English 界面覆盖主要区域；较新的功能界面暂以中文为准，将逐步补全。
                  </p>
                </div>
                <div>
                  <label className="mb-1 block font-medium">{t('theme')}</label>
                  <select
                    value={settings.theme}
                    onChange={(e) =>
                      void update({ theme: e.target.value as typeof settings.theme })
                    }
                    className={input}
                  >
                    <option value="system">{t('themeSystem')}</option>
                    <option value="light">{t('themeLight')}</option>
                    <option value="dark">{t('themeDark')}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-medium">{t('workspaceDir')}</label>
                  <div className="flex gap-2">
                    <input value={settings.workspaceDir} readOnly className={`${input} truncate`} />
                    <button
                      onClick={() => void pickWorkspace()}
                      className="shrink-0 rounded-md bg-surface-2 px-3 py-1.5 hover:bg-line"
                    >
                      {t('choose')}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-muted">{t('workspaceHint')}</p>
                </div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.autoApproveReadOnly}
                    onChange={(e) => void update({ autoApproveReadOnly: e.target.checked })}
                  />
                  {t('autoApprove')}
                </label>
                <div>
                  <label className="mb-1 block font-medium">{t('submitKey')}</label>
                  <select
                    value={settings.submitKey ?? 'enter'}
                    onChange={(e) =>
                      void update({ submitKey: e.target.value as 'enter' | 'mod-enter' })
                    }
                    className={input}
                  >
                    <option value="enter">{t('submitEnter')}</option>
                    <option value="mod-enter">{t('submitMod')}</option>
                  </select>
                </div>
              </>
            )}

            {cat === 'models' && (
              <>
                <div>
                  <label className="mb-1 block font-medium">{t('ollamaUrl')}</label>
                  <input
                    value={settings.ollamaBaseUrl}
                    onChange={(e) => void update({ ollamaBaseUrl: e.target.value })}
                    className={input}
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium">{t('defaultModel')}</label>
                  <select
                    value={settings.defaultModel}
                    onChange={(e) => void update({ defaultModel: e.target.value })}
                    className={input}
                  >
                    {models.length === 0 && <option value="">{t('noModels')}</option>}
                    {modelGroups.map(([provider, list]) => (
                      <optgroup key={provider} label={provider}>
                        {list.map((m) => (
                          <option key={m.name} value={m.name}>
                            {m.label ?? m.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-medium">{t('cloudProviders')}</label>
                  <p className="mb-2 mt-1 text-xs text-muted">{t('cloudProvidersHint')}</p>
                  <div className="space-y-3">
                    {providers.map((p) => (
                      <div key={p.id} className="rounded-lg border border-line p-3">
                        <div className="mb-2 flex items-center gap-2">
                          <input
                            value={p.label}
                            onChange={(e) => patchProvider(p.id, { label: e.target.value })}
                            onBlur={() => persistProviders(providers)}
                            placeholder={t('displayName')}
                            className="flex-1 rounded-md border border-line bg-transparent px-2 py-1"
                          />
                          <button
                            onClick={() => void verifyProvider(p.id)}
                            className="text-xs text-accent hover:underline"
                          >
                            验证
                          </button>
                          <button
                            onClick={() => removeProvider(p.id)}
                            className="text-xs text-muted hover:text-red-500"
                          >
                            {t('remove')}
                          </button>
                        </div>
                        {verifyMsg[p.id] && (
                          <p
                            className={`mb-1 text-xs ${verifyMsg[p.id].startsWith('✓') ? 'text-green-500' : 'text-red-500'}`}
                          >
                            {verifyMsg[p.id]}
                          </p>
                        )}
                        <input
                          value={p.baseUrl}
                          onChange={(e) => patchProvider(p.id, { baseUrl: e.target.value })}
                          onBlur={() => persistProviders(providers)}
                          placeholder="Base URL, e.g. https://api.deepseek.com/v1"
                          className="mb-2 w-full rounded-md border border-line bg-transparent px-2 py-1 font-mono text-xs"
                        />
                        <input
                          value={p.apiKey ?? ''}
                          onChange={(e) => patchProvider(p.id, { apiKey: e.target.value })}
                          onBlur={() => persistProviders(providers)}
                          placeholder="API Key"
                          type="password"
                          className="mb-2 w-full rounded-md border border-line bg-transparent px-2 py-1 font-mono text-xs"
                        />
                        <input
                          value={(p.models ?? []).join(',')}
                          onChange={(e) =>
                            patchProvider(p.id, {
                              models: e.target.value
                                .split(',')
                                .map((m) => m.trim())
                                .filter(Boolean)
                            })
                          }
                          onBlur={() => persistProviders(providers)}
                          placeholder={t('modelsCsvPh')}
                          className="w-full rounded-md border border-line bg-transparent px-2 py-1 font-mono text-xs"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(['deepseek', 'minimax', 'openai', 'custom'] as const).map((k) => (
                      <button
                        key={k}
                        onClick={() => addProvider(k)}
                        className="rounded-md border border-line px-2 py-1 text-xs text-muted transition hover:border-accent hover:text-accent"
                      >
                        + {PROVIDER_PRESETS[k].label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {cat === 'voice' && (
              <div>
                <label className="mb-1 block font-medium">{t('asrTitle')}</label>
                <p className="mb-2 text-xs text-muted">{t('asrHint')}</p>
                <div className="flex gap-2">
                  <select
                    value={settings.asrProviderId ?? ''}
                    onChange={(e) => void update({ asrProviderId: e.target.value || undefined })}
                    className={`${input} flex-1`}
                  >
                    <option value="">{t('asrOff')}</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={settings.asrModel ?? ''}
                    onChange={(e) => void update({ asrModel: e.target.value || undefined })}
                    placeholder={t('asrModelPh')}
                    className="flex-1 rounded-md border border-line bg-transparent px-2 py-1.5 font-mono text-xs"
                  />
                </div>
              </div>
            )}

            {cat === 'mcp' && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="font-medium">{t('mcpTitle')}</label>
                  <div className="flex gap-2">
                    <button
                      onClick={testMcp}
                      disabled={mcpTesting}
                      className="rounded-md bg-surface-2 px-2 py-0.5 text-xs disabled:opacity-50"
                    >
                      {mcpTesting ? t('mcpTesting') : t('testConnection')}
                    </button>
                    <button
                      onClick={saveMcp}
                      className="rounded-md bg-surface-2 px-2 py-0.5 text-xs"
                    >
                      {t('save')}
                    </button>
                  </div>
                </div>
                {mcpStatus && (
                  <ul className="mb-2 space-y-1">
                    {mcpStatus.length === 0 ? (
                      <li className="text-xs text-muted">（未配置 MCP server）</li>
                    ) : (
                      mcpStatus.map((m) => (
                        <li key={m.name} className="rounded-md bg-surface-2 px-2 py-1 text-xs">
                          <span className={m.ok ? 'text-green-500' : 'text-red-500'}>
                            {m.ok ? '●' : '○'}
                          </span>{' '}
                          <span className="font-mono">{m.name}</span>{' '}
                          {m.ok ? (
                            <span className="text-muted">工具×{m.toolCount}</span>
                          ) : (
                            <span className="text-red-500">{m.error}</span>
                          )}
                        </li>
                      ))
                    )}
                  </ul>
                )}
                <textarea
                  value={mcpText}
                  onChange={(e) => setMcpText(e.target.value)}
                  onBlur={saveMcp}
                  rows={12}
                  spellCheck={false}
                  className="w-full rounded-md border border-line bg-transparent p-2 font-mono text-xs"
                />
                {mcpError ? (
                  <p className="mt-1 text-xs text-red-500">JSON: {mcpError}</p>
                ) : (
                  <p className="mt-1 whitespace-pre-wrap break-all text-xs text-muted">
                    {
                      'stdio: { "fs": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "PATH"] } }\n'
                    }
                    {'http: { "remote": { "url": "https://example.com/mcp", "type": "http" } }'}
                  </p>
                )}
              </div>
            )}

            {cat === 'skills' && (
              <>
                <div>
                  <label className="mb-1 block font-medium">🛒 {t('marketplace')}</label>
                  <div className="grid grid-cols-2 gap-2">
                    {catalog.map((c) => (
                      <div
                        key={c.id}
                        className="flex flex-col rounded-lg border border-line bg-surface-2 p-2"
                      >
                        <div className="flex items-start gap-2">
                          <span className="text-lg leading-none">{c.icon}</span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{c.name}</div>
                            <p className="text-xs text-muted">{c.description}</p>
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            void (c.installed ? uninstallCatalog(c.id) : installCatalog(c.id))
                          }
                          className={`mt-2 self-end rounded-md px-2 py-0.5 text-xs ${
                            c.installed
                              ? 'border border-line text-muted hover:text-fg'
                              : 'border border-line bg-surface-2 text-fg hover:bg-accent-soft'
                          }`}
                        >
                          {c.installed ? t('uninstall') : t('install')}
                        </button>
                      </div>
                    ))}
                  </div>
                  {pluginMsg && (
                    <p
                      className={`mt-1 text-xs ${
                        pluginMsg.startsWith('✓') ? 'text-green-500' : 'text-red-500'
                      }`}
                    >
                      {pluginMsg}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted">{t('skillsInstalledHint')}</p>
                </div>
                <div>
                  <label className="mb-1 block font-medium">{t('skillsTitle')}</label>
                  {skills.length === 0 ? (
                    <p className="text-xs text-muted">
                      <code>.hemilier/skills/</code> · <code>userData/skills</code>
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {skills.map((s) => (
                        <li key={s.name} className="rounded-md bg-surface-2 px-2 py-1">
                          <span className="font-mono text-accent">{s.name}</span>
                          <span className="ml-1 text-xs text-muted">[{s.source}]</span>
                          {s.description && <p className="text-xs text-muted">{s.description}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="font-medium">{t('pluginsTitle')}</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => void installPlugin()}
                        className="rounded-md bg-surface-2 px-2 py-0.5 text-xs"
                      >
                        {t('installPlugin')}
                      </button>
                      <button
                        onClick={() => void window.api.openPluginsDir()}
                        className="rounded-md bg-surface-2 px-2 py-0.5 text-xs"
                      >
                        {t('openPluginsDir')}
                      </button>
                    </div>
                  </div>
                  {plugins.length === 0 ? (
                    <p className="text-xs text-muted">
                      <code>userData/plugins/&lt;name&gt;/plugin.json</code>
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {plugins.map((p) => (
                        <li
                          key={p.name}
                          className="flex items-center justify-between rounded-md bg-surface-2 px-2 py-1"
                        >
                          <div className="min-w-0">
                            <span className="font-mono">{p.name}</span>
                            <span className="ml-1 text-xs text-muted">
                              MCP×{p.mcpCount}
                              {p.hasSkills ? ' · skills✓' : ''}
                            </span>
                            {p.description && (
                              <p className="truncate text-xs text-muted">{p.description}</p>
                            )}
                          </div>
                          <input
                            type="checkbox"
                            checked={p.enabled}
                            onChange={(e) => void togglePlugin(p.name, e.target.checked)}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}

            {cat === 'shortcuts' && (
              <ul className="space-y-1.5">
                {(
                  [
                    ['scNew', '⌘/Ctrl + N'],
                    ['scExport', '⌘/Ctrl + ⇧ + E'],
                    ['scSettings', '⌘/Ctrl + ,'],
                    ['scSidebar', '⌘/Ctrl + \\'],
                    ['scSpaces', '⌘/Ctrl + 1 / 2 / 3'],
                    ['scStop', 'Esc'],
                    ['scSend', settings.submitKey === 'mod-enter' ? '⌘/Ctrl + Enter' : 'Enter'],
                    ['scNewline', settings.submitKey === 'mod-enter' ? 'Enter' : '⇧ + Enter'],
                    ['scAtFile', '@']
                  ] as const
                ).map(([label, keys]) => (
                  <li
                    key={label}
                    className="flex items-center justify-between rounded-md bg-surface-2 px-2.5 py-1.5"
                  >
                    <span>{(t as unknown as (k: string) => string)(label)}</span>
                    <kbd className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-xs">
                      {keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            )}

            {cat === 'about' && (
              <div className="space-y-2">
                <div className="text-lg font-semibold">{t('appTagline')}</div>
                <div className="text-xs text-muted">v0.1.0</div>
                <p className="text-muted">{t('aboutDesc')}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
