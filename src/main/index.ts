import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, nativeImage, session, shell } from 'electron'
import { registerIpc } from './ipc'
import { setupAppMenu } from './menu'
import { mcpManager } from './mcp/manager'

// 主进程日志写文件 + 捕获未处理异常，便于排障（userData/main.log）
function setupLogging(): void {
  const logFile = join(app.getPath('userData'), 'main.log')
  const write = (level: string, parts: unknown[]): void => {
    try {
      appendFileSync(
        logFile,
        `[${new Date().toISOString()}] ${level} ${parts.map(String).join(' ')}\n`
      )
    } catch {
      /* 日志失败不影响运行 */
    }
  }
  process.on('uncaughtException', (e) => write('UNCAUGHT', [e?.stack ?? e]))
  process.on('unhandledRejection', (e) => write('UNHANDLED', [e]))
  const origErr = console.error.bind(console)
  console.error = (...args: unknown[]): void => {
    write('ERROR', args)
    origErr(...args)
  }
}

let mainWindow: BrowserWindow | null = null

// 应用名：开发模式下 Electron 默认显示 "Electron"，统一改为 Hemilier（菜单栏/关于/Dock）
app.setName('Hemilier')

// 单实例锁：避免开两个实例同时读写同一份 JSON 数据导致损坏
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// 开发模式下让 Dock/任务栏也显示自定义图标（打包版用 bundle 内的图标）
function applyDevIcon(): void {
  const iconPath = join(process.cwd(), 'build', 'icon.png')
  if (!existsSync(iconPath)) return
  const img = nativeImage.createFromPath(iconPath)
  if (img.isEmpty()) return
  if (process.platform === 'darwin') app.dock?.setIcon(img)
}

// 生产环境内容安全策略：渲染进程只加载自身资源，所有网络访问都经主进程 IPC。
// 开发环境（electron-vite dev）下不注入，以免破坏 Vite HMR 的 ws / eval。
function setupContentSecurityPolicy(): void {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
}

function windowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function readWindowState(): { width: number; height: number; x?: number; y?: number } {
  try {
    const s = JSON.parse(readFileSync(windowStatePath(), 'utf8'))
    if (s && typeof s.width === 'number' && typeof s.height === 'number') return s
  } catch {
    /* 无记录则用默认 */
  }
  return { width: 1200, height: 800 }
}

// 运行时窗口/任务栏图标（Windows/Linux 用；macOS 用 bundle 内的 icns）
function windowIcon(): string | undefined {
  if (process.platform === 'darwin') return undefined
  // Windows 任务栏图标也用更铺满的 icon-win.png（与 exe/桌面图标一致），缺失则退回 icon.png
  const candidates = [
    join(process.resourcesPath ?? '', 'icon-win.png'), // 打包后（铺满版）
    join(process.resourcesPath ?? '', 'icon.png'), // 打包后（通用）
    join(process.cwd(), 'build', 'icon-win.png'), // 开发期
    join(process.cwd(), 'build', 'icon.png')
  ]
  return candidates.find((p) => existsSync(p))
}

function createWindow(): void {
  const state = readWindowState()
  const icon = windowIcon()
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'Hemilier',
    ...(icon ? { icon } : {}),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // 关闭前记忆窗口大小/位置
  mainWindow.on('close', () => {
    if (!mainWindow || mainWindow.isMinimized() || mainWindow.isMaximized()) return
    try {
      writeFileSync(windowStatePath(), JSON.stringify(mainWindow.getBounds()), 'utf8')
    } catch {
      /* 忽略写入失败 */
    }
  })

  // 外部链接用系统浏览器打开，且仅允许安全协议（防 file:// 或可启动其他程序的危险 scheme）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const proto = new URL(url).protocol
      if (proto === 'http:' || proto === 'https:' || proto === 'mailto:') shell.openExternal(url)
    } catch {
      /* URL 非法则忽略 */
    }
    return { action: 'deny' }
  })

  // 阻止主框架被导航到外部地址（渲染端被攻破时的兜底）；放行开发期的 HMR 地址
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const devBase = process.env['ELECTRON_RENDERER_URL']
    if (devBase && url.startsWith(devBase)) return
    e.preventDefault()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return
  setupLogging()
  // 仅允许麦克风（语音输入用）；摄像头等其它媒体一律拒绝
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (permission === 'media') {
      const types = (details as { mediaTypes?: string[] }).mediaTypes
      callback(!types || types.every((t) => t === 'audio'))
      return
    }
    callback(false)
  })
  if (!process.env['ELECTRON_RENDERER_URL']) setupContentSecurityPolicy()
  else applyDevIcon()
  registerIpc(() => mainWindow)
  setupAppMenu(() => mainWindow)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void mcpManager.closeAll()
})
