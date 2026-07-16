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

// 各提供方上次成功拉到的模型名缓存：临时失联/网络抖动时沿用旧列表，不让下拉框凭空清空
const lastKnownModels = new Map<string, string[]>()

/** 聚合所有提供方的模型，name 为带前缀的路由 id。并行 + 每个提供方 10s 超时，单个端点不可达不拖垮整个列表 */
export async function listAllModels(settings: Settings): Promise<ModelInfo[]> {
  const providers = getProviders(settings)
  const results = await Promise.allSettled(
    providers.map(async (p) => {
      if (p.kind === 'openai' && p.models?.length) return { p, names: p.models }
      const names = await Promise.race([
        makeProvider(p)
          .listModels()
          .then((ms) => ms.map((m) => m.name)),
        new Promise<string[]>((_, reject) =>
          setTimeout(() => reject(new Error('列模型超时')), 10_000)
        )
      ])
      lastKnownModels.set(p.id, names)
      return { p, names }
    })
  )
  const out: ModelInfo[] = []
  results.forEach((r, i) => {
    const p = providers[i]
    // 失败时退回上次成功的列表（可能只是服务暂时没启动）；从未成功过才真正略过
    const names = r.status === 'fulfilled' ? r.value.names : (lastKnownModels.get(p.id) ?? [])
    for (const n of names) {
      out.push({ name: `${p.id}::${n}`, label: n, provider: p.label })
    }
  })
  return out
}
