/**
 * @desc AI 回合的 system 消息装配（纯逻辑，便于单测与阅读）。
 *
 * 装配顺序固定，且**与「上下文面板」共用同一份分段真源**：
 *   人设 → 被动技能正文 → 主动技能清单 → 当前状态 → 变化队列 → 历史 → 本轮用户输入
 *
 * 设计要点：
 * - `buildTurnSegments()` 产出「分段」结构（每段含展示文本、实际消息、本地 token 估算）；
 *   装配（`segmentsToMessages`）与上下文面板（`session.ts` 写入快照后由界面读取）都基于它，
 *   避免装配与展示两处口径漂移。
 * - 「被动技能正文」与「主动技能清单」分别来自 `$lib/ai/skills.ts` 的两个渲染函数，
 *   被动技能不重复出现在清单里（见该文件说明）
 * - 历史与本轮输入原样追加，保持上一轮 `ChatMessage[]` 的连续上下文
 * - 段被**临时禁用**（会话级，不持久化）时该段不产生消息，但仍出现在面板里（灰显）
 */
import type { ChatMessage } from './client'
import { estimateMessagesTokens } from './token-usage'

export interface TurnContextInput {
    /** @desc 人设提示词（用户自定义优先，已回落默认值） */
    systemPrompt: string
    /** @desc 启用中的被动技能正文（常驻注入，空串跳过） */
    passiveSkills?: string
    /** @desc 启用中的主动技能清单（名称 + 一句话描述，空串跳过） */
    skillListing?: string
    /** @desc 当前状态（工程 / 视图 / 环节锁定 / 弹窗，空串跳过） */
    context?: string
    /** @desc 变化队列渲染结果（自上次对话以来的工程改动，空串跳过） */
    changes?: string
    /** @desc 历史消息 */
    history?: ChatMessage[]
    /** @desc 本轮用户输入 */
    userMessage?: string
}

/** @desc 上下文分段 id（顺序即装配顺序） */
export type TurnSegmentId = 'persona' | 'passiveSkills' | 'activeSkills' | 'context' | 'changes' | 'history' | 'user'

/** @desc 分段展示名（面板文案的唯一真源） */
export const TURN_SEGMENT_LABELS: Record<TurnSegmentId, string> = {
    persona: '人设',
    passiveSkills: '被动技能正文',
    activeSkills: '主动技能清单',
    context: '当前状态',
    changes: '变化队列',
    history: '对话历史',
    user: '本轮用户输入'
}

/** @desc 分段说明（面板 tooltip 用） */
export const TURN_SEGMENT_HINTS: Record<TurnSegmentId, string> = {
    persona: '系统人设提示词（设置 → 助手设置 → 提示词），临时禁用后模型将失去角色与工具约定',
    passiveSkills: '启用中的被动技能正文，每轮常驻注入',
    activeSkills: '启用中的主动技能「名称 + 一句话描述」清单，正文由 use_skill 按需激活',
    context: '当前工程 / 视图 / 环节锁定 / 打开的弹窗（以本条为准）',
    changes: '自上次对话以来的工程改动，回合开始时取出并清空队列',
    history: '上一轮回传的完整消息序列（含此前的工具调用与结果）',
    user: '本轮用户输入'
}

/** @desc 一个上下文分段 */
export interface TurnSegment {
    id: TurnSegmentId
    /** @desc 界面展示名 */
    label: string
    /** @desc 段正文（多消息段为各消息正文拼接，仅用于展示与本地估算） */
    text: string
    /** @desc 该段实际注入的消息（空段为空数组） */
    messages: ChatMessage[]
    /** @desc 本地估算 token（启发式，口径见 token-usage.ts） */
    tokens: number
}

/** @desc 取字符串参数并去掉首尾空白（空串视为未提供） */
const trimmed = (value?: string): string => (typeof value === 'string' ? value.trim() : '')

/** @desc 当前状态 system 消息正文（含「以本条为准」声明） */
export const renderContextMessage = (context: string): string =>
    `【当前状态】${context.trim()}\n注意：工程与视图可能在对话期间被用户切换，以本条状态为准。`

/** @desc 组装一个分段（token 估算按消息计，含每条消息的角色开销） */
const toSegment = (id: TurnSegmentId, text: string, messages: ChatMessage[]): TurnSegment => ({
    id,
    label: TURN_SEGMENT_LABELS[id],
    text,
    messages,
    tokens: estimateMessagesTokens(messages)
})

/**
 * @desc 把各段文本渲染成**分段**结构（装配与面板共用的唯一真源）。
 * 空段（正文为空）仍会出现在结果里（`messages` 为空数组），便于面板显示「无内容」。
 */
export const buildTurnSegments = (input: TurnContextInput): TurnSegment[] => {
    const segments: TurnSegment[] = []
    const persona = input.systemPrompt ?? ''
    segments.push(toSegment('persona', persona, [{ role: 'system', content: persona }]))

    const optional = (id: TurnSegmentId, raw: string | undefined, render?: (text: string) => string): TurnSegment => {
        const body = trimmed(raw)
        const text = body ? (render ? render(body) : body) : ''
        return toSegment(id, text, text ? [{ role: 'system', content: text }] : [])
    }

    segments.push(optional('passiveSkills', input.passiveSkills))
    segments.push(optional('activeSkills', input.skillListing))
    segments.push(optional('context', input.context, renderContextMessage))
    segments.push(optional('changes', input.changes))

    const history = Array.isArray(input.history) ? input.history : []
    segments.push(toSegment('history', history.map((m) => m.content).join('\n\n'), history))

    const userMessage = trimmed(input.userMessage)
    segments.push(toSegment('user', userMessage, userMessage ? [{ role: 'user', content: userMessage }] : []))

    return segments
}

/**
 * @desc 分段 → 实际请求消息序列，跳过启用集合中被临时禁用的段。
 * 首条消息通常是人设 system；若人设段被禁用则首条可能是其它 system / 历史消息。
 */
export const segmentsToMessages = (
    segments: readonly TurnSegment[],
    disabled: readonly TurnSegmentId[] = []
): ChatMessage[] => segments.filter((s) => !disabled.includes(s.id)).flatMap((s) => s.messages)

/** @desc 按固定顺序装配本轮消息（等价于 `segmentsToMessages(buildTurnSegments(input))`） */
export const buildTurnMessages = (input: TurnContextInput): ChatMessage[] =>
    segmentsToMessages(buildTurnSegments(input))
