import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { app } from 'electron'

// 后台例程的 git worktree 隔离：在独立 worktree + 分支里运行 agent，改动不碰用户当前工作树。
// 跑完把改动提交到隔离分支（保留可审查/合并），再移除 worktree（分支保留）。非 git 仓库则退回原地运行。

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).toString()
}

export interface Worktree {
  dir: string
  branch: string
  base: string
}

export function isGitRepo(dir: string): boolean {
  try {
    git(['rev-parse', '--is-inside-work-tree'], dir)
    return true
  } catch {
    return false
  }
}

/** 为一次后台运行创建隔离 worktree；非 git 仓库返回 null（调用方退回原地运行） */
export function createWorktree(base: string, label: string): Worktree | null {
  if (!isGitRepo(base)) return null
  const id = randomUUID().slice(0, 8)
  const slug = label.replace(/[^\w一-龥-]+/g, '-').slice(0, 24) || 'task'
  const branch = `hemilier/${slug}-${id}`
  const dir = path.join(app.getPath('userData'), 'worktrees', id)
  try {
    git(['worktree', 'add', '-b', branch, dir, 'HEAD'], base)
    return { dir, branch, base }
  } catch {
    return null
  }
}

/**
 * 收尾：把 worktree 里的改动提交到隔离分支，再移除 worktree。
 * - 有改动且提交成功 → committed=true，移除 worktree（分支保留供合并）。
 * - 有改动但提交失败（如 pre-commit 钩子拒绝）→ keptDir 返回 worktree 路径，
 *   **保留现场不删除**，避免例程成果被静默销毁。
 * - 无改动 → 移除 worktree 并删掉空分支。
 */
export function finalizeWorktree(wt: Worktree): {
  branch: string
  committed: boolean
  keptDir?: string
} {
  let committed = false
  let hadChanges = false
  try {
    git(['add', '-A'], wt.dir)
    hadChanges = !!git(['status', '--porcelain'], wt.dir).trim()
    if (hadChanges) {
      // -c 身份避免未配置 user.name/email；--no-verify 跳过钩子（例程环境常缺钩子依赖）
      git(
        [
          '-c',
          'user.name=hemilier',
          '-c',
          'user.email=hemilier@local',
          'commit',
          '--no-verify',
          '-m',
          'hemilier 例程自动提交（隔离运行）'
        ],
        wt.dir
      )
      committed = true
    }
  } catch {
    /* 提交失败：下方保留现场 */
  }
  if (hadChanges && !committed) {
    // 有改动但没提交成功——保留 worktree，让用户能找回成果
    return { branch: wt.branch, committed: false, keptDir: wt.dir }
  }
  try {
    git(['worktree', 'remove', '--force', wt.dir], wt.base)
  } catch {
    /* 忽略移除失败 */
  }
  if (!committed) {
    try {
      git(['branch', '-D', wt.branch], wt.base)
    } catch {
      /* 空分支删除失败忽略 */
    }
  }
  return { branch: wt.branch, committed }
}
