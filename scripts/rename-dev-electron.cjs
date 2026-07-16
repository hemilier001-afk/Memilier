// 开发模式下，macOS Dock 显示的名字来自「正在运行的 .app 包」的 Info.plist
// （CFBundleName / CFBundleDisplayName），app.setName() 与 package.json 都改不动它；
// 且 LaunchServices 按【包路径】缓存注册名——只改 plist 后旧路径的 "Electron" 记录仍然生效。
// 终极做法：把整个 Electron.app 改名为 hemilier.app（新路径 = 全新注册，无缓存可言），
// 同步 electron 包的 path.txt 指向，并改 plist + 重签名 + 强制注册。
// 仅影响本地开发；挂在 postinstall 上，重装依赖后自动重新应用。
// 打包版由 electron-builder 的 productName 决定，不受此影响。

const { execFileSync } = require('node:child_process')
const { existsSync, renameSync, readFileSync, writeFileSync } = require('node:fs')
const path = require('node:path')

const APP_NAME = 'hemilier'

function main() {
  if (process.platform !== 'darwin') return // 仅 macOS 有此现象

  const electronDir = path.join(__dirname, '..', 'node_modules', 'electron')
  const distDir = path.join(electronDir, 'dist')
  const oldApp = path.join(distDir, 'Electron.app')
  const newApp = path.join(distDir, `${APP_NAME}.app`)

  // 1) 整包改名（幂等：已改过则跳过）
  if (existsSync(oldApp) && !existsSync(newApp)) {
    try {
      renameSync(oldApp, newApp)
    } catch {
      /* 占用等原因改不动就退回旧路径继续 */
    }
  }
  const bundle = existsSync(newApp) ? newApp : oldApp
  if (!existsSync(bundle)) return // electron 尚未安装则跳过

  // 2) path.txt：require('electron') 由它定位可执行文件，必须跟着包名走
  const pathTxt = path.join(electronDir, 'path.txt')
  const want = `${path.basename(bundle)}/Contents/MacOS/Electron`
  try {
    if (readFileSync(pathTxt, 'utf8') !== want) writeFileSync(pathTxt, want)
  } catch {
    /* path.txt 异常不阻断 */
  }

  // 3) Info.plist 的显示名
  const plist = path.join(bundle, 'Contents', 'Info.plist')
  const pb = '/usr/libexec/PlistBuddy'
  if (existsSync(pb) && existsSync(plist)) {
    const set = (key) => {
      try {
        execFileSync(pb, ['-c', `Set :${key} ${APP_NAME}`, plist])
      } catch {
        try {
          execFileSync(pb, ['-c', `Add :${key} string ${APP_NAME}`, plist])
        } catch {
          /* 改不动就保持原样，不阻断安装 */
        }
      }
    }
    set('CFBundleName')
    set('CFBundleDisplayName')
  }

  // 4) 重签名（改包内容使原签名失效）+ LaunchServices 强制注册新路径
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
  console.log(`[rename-dev-electron] 开发用 Electron 包已更名为 ${path.basename(bundle)}`)
}

main()
