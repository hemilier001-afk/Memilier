import type { ModelInfo, ProviderConfig, Settings } from '@shared/types'
import { OllamaProvider } from './ollama'
import { OpenAICompatProvider } from './openai'
import type { ModelProvider } from './types'

export const OLLAMA_ID = 'ollama'

/** 内置 Ollama 提供方 + 用户配置的云端提供方 */
export function getProviders(settings: Settings): ProviderConfig[] {
  return [
    { id: OLLAMA_ID, label: 'Ollama (本地)', kind: 'ollama', baseUrl: settings.ollamaBaseUrl },
    ...(settings.providers ?? [])
  ]
}

function makeProvider(cfg: ProviderConfig): ModelProvider {
  return cfg.kind === 'openai'
    ? new OpenAICompatProvider(cfg.baseUrl, cfg.apiKey)
    : new OllamaProvider(cfg.baseUrl)
}

/** 模型 id 形如 <provider>::<model>；无前缀视为 Ollama 模型 */
export function splitModelId(modelId: string): { providerId: string; model: string } {
  const i = modelId.indexOf('::')
  if (i < 0) return { providerId: OLLAMA_ID, model: modelId }
  return { providerId: modelId.slice(0, i), model: modelId.slice(i + 2) }
}

/** 去掉 provider 前缀，返回纯模型名（用于真正请求 API） */
export function bareModel(modelId: string): string {
  return splitModelId(modelId).model
}

/** 根据模型 id 解析出对应的 Provider 实例 */
export function resolveProvider(modelId: string, settings: Settings): ModelProvider {
  const { providerId } = splitModelId(modelId)
  const cfg = getProviders(settings).find((p) => p.id === providerId)
  // 找不到（如配置被删）时退回 Ollama
  return makeProvider(cfg ?? getProviders(settings)[0])
}

/** 聚合所有提供方的模型，name 为带前缀的路由 id */
export async function listAllModels(settings: Settings): Promise<ModelInfo[]> {
  const out: ModelInfo[] = []
  for (const p of getProviders(settings)) {
    try {
      let names: string[]
      if (p.kind === 'openai' && p.models?.length) {
        names = p.models
      } else {
        names = (await makeProvider(p).listModels()).map((m) => m.name)
      }
      for (const n of names) {
        out.push({ name: `${p.id}::${n}`, label: n, provider: p.label })
      }
    } catch {
      /* 某个提供方不可达时跳过 */
    }
  }
  return out
}
