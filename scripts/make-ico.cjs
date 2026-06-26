// 由 build/icon.png 生成多尺寸 build/icon.ico（用 sips 缩放，手工组装 ICO 容器，内嵌 PNG）。
// 用法：node scripts/make-ico.cjs <projectRoot>
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = process.argv[2] || process.cwd()
// 优先用更铺满的 Windows 专用图（icon-win.png），否则退回通用 icon.png
const winSrc = path.join(root, 'build', 'icon-win.png')
const src = fs.existsSync(winSrc) ? winSrc : path.join(root, 'build', 'icon.png')
const sizes = [16, 32, 48, 64, 128, 256]
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ico-'))

const imgs = sizes.map((s) => {
  const out = path.join(tmp, `${s}.png`)
  execFileSync('sips', ['-z', String(s), String(s), src, '--out', out], { stdio: 'ignore' })
  return { size: s, data: fs.readFileSync(out) }
})

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type = icon
header.writeUInt16LE(imgs.length, 4)

const entries = Buffer.alloc(16 * imgs.length)
let offset = 6 + 16 * imgs.length
const datas = []
imgs.forEach((img, i) => {
  const e = entries.subarray(i * 16)
  e.writeUInt8(img.size >= 256 ? 0 : img.size, 0) // width (0=256)
  e.writeUInt8(img.size >= 256 ? 0 : img.size, 1) // height
  e.writeUInt8(0, 2) // color count
  e.writeUInt8(0, 3) // reserved
  e.writeUInt16LE(1, 4) // planes
  e.writeUInt16LE(32, 6) // bit count
  e.writeUInt32LE(img.data.length, 8)
  e.writeUInt32LE(offset, 12)
  offset += img.data.length
  datas.push(img.data)
})

fs.writeFileSync(path.join(root, 'build', 'icon.ico'), Buffer.concat([header, entries, ...datas]))
console.log('wrote build/icon.ico (' + imgs.length + ' sizes)')
