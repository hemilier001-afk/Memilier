import { describe, expect, it } from 'vitest'
import { parseFrontmatter, stripFrontmatter } from '../src/main/skills/frontmatter'

const sample = `---
name: code-reviewer
description: "审查代码并给出改进建议"
version: '1.0'
---

# Code Reviewer

正文内容在这里。
`

describe('parseFrontmatter', () => {
  it('解析 key: value 并去除引号', () => {
    const fm = parseFrontmatter(sample)
    expect(fm.name).toBe('code-reviewer')
    expect(fm.description).toBe('审查代码并给出改进建议')
    expect(fm.version).toBe('1.0')
  })

  it('无 frontmatter 返回空对象', () => {
    expect(parseFrontmatter('# 只有正文\n没有 frontmatter')).toEqual({})
  })

  it('忽略没有冒号的行', () => {
    const fm = parseFrontmatter('---\nname: x\n这是一行无冒号\n---\n')
    expect(fm).toEqual({ name: 'x' })
  })
})

describe('stripFrontmatter', () => {
  it('去掉 frontmatter 块只留正文', () => {
    const body = stripFrontmatter(sample)
    expect(body).toContain('# Code Reviewer')
    expect(body).not.toContain('name: code-reviewer')
    expect(body.startsWith('---')).toBe(false)
  })

  it('无 frontmatter 时原样返回', () => {
    const text = '# 标题\n正文'
    expect(stripFrontmatter(text)).toBe(text)
  })
})
