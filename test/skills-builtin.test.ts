import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BUILTIN_SKILLS } from '../src/main/skills/builtin'
import { skillManager } from '../src/main/skills/manager'

// 无 electron 环境下 globalDir() 会抛错（app.getPath），这里指到临时目录
let ws = ''
let fakeGlobal = ''

beforeEach(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), 'hemi-skill-ws-'))
  fakeGlobal = await fs.mkdtemp(path.join(os.tmpdir(), 'hemi-skill-global-'))
  skillManager.globalDir = () => fakeGlobal
})
afterEach(async () => {
  await fs.rm(ws, { recursive: true, force: true })
  await fs.rm(fakeGlobal, { recursive: true, force: true })
})

async function writeSkill(dir: string, name: string, desc: string, body: string): Promise<void> {
  const d = path.join(dir, name)
  await fs.mkdir(d, { recursive: true })
  await fs.writeFile(
    path.join(d, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body}`,
    'utf8'
  )
}

describe('内置技能（随应用发布，开箱即用）', () => {
  it('全新环境（无任何已装插件/技能）也能列出内置技能', async () => {
    const list = await skillManager.listSkills(ws, [])
    const names = list.map((s) => s.name)
    for (const b of BUILTIN_SKILLS) expect(names).toContain(b.name)
    expect(list.every((s) => s.source === 'builtin')).toBe(true)
  })

  it('内置技能的正文可直接加载（不读盘）', async () => {
    const body = await skillManager.loadSkill(ws, 'office-word', [])
    expect(body).toContain('write_docx')
    expect(body).toContain('read_document')
  })

  it('办公技能都教内置工具，而非要求装 Python', async () => {
    const word = await skillManager.loadSkill(ws, 'office-word', [])
    const excel = await skillManager.loadSkill(ws, 'office-excel', [])
    const ppt = await skillManager.loadSkill(ws, 'office-ppt', [])
    const pdf = await skillManager.loadSkill(ws, 'doc-pdf', [])
    expect(word).toContain('原生支持')
    expect(excel).toContain('write_xlsx')
    expect(ppt).toContain('write_pptx')
    expect(pdf).toContain('export_pdf')
  })

  it('内置优先于插件市场装的同名旧副本（说明书不被旧版盖掉）', async () => {
    const pluginDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hemi-skill-plugin-'))
    await writeSkill(pluginDir, 'office-word', '旧版：需要 python-docx', '# 旧版\n用 python-docx')
    const list = await skillManager.listSkills(ws, [pluginDir])
    const word = list.find((s) => s.name === 'office-word')!
    expect(word.source).toBe('builtin')
    expect(await skillManager.loadSkill(ws, 'office-word', [pluginDir])).toContain('write_docx')
    await fs.rm(pluginDir, { recursive: true, force: true })
  })

  it('工作区自定义技能可覆盖内置（用户明确意图优先）', async () => {
    await writeSkill(
      skillManager.workspaceSkillDir(ws),
      'office-word',
      '本项目的公文格式',
      '# 本项目公文规范\n必须用红头模板'
    )
    const list = await skillManager.listSkills(ws, [])
    expect(list.find((s) => s.name === 'office-word')!.source).toBe('workspace')
    expect(await skillManager.loadSkill(ws, 'office-word', [])).toContain('红头模板')
  })

  it('第三方插件的其它技能仍可用（不被内置挤掉）', async () => {
    const pluginDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hemi-skill-plugin2-'))
    await writeSkill(pluginDir, 'my-tool', '第三方技能', '# 第三方\n内容')
    const list = await skillManager.listSkills(ws, [pluginDir])
    expect(list.find((s) => s.name === 'my-tool')?.source).toBe('plugin')
    await fs.rm(pluginDir, { recursive: true, force: true })
  })
})
