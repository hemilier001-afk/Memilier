import { describe, expect, it } from 'vitest'
import { extractToolCalls } from '../src/main/providers/openai'

describe('extractToolCalls', () => {
  it('省略 index 的分片也能拼出工具调用（MiniMax bug 回归）', () => {
    const calls = extractToolCalls([
      { delta: { tool_calls: [{ id: 'a', function: { name: 'run_command' } }] } },
      { delta: { tool_calls: [{ function: { arguments: '{"command":' } }] } },
      { delta: { tool_calls: [{ function: { arguments: '"ls -la"}' } }] } }
    ])
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('run_command')
    expect(calls[0].args).toEqual({ command: 'ls -la' })
  })

  it('标准带 index 的多工具调用', () => {
    const calls = extractToolCalls([
      {
        delta: {
          tool_calls: [
            { index: 0, id: 'a', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } },
            { index: 1, id: 'b', function: { name: 'grep', arguments: '{"pattern":"x"}' } }
          ]
        }
      }
    ])
    expect(calls).toHaveLength(2)
    expect(calls.map((c) => c.name)).toEqual(['read_file', 'grep'])
    expect(calls[1].args).toEqual({ pattern: 'x' })
  })

  it('tool_calls 放在 message（非 delta）里', () => {
    const calls = extractToolCalls([
      {
        message: {
          tool_calls: [{ id: 'c', function: { name: 'glob', arguments: '{"pattern":"**/*.ts"}' } }]
        }
      }
    ])
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('glob')
  })

  it('arguments 为对象而非字符串也能处理', () => {
    const calls = extractToolCalls([
      {
        delta: {
          tool_calls: [{ id: 'd', function: { name: 'list_dir', arguments: { path: 'src' } } }]
        }
      }
    ])
    expect(calls[0].args).toEqual({ path: 'src' })
  })

  it('无工具调用返回空数组', () => {
    expect(extractToolCalls([{ delta: {} }])).toEqual([])
  })
})
