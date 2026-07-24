import { useEffect, useState } from 'react'
import type { AgentInfo, ProviderConfig, SkillInfo } from '@shared/types'
import { useStore } from '../store'
import { ExtensionsPanel } from './ExtensionsPanel'
import { AppIcon, StatusDot, Toggle } from './ui'
import {
  UsersIcon,
  SparklesIcon,
  ShieldIcon,
  ShieldOffIcon,
  ZapIcon,
  SlidersIcon,
  BrandIcon
} from './icons'
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

type Cat = 'general' | 'models' | 'voice' | 'security' | 'mcp' | 'skills' | 'shortcuts' | 'about'

const input =
  'w-full rounded-lg border border-line bg-surface/60 px-3 py-2 outline-none transition focus:border-accent focus:bg-surface'
// 区块标题：统一的分节标签样式，加大下边距让排版更舒展（借鉴 Claude/Codex 设置页的留白）
const label = 'mb-1.5 block text-[13px] font-medium text-fg'
const hint = 'mt-1.5 text-xs leading-relaxed text-muted'

export function SettingsModal(): JSX.Element | null {
  const t = useT()
  const open = useStore((s) => s.settingsOpen)
  const setOpen = useStore((s) => s.setSettingsOpen)
  const settings = useStore((s) => s.settings)
  const models = useStore((s) => s.models)
  const update = useStore((s) => s.updateSettings)

  const [cat, setCat] = useState<Cat>('general')
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [auditRows, setAuditRows] = useState<import('@shared/types').AuditEntry[]>([])
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    if (open) {
      const s = useStore.getState().settings
      setProviders(s?.providers ?? [])
      void window.api.listSkills().then(setSkills)
      void window.api.listAgents(useStore.getState().settings?.workspaceDir ?? '').then(setAgents)
      void window.api.appVersion().then(setAppVersion)
    }
  }, [open])

  // 审计日志按需加载：切到安全页时取最近 50 条
  useEffect(() => {
    if (open && cat === 'security') void window.api.auditList(50).then(setAuditRows)
  }, [open, cat])

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

  const [verifyMsg, setVerifyMsg] = useState<Record<string, string>>({})
  const [backupMsg, setBackupMsg] = useState<string | null>(null)
  const verifyProvider = async (id: string): Promise<void> => {
    setVerifyMsg((m) => ({ ...m, [id]: t('verifying') }))
    const r = await window.api.testProvider(id)
    setVerifyMsg((m) => ({ ...m, [id]: r.ok ? `✓ ${r.note ?? t('verifyOk')}` : `✗ ${r.error}` }))
  }

  const pickWorkspace = async (): Promise<void> => {
    const dir = await window.api.pickWorkspace()
    if (dir) await update({ workspaceDir: dir })
  }
  if (!open || !settings) return null

  const CATS: { key: Cat; label: string; icon: string }[] = [
    { key: 'general', label: t('setGeneral'), icon: '⚙' },
    { key: 'models', label: t('setModels'), icon: '🧠' },
    { key: 'voice', label: t('setVoice'), icon: '🎤' },
    { key: 'security', label: t('setSecurity'), icon: '🛡' },
    { key: 'mcp', label: t('extTitle'), icon: '🧩' },
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="flex h-[620px] max-h-[90vh] w-[840px] max-w-[94vw] overflow-hidden rounded-2xl border border-line bg-paper text-fg shadow-2xl">
        {/* 左侧分类菜单 */}
        <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-line bg-surface-2/60 p-3">
          <div className="px-2 pb-3 pt-1.5 text-[15px] font-semibold">{t('settings')}</div>
          {CATS.map((c) => (
            <button
              key={c.key}
              onClick={() => setCat(c.key)}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition ${
                cat === c.key
                  ? 'bg-accent-soft font-medium text-accent'
                  : 'text-muted hover:bg-accent-soft/50 hover:text-fg'
              }`}
            >
              <span className="text-base">{c.icon}</span>
              {c.label}
            </button>
          ))}
        </nav>

        {/* 右侧内容 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between px-8 py-5">
            <h2 className="text-lg font-semibold">{CATS.find((c) => c.key === cat)?.label}</h2>
            <button
              onClick={() => setOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg"
            >
              ✕
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-8 pb-8 pt-1 text-sm">
            {cat === 'general' && (
              <>
                <div>
                  <label className={label}>{t('profileSection')}</label>
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
                  <p className={hint}>{t('profileNamePh')}</p>
                </div>
                <div>
                  <label className={label}>{t('language')}</label>
                  <select
                    value={settings.language}
                    onChange={(e) => void update({ language: e.target.value as 'zh' | 'en' })}
                    className={input}
                  >
                    <option value="zh">中文</option>
                    <option value="en">English</option>
                  </select>
                  <p className={hint}>
                    English 界面覆盖主要区域；较新的功能界面暂以中文为准，将逐步补全。
                  </p>
                </div>
                <div>
                  <label className={label}>{t('backupTitle')}</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        void window.api.exportData().then((r) => {
                          if (r.ok) setBackupMsg(t('exportedToast'))
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
                            setBackupMsg(
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
                  {backupMsg && <p className="mt-1 text-xs text-green-500">{backupMsg}</p>}
                  <p className={hint}>{t('backupHint')}</p>
                </div>
                <div>
                  <label className={label}>{t('proxyLabel')}</label>
                  <input
                    key={`proxy-${settings.proxyUrl ?? ''}`}
                    defaultValue={settings.proxyUrl ?? ''}
                    placeholder="http://127.0.0.1:7890"
                    onBlur={(e) => void update({ proxyUrl: e.target.value.trim() })}
                    className={input}
                  />
                  <p className={hint}>{t('proxyHint')}</p>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className={label}>Temperature</label>
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
                    <label className={label}>Max tokens</label>
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
                  <label className={label}>{t('theme')}</label>
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
                  <label className={label}>{t('workspaceDir')}</label>
                  <div className="flex gap-2">
                    <input value={settings.workspaceDir} readOnly className={`${input} truncate`} />
                    <button
                      onClick={() => void pickWorkspace()}
                      className="shrink-0 rounded-md bg-surface-2 px-3 py-1.5 hover:bg-line"
                    >
                      {t('choose')}
                    </button>
                  </div>
                  <p className={hint}>{t('workspaceHint')}</p>
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
                  <p className={hint}>{t('hooksHint')}</p>
                </div>
                <div>
                  <label className={label}>{t('submitKey')}</label>
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
                  <label className={label}>{t('ollamaUrl')}</label>
                  <input
                    value={settings.ollamaBaseUrl}
                    onChange={(e) => void update({ ollamaBaseUrl: e.target.value })}
                    className={input}
                  />
                </div>
                <div>
                  <label className={label}>{t('defaultModel')}</label>
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
                <label className={label}>{t('asrTitle')}</label>
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

            {cat === 'security' && (
              <div className="space-y-6">
                {/* 默认权限模式（四挡，对齐 Codex 审批口径）；会话内可在模式菜单单独覆盖 */}
                <div>
                  <h3 className="mb-1 text-[13px] font-semibold text-fg">{t('apDefaultLabel')}</h3>
                  <p className="mb-2.5 text-xs leading-relaxed text-muted">{t('apDefaultHint')}</p>
                  <div className="space-y-2">
                    {(['ask', 'auto', 'full', 'custom'] as const).map((k) => {
                      const Icon =
                        k === 'ask'
                          ? ShieldIcon
                          : k === 'auto'
                            ? ZapIcon
                            : k === 'full'
                              ? ShieldOffIcon
                              : SlidersIcon
                      const active = (settings.approvalMode ?? 'ask') === k
                      const cap = `ap${k[0].toUpperCase()}${k.slice(1)}`
                      return (
                        <button
                          key={k}
                          onClick={() => void update({ approvalMode: k })}
                          className={`flex w-full items-center gap-3.5 rounded-xl border px-3.5 py-3 text-left transition ${
                            active
                              ? 'border-accent bg-accent-soft'
                              : 'border-line hover:bg-surface-2'
                          }`}
                        >
                          <AppIcon muted>
                            <Icon className="h-5 w-5" />
                          </AppIcon>
                          <div className="min-w-0 flex-1">
                            <div className="text-[15px] font-semibold text-fg">
                              {t(cap as 'apAsk')}
                            </div>
                            <div className="text-xs text-muted">
                              {t(`${cap}Desc` as 'apAskDesc')}
                            </div>
                          </div>
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                              active ? 'border-accent bg-accent text-white' : 'border-line'
                            }`}
                          >
                            {active ? '✓' : ''}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* 自定义策略：按类别 自动/询问（仅 custom 模式生效） */}
                {settings.approvalMode === 'custom' && (
                  <div>
                    <h3 className="mb-2 text-[13px] font-semibold text-fg">{t('polTitle')}</h3>
                    <div className="overflow-hidden rounded-xl border border-line">
                      {(
                        [
                          ['fileWrite', 'polFileWrite'],
                          ['command', 'polCommand'],
                          ['network', 'polNetwork'],
                          ['memorySkill', 'polMemorySkill'],
                          ['mcp', 'polMcp']
                        ] as const
                      ).map(([key, lbl], i) => {
                        const on = (settings.customPolicy?.[key] ?? 'ask') === 'auto'
                        return (
                          <div
                            key={key}
                            className={`flex items-center justify-between px-4 py-2.5 ${
                              i > 0 ? 'border-t border-line' : ''
                            }`}
                          >
                            <span className="text-sm text-fg">{t(lbl)}</span>
                            <div className="flex items-center gap-2.5">
                              <span className="text-xs text-muted">
                                {on ? t('polAuto') : t('polAsk')}
                              </span>
                              <Toggle
                                on={on}
                                onChange={() =>
                                  void update({
                                    customPolicy: {
                                      ...settings.customPolicy,
                                      [key]: on ? 'ask' : 'auto'
                                    }
                                  })
                                }
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* 命令沙箱（Seatbelt，仅 macOS） */}
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold text-fg">{t('sandboxLabel')}</div>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted">{t('sandboxHint')}</p>
                  </div>
                  <Toggle
                    on={settings.sandboxCommands ?? true}
                    onChange={() =>
                      void update({ sandboxCommands: !(settings.sandboxCommands ?? true) })
                    }
                  />
                </div>

                {/* 审计日志 */}
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <h3 className="text-[13px] font-semibold text-fg">{t('auditTitle')}</h3>
                    <div className="flex gap-2">
                      <button
                        onClick={() => void window.api.auditList(50).then(setAuditRows)}
                        className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs text-fg transition hover:bg-accent-soft"
                      >
                        {t('auditRefresh')}
                      </button>
                      <button
                        onClick={() => void window.api.auditOpen()}
                        className="rounded-lg bg-surface-2 px-2.5 py-1 text-xs text-fg transition hover:bg-accent-soft"
                      >
                        {t('auditOpenFile')}
                      </button>
                    </div>
                  </div>
                  <p className="mb-2 text-xs leading-relaxed text-muted">{t('auditHint')}</p>
                  {auditRows.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
                      {t('auditEmpty')}
                    </p>
                  ) : (
                    <div className="max-h-64 overflow-y-auto overflow-hidden rounded-xl border border-line">
                      {auditRows.map((a, i) => (
                        <div
                          key={`${a.ts}-${i}`}
                          className={`flex items-center gap-2 px-3 py-2 text-xs ${
                            i > 0 ? 'border-t border-line' : ''
                          }`}
                        >
                          <StatusDot tone={a.ok === false ? 'off' : 'ok'} />
                          <span className="shrink-0 text-muted">
                            {new Date(a.ts).toLocaleTimeString()}
                          </span>
                          <span className="font-mono text-fg">{a.tool}</span>
                          <span className="text-muted">
                            {t(
                              ({
                                preset: 'adPreset',
                                'rule-allow': 'adRuleAllow',
                                'rule-deny': 'adRuleDeny',
                                readonly: 'adReadonly',
                                remembered: 'adRemembered',
                                user: a.ok === false ? 'adUserDeny' : 'adUser',
                                unattended: 'adUnattended',
                                'hook-block': 'adHookBlock'
                              }[a.decision] ?? 'adUser') as 'adUser'
                            )}
                          </span>
                          {a.source === 'subagent' && <span className="text-muted">sub</span>}
                          <span
                            className="ml-auto shrink-0 truncate text-muted"
                            title={a.error ?? ''}
                          >
                            {a.error ? a.error.slice(0, 40) : a.ms != null ? `${a.ms}ms` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {cat === 'mcp' && <ExtensionsPanel />}

            {cat === 'skills' && (
              <div className="space-y-6">
                <div>
                  <h3 className="mb-1 text-[13px] font-semibold text-fg">{t('agentsTitle')}</h3>
                  <p className="mb-2 text-xs leading-relaxed text-muted">{t('agentsHint')}</p>
                  <div>
                    {agents.map((a) => (
                      <div key={a.name} className="flex items-center gap-3.5 py-2.5">
                        <AppIcon muted>
                          <UsersIcon className="h-5 w-5" />
                        </AppIcon>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[15px] font-semibold text-fg">
                              {a.name}
                            </span>
                            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                              {a.source}
                            </span>
                          </div>
                          {a.description && (
                            <p className="truncate text-[13px] text-muted">{a.description}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="mb-1 text-[13px] font-semibold text-fg">{t('skillsTitle')}</h3>
                  <p className="mb-2 text-xs leading-relaxed text-muted">{t('skillsHint')}</p>
                  {skills.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
                      <code>.hemilier/skills/</code> · <code>userData/skills</code>
                    </p>
                  ) : (
                    <div>
                      {skills.map((s) => (
                        <div key={s.name} className="flex items-center gap-3.5 py-2.5">
                          <AppIcon muted>
                            <SparklesIcon className="h-5 w-5" />
                          </AppIcon>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-[15px] font-semibold text-fg">
                                {s.name}
                              </span>
                              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                                {s.source}
                              </span>
                            </div>
                            {s.description && (
                              <p className="truncate text-[13px] text-muted">{s.description}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
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
              <div>
                <div className="mb-5 flex items-center gap-4">
                  <BrandIcon className="h-14 w-14 shrink-0" />
                  <div>
                    <div className="text-lg font-semibold">{t('appTagline')}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {appVersion ? `v${appVersion}` : ''}
                    </div>
                  </div>
                </div>
                <p className="text-[13px] leading-relaxed text-muted">{t('aboutDesc')}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {t('aboutFeatures')
                    .split(' · ')
                    .map((f) => (
                      <span
                        key={f}
                        className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs text-muted"
                      >
                        {f}
                      </span>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
