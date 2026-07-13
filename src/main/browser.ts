import { BrowserWindow } from 'electron'

// 智能体控制的「可视浏览器」：复用 Electron 内嵌的 Chromium，零额外依赖。
// - 窗口可见：用户全程看得到智能体在浏览什么（透明性）；关掉窗口即终止会话。
// - 允许打开 localhost/内网（这正是测试本地开发服务器的用途）；打开动作经权限网关确认。
// - 页面以最严格的 webPreferences 加载（sandbox、无 Node、无 preload），与应用本体隔离。

interface ConsoleEntry {
  level: string
  text: string
  at: number
}

const LEVELS = ['debug', 'log', 'warn', 'error'] as const
const MAX_CONSOLE = 200

class BrowserManager {
  private win: BrowserWindow | null = null
  private console: ConsoleEntry[] = []

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    this.console = []
    const win = new BrowserWindow({
      width: 1100,
      height: 800,
      title: 'Hemilier 浏览器（智能体控制）',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        devTools: true
      }
    })
    // 收集控制台输出（网页调试的核心信息源）
    win.webContents.on('console-message', (_e, level, message) => {
      this.console.push({ level: LEVELS[level] ?? String(level), text: message, at: Date.now() })
      if (this.console.length > MAX_CONSOLE)
        this.console.splice(0, this.console.length - MAX_CONSOLE)
    })
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      this.console.push({
        level: 'error',
        text: `加载失败(${code}) ${desc} ${url}`,
        at: Date.now()
      })
    })
    // 新窗口一律改为当前窗口内导航（不弹新窗）
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) void win.webContents.loadURL(url)
      return { action: 'deny' }
    })
    win.on('closed', () => {
      this.win = null
    })
    this.win = win
    return win
  }

  /** 打开/导航到 URL，等待加载完成（15s 上限），返回页面标题 */
  async open(url: string): Promise<string> {
    if (!/^https?:\/\//i.test(url)) throw new Error('仅支持 http/https URL')
    const win = this.ensureWindow()
    this.console = [] // 新页面从干净的控制台开始
    const loaded = new Promise<void>((resolve) => {
      const done = (): void => {
        win.webContents.removeListener('did-finish-load', done)
        win.webContents.removeListener('did-fail-load', done)
        resolve()
      }
      win.webContents.on('did-finish-load', done)
      win.webContents.on('did-fail-load', done)
      setTimeout(done, 15_000)
    })
    await win.loadURL(url).catch(() => {
      /* did-fail-load 已记录，这里避免 loadURL 的重复抛错 */
    })
    await loaded
    await new Promise((r) => setTimeout(r, 300)) // 等一拍渲染/首屏 JS
    return win.webContents.getTitle()
  }

  private requireWindow(): BrowserWindow {
    if (!this.win || this.win.isDestroyed()) {
      throw new Error('浏览器未打开，请先用 browser_open 打开一个页面')
    }
    return this.win
  }

  /** 页面快照：标题 / URL / 可见文本（截断） */
  async snapshot(maxChars = 8000): Promise<string> {
    const win = this.requireWindow()
    const data = (await win.webContents.executeJavaScript(
      `({ title: document.title, url: location.href, text: (document.body && document.body.innerText) || '' })`,
      true
    )) as { title: string; url: string; text: string }
    const text =
      data.text.length > maxChars ? `${data.text.slice(0, maxChars)}\n…（已截断）` : data.text
    return `标题：${data.title}\nURL：${data.url}\n——— 页面可见文本 ———\n${text || '(空)'}`
  }

  /** 最近的控制台输出（错误在前后顺序中原样保留） */
  consoleLogs(limit = 50): string {
    if (!this.console.length) return '(控制台无输出)'
    return this.console
      .slice(-limit)
      .map((c) => `[${c.level}] ${c.text}`)
      .join('\n')
  }

  /** 按 CSS 选择器点击元素 */
  async click(selector: string): Promise<string> {
    const win = this.requireWindow()
    const ok = (await win.webContents.executeJavaScript(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true })()`,
      true
    )) as boolean
    if (!ok) throw new Error(`未找到元素：${selector}`)
    await new Promise((r) => setTimeout(r, 300))
    return `已点击 ${selector}`
  }

  /** 向 input/textarea 填入文本（触发 input/change 事件，兼容 React 受控组件） */
  async fill(selector: string, text: string): Promise<string> {
    const win = this.requireWindow()
    const ok = (await win.webContents.executeJavaScript(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)})
        if (!el) return false
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        const desc = Object.getOwnPropertyDescriptor(proto, 'value')
        if (desc && desc.set) desc.set.call(el, ${JSON.stringify(text)})
        else el.value = ${JSON.stringify(text)}
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      })()`,
      true
    )) as boolean
    if (!ok) throw new Error(`未找到元素：${selector}`)
    return `已向 ${selector} 填入文本`
  }

  /** 截图当前页面，返回 PNG Buffer */
  async screenshot(): Promise<Buffer> {
    const win = this.requireWindow()
    const img = await win.webContents.capturePage()
    return img.toPNG()
  }
}

export const browserManager = new BrowserManager()
