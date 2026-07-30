import { describe, expect, it } from 'vitest'
import { CATALOG } from '../src/main/plugins/catalog'
import { BUILTIN_SKILLS } from '../src/main/skills/builtin'

// 与 ipc.ts 里 plugins:list 的判定同构（纯逻辑，便于直测）
function isSuperseded(skillNames: string[]): boolean {
  const builtin = new Set(BUILTIN_SKILLS.map((b) => b.name))
  return skillNames.length > 0 && skillNames.every((n) => builtin.has(n))
}

describe('插件市场目录', () => {
  it('每个条目都有版本号（否则无法做更新提示）', () => {
    expect(CATALOG.length).toBeGreaterThan(0)
    for (const c of CATALOG) {
      expect(c.version, `${c.id} 缺 version`).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })

  it('id 唯一（重复会导致安装/卸载错乱）', () => {
    const ids = CATALOG.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('目录里不再包含已内置的办公技能（避免装了不生效的僵尸插件）', () => {
    const builtinNames = new Set(BUILTIN_SKILLS.map((b) => b.name))
    for (const c of CATALOG) {
      expect(builtinNames.has(c.id), `${c.id} 已是内置技能，不该出现在市场`).toBe(false)
    }
  })

  it('每个条目的技能正文非空且描述完整', () => {
    for (const c of CATALOG) {
      expect(c.skill.body.length, `${c.id} 正文过短`).toBeGreaterThan(80)
      expect(c.skill.description.trim()).not.toBe('')
    }
  })
})

describe('僵尸插件判定（内容已被内置技能取代）', () => {
  it('技能名全部命中内置 → 判为已内置（旧版 office-word 等）', () => {
    expect(isSuperseded(['office-word'])).toBe(true)
    expect(isSuperseded(['office-excel', 'doc-pdf'])).toBe(true)
  })

  it('市场里在售的技能包不会被误判', () => {
    expect(isSuperseded(['data-analysis'])).toBe(false)
    expect(isSuperseded(['image-basic'])).toBe(false)
    expect(isSuperseded(['doc-batch'])).toBe(false)
  })

  it('混合（部分内置部分自有）不判为已内置——它还有独有内容', () => {
    expect(isSuperseded(['office-word', 'my-custom-skill'])).toBe(false)
  })

  it('无技能的插件（纯 MCP）不判为已内置', () => {
    expect(isSuperseded([])).toBe(false)
  })
})
