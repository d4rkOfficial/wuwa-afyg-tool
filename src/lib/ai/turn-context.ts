/**
 * @desc AI 回合的 system 消息装配（纯逻辑，便于单测与阅读）。
 *
 * 装配顺序固定：
 *   人设提示词 → 被动技能正文 → 主动技能清单 → 当前状态 → 变化队列 → 历史 → 本轮用户输入
 *
 * 设计要点：
 * - 「被动技能正文」与「主动技能清单」分别来自 `$lib/ai/skills.ts` 的两个渲染函数，
 *   被动技能不重复出现在清单里（见该文件说明）
 * - 历史与本轮输入原样追加，保持上一轮 `ChatMessage[]` 的连续上下文
 */
import type { ChatMessage } from './client'

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

/** @desc 取字符串参数并去掉首尾空白（空串视为未提供） */
const trimmed = (value?: string): string => (typeof value === 'string' ? value.trim() : '')

/** @desc 当前状态 system 消息正文（含「以本条为准」声明） */
export const renderContextMessage = (context: string): string =>
    `【当前状态】${context.trim()}\n注意：工程与视图可能在对话期间被用户切换，以本条状态为准。`

/** @desc 按固定顺序装配本轮消息（首条必为人设 system） */
export const buildTurnMessages = (input: TurnContextInput): ChatMessage[] => {
    const messages: ChatMessage[] = [{ role: 'system', content: input.systemPrompt }]
    const pushSystem = (text?: string) => {
        const body = trimmed(text)
        if (body) messages.push({ role: 'system', content: body })
    }
    pushSystem(input.passiveSkills)
    pushSystem(input.skillListing)
    const context = trimmed(input.context)
    if (context) messages.push({ role: 'system', content: renderContextMessage(context) })
    pushSystem(input.changes)
    if (Array.isArray(input.history) && input.history.length > 0) messages.push(...input.history)
    const userMessage = trimmed(input.userMessage)
    if (userMessage) messages.push({ role: 'user', content: userMessage })
    return messages
}
