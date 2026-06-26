import type { Message, ModelInfo, ToolCall, ToolDef } from '@shared/types'

export interface ChatOptions {
  model: string
  messages: Message[]
  tools?: ToolDef[]
  signal?: AbortSignal
  onToken?: (text: string) => void
}

export interface ChatResult {
  content: string
  toolCalls: ToolCall[]
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
