import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

// 原生应用菜单 + 快捷键。自定义项通过 menu:action 事件下发给渲染进程处理。
export function setupAppMenu(getWindow: () => BrowserWindow | null): void {
  const isMac = process.platform === 'darwin'
  const send = (action: string): void => {
    getWindow()?.webContents.send('menu:action', action)
  }
  const sep: MenuItemConstructorOptions = { type: 'separator' }

  const appMenu: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: 'hemilier',
          submenu: [
            { role: 'about', label: '关于 hemilier' },
            sep,
            { label: '设置…', accelerator: 'Cmd+,', click: () => send('settings') },
            sep,
            { role: 'services' },
            sep,
            { role: 'hide', label: '隐藏 hemilier' },
            { role: 'hideOthers', label: '隐藏其他' },
            { role: 'unhide', label: '全部显示' },
            sep,
            { role: 'quit', label: '退出 hemilier' }
          ]
        }
      ]
    : []

  const fileMenu: MenuItemConstructorOptions = {
    label: '文件',
    submenu: [
      { label: '新建对话', accelerator: 'CmdOrCtrl+N', click: () => send('new-chat') },
      { label: '导出对话…', accelerator: 'CmdOrCtrl+Shift+E', click: () => send('export') },
      ...(isMac
        ? []
        : [sep, { label: '设置…', accelerator: 'Ctrl+,', click: () => send('settings') }]),
      sep,
      isMac
        ? { role: 'close', label: '关闭窗口' }
        : ({ role: 'quit', label: '退出' } as MenuItemConstructorOptions)
    ]
  }

  const editMenu: MenuItemConstructorOptions = {
    label: '编辑',
    submenu: [
      { role: 'undo', label: '撤销' },
      { role: 'redo', label: '重做' },
      sep,
      { role: 'cut', label: '剪切' },
      { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' },
      { role: 'selectAll', label: '全选' }
    ]
  }

  const viewMenu: MenuItemConstructorOptions = {
    label: '视图',
    submenu: [
      { label: '显示/隐藏侧栏', accelerator: 'CmdOrCtrl+\\', click: () => send('toggle-sidebar') },
      sep,
      { role: 'reload', label: '重新加载' },
      { role: 'toggleDevTools', label: '开发者工具' },
      sep,
      { role: 'resetZoom', label: '实际大小' },
      { role: 'zoomIn', label: '放大' },
      { role: 'zoomOut', label: '缩小' },
      sep,
      { role: 'togglefullscreen', label: '全屏' }
    ]
  }

  const spaceMenu: MenuItemConstructorOptions = {
    label: '空间',
    submenu: [
      { label: 'Chat', accelerator: 'CmdOrCtrl+1', click: () => send('space:chat') },
      { label: 'Cowork', accelerator: 'CmdOrCtrl+2', click: () => send('space:cowork') },
      { label: 'Code', accelerator: 'CmdOrCtrl+3', click: () => send('space:code') },
      sep,
      { label: '回顾沉淀（反思）', click: () => send('reflect') }
    ]
  }

  const windowMenu: MenuItemConstructorOptions = {
    label: '窗口',
    submenu: [
      { role: 'minimize', label: '最小化' },
      ...(isMac ? [{ role: 'zoom' as const, label: '缩放' }] : []),
      { role: 'close', label: '关闭' }
    ]
  }

  const template: MenuItemConstructorOptions[] = [
    ...appMenu,
    fileMenu,
    editMenu,
    viewMenu,
    spaceMenu,
    windowMenu
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  void app // 保留对 app 的引用，便于将来扩展菜单
}
