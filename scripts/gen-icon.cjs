// 用已安装的 Electron 把图标 SVG 渲染成 1024×1024 PNG（无需额外依赖）。
// 用法：electron scripts/gen-icon.cjs <projectRoot>
const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const root = process.argv[2] || process.cwd()

// hemilier 图标：奶白圆形 + 珊瑚圆角底（方案二配色）
const BG = '#D2552C'
const BODY = '#FBF3EA'
const CRAB = `
<rect x="6" y="6" width="88" height="88" rx="22" fill="${BG}"/>
<circle cx="50" cy="50" r="29" fill="none" stroke="${BODY}" stroke-width="12"/>`

// 围绕画布中心整体缩放：mac 留 squircle 透明边距；Windows 更铺满
const wrap = (scale) =>
  `<svg width="1024" height="1024" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><g transform="translate(50 50) scale(${scale}) translate(-50 -50)">${CRAB}</g></svg>`

const targets = [
  { file: 'icon.png', svg: wrap(0.9) }, // macOS（约 10% 透明边距）
  { file: 'icon-win.png', svg: wrap(1.06) } // Windows（更铺满）
]

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: false }
  })
  for (const { file, svg } of targets) {
    const html = `<body style="margin:0;padding:0;background:transparent">${svg}</body>`
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    await new Promise((r) => setTimeout(r, 400))
    const img = await win.webContents.capturePage()
    fs.writeFileSync(path.join(root, 'build', file), img.toPNG())
    console.log('wrote build/' + file)
  }
  app.exit(0)
})
