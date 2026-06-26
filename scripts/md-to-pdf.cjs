// 用 markdown-it 把 Markdown 渲染为 HTML，再用 Electron 的 printToPDF 导出（自带系统中文字体）。
// 用法：electron scripts/md-to-pdf.cjs <projectRoot>
const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')
const MarkdownIt = require('markdown-it')

const root = process.argv[2] || process.cwd()
// 可选第二参数指定文档名（不含扩展名），默认「操作手册」；用于生成 Windows 专版等
const docName = process.argv[3] || '操作手册'
const md = fs.readFileSync(path.join(root, 'docs', `${docName}.md`), 'utf8')
const body = new MarkdownIt({ html: false, linkify: true, breaks: false }).render(md)

const css = `
*{box-sizing:border-box}
body{font-family:-apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#1f1e1d;line-height:1.72;font-size:13px;margin:0}
h1{font-size:25px;color:#b5452f;border-bottom:2px solid #c96442;padding-bottom:8px;margin:0 0 .6em}
h2{font-size:18px;margin:1.5em 0 .5em;border-bottom:1px solid #e7e4da;padding-bottom:4px}
h3{font-size:15px;margin:1.2em 0 .4em}
p{margin:.5em 0}
code{background:#f0eee6;padding:1px 5px;border-radius:4px;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:.9em}
pre{background:#f7f6f1;border:1px solid #e7e4da;border-radius:8px;padding:12px;overflow:auto;page-break-inside:avoid}
pre code{background:none;padding:0}
table{border-collapse:collapse;width:100%;margin:1em 0;font-size:12px;page-break-inside:avoid}
th,td{border:1px solid #ddd;padding:6px 10px;text-align:left;vertical-align:top}
th{background:#f0eee6;font-weight:600}
blockquote{border-left:3px solid #c96442;margin:1em 0;padding:.3em 1em;color:#555;background:#faf9f5}
a{color:#c96442;text-decoration:none}
hr{border:none;border-top:1px solid #e7e4da;margin:1.6em 0}
ul,ol{padding-left:1.5em;margin:.5em 0}
li{margin:.2em 0}
h1,h2,h3{page-break-after:avoid}
`

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false } })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 500))
  const pdf = await win.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 }
  })
  fs.writeFileSync(path.join(root, 'docs', `${docName}.pdf`), pdf)
  try {
    fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(root, 'dist', `${docName}.pdf`), pdf)
  } catch {
    /* ignore */
  }
  console.log(`wrote docs/${docName}.pdf (` + pdf.length + ' bytes)')
  app.exit(0)
})
