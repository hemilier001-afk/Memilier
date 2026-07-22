import { useEffect, useState } from 'react'
import type {
  AgentInfo,
  McpConnectorInfo,
  PluginCatalogItem,
  PluginInfo,
  ProviderConfig,
  SkillInfo
} from '@shared/types'
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
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [mcpStatus, setMcpStatus] = useState<
    | {
        name: string
        ok: boolean
        toolCount: number
        error?: string
        untrusted?: boolean
        source?: 'user' | 'plugin'
      }[]
    | null
  >(null)
  const [mcpTesting, setMcpTesting] = useState(false)
  const [pluginMsg, setPluginMsg] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<PluginCatalogItem[]>([])
  const [connectors, setConnectors] = useState<McpConnectorInfo[]>([])
  const [connectForm, setConnectForm] = useState<string | null>(null)
  const [connectEnv, setConnectEnv] = useState<Record<string, string>>({})
  const [connectArgs, setConnectArgs] = useState<string[]>([])
  const [connectMsg, setConnectMsg] = useState<string | null>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      const s = useStore.getState().settings
      setMcpText(JSON.stringify(s?.mcpServers ?? {}, null, 2))
      setProviders(s?.providers ?? [])
      setMcpError(null)
      void window.api.listSkills().then(setSkills)
      void window.api.listAgents(useStore.getState().settings?.workspaceDir ?? '').then(setAgents)
      void window.api.listPlugins().then(setPlugins)
      void window.api.pluginCatalog().then(setCatalog)
      void window.api.mcpCatalog().then(setConnectors)
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

  /** 接入/启停/删除/导入后统一刷新：设置、JSON 文本、目录 installed 标记、探活 */
  const refreshMcpAll = async (): Promise<void> => {
    const s = await window.api.getSettings()
    useStore.setState({ settings: s })
    setMcpText(JSON.stringify(s.mcpServers ?? {}, null, 2))
    setConnectors(await window.api.mcpCatalog())
    await testMcp()
  }
  const beginConnect = (c: McpConnectorInfo): void => {
    // 无需填写任何字段的连接器：点了直接接入
    if (!(c.envFields?.length || c.argFields?.length)) {
      void window.api.mcpConnect(c.id, {}).then((r) => {
        if (r.ok) void refreshMcpAll()
      })
      return
    }
    setConnectForm(c.id)
    setConnectEnv({})
    setConnectArgs([])
    setConnectMsg(null)
  }
  const doConnect = async (c: McpConnectorInfo): Promise<void> => {
    setConnectMsg(null)
    const r = await window.api.mcpConnect(c.id, { env: connectEnv, extraArgs: connectArgs })
    if (!r.ok) {
      setConnectMsg(r.error ?? 'failed')
      return
    }
    setConnectForm(null)
    await refreshMcpAll()
  }
  const importFromClipboard = async (): Promise<void> => {
    setImportMsg(null)
    const text = await window.api.readClipboardText()
    const r = await window.api.mcpImport(text)
    setImportMsg(
      r.ok ? `✓ ${t('mcpImported').replace('{n}', String(r.added ?? 0))}` : `✗ ${r.error}`
    )
    if (r.ok) await refreshMcpAll()
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
                  <label className="mb-1 block font-medium">{t('backupTitle')}</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        void window.api.exportData().then((r) => {
                          if (r.ok) setPluginMsg(t('exportedToast'))
                        })
                      }
                      className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm text-fg transition hover:bg-accent-soft"
                    >
                      {t('exportBtn')}
                    </button>
                    <button
                      onClick={() =>
                        void window.api.importData().then((r) => {
                          if (r.ok) {
                            setPluginMsg(
                              t('importedToast').replace('{c}', String(r.conversations ?? 0))
                            )
                            void useStore.getState().init()
                          }
                        })
                      }
                      className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm text-fg transition hover:bg-accent-soft"
                    >
                      {t('importBtn')}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-muted">{t('backupHint')}</p>
                </div>
                <div>
                  <label className="mb-1 block font-medium">{t('proxyLabel')}</label>
                  <input
                    key={`proxy-${settings.proxyUrl ?? ''}`}
                    defaultValue={settings.proxyUrl ?? ''}
                    placeholder="http://127.0.0.1:7890"
                    onBlur={(e) => void update({ proxyUrl: e.target.value.trim() })}
                    className={input}
                  />
                  <p className="mt-1 text-xs text-muted">{t('proxyHint')}</p>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="mb-1 block font-medium">Temperature</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      key={`temp-${settings.temperature ?? ''}`}
                      defaultValue={settings.temperature ?? ''}
                      onBlur={(e) =>
                        void update({
                          temperature: e.target.value === '' ? undefined : Number(e.target.value)
                        })
                      }
                      className={input}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="mb-1 block font-medium">Max tokens</label>
                    <input
                      type="number"
                      step="256"
                      min="1"
                      key={`maxtok-${settings.maxTokens ?? ''}`}
                      defaultValue={settings.maxTokens ?? ''}
                      onBlur={(e) =>
                        void update({
                          maxTokens: e.target.value === '' ? undefined : Number(e.target.value)
                        })
                      }
                      className={input}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted">{t('temperatureLabel')}</p>
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
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.enableHooks ?? false}
                      onChange={(e) => void update({ enableHooks: e.target.checked })}
                    />
                    {t('hooksLabel')}
                  </label>
                  <p className="mt-1 text-xs text-muted">{t('hooksHint')}</p>
                </div>
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
              <div className="space-y-5">
                {/* ① 连接器目录：一键接入 */}
                <div>
                  <label className="mb-0.5 block font-medium">{t('mcpCatalogTitle')}</label>
                  <p className="mb-2 text-xs text-muted">{t('mcpCatalogHint')}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {connectors.map((c) => (
                      <div
                        key={c.id}
                        className="flex flex-col rounded-lg border border-line bg-surface-2 p-2.5"
                      >
                        <div className="flex items-start gap-2">
                          <span className="text-lg leading-none">{c.icon}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium">{c.name}</span>
                              <span className="rounded bg-surface px-1 text-[10px] text-muted">
                                {c.category}
                              </span>
                            </div>
                            <p className="mt-0.5 text-xs leading-snug text-muted">
                              {c.description}
                            </p>
                          </div>
                        </div>
                        {connectForm === c.id ? (
                          <div className="mt-2 space-y-1.5">
                            {(c.argFields ?? []).map((f, i) => (
                              <input
                                key={f.label}
                                value={connectArgs[i] ?? ''}
                                onChange={(e) => {
                                  const next = [...connectArgs]
                                  next[i] = e.target.value
                                  setConnectArgs(next)
                                }}
                                placeholder={`${f.label}${f.required ? ' *' : ''}（${f.placeholder}）`}
                                className="w-full rounded-md border border-line bg-transparent px-2 py-1 text-xs"
                              />
                            ))}
                            {(c.envFields ?? []).map((f) => (
                              <input
                                key={f.key}
                                type={f.secret ? 'password' : 'text'}
                                value={connectEnv[f.key] ?? ''}
                                onChange={(e) =>
                                  setConnectEnv({ ...connectEnv, [f.key]: e.target.value })
                                }
                                placeholder={`${f.label}${f.required ? ' *' : ''}`}
                                className="w-full rounded-md border border-line bg-transparent px-2 py-1 text-xs"
                              />
                            ))}
                            {connectMsg && <p className="text-xs text-red-500">{connectMsg}</p>}
                            <div className="flex justify-end gap-1.5">
                              <button
                                onClick={() => setConnectForm(null)}
                                className="rounded px-2 py-0.5 text-xs text-muted hover:text-fg"
                              >
                                {t('cancel')}
                              </button>
                              <button
                                onClick={() => void doConnect(c)}
                                className="rounded border border-line bg-surface px-2 py-0.5 text-xs text-fg hover:bg-accent-soft"
                              >
                                {t('mcpConnect')}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => beginConnect(c)}
                            disabled={c.installed}
                            className="mt-2 self-end rounded border border-line bg-surface px-2.5 py-0.5 text-xs text-fg transition hover:bg-accent-soft disabled:cursor-default disabled:opacity-60 disabled:hover:bg-surface"
                          >
                            {c.installed ? `✓ ${t('mcpConnected')}` : t('mcpConnect')}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* ② 已安装管理：状态/启停/信任/删除 */}
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <label className="font-medium">{t('mcpTitle')}</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => void importFromClipboard()}
                        className="rounded-md bg-surface-2 px-2 py-0.5 text-xs"
                        title={t('mcpImportTip')}
                      >
                        {t('mcpImport')}
                      </button>
                      <button
                        onClick={testMcp}
                        disabled={mcpTesting}
                        className="rounded-md bg-surface-2 px-2 py-0.5 text-xs disabled:opacity-50"
                      >
                        {mcpTesting ? t('mcpTesting') : t('testConnection')}
                      </button>
                    </div>
                  </div>
                  {importMsg && <p className="mb-1 text-xs text-muted">{importMsg}</p>}
                  {mcpStatus && (
                    <ul className="space-y-1">
                      {mcpStatus.length === 0 ? (
                        <li className="text-xs text-muted">{t('mcpNone')}</li>
                      ) : (
                        mcpStatus.map((m) => (
                          <li
                            key={m.name}
                            className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-xs"
                          >
                            <span
                              className={
                                m.untrusted
                                  ? 'text-amber-500'
                                  : m.ok
                                    ? 'text-green-500'
                                    : settings?.mcpServers?.[m.name]?.enabled === false
                                      ? 'text-muted'
                                      : 'text-red-500'
                              }
                            >
                              {m.untrusted ? '⚠' : m.ok ? '●' : '○'}
                            </span>
                            <span className="truncate font-mono">{m.name}</span>
                            {m.source === 'plugin' && (
                              <span className="rounded bg-surface px-1 text-[10px] text-muted">
                                {t('mcpFromPlugin')}
                              </span>
                            )}
                            {m.untrusted ? (
                              <span className="text-amber-500">{t('mcpNeedsTrust')}</span>
                            ) : m.ok ? (
                              <span className="text-muted">
                                {t('mcpTools').replace('{n}', String(m.toolCount))}
                              </span>
                            ) : settings?.mcpServers?.[m.name]?.enabled === false ? (
                              <span className="text-muted">{t('mcpDisabled')}</span>
                            ) : (
                              <span className="truncate text-red-500">{m.error}</span>
                            )}
                            <span className="ml-auto flex shrink-0 items-center gap-1.5">
                              {m.untrusted && (
                                <button
                                  onClick={() =>
                                    void window.api.trustMcp(m.name).then(() => void testMcp())
                                  }
                                  className="rounded border border-line px-2 py-0.5 text-fg hover:bg-accent-soft"
                                >
                                  {t('mcpTrust')}
                                </button>
                              )}
                              {m.source === 'user' && !m.untrusted && (
                                <label
                                  className="flex cursor-pointer items-center gap-1 text-muted"
                                  title={t('mcpEnabledTip')}
                                >
                                  <input
                                    type="checkbox"
                                    checked={settings?.mcpServers?.[m.name]?.enabled !== false}
                                    onChange={(e) =>
                                      void window.api
                                        .mcpSetEnabled(m.name, e.target.checked)
                                        .then(() => void refreshMcpAll())
                                    }
                                  />
                                </label>
                              )}
                              {m.source === 'user' && (
                                <button
                                  onClick={() => {
                                    if (confirm(t('mcpRemoveConfirm').replace('{name}', m.name)))
                                      void window.api
                                        .mcpRemove(m.name)
                                        .then(() => void refreshMcpAll())
                                  }}
                                  className="text-muted hover:text-red-500"
                                  title={t('deleteChat')}
                                >
                                  ✕
                                </button>
                              )}
                            </span>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </div>

                {/* ③ 高级：手动 JSON（折叠） */}
                <details>
                  <summary className="cursor-pointer text-xs text-muted hover:text-fg">
                    {t('mcpAdvanced')}
                  </summary>
                  <div className="mt-2">
                    <textarea
                      value={mcpText}
                      onChange={(e) => setMcpText(e.target.value)}
                      onBlur={saveMcp}
                      rows={10}
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
                </details>
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
                  <label className="mb-1 block font-medium">{t('agentsTitle')}</label>
                  <ul className="space-y-1">
                    {agents.map((a) => (
                      <li key={a.name} className="rounded-md bg-surface-2 px-2 py-1">
                        <span className="font-mono text-accent">{a.name}</span>
                        <span className="ml-1 text-xs text-muted">[{a.source}]</span>
                        {a.description && <p className="text-xs text-muted">{a.description}</p>}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-muted">{t('agentsHint')}</p>
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
