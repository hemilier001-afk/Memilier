// 开发模式下，macOS Dock 悬停显示的名字来自「正在运行的 Electron.app 包」的 Info.plist
// （CFBundleName / CFBundleDisplayName），app.setName() 与 package.json 都改不动它。
// 本脚本把开发用 Electron.app 的这两个键改成 hemilier，让 dev 期 Dock 名与打包版一致。
// 仅影响本地开发；挂在 postinstall 上，重装依赖后自动重新应用。打包版由 electron-builder 的 productName 决定，不受此影响。

const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const path = require('node:path')

const APP_NAME = 'hemilier'

function main() {
  if (process.platform !== 'darwin') return // 仅 macOS 有此现象
  const plist = path.join(
    __dirname,
    '..',
    'node_modules',
    'electron',
    'dist',
    'Electron.app',
    'Contents',
    'Info.plist'
  )
  if (!existsSync(plist)) return // electron 尚未安装则跳过

  const pb = '/usr/libexec/PlistBuddy'
  if (!existsSync(pb)) return

  const set = (key) => {
    try {
      execFileSync(pb, ['-c', `Set :${key} ${APP_NAME}`, plist])
    } catch {
      // 键不存在则新增
      try {
        execFileSync(pb, ['-c', `Add :${key} string ${APP_NAME}`, plist])
      } catch {
        /* 忽略：改不动就保持原样，不阻断安装 */
      }
    }
  }
  set('CFBundleName')
  set('CFBundleDisplayName')

  // 改完 plist 还需两步，否则 Dock 悬停名仍显示旧缓存：
  // 1) 重签名（改 Info.plist 会使原签名失效，系统可能忽略修改）
  // 2) LaunchServices 强制重注册（Dock 名读的是 LS 注册缓存，不会自动重读 plist）
  // plist = …/Electron.app/Contents/Info.plist → dirname 是 Contents，再上一级才是 .app 包
  const bundle = path.resolve(path.dirname(plist), '..') // …/Electron.app
  try {
    execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle])
  } catch {
    /* 签名失败不阻断 */
  }
  try {
    execFileSync(
      '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
      ['-f', bundle]
    )
  } catch {
    /* 重注册失败不阻断 */
  }
  console.log(
    `[rename-dev-electron] 开发用 Electron.app 名称已设为 "${APP_NAME}"（已重签名+重注册）`
  )
}

main()
