import { describe, expect, it } from 'vitest'
import { presetDecision, toolCategory } from '../src/main/agent/safety'
import { buildSeatbeltProfile, sandboxWritePaths } from '../src/main/agent/sandbox'

describe('toolCategory', () => {
  it('按工具归类', () => {
    expect(toolCategory('read_file', 'none', false)).toBe('read')
    expect(toolCategory('write_file', 'write', false)).toBe('fileWrite')
    expect(toolCategory('edit_file', 'write', false)).toBe('fileWrite')
    expect(toolCategory('run_command', 'exec', false)).toBe('command')
    expect(toolCategory('fetch_url', 'exec', false)).toBe('network')
    expect(toolCategory('web_search', 'exec', false)).toBe('network')
    expect(toolCategory('browser_open', 'exec', false)).toBe('network')
    expect(toolCategory('browser_screenshot', 'write', false)).toBe('network')
    expect(toolCategory('add_memory', 'write', false)).toBe('memorySkill')
    expect(toolCategory('save_skill', 'write', false)).toBe('memorySkill')
    expect(toolCategory('mcp__srv__tool', 'exec', true)).toBe('mcp')
  })
})

describe('presetDecision（四挡权限预设）', () => {
  it('ask：一律走网关询问', () => {
    expect(presetDecision('ask', 'fileWrite')).toBe('ask')
    expect(presetDecision('ask', 'command')).toBe('ask')
    expect(presetDecision('ask', 'mcp')).toBe('ask')
  })
  it('auto（替我审批）：常规自动批，MCP 仍问', () => {
    expect(presetDecision('auto', 'fileWrite')).toBe('auto')
    expect(presetDecision('auto', 'command')).toBe('auto')
    expect(presetDecision('auto', 'network')).toBe('auto')
    expect(presetDecision('auto', 'memorySkill')).toBe('auto')
    expect(presetDecision('auto', 'mcp')).toBe('ask')
  })
  it('full（完全访问）：全部自动批（危险命令由调用方另行强制确认）', () => {
    expect(presetDecision('full', 'mcp')).toBe('auto')
    expect(presetDecision('full', 'command')).toBe('auto')
    expect(presetDecision('full', 'read')).toBe('auto')
  })
  it('custom：按类别取值，缺省 ask', () => {
    expect(presetDecision('custom', 'command', { command: 'auto' })).toBe('auto')
    expect(presetDecision('custom', 'network', { command: 'auto' })).toBe('ask')
    expect(presetDecision('custom', 'fileWrite')).toBe('ask')
  })
  it('read 类别在非 full 模式下交回既有 autoApproveReadOnly 逻辑', () => {
    expect(presetDecision('auto', 'read')).toBe('ask')
    expect(presetDecision('custom', 'read')).toBe('ask')
  })
})

describe('Seatbelt 沙箱 profile', () => {
  it('默认放行 + 整体禁写 + 白名单子路径', () => {
    const p = buildSeatbeltProfile(['/ws/project', '/tmp'])
    expect(p).toContain('(version 1)')
    expect(p).toContain('(allow default)')
    expect(p).toContain('(deny file-write*)')
    expect(p).toContain('(subpath "/ws/project")')
    expect(p).toContain('(subpath "/tmp")')
    // 禁写在前、白名单在后（Seatbelt 后规则优先）
    expect(p.indexOf('(deny file-write*)')).toBeLessThan(p.indexOf('(subpath "/ws/project")'))
  })
  it('路径中的引号被转义（防 profile 注入）', () => {
    const p = buildSeatbeltProfile(['/a"b'])
    expect(p).toContain('\\"')
    expect(p).not.toContain('(subpath "/a"b")')
  })
  it('写路径清单包含工作区与临时目录', () => {
    const paths = sandboxWritePaths('/ws/demo')
    expect(paths.some((x) => x.includes('/ws/demo') || x === '/ws/demo')).toBe(true)
    expect(paths.some((x) => x.includes('tmp'))).toBe(true)
  })
})
