import { randomUUID } from 'node:crypto'
import type { Message, ModelInfo, ToolCall } from '@shared/types'
import type { ChatOptions, ChatResult, ModelProvider } from './types'
import { stallGuard, withRetry } from './util'
import { netFetch } from './netfetch'

const STALL_MS = 60_000

type OpenAIContent =
  | string
  | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[]

interface OpenAIMsg {
  role: string
  content: OpenAIContent
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

// 把内部消息转换为 OpenAI Chat Completions 格式（assistant 带 tool_calls，tool 带 tool_call_id）
function toOpenAIMessages(messages: Message[]): OpenAIMsg[] {
  return messages.map((m) => {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || '',
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) }
        }))
      }
    }
    if (m.role === 'tool') {
      return { role: 'tool', content: m.content, tool_call_id: m.toolCallId }
    }
    if (m.role === 'user' && m.images?.length) {
      return {
        role: 'user',
        content: [
          { type: 'text' as const, text: m.content },
          ...m.images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))
        ]
      }
    }
    return { role: m.role, content: m.content }
  })
}

// 流式累积中的工具调用（arguments 分片到达，需按 index 拼接）
interface PartialToolCall {
  id?: string
  name?: string
  args: string
}

type Tc = { index?: number; id?: string; function?: { name?: string; arguments?: unknown } }
type ToolChoice = { delta?: { tool_calls?: Tc[] }; message?: { tool_calls?: Tc[] } }

/**
 * 从流式分片里累积出工具调用。兼容：
 * - arguments 分片拼接；index 缺失时按出现顺序兜底（修复 MiniMax 等省略 index 导致工具调用丢失的 bug）；
 * - tool_calls 放在 message（非 delta）里；arguments 为对象而非字符串。
 */
export function extractToolCalls(choices: ToolChoice[]): ToolCall[] {
  const partials: PartialToolCall[] = []
  for (const choice of choices) {
    const tcs = choice.delta?.tool_calls ?? choice.message?.tool_calls ?? []
    for (let k = 0; k < tcs.length; k++) {
      const tc = tcs[k]
      const idx = tc.index ?? k
      const slot = (partials[idx] ??= { args: '' })
      if (tc.id) slot.id = tc.id
      if (tc.function?.name) slot.name = tc.function.name
      const a = tc.function?.arguments
      if (a !== undefined && a !== null) slot.args += typeof a === 'string' ? a : JSON.stringify(a)
    }
  }
  return partials
    .filter((p) => p && p.name)
    .map((p) => {
      let args: Record<string, unknown> = {}
      try {
        args = p.args ? JSON.parse(p.args) : {}
      } catch {
        /* 参数解析失败时留空对象 */
      }
      return { id: p.id || randomUUID(), name: p.name as string, args, status: 'pending' as const }
    })
}

/**
 * 通用 OpenAI 兼容 Provider，适配 DeepSeek / MiniMax / OpenAI 等
 * 提供 /v1/chat/completions（SSE 流式 + function calling）的端点。
 */
export class OpenAICompatProvider implements ModelProvider {
  id = 'openai'

  constructor(
    private baseUrl: string,
    private apiKey?: string
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`
    return h
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const res = await netFetch(`${this.baseUrl}/models`, { headers: this.headers() })
      if (!res.ok) return []
      const data = (await res.json()) as { data?: { id: string }[] }
      return (data.data ?? []).map((m) => ({ name: m.id }))
    } catch {
      return []
    }
  }

  async chat(opts: ChatOptions): Promise<ChatResult> {
    const wantTools = !!opts.tools?.length
    try {
      return await this.request(opts, wantTools)
    } catch (e) {
      // 仅在“明确不支持工具/函数调用”时退回纯聊天；其它错误(如参数非法、限流)应抛出而非静默关掉工具
      if (
        wantTools &&
        e instanceof Error &&
        /tool|function/i.test(e.message) &&
        /unsupport|not\s+support|does\s+not\s+support|doesn'?t\s+support|not\s+available/i.test(
          e.message
        )
      ) {
        return await this.request(opts, false)
      }
      throw e
    }
  }

  private async request(opts: ChatOptions, withTools: boolean): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: toOpenAIMessages(opts.messages),
      stream: true,
      // 让端点在最后一个 chunk 里带上真实用量（OpenAI 规范；不支持的端点会忽略该字段）
      stream_options: { include_usage: true },
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      tools: withTools
        ? opts.tools?.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters }
          }))
        : undefined
    }

    const guard = stallGuard(opts.signal, STALL_MS)
    try {
      // 建连阶段重试瞬时故障（429/5xx/网络抖动）；已开始流式后不重试，避免重复内容
      const res = await withRetry(
        () =>
          netFetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(body),
            signal: guard.signal
          }),
        { statusOf: (r) => r.status, signal: opts.signal }
      )

      if (!res.ok || !res.body) {
        const txt = await res.text().catch(() => '')
        throw new Error(`API 请求失败 (${res.status})${txt ? `：${txt}` : ''}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let content = ''
      let reasoning = ''
      let usage: import('./types').TokenUsage | undefined
      const toolChoices: ToolChoice[] = []

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        guard.reset()
        buffer += decoder.decode(value, { stream: true })

        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') continue

          let json: {
            choices?: (ToolChoice & {
              delta?: { content?: string; reasoning_content?: string; reasoning?: string }
            })[]
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
            error?: { message?: string } | string
          }
          try {
            json = JSON.parse(payload)
          } catch {
            continue
          }
          if (json.error) {
            const msg = typeof json.error === 'string' ? json.error : json.error.message
            throw new Error(msg || 'API 返回错误')
          }

          // 用量通常在最后一个 chunk（需 stream_options.include_usage）；有些端点也放在每个 chunk
          if (json.usage) {
            usage = {
              prompt: json.usage.prompt_tokens ?? 0,
              completion: json.usage.completion_tokens ?? 0,
              total:
                json.usage.total_tokens ??
                (json.usage.prompt_tokens ?? 0) + (json.usage.completion_tokens ?? 0)
            }
          }
          const choice = json.choices?.[0]
          if (!choice) continue
          const rc = choice.delta?.reasoning_content ?? choice.delta?.reasoning
          if (rc) {
            reasoning += rc
            opts.onReasoning?.(rc)
          }
          if (choice.delta?.content) {
            content += choice.delta.content
            opts.onToken?.(choice.delta.content)
          }
          if (choice.delta?.tool_calls || choice.message?.tool_calls) toolChoices.push(choice)
        }
      }

      return {
        content,
        toolCalls: extractToolCalls(toolChoices),
        reasoning: reasoning || undefined,
        usage
      }
    } finally {
      guard.dispose()
    }
  }
}
