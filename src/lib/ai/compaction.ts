/**
 * @desc 上下文压缩（对齐 DSH 的 `/compact`）：把较旧的历史交给模型压成一份**摘要**，
 * 用「一条摘要 + 最近若干条原文」替换原历史，从而把上下文占用降下来。
 *
 * ## 为什么是压缩而不是删除
 * 删除单条消息会破坏 `tool_call` / `tool_result` 的配对（协议要求每个 tool_call 都有对应的结果消息），
 * 按轮次整块删又等于把结论一起丢掉。摘要既保住结论、又真的省 token ——
 * DSH 也是这么做的（取证确认它**没有**单条消息删除功能，只有压缩 / 分支）。
 *
 * ## 切分点为什么只落在「用户消息」上
 * `user` 消息绝不会插在 assistant(`tool_calls`) 与它的 tool 结果之间，因此落在 user 上的切点
 * **天然**不会拆散配对。找不到这样的切点（比如整段历史里切点之后没有 user 消息）就拒绝压缩，
 * 而不是冒险切在别处。
 *
 * ## 摘要消息的角色是 `system`
 * 放进历史时用 `system` 角色：既不会被误认成「用户说过的话」或「助手说过的话」，
 * 又能在 Chat Completions 与 Responses 两条协议上都被原样传递（见 `session.ts` 的 `toResponseItems`）。
 */
import { chatCompletionStream, type ChatMessage } from './client'
import { estimateMessagesTokens } from './token-usage'

/** @desc 压缩后原样保留的最近消息条数 */
export const COMPACTION_KEEP_RECENT = 6

/** @desc `older` 至少要有这么多条才值得压（太短时摘要可能比原文还长） */
export const COMPACTION_MIN_OLDER = 4

/** @desc 摘要的输出上限（摘要本身要短，否则压缩就失去意义） */
const COMPACTION_MAX_TOKENS = 4096

export interface CompactionPlan {
    /** @desc 送去摘要的历史 */
    older: ChatMessage[]
    /** @desc 原样保留的最近历史 */
    recent: ChatMessage[]
}

/**
 * @desc 规划压缩切分点。
 * @returns 无法安全压缩时返回 `null`：历史太短（`older` 不足 `COMPACTION_MIN_OLDER` 条），
 *   或切点之后找不到「用户消息」这一安全边界。
 */
export const planCompaction = (
    messages: readonly ChatMessage[],
    keepRecent = COMPACTION_KEEP_RECENT
): CompactionPlan | null => {
    // 目标切点：至少保留 keepRecent 条；然后**向后**推进到最近的 user 边界
    let cut = Math.max(0, messages.length - keepRecent)
    while (cut < messages.length && messages[cut].role !== 'user') cut++
    if (cut >= messages.length) return null
    if (cut < COMPACTION_MIN_OLDER) return null
    return { older: messages.slice(0, cut), recent: messages.slice(cut) }
}

/** @desc 追加在 `older` 之后的摘要指令（作为最后一条 user 消息发出） */
export const COMPACTION_INSTRUCTION = [
    '请把以上对话压缩成一份**结构化摘要**，供后续对话直接当作已经发生的事实使用。',
    '',
    '必须保留：',
    '1. 当前工程（名称 / id）与队伍配置，以及四环节（队伍 / 排轴 / 拉表 / 配装）的锁定状态；',
    '2. 用户明确提出过的要求、约束与偏好（例如命名规则、口径、单位）；',
    '3. 已经做出的改动与其结果（工具名 + 关键参数 + 结论数字）；',
    '4. 尚未完成的待办与已知问题。',
    '',
    '可以省略：',
    '- 寒暄、致谢、重复确认；',
    '- 工具返回的原始长文本（只留结论与关键数字）；',
    '- 已被后续结论推翻的中间过程。',
    '',
    '直接输出摘要正文，不要写「以下是摘要」之类的开场白，也不要输出 JSON。'
].join('\n')

/** @desc 摘要消息的前缀（让模型知道这段是压缩产物，需要细节时应重查而非臆测） */
export const SUMMARY_PREFIX =
    '【历史摘要】以下是对更早对话的压缩摘要，原始消息已移出上下文。' +
    '把它当作已发生的事实；需要细节时请用工具重新查询，不要凭摘要臆测具体数值。'

/** @desc 把模型产出的摘要包装成一条可放进历史的 system 消息 */
export const buildSummaryMessage = (summary: string): ChatMessage => ({
    role: 'system',
    content: `${SUMMARY_PREFIX}\n\n${summary.trim()}`
})

/** @desc 压缩请求的结果（失败原因回传给界面展示，不静默吞掉） */
export type SummarizeOutcome = { ok: true; summary: string } | { ok: false; error: string }

/**
 * @desc 调模型把 `older` 压成摘要。
 *
 * 只走 Chat Completions（`chatCompletionStream`）：这是一次普通的文本请求，不需要工具，
 * 也不需要 Responses API 那条仅为「服务端 web_search」而存在的通道，所有预设提供商都支持它。
 * 不传 `tools`，也不传思考强度（用提供商默认），避免把压缩变成一次昂贵的长思考。
 */
export const summarizeMessages = async (
    cfg: { apiKey: string; baseUrl: string; model: string; directRequest?: boolean },
    older: readonly ChatMessage[],
    signal?: AbortSignal
): Promise<SummarizeOutcome> => {
    try {
        const result = await chatCompletionStream(
            cfg.apiKey,
            [...older, { role: 'user', content: COMPACTION_INSTRUCTION }],
            {
                baseUrl: cfg.baseUrl,
                model: cfg.model,
                signal,
                direct: cfg.directRequest,
                maxTokens: COMPACTION_MAX_TOKENS
            }
        )
        const summary = result.content.trim()
        if (!summary) return { ok: false, error: '模型返回了空摘要，历史未改动' }
        return { ok: true, summary }
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : '压缩请求失败' }
    }
}

/** @desc 一次压缩的落地结果（新的历史 + 供界面展示的统计） */
export interface AppliedCompaction {
    /** @desc 新的历史：摘要消息 + 原样保留的最近消息 */
    history: ChatMessage[]
    /** @desc 被压掉的消息条数 */
    summarizedCount: number
    /** @desc 压缩前后整个历史的估算 token（本地估算，仅供对比，不是计费依据） */
    tokensBefore: number
    tokensAfter: number
}

/** @desc 纯函数：把摘要与保留段拼成新历史，并算出前后 token（便于单测与界面复用同一口径） */
export const applyCompaction = (
    messages: readonly ChatMessage[],
    plan: CompactionPlan,
    summary: string
): AppliedCompaction => {
    const history = [buildSummaryMessage(summary), ...plan.recent]
    return {
        history,
        summarizedCount: plan.older.length,
        tokensBefore: estimateMessagesTokens(messages),
        tokensAfter: estimateMessagesTokens(history)
    }
}
