import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'

/**
 * 把相对/绝对路径解析为绝对路径，并校验其落在工作区目录内。
 * 解析符号链接后再比较，防止越界。新文件（尚不存在）会基于最近的已存在父目录校验。
 */
export function resolveInWorkspace(workspace: string, target: string): string {
  const realWs = realpathSync(workspace)
  const abs = path.resolve(realWs, target)

  // 找到最深的已存在祖先目录，对其解析符号链接
  let probe = abs
  while (!existsSync(probe)) {
    const parent = path.dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  const realProbe = realpathSync(probe)
  const within = realProbe === realWs || realProbe.startsWith(realWs + path.sep)
  if (!within) {
    throw new Error(`路径越界，超出工作区：${target}`)
  }
  return abs
}
