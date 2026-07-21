import type { Message, ModelInfo, ToolCall, ToolDef } from '@shared/types'

export interface ChatOptions {
  model: string
  messages: Message[]
  tools?: ToolDef[]
  signal?: AbortSignal
  onToken?: (text: string) => void
  /** 推理链分片（如 deepseek-reasoner 的 reasoning_content、qwen3 thinking）实时回传 */
  onReasoning?: (text: string) => void
  /** 采样温度（省略则用端点默认） */
  temperature?: number
  /** 最大生成 token（省略则用端点默认） */
  maxTokens?: number
}

export interface ChatResult {
  content: string
  toolCalls: ToolCall[]
  /** 完整推理链（若模型返回） */
  reasoning?: string
}

/**
 * 模型提供方抽象。已实现 Ollama 与 OpenAI 兼容端点，
 * 后续可加入更多端点，只需实现同一接口即可在 UI 中切换。
 */
export interface ModelProvider {
  id: string
  listModels(): Promise<ModelInfo[]>
  chat(opts: ChatOptions): Promise<ChatResult>
}
