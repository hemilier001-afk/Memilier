import { describe, expect, it } from 'vitest'
import { mapRegistryResponse } from '../src/main/mcp/registry'

// 贴合官方 registry /v0/servers 的真实结构（2025-12 schema）：每条 { server, _meta }，
// server 下有 packages(本地包) 或 remotes(远程)；同名多版本用 _meta.isLatest 去重。
const SAMPLE = {
  servers: [
    {
      server: {
        name: 'com.pulsemcp/remote-filesystem',
        title: 'Remote Filesystem',
        description: 'Read/write files in a GCS bucket',
        packages: [
          {
            registryType: 'npm',
            identifier: 'remote-filesystem-mcp-server',
            version: '0.1.3',
            runtimeHint: 'npx',
            environmentVariables: [
              { name: 'GCS_BUCKET', description: 'Bucket name', isRequired: true }
            ]
          }
        ]
      },
      _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active', isLatest: true } }
    },
    {
      // 同名旧版本 → 应被 isLatest 版覆盖，只保留一个
      server: {
        name: 'com.pulsemcp/remote-filesystem',
        description: 'old',
        packages: [
          { registryType: 'npm', identifier: 'remote-filesystem-mcp-server', version: '0.1.2' }
        ]
      },
      _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active', isLatest: false } }
    },
    {
      // 远程 server（streamable-http）→ 映射成 url 直连
      server: {
        name: 'ai.smithery/github',
        title: 'GitHub (Smithery)',
        description: 'GitHub via Smithery',
        remotes: [{ type: 'streamable-http', url: 'https://server.smithery.ai/github/mcp' }]
      },
      _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active', isLatest: true } }
    },
    {
      // pypi → uvx
      server: {
        name: 'io.github.acme/pytool',
        description: 'python tool',
        packages: [{ registryType: 'pypi', identifier: 'mcp-pytool', runtimeHint: 'uvx' }]
      },
      _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active', isLatest: true } }
    },
    {
      // 已删除 → 跳过
      server: { name: 'io.github.foo/gone', remotes: [{ type: 'sse', url: 'https://x' }] },
      _meta: { 'io.modelcontextprotocol.registry/official': { status: 'deleted', isLatest: true } }
    },
    {
      // docker-only 本地包、且无 remotes → 无法通用拉起 → 跳过
      server: {
        name: 'io.github.foo/dockeronly',
        packages: [{ registryType: 'oci', identifier: 'x' }]
      },
      _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active', isLatest: true } }
    }
  ]
}

describe('mapRegistryResponse（真实 registry 结构）', () => {
  it('unwrap server + 同名去重（保留最新）', () => {
    const all = mapRegistryResponse(SAMPLE, '')
    const fs = all.filter((x) => x.name === 'Remote Filesystem')
    expect(fs).toHaveLength(1) // 两个版本去重成一个
    expect(fs[0].command).toBe('npx')
    expect(fs[0].args).toEqual(['-y', 'remote-filesystem-mcp-server'])
    expect(fs[0].publisher).toBe('pulsemcp')
    expect(fs[0].envFields?.[0]).toMatchObject({ key: 'GCS_BUCKET', required: true })
  })
  it('远程 server → url + transport', () => {
    const gh = mapRegistryResponse(SAMPLE, '').find((x) => x.name === 'GitHub (Smithery)')!
    expect(gh.url).toBe('https://server.smithery.ai/github/mcp')
    expect(gh.transport).toBe('http')
    expect(gh.command).toBeUndefined()
  })
  it('pypi → uvx', () => {
    const py = mapRegistryResponse(SAMPLE, '').find((x) => x.name === 'pytool')!
    expect(py.command).toBe('uvx')
    expect(py.args).toEqual(['mcp-pytool'])
  })
  it('跳过已删除与不可拉起的条目', () => {
    const names = mapRegistryResponse(SAMPLE, '').map((x) => x.name)
    expect(names).not.toContain('gone')
    expect(names).not.toContain('dockeronly')
  })
  it('查询词过滤（名称/描述/发布者）', () => {
    expect(mapRegistryResponse(SAMPLE, 'smithery').map((x) => x.name)).toContain(
      'GitHub (Smithery)'
    )
    expect(mapRegistryResponse(SAMPLE, 'python')).toHaveLength(1)
    expect(mapRegistryResponse(SAMPLE, '不存在')).toHaveLength(0)
  })
  it('空/异常响应不抛错', () => {
    expect(mapRegistryResponse({}, 'x')).toEqual([])
    expect(mapRegistryResponse(null, 'x')).toEqual([])
    expect(mapRegistryResponse({ servers: 'bad' }, 'x')).toEqual([])
  })
})
