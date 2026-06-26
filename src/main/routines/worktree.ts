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
 * 返回是否产生了提交（committed=false 时删掉空分支，避免污染）。
 */
export function finalizeWorktree(wt: Worktree): { branch: string; committed: boolean } {
  let committed = false
  try {
    git(['add', '-A'], wt.dir)
    if (git(['status', '--porcelain'], wt.dir).trim()) {
      // 带上 -c 身份，避免仓库未配置 user.name/email 时提交失败
      git(
        [
          '-c',
          'user.name=hemilier',
          '-c',
          'user.email=hemilier@local',
          'commit',
          '-m',
          'hemilier 例程自动提交（隔离运行）'
        ],
        wt.dir
      )
      committed = true
    }
  } catch {
    /* 提交失败则按无提交处理 */
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
