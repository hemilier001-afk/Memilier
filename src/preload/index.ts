import { contextBridge, ipcRenderer } from 'electron'
import type { Api, PermissionRequest } from '@shared/types'

const api: Api = {
  platform: process.platform,
  home: process.env.HOME ?? process.env.USERPROFILE ?? '',
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  listModels: () => ipcRenderer.invoke('ollama:listModels'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  listConversations: () => ipcRenderer.invoke('conversations:list'),
  getConversation: (id) => ipcRenderer.invoke('conversations:get', id),
  createConversation: (kind, projectId) =>
    ipcRenderer.invoke('conversations:create', kind, projectId),
  setConversationProject: (id, projectId) =>
    ipcRenderer.invoke('conversations:setProject', id, projectId),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (name, kind) => ipcRenderer.invoke('projects:create', name, kind),
  renameProject: (id, name) => ipcRenderer.invoke('projects:rename', id, name),
  deleteProject: (id) => ipcRenderer.invoke('projects:delete', id),
  deleteConversation: (id) => ipcRenderer.invoke('conversations:delete', id),
  renameConversation: (id, title) => ipcRenderer.invoke('conversations:rename', id, title),
  setConversationModel: (id, model) => ipcRenderer.invoke('conversations:setModel', id, model),
  setConversationMode: (id, mode) => ipcRenderer.invoke('conversations:setMode', id, mode),
  setConversationApproval: (id, mode) => ipcRenderer.invoke('conversations:setApproval', id, mode),
  auditList: (limit) => ipcRenderer.invoke('audit:list', limit),
  auditOpen: () => ipcRenderer.invoke('audit:open'),
  extractDocument: (ws, rel) => ipcRenderer.invoke('office:extract', ws, rel),
  extractDocumentPath: (absPath) => ipcRenderer.invoke('office:extractPath', absPath),
  setConversationWorkspace: (id, dir) => ipcRenderer.invoke('conversations:setWorkspace', id, dir),
  pickFile: () => ipcRenderer.invoke('dialog:pickFile'),
  transcribeAudio: (bytes, mime) => ipcRenderer.invoke('asr:transcribe', bytes, mime),
  sendMessage: (conversationId, content, images, userMessageId) =>
    ipcRenderer.invoke('agent:send', conversationId, content, images, userMessageId),
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),
  readImage: (ref) => ipcRenderer.invoke('images:read', ref),
  regenerate: (conversationId) => ipcRenderer.invoke('agent:regenerate', conversationId),
  truncateFrom: (conversationId, messageId) =>
    ipcRenderer.invoke('conversations:truncateFrom', conversationId, messageId),
  compactConversation: (conversationId) =>
    ipcRenderer.invoke('conversations:compact', conversationId),
  exportConversation: (conversationId) =>
    ipcRenderer.invoke('conversations:export', conversationId),
  listFiles: (workspaceDir) => ipcRenderer.invoke('workspace:listFiles', workspaceDir),
  abort: (conversationId) => ipcRenderer.invoke('agent:abort', conversationId),
  respondPermission: (id, approved, remember) =>
    ipcRenderer.invoke('permission:respond', id, approved, remember),
  pickWorkspace: () => ipcRenderer.invoke('dialog:pickWorkspace'),
  readDir: (workspaceDir, relPath) =>
    ipcRenderer.invoke('workspace:readDir', workspaceDir, relPath),
  gitStatus: (ws) => ipcRenderer.invoke('git:status', ws),
  gitDiff: (ws, path, staged) => ipcRenderer.invoke('git:diff', ws, path, staged),
  gitStage: (ws, path) => ipcRenderer.invoke('git:stage', ws, path),
  gitUnstage: (ws, path) => ipcRenderer.invoke('git:unstage', ws, path),
  gitCommit: (ws, message) => ipcRenderer.invoke('git:commit', ws, message),
  gitInit: (ws) => ipcRenderer.invoke('git:init', ws),
  listMemory: (ws) => ipcRenderer.invoke('memory:list', ws),
  addMemory: (ws, text, type, scope) => ipcRenderer.invoke('memory:add', ws, text, type, scope),
  forgetMemory: (ws, id) => ipcRenderer.invoke('memory:forget', ws, id),
  resolvePendingMemory: (ws, id, adopt) =>
    ipcRenderer.invoke('memory:resolvePending', ws, id, adopt),
  consolidateMemory: (ws, scope) => ipcRenderer.invoke('memory:consolidate', ws, scope),
  applyConsolidation: (ws, scope, entries) =>
    ipcRenderer.invoke('memory:applyConsolidation', ws, scope, entries),
  readWorkspaceFile: (workspaceDir, relPath) =>
    ipcRenderer.invoke('workspace:readFile', workspaceDir, relPath),
  writeWorkspaceFile: (workspaceDir, relPath, content) =>
    ipcRenderer.invoke('workspace:writeFile', workspaceDir, relPath, content),
  listSkills: () => ipcRenderer.invoke('skills:list'),
  listAgents: (ws) => ipcRenderer.invoke('agents:list', ws),
  listCommands: (ws) => ipcRenderer.invoke('commands:list', ws),
  searchConversations: (q) => ipcRenderer.invoke('conversations:search', q),
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),
  listPlugins: () => ipcRenderer.invoke('plugins:list'),
  setPluginEnabled: (name, enabled) => ipcRenderer.invoke('plugins:setEnabled', name, enabled),
  openPluginsDir: () => ipcRenderer.invoke('plugins:openDir'),
  installPlugin: () => ipcRenderer.invoke('plugins:install'),
  pluginCatalog: () => ipcRenderer.invoke('plugins:catalog'),
  installCatalogPlugin: (id) => ipcRenderer.invoke('plugins:installCatalog', id),
  uninstallPlugin: (id) => ipcRenderer.invoke('plugins:uninstall', id),
  mcpStatus: () => ipcRenderer.invoke('mcp:status'),
  trustMcp: (name) => ipcRenderer.invoke('mcp:trust', name),
  mcpCatalog: () => ipcRenderer.invoke('mcp:catalog'),
  mcpConnect: (id, input) => ipcRenderer.invoke('mcp:connect', id, input),
  mcpSearch: (query) => ipcRenderer.invoke('mcp:search', query),
  mcpInstallRegistry: (entry, input) => ipcRenderer.invoke('mcp:installRegistry', entry, input),
  mcpSetEnabled: (name, enabled) => ipcRenderer.invoke('mcp:setEnabled', name, enabled),
  mcpRemove: (name) => ipcRenderer.invoke('mcp:remove', name),
  mcpImport: (text) => ipcRenderer.invoke('mcp:import', text),
  readClipboardText: () => ipcRenderer.invoke('clipboard:read'),
  appVersion: () => ipcRenderer.invoke('app:version'),
  runTerminal: (conversationId, workspaceDir, command) =>
    ipcRenderer.invoke('terminal:run', conversationId, workspaceDir, command),
  killTerminal: (conversationId) => ipcRenderer.invoke('terminal:kill', conversationId),
  listRoutines: () => ipcRenderer.invoke('routines:list'),
  saveRoutine: (routine) => ipcRenderer.invoke('routines:save', routine),
  deleteRoutine: (id) => ipcRenderer.invoke('routines:delete', id),
  runRoutineNow: (id) => ipcRenderer.invoke('routines:runNow', id),
  listTasks: () => ipcRenderer.invoke('tasks:list'),
  cancelTask: (taskId) => ipcRenderer.invoke('tasks:cancel', taskId),
  setConversationPinned: (id, pinned) => ipcRenderer.invoke('conversations:setPinned', id, pinned),
  testProvider: (providerId) => ipcRenderer.invoke('providers:test', providerId),
  logError: (msg) => ipcRenderer.send('log:renderer', msg),
  openUrl: (url) => ipcRenderer.invoke('shell:openUrl', url),

  onAgentEvent: (cb) => {
    const listener = (_e: unknown, payload: Parameters<typeof cb>[0]): void => cb(payload)
    ipcRenderer.on('agent:event', listener)
    return () => ipcRenderer.removeListener('agent:event', listener)
  },
  onPermissionRequest: (cb) => {
    const listener = (_e: unknown, req: PermissionRequest): void => cb(req)
    ipcRenderer.on('permission:request', listener)
    return () => ipcRenderer.removeListener('permission:request', listener)
  },
  onTerminalEvent: (cb) => {
    const listener = (_e: unknown, ev: Parameters<typeof cb>[0]): void => cb(ev)
    ipcRenderer.on('terminal:event', listener)
    return () => ipcRenderer.removeListener('terminal:event', listener)
  },
  onTasksUpdate: (cb) => {
    const listener = (_e: unknown, tasks: Parameters<typeof cb>[0]): void => cb(tasks)
    ipcRenderer.on('tasks:update', listener)
    return () => ipcRenderer.removeListener('tasks:update', listener)
  },
  onMemoryUpdated: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('memory:updated', listener)
    return () => ipcRenderer.removeListener('memory:updated', listener)
  },
  onConversationsUpdated: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('conversations:updated', listener)
    return () => ipcRenderer.removeListener('conversations:updated', listener)
  },
  onUpdateAvailable: (cb) => {
    const listener = (_e: unknown, info: Parameters<typeof cb>[0]): void => cb(info)
    ipcRenderer.on('update:available', listener)
    return () => ipcRenderer.removeListener('update:available', listener)
  },
  onMenuAction: (cb) => {
    const listener = (_e: unknown, action: string): void => cb(action)
    ipcRenderer.on('menu:action', listener)
    return () => ipcRenderer.removeListener('menu:action', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
