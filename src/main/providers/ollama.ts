import { randomUUID } from 'node:crypto'
import type { Message, ModelInfo, ToolCall } from '@shared/types'
import type { ChatOptions, ChatResult, ModelProvider } from './types'
import { stallGuard } from './util'

const STALL_MS = 60_000

interface OllamaMsg {
  role: string
  content: string
  images?: string[]
  tool_calls?: { function?: { name?: string; arguments?: Record<string, unknown> | string } }[]
}

function toOllamaMessages(messages: Message[]): OllamaMsg[] {
  return messages.map((m) => {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || '',
        tool_calls: m.toolCalls.map((tc) => ({
          function: { name: tc.name, arguments: tc.args }
        }))
      }
    }
    if (m.role === 'user' && m.images?.length) {
      // Ollama 需要去掉 data URL 前缀，只留 base64
      return {
        role: 'user',
        content: m.content,
        images: m.images.map((u) => u.replace(/^data:[^;]+;base64,/, ''))
      }
    }
    return { role: m.role, content: m.content }
  })
}

export class OllamaProvider implements ModelProvider {
  id = 'ollama'

  constructor(private baseUrl: string) {}

  async listModels(): Promise<ModelInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`)
      if (!res.ok) return []
      const data = (await res.json()) as { models?: { name: string; size?: number }[] }
      return (data.models ?? []).map((m) => ({ name: m.name, size: m.size }))
    } catch {
      return []
    }
  }

  async chat(opts: ChatOptions): Promise<ChatResult> {
    const wantTools = !!opts.tools?.length
    try {
      return await this.request(opts, wantTools)
    } catch (e) {
      // 模型不支持工具调用时，退回纯聊天再试一次
      if (wantTools && e instanceof Error && /does not support tools/i.test(e.message)) {
        return await this.request(opts, false)
      }
      throw e
    }
  }

  private async request(opts: ChatOptions, withTools: boolean): Promise<ChatResult> {
    const body = {
      model: opts.model,
      messages: toOllamaMessages(opts.messages),
      stream: true,
      // Ollama 默认 num_ctx 仅 2048，会截断系统提示+工具定义导致模型"看不到"工具；
      // 调到 16k 与主进程 ~48k 字符的历史裁剪预算量级对齐（否则 Ollama 会先掐掉头部的系统提示）
      options: { num_ctx: 16384 },
      tools: withTools
        ? opts.tools?.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters }
          }))
        : undefined
    }

    const guard = stallGuard(opts.signal, STALL_MS)
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: guard.signal
      })

      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => '')
        throw new Error(`Ollama 请求失败 (${res.status})${txt ? `：${txt}` : ''}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let content = ''
      const toolCalls: ToolCall[] = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        guard.reset()
        buffer += decoder.decode(value, { stream: true })

        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line) continue

          let json: {
            message?: OllamaMsg
            error?: string
          }
          try {
            json = JSON.parse(line)
          } catch {
            continue
          }
          if (json.error) throw new Error(json.error)

          const msg = json.message
          if (msg?.content) {
            content += msg.content
            opts.onToken?.(msg.content)
          }
          if (msg?.tool_calls) {
            for (const tc of msg.tool_calls) {
              const raw = tc.function?.arguments
              let args: Record<string, unknown> = {}
              if (typeof raw === 'string') {
                try {
                  args = JSON.parse(raw)
                } catch {
                  /* 解析失败留空对象 */
                }
              } else if (raw && typeof raw === 'object') {
                args = raw as Record<string, unknown>
              }
              toolCalls.push({
                id: randomUUID(),
                name: tc.function?.name ?? '',
                args,
                status: 'pending'
              })
            }
          }
        }
      }

      return { content, toolCalls }
    } finally {
      guard.dispose()
    }
  }
}
