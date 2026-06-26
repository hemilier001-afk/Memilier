import { contextBridge, ipcRenderer } from 'electron'
import type { Api, PermissionRequest } from '@shared/types'

const api: Api = {
  platform: process.platform,
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
  setConversationWorkspace: (id, dir) => ipcRenderer.invoke('conversations:setWorkspace', id, dir),
  pickFile: () => ipcRenderer.invoke('dialog:pickFile'),
  transcribeAudio: (bytes, mime) => ipcRenderer.invoke('asr:transcribe', bytes, mime),
  sendMessage: (conversationId, content, images) =>
    ipcRenderer.invoke('agent:send', conversationId, content, images),
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),
  readImage: (ref) => ipcRenderer.invoke('images:read', ref),
  regenerate: (conversationId) => ipcRenderer.invoke('agent:regenerate', conversationId),
  truncateFrom: (conversationId, messageId) =>
    ipcRenderer.invoke('conversations:truncateFrom', conversationId, messageId),
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
  addMemory: (ws, text, type) => ipcRenderer.invoke('memory:add', ws, text, type),
  forgetMemory: (ws, id) => ipcRenderer.invoke('memory:forget', ws, id),
  readWorkspaceFile: (workspaceDir, relPath) =>
    ipcRenderer.invoke('workspace:readFile', workspaceDir, relPath),
  writeWorkspaceFile: (workspaceDir, relPath, content) =>
    ipcRenderer.invoke('workspace:writeFile', workspaceDir, relPath, content),
  listSkills: () => ipcRenderer.invoke('skills:list'),
  listPlugins: () => ipcRenderer.invoke('plugins:list'),
  setPluginEnabled: (name, enabled) => ipcRenderer.invoke('plugins:setEnabled', name, enabled),
  openPluginsDir: () => ipcRenderer.invoke('plugins:openDir'),
  installPlugin: () => ipcRenderer.invoke('plugins:install'),
  pluginCatalog: () => ipcRenderer.invoke('plugins:catalog'),
  installCatalogPlugin: (id) => ipcRenderer.invoke('plugins:installCatalog', id),
  uninstallPlugin: (id) => ipcRenderer.invoke('plugins:uninstall', id),
  mcpStatus: () => ipcRenderer.invoke('mcp:status'),
  runTerminal: (conversationId, workspaceDir, command) =>
    ipcRenderer.invoke('terminal:run', conversationId, workspaceDir, command),
  killTerminal: (conversationId) => ipcRenderer.invoke('terminal:kill', conversationId),
  listRoutines: () => ipcRenderer.invoke('routines:list'),
  saveRoutine: (routine) => ipcRenderer.invoke('routines:save', routine),
  deleteRoutine: (id) => ipcRenderer.invoke('routines:delete', id),
  runRoutineNow: (id) => ipcRenderer.invoke('routines:runNow', id),
  listTasks: () => ipcRenderer.invoke('tasks:list'),

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
  onMenuAction: (cb) => {
    const listener = (_e: unknown, action: string): void => cb(action)
    ipcRenderer.on('menu:action', listener)
    return () => ipcRenderer.removeListener('menu:action', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
