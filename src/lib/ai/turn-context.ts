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
    /** @desc 当前工作摘要（空串仍然注入该段 —— 见 `renderWorkSummaryMessage`） */
    workSummary?: string
    /** @desc 变化队列渲染结果（自上次对话以来的工程改动，空串跳过） */
    changes?: string
    /** @desc 历史消息 */
    history?: ChatMessage[]
    /** @desc 本轮用户输入 */
    userMessage?: string
    /**
     * @desc 本轮用户消息附带的图片（data URL）。
     * 只影响 `user` 分段那一条消息 —— 附件是「这一轮说了什么」的一部分，
     * 因此它随历史一起保留（后续轮次仍能看到这张图）。
     */
    userImages?: string[]
}

/** @desc 上下文分段 id（顺序即装配顺序） */
export type TurnSegmentId =
    'persona' | 'passiveSkills' | 'activeSkills' | 'context' | 'workSummary' | 'changes' | 'history' | 'user'

/** @desc 分段展示名（面板文案的唯一真源） */
export const TURN_SEGMENT_LABELS: Record<TurnSegmentId, string> = {
    persona: '人设',
    passiveSkills: '被动技能正文',
    activeSkills: '主动技能清单',
    context: '当前状态',
    workSummary: '工作摘要',
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
    workSummary:
        '要求 AI 每轮先用 set_work_summary 更新的一句话工作摘要（同时显示在助手悬浮窗大标题上）；该段**始终注入**，禁用后 AI 不再维护摘要',
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

/**
 * @desc 「工作摘要」分段正文：固定要求 + 当前摘要。
 *
 * 为什么单独成段、而不是塞进人设提示词：人设可被用户自定义覆盖（清空即回落默认），
 * 而「每轮先用 `set_work_summary` 更新摘要」是**产品行为要求**，不能因为用户改了人设就消失。
 *
 * 该段**始终注入**（即使还没有摘要）—— 空摘要时若跳过整段，模型第一次就永远不知道该写摘要。
 */
export const renderWorkSummaryMessage = (summary: string): string =>
    [
        '【当前工作摘要】这是显示在助手悬浮窗标题上、给用户看的一句话摘要。',
        '要求：**每轮回复开始前，先调用 `set_work_summary` 更新它**，用一句话概括「正在做什么 / 进行到哪一步」。',
        '它面向用户而不是给自己看的备忘：写清在做什么（例如「给椿配装，正在对比两把武器」），不要写寒暄、过程或本次回答的结论。',
        summary
            ? `你上一轮的摘要：「${summary}」。若仍在做同一件事就沿用或精炼，若已转向新任务就改写，不要原样重复无关内容。`
            : '目前还没有摘要，本轮请务必先写一条。'
    ].join('\n')

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

    /*
     * 工作摘要段**无条件注入**（不走 `optional`）：它是「每轮先更新摘要」这条要求的载体，
     * 空摘要时必须照常出现，否则模型第一次无从知道要写摘要。
     */
    const workSummaryText = renderWorkSummaryMessage(trimmed(input.workSummary))
    segments.push(toSegment('workSummary', workSummaryText, [{ role: 'system', content: workSummaryText }]))

    segments.push(optional('changes', input.changes))

    const history = Array.isArray(input.history) ? input.history : []
    segments.push(toSegment('history', history.map((m) => m.content).join('\n\n'), history))

    const userMessage = trimmed(input.userMessage)
    const userImages = input.userImages ?? []
    // 只有图片、没有文字也是一条合法消息（发图问「这是什么」）；此时段内消息仍要产生
    const hasUserContent = Boolean(userMessage) || userImages.length > 0
    // 面板里把附图张数显示出来，否则「本轮用户输入」看起来会像丢字（正文为空或很短）
    const userDisplay = userImages.length > 0 ? `${userMessage}\n（附 ${userImages.length} 张图片）` : userMessage
    segments.push(
        toSegment(
            'user',
            userDisplay,
            hasUserContent
                ? [
                      {
                          role: 'user',
                          content: userMessage,
                          ...(userImages.length > 0 ? { images: userImages } : {})
                      }
                  ]
                : []
        )
    )

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
