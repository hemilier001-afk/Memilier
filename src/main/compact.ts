// 对话压缩：把较早的历史交给模型压成一份摘要，保留最近若干条原文。
// 两个入口共用：用户手动 /compact（ipc.ts），以及超出上下文预算时的**自动压缩**（agent/loop.ts）。
//
// 为什么自动压缩比"静默裁掉最早消息"好：裁掉=信息直接消失，智能体会突然忘记早先的目标与结论；
// 压缩=把关键信息浓缩后留在上下文里，长对话仍然连贯（对齐 Claude/Codex 的做法）。
import { randomUUID } from 'node:crypto'
import type { Conversation } from '../shared/types'
import { bareModel, resolveProvider } from './providers/registry'
import { store } from './store'

/** 保留最近 N 条原文（更早的压成摘要） */
// 保留最近 N 条原文。4 条太少：一次「工具调用 + 大结果 + 回复」就占 3 条，
// 稍一压缩就把刚读到的资料丢光。
const KEEP = 8
const SUMMARY_INPUT_LIMIT = 40_000

const COMPACTOR_PROMPT =
  '你是对话压缩器。把给定的对话历史压缩成一份简洁但信息完整的中文摘要，保留：' +
  '用户的目标与关键要求、已完成的事项与结论、重要决定、未解决的问题、涉及的文件/路径/命令等关键细节。' +
  '用要点列出，不要添加评论。'

export interface CompactResult {
  ok: boolean
  conversation?: Conversation
  error?: string
  /** 被压缩掉的原始消息条数 */
  compacted?: number
}

/** 压缩一个会话的较早历史。signal 用于跟随本次运行的中断。 */
export async function compactConversation(
  id: string,
  signal?: AbortSignal
): Promise<CompactResult> {
  const conv = store.getConversation(id)
  if (!conv) return { ok: false, error: '对话不存在' }
  if (conv.messages.length <= KEEP + 2) return { ok: false, error: '对话还很短，暂不需要压缩' }

  const settings = store.getSettings()
  const modelId = conv.model || settings.defaultModel
  if (!bareModel(modelId)) return { ok: false, error: '尚未选择模型' }
  const provider = resolveProvider(modelId, settings)

  const old = conv.messages.slice(0, -KEEP)
  const kept = conv.messages.slice(-KEEP)
  while (kept.length && kept[0].role === 'tool') kept.shift() // 保住工具配对

  const transcript = old
    .filter((m) => m.content)
    .map((m) => {
      const role = m.role === 'user' ? '用户' : m.role === 'assistant' ? '助手' : '工具结果'
      return `【${role}】${m.content.slice(0, 2000)}`
    })
    .join('\n')
    .slice(0, SUMMARY_INPUT_LIMIT)

  try {
    const { content } = await provider.chat({
      model: bareModel(modelId),
      messages: [
        { id: 's', role: 'system', content: COMPACTOR_PROMPT, createdAt: 0 },
        { id: 'u', role: 'user', content: transcript, createdAt: 0 }
      ],
      signal
    })
    // 重新取一次：压缩期间会话可能已被其它路径更新
    const fresh = store.getConversation(id)
    if (!fresh) return { ok: false, error: '对话已不存在' }
    // 摘要必须是 **user** 角色：此前用 assistant 角色，压缩后整段对话里可能一条 user 消息都不剩，
    // 模型只看到"我自己说过的话"，不知道用户在要求什么 —— 于是回一句"请告诉我需要执行的任务"（实测踩过）。
    const summaryMsg = {
      id: randomUUID(),
      role: 'user' as const,
      content: `📜 **对话已压缩**（此前 ${old.length} 条消息的摘要，作为背景资料；请据此继续未完成的任务，不要重新询问用户）：\n\n${content}`,
      createdAt: Date.now()
    }
    // 若保留区里已没有用户消息，把被压掉的最后一条用户请求原文补回来——
    // 否则"待办事项"只存在于摘要里，模型容易当成已完成而空转。
    const lastUserInOld = [...old].reverse().find((m) => m.role === 'user' && m.content?.trim())
    const keptHasUser = kept.some((m) => m.role === 'user')
    const restored =
      !keptHasUser && lastUserInOld
        ? [
            {
              id: randomUUID(),
              role: 'user' as const,
              content: `（承接上文，我最近的请求是）${lastUserInOld.content}`,
              createdAt: Date.now()
            }
          ]
        : []
    fresh.messages = [summaryMsg, ...restored, ...kept]
    fresh.updatedAt = Date.now()
    store.saveConversation(fresh)
    store.flush()
    return { ok: true, conversation: fresh, compacted: old.length }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
