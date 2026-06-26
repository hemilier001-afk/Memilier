// electron-builder afterPack 钩子：在打 zip 之前，用纯 JS 的 resedit 把图标嵌入 Windows .exe
// （rcedit 需要 Wine，跨平台打包用不了；resedit 是纯 JS，免 Wine）。
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const fs = require('node:fs')
  const path = require('node:path')
  const resedit = await import('resedit')

  const dir = context.appOutDir
  const exeName = fs.readdirSync(dir).find((f) => f.endsWith('.exe'))
  if (!exeName) return
  const exePath = path.join(dir, exeName)
  const icoPath = path.join(context.packager.projectDir, 'build', 'icon.ico')
  if (!fs.existsSync(icoPath)) {
    console.warn('[afterPack] build/icon.ico 不存在，跳过图标嵌入')
    return
  }

  const exe = resedit.NtExecutable.from(fs.readFileSync(exePath))
  const res = resedit.NtExecutableResource.from(exe)
  const icon = resedit.Data.IconFile.from(fs.readFileSync(icoPath))
  resedit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    1,
    1033,
    icon.icons.map((i) => i.data)
  )
  res.outputResource(exe)
  fs.writeFileSync(exePath, Buffer.from(exe.generate()))
  console.log(`[afterPack] 已把图标嵌入 ${exeName}`)
}
