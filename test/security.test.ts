import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveInWorkspace } from '../src/main/security'

describe('resolveInWorkspace', () => {
  let ws: string
  let outside: string

  beforeEach(() => {
    // realpathSync 消除 macOS 上 /var -> /private/var 的符号链接差异，
    // 与 resolveInWorkspace 内部对工作区根的解析保持一致
    ws = realpathSync(mkdtempSync(path.join(tmpdir(), 'ws-')))
    outside = realpathSync(mkdtempSync(path.join(tmpdir(), 'out-')))
  })

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  it('解析工作区内的相对路径', () => {
    const resolved = resolveInWorkspace(ws, 'sub/file.txt')
    expect(resolved).toBe(path.join(ws, 'sub/file.txt'))
  })

  it("'.' 解析为工作区根", () => {
    expect(resolveInWorkspace(ws, '.')).toBe(ws)
  })

  it('允许尚不存在的新文件（基于已存在的父目录校验）', () => {
    expect(() => resolveInWorkspace(ws, 'newdir/new.txt')).not.toThrow()
  })

  it('拒绝用 .. 跳出工作区', () => {
    expect(() => resolveInWorkspace(ws, '../escape.txt')).toThrow(/越界/)
  })

  it('拒绝指向工作区外的绝对路径', () => {
    expect(() => resolveInWorkspace(ws, path.join(outside, 'x.txt'))).toThrow(/越界/)
  })

  it('拒绝通过符号链接跳出工作区', () => {
    writeFileSync(path.join(outside, 'secret.txt'), 'secret')
    symlinkSync(outside, path.join(ws, 'link'))
    expect(() => resolveInWorkspace(ws, 'link/secret.txt')).toThrow(/越界/)
  })

  it('允许工作区内的子目录（含真实子目录）', () => {
    mkdirSync(path.join(ws, 'real'))
    expect(resolveInWorkspace(ws, 'real')).toBe(path.join(ws, 'real'))
  })
})
