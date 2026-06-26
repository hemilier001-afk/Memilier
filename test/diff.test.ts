import { describe, expect, it } from 'vitest'
import { diffStat, lineDiff } from '../src/shared/diff'

describe('lineDiff', () => {
  it('相同内容全部为上下文行', () => {
    const lines = lineDiff('a\nb\nc', 'a\nb\nc')
    expect(lines.every((l) => l.type === 'ctx')).toBe(true)
    expect(diffStat(lines)).toEqual({ added: 0, removed: 0 })
  })

  it('识别新增行', () => {
    const lines = lineDiff('a\nc', 'a\nb\nc')
    expect(diffStat(lines)).toEqual({ added: 1, removed: 0 })
    expect(lines.find((l) => l.type === 'add')?.text).toBe('b')
  })

  it('识别删除行', () => {
    const lines = lineDiff('a\nb\nc', 'a\nc')
    expect(diffStat(lines)).toEqual({ added: 0, removed: 1 })
    expect(lines.find((l) => l.type === 'del')?.text).toBe('b')
  })

  it('识别替换（先删后增）', () => {
    const lines = lineDiff('hello', 'world')
    expect(diffStat(lines)).toEqual({ added: 1, removed: 1 })
  })

  it('新建文件（before 为空）全部为新增', () => {
    const lines = lineDiff('', 'x\ny')
    expect(diffStat(lines)).toEqual({ added: 2, removed: 0 })
  })
})
