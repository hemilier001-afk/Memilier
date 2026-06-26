import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { McpServerConfig, ToolDef } from '@shared/types'

const PREFIX = 'mcp__'

interface Connected {
  client: Client
  /** 该连接对应的配置签名；配置变化时重连 */
  sig: string
}

/**
 * MCP 客户端管理器：按需连接配置的 MCP server（stdio），把它们的工具
 * 以 mcp__<server>__<tool> 的命名空间暴露给模型，并负责调用路由。
 */
class McpManager {
  private clients = new Map<string, Connected>()
  private routes = new Map<string, { server: string; tool: string }>()

  private sig(cfg: McpServerConfig): string {
    return JSON.stringify([cfg.command, cfg.args ?? [], cfg.env ?? {}, cfg.url, cfg.type])
  }

  /** 按配置选择传输：有 url 走 http/sse，否则 stdio */
  private makeTransport(cfg: McpServerConfig): Transport {
    if (cfg.url) {
      const url = new URL(cfg.url)
      return cfg.type === 'sse'
        ? new SSEClientTransport(url)
        : new StreamableHTTPClientTransport(url)
    }
    if (!cfg.command) throw new Error('MCP 配置需提供 command（stdio）或 url（http/sse）')
    return new StdioClientTransport({
      command: cfg.command,
      args: cfg.args ?? [],
      env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>
    })
  }

  /** 丢弃某 server 的连接与路由（连接已死或配置已变） */
  private async drop(name: string): Promise<void> {
    const c = this.clients.get(name)
    if (c) {
      try {
        await c.client.close()
      } catch {
        /* 忽略关闭错误 */
      }
      this.clients.delete(name)
    }
    for (const [fq, r] of this.routes) if (r.server === name) this.routes.delete(fq)
  }

  private async ensure(name: string, cfg: McpServerConfig): Promise<Connected | null> {
    const sig = this.sig(cfg)
    const existing = this.clients.get(name)
    if (existing) {
      if (existing.sig === sig) return existing
      await this.drop(name) // 配置变了 → 重连，无需重启 APP
    }
    try {
      const transport = this.makeTransport(cfg)
      const client = new Client(
        { name: 'hemilier-desktop-agent', version: '0.1.0' },
        { capabilities: {} }
      )
      // 给连接加超时，避免错误配置的 server 卡住整个发送流程
      await Promise.race([
        client.connect(transport),
        new Promise((_, reject) => setTimeout(() => reject(new Error('连接超时（15s）')), 15_000))
      ])
      const connected: Connected = { client, sig }
      this.clients.set(name, connected)
      return connected
    } catch (e) {
      console.error(`[mcp] 连接 server "${name}" 失败：`, e)
      return null
    }
  }

  /** 连接所有启用的 server 并返回合并后的工具定义 */
  async listToolDefs(servers: Record<string, McpServerConfig>): Promise<ToolDef[]> {
    const defs: ToolDef[] = []
    this.routes.clear()
    for (const [name, cfg] of Object.entries(servers ?? {})) {
      if (cfg.enabled === false) continue
      const conn = await this.ensure(name, cfg)
      if (!conn) continue
      try {
        const { tools } = await conn.client.listTools()
        for (const t of tools) {
          const fq = `${PREFIX}${name}__${t.name}`
          this.routes.set(fq, { server: name, tool: t.name })
          defs.push({
            name: fq,
            description: t.description ?? '',
            parameters: (t.inputSchema as Record<string, unknown>) ?? {
              type: 'object',
              properties: {}
            }
          })
        }
      } catch (e) {
        console.error(`[mcp] 列出 server "${name}" 的工具失败：`, e)
        await this.drop(name) // 连接可能已死，丢弃以便下次重连
      }
    }
    return defs
  }

  /** 探测各 server 的连通性，供设置面板「测试连接」展示 */
  async status(
    servers: Record<string, McpServerConfig>
  ): Promise<{ name: string; ok: boolean; toolCount: number; error?: string }[]> {
    const out: { name: string; ok: boolean; toolCount: number; error?: string }[] = []
    for (const [name, cfg] of Object.entries(servers ?? {})) {
      if (cfg.enabled === false) {
        out.push({ name, ok: false, toolCount: 0, error: '已禁用' })
        continue
      }
      const conn = await this.ensure(name, cfg)
      if (!conn) {
        out.push({ name, ok: false, toolCount: 0, error: '连接失败（命令/路径是否正确？）' })
        continue
      }
      try {
        const { tools } = await conn.client.listTools()
        out.push({ name, ok: true, toolCount: tools.length })
      } catch (e) {
        await this.drop(name)
        out.push({
          name,
          ok: false,
          toolCount: 0,
          error: e instanceof Error ? e.message : String(e)
        })
      }
    }
    return out
  }

  isMcpTool(name: string): boolean {
    return name.startsWith(PREFIX)
  }

  async callTool(fqName: string, args: Record<string, unknown>): Promise<string> {
    const route = this.routes.get(fqName)
    if (!route) throw new Error(`未知的 MCP 工具：${fqName}`)
    const conn = this.clients.get(route.server)
    if (!conn) throw new Error(`MCP server 未连接：${route.server}`)
    // 给调用加超时，避免卡住的 MCP server 拖死整轮
    let res
    try {
      res = await Promise.race([
        conn.client.callTool({ name: route.tool, arguments: args }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`MCP 工具调用超时（30s）：${fqName}`)), 30_000)
        )
      ])
    } catch (e) {
      await this.drop(route.server) // 连接可能已死，丢弃以便下次重连
      throw e
    }
    const content = (res.content ?? []) as { type: string; text?: string }[]
    const text = content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n')
    return text || '(无文本输出)'
  }

  async closeAll(): Promise<void> {
    for (const { client } of this.clients.values()) {
      try {
        await client.close()
      } catch {
        // 忽略关闭错误
      }
    }
    this.clients.clear()
    this.routes.clear()
  }
}

export const mcpManager = new McpManager()
