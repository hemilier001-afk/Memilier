// Markdown → PDF：内置 md→HTML 转换 + 隐藏 BrowserWindow printToPDF（Chromium 排版引擎）。
// 相比纯 PDF 字节生成：中文字体/表格/代码块开箱即用（与 scripts/md-to-pdf.cjs 同思路，
// 但做成运行时工具，供智能体直接产出 PDF 交付物）。测试环境（无 electron）会抛错，由工具层兜底。

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
}

/** 轻量 Markdown → HTML（标题/段落/列表/表格/代码块/引用/分隔线；够写报告即可） */
export function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  // 列表栈：支持按缩进嵌套（原来只有一个 listType，多层列表被拍平成一层）
  const stack: ('ul' | 'ol')[] = []
  const closeList = (): void => {
    while (stack.length) out.push(`</${stack.pop()}>`)
  }
  const indentLevel = (l: string): number =>
    Math.min(Math.floor(/^[\t ]*/.exec(l)![0].replace(/\t/g, '  ').length / 2), 4)
  const openList = (kind: 'ul' | 'ol', level: number): void => {
    while (stack.length > level + 1) out.push(`</${stack.pop()}>`)
    if (stack.length === level + 1 && stack[level] !== kind) {
      out.push(`</${stack.pop()}>`)
    }
    while (stack.length < level + 1) {
      out.push(`<${kind}>`)
      stack.push(kind)
    }
  }
  while (i < lines.length) {
    const line = lines[i]
    if (/^```/.test(line)) {
      closeList()
      i++
      const code: string[] = []
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++])
      i++
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`)
      continue
    }
    if (/^\s*\|/.test(line)) {
      closeList()
      const rows: string[][] = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cols = lines[i]
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim())
        if (!cols.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cols)
        i++
      }
      if (rows.length) {
        const [head, ...body] = rows
        out.push(
          '<table><thead><tr>' +
            head.map((c) => `<th>${inline(c)}</th>`).join('') +
            '</tr></thead><tbody>' +
            body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') +
            '</tbody></table>'
        )
      }
      continue
    }
    if (/^\s*<!--\s*(pagebreak|分页)\s*-->\s*$/i.test(line)) {
      closeList()
      out.push('<div style="page-break-after:always"></div>')
      i++
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      closeList()
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`)
    } else if (/^\s*[-*]\s+/.test(line)) {
      openList('ul', indentLevel(line))
      out.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`)
    } else if (/^\s*\d+\.\s+/.test(line)) {
      openList('ol', indentLevel(line))
      out.push(`<li>${inline(line.replace(/^\s*\d+\.\s+/, ''))}</li>`)
    } else if (/^\s*>\s?/.test(line)) {
      closeList()
      out.push(`<blockquote>${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`)
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      closeList()
      out.push('<hr/>')
    } else if (line.trim() === '') {
      closeList()
    } else {
      closeList()
      out.push(`<p>${inline(line)}</p>`)
    }
    i++
  }
  closeList()
  return out.join('\n')
}

const PRINT_CSS = `
  body { font-family: "Times New Roman", Georgia, "PingFang SC", "Microsoft YaHei", serif;
         font-size: 11.5pt; line-height: 1.75; color: #262624; margin: 0; padding: 0 4px; }
  h1 { font-size: 20pt; border-bottom: 1.5px solid #262624; padding-bottom: 6px; }
  h2 { font-size: 15pt; margin-top: 1.4em; border-bottom: 0.75px solid #d8d6ce; padding-bottom: 4px; }
  h3 { font-size: 12.5pt; margin-top: 1.2em; }
  table { border-collapse: collapse; width: 100%; margin: 0.8em 0; font-size: 10.5pt; }
  th, td { border: 0.75px solid #b8b6ae; padding: 5px 9px; text-align: left; }
  th { background: #f4f2ec; }
  code { font-family: Menlo, Consolas, monospace; font-size: 10pt; background: #f4f2ec;
         padding: 1px 5px; border-radius: 3px; }
  pre { background: #f7f6f1; border: 0.75px solid #e4e2da; border-radius: 6px; padding: 10px 14px;
        overflow-wrap: break-word; white-space: pre-wrap; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #d8d6ce; margin: 0.6em 0; padding: 2px 14px; color: #6f6d66; }
  hr { border: none; border-top: 0.75px solid #d8d6ce; margin: 1.4em 0; }
  a { color: #262624; }
  h4 { font-size: 11.5pt; margin-top: 1.1em; }
  h5, h6 { font-size: 11pt; margin-top: 1em; color: #3d3d3a; }
  del { color: #8f8d85; }
  ul ul, ol ol, ul ol, ol ul { margin: 0.2em 0; }
`

/** markdown → PDF 字节（主进程内起隐藏窗口打印；仅运行时可用） */
export async function markdownToPdf(markdown: string, title?: string): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { BrowserWindow } = require('electron') as typeof import('electron')
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title ?? '')}</title>
<style>${PRINT_CSS}</style></head><body>${mdToHtml(markdown)}</body></html>`
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, javascript: false } // 纯静态渲染，禁 JS 更稳
  })
  try {
    await win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html).toString('base64')}`)
    const buf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 }
    })
    return buf
  } finally {
    win.destroy()
  }
}
