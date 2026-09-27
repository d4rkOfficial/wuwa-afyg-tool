/**
 * @desc token 用量：服务商 usage 解析（真源）+ 本地估算回退（启发式）+ 展示格式化（纯逻辑）。
 *
 * ## 数据来源优先级
 * 1. **服务商 usage**（唯一真源）：流式响应最后一个 chunk 上的 `usage` 字段。
 *    - DeepSeek（Chat Completions）：`prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`
 *      （需请求体带 `stream_options: { include_usage: true }`，见 `client.ts`）
 *    - OpenAI 兼容：`prompt_tokens` / `completion_tokens` / `total_tokens` +
 *      `prompt_tokens_details.cached_tokens`（没有 miss 字段，命中率用 cached / prompt）
 *    - Responses API（DeepSeek 官方走这条）：`input_tokens` / `output_tokens` / `total_tokens` +
 *      `input_tokens_details.cached_tokens`
 * 2. **本地估算**（`estimateTokens`）：仅在该次请求完全没有 usage 时兜底，界面必须标注「估算」。
 *    字段缺失（例如有 prompt 没有 cache）时保持 `undefined`，界面显示「—」，绝不臆造。
 *
 * ## 本地估算口径与局限
 * - CJK 字符（中日韩表意文字 / 假名 / 全角标点）按 **1 token/字**；
 * - 其余字符（ASCII、拉丁字母等）按 **4 字符 ≈ 1 token**，向上取整；
 * - 每条消息另有约 4 token 的角色 / 结构开销（对齐 OpenAI 计数口径的近似值）。
 * - 局限：不区分 BPE 词表、不建模代码 / 数字 / 罕见字符的真实切分，也不含系统提示与
 *   工具 schema 的固定开销。实测中文文本通常偏差在 ±20% 内，仅用于占比观察与无 usage 兜底，
 *   **不能当作计费依据**。
 */
import type { ChatMessage } from './client'

/** @desc 每条消息的角色 / 结构开销（近似值，见文件头局限说明） */
export const MESSAGE_OVERHEAD_TOKENS = 4

/** @desc CJK 字符（表意文字 / 假名 / 谚文 / 全角标点），命中按 1 token/字计 */
const CJK_CHAR = /[\u2e80-\u303f\u3040-\u30ff\u3130-\u318f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/

/** @desc 其余字符按 4 字符 ≈ 1 token 计 */
const ASCII_CHARS_PER_TOKEN = 4

/** @desc 本地 token 估算（启发式，口径与局限见文件头注释） */
export const estimateTokens = (text: string): number => {
    if (!text) return 0
    let cjk = 0
    let other = 0
    for (const ch of text) {
        if (CJK_CHAR.test(ch)) cjk++
        else other++
    }
    return cjk + Math.ceil(other / ASCII_CHARS_PER_TOKEN)
}

/** @desc 单条消息的估算：正文 + 工具调用（名称 / 参数 JSON）+ 角色开销 */
export const estimateMessageTokens = (message: ChatMessage): number => {
    let tokens = estimateTokens(message.content ?? '') + MESSAGE_OVERHEAD_TOKENS
    for (const call of message.tool_calls ?? []) {
        tokens += estimateTokens(call.function?.name ?? '') + estimateTokens(call.function?.arguments ?? '')
    }
    return tokens
}

/** @desc 一组消息的估算合计 */
export const estimateMessagesTokens = (messages: readonly ChatMessage[]): number =>
    messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0)

// ── 服务商 usage 解析 ─────────────────────────────────────────────────

/** @desc 归一化后的服务商 usage（缺字段一律 `undefined`，界面显示「—」） */
export interface TokenUsage {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
    /** @desc 缓存命中 prompt token（DeepSeek `prompt_cache_hit_tokens` / `*_details.cached_tokens`） */
    cacheHitTokens?: number
    /** @desc 缓存未命中 prompt token（仅 DeepSeek 单独上报；OpenAI 兼容需用 prompt - hit 推） */
    cacheMissTokens?: number
}

const num = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined

/**
 * @desc 解析服务商返回的 usage（DeepSeek / OpenAI 兼容 / Responses 三种字段口径都认）。
 * @returns 一个已知数值字段都没有时返回 `null`（调用方据此走本地估算回退）。
 */
export const parseUsage = (raw: unknown): TokenUsage | null => {
    const u = asRecord(raw)
    if (!u) return null
    const details = asRecord(u.prompt_tokens_details) ?? asRecord(u.input_tokens_details)
    const promptTokens = num(u.prompt_tokens) ?? num(u.input_tokens)
    const completionTokens = num(u.completion_tokens) ?? num(u.output_tokens)
    const reportedTotal = num(u.total_tokens)
    const usage: TokenUsage = {
        promptTokens,
        completionTokens,
        // total 缺失时用 prompt + completion 补齐（算术推导，不是臆造）
        totalTokens:
            reportedTotal ??
            (promptTokens !== undefined && completionTokens !== undefined
                ? promptTokens + completionTokens
                : undefined),
        cacheHitTokens: num(u.prompt_cache_hit_tokens) ?? num(details?.cached_tokens),
        cacheMissTokens: num(u.prompt_cache_miss_tokens)
    }
    const known = Object.values(usage).some((v) => v !== undefined)
    return known ? usage : null
}

/**
 * @desc 缓存命中率：优先 `hit / (hit + miss)`（DeepSeek 口径）；
 * 只有 `cached_tokens` 时退化为 `hit / prompt`（OpenAI 兼容口径）。
 * @returns 无法计算（字段缺失或分母为 0）时返回 `null`，界面显示「—」。
 */
export const cacheHitRate = (
    usage: Pick<TokenUsage, 'cacheHitTokens' | 'cacheMissTokens' | 'promptTokens'> | null | undefined
): number | null => {
    if (!usage) return null
    const hit = usage.cacheHitTokens
    if (hit === undefined) return null
    const miss = usage.cacheMissTokens
    if (miss !== undefined && hit + miss > 0) return hit / (hit + miss)
    const prompt = usage.promptTokens
    if (prompt !== undefined && prompt > 0) return Math.min(1, hit / prompt)
    return null
}

// ── 展示格式化 ────────────────────────────────────────────────────────

/** @desc token 数展示：≥1000 用 `8.1k`，缺失显示「—」 */
export const formatTokens = (value: number | undefined | null): string => {
    if (value === undefined || value === null || !Number.isFinite(value)) return '—'
    if (value >= 10000) return `${Math.round(value / 1000)}k`
    if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
    return String(Math.round(value))
}

/** @desc 命中率展示：`74%` / 无法计算时「—」 */
export const formatPercent = (rate: number | null | undefined): string =>
    rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`

/** @desc 耗时展示：`4.2s` */
export const formatDuration = (ms: number): string => `${(Math.max(0, ms) / 1000).toFixed(1)}s`

// ── 用量累计与回合汇总 ────────────────────────────────────────────────

/**
 * @desc 累计用量（本轮 / 本会话共用结构）。
 * `promptTokens` 等合计值可能混合「服务商上报」与「本地估算」，用 `estimatedRequests` 标注。
 */
export interface UsageTotals {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cacheHitTokens?: number
    cacheMissTokens?: number
    /** @desc 统计到的请求数（每轮可能有多个工具轮次请求） */
    requests: number
    /** @desc 其中完全没有服务商 usage、用本地估算回退的请求数 */
    estimatedRequests: number
}

export const emptyUsageTotals = (): UsageTotals => ({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    requests: 0,
    estimatedRequests: 0
})

/** @desc 累计视图 + 会话级额外字段 */
export interface SessionUsageTotals extends UsageTotals {
    /** @desc 已完成的回合数 */
    turns: number
}

export const emptySessionUsageTotals = (): SessionUsageTotals => ({ ...emptyUsageTotals(), turns: 0 })

/** @desc 回合汇总（回合结束后保留，直到下一轮开始） */
export interface TurnSummary {
    elapsedMs: number
    toolCalls: number
    failedTools: number
    usage: UsageTotals
}

/**
 * @desc 一行式回合汇总文案，例如
 * `本轮：4.2s · 3 次工具调用 · prompt 8.1k / completion 0.6k · 缓存命中 74%`。
 * 没有任何请求（例如未配置 Key 就失败）时只保留耗时与工具信息。
 */
export const summarizeTurn = (summary: TurnSummary): string => {
    const parts = [`本轮：${formatDuration(summary.elapsedMs)}`]
    if (summary.toolCalls > 0) {
        parts.push(`${summary.toolCalls} 次工具调用${summary.failedTools > 0 ? `（${summary.failedTools} 失败）` : ''}`)
    }
    const { usage } = summary
    if (usage.requests > 0) {
        parts.push(`prompt ${formatTokens(usage.promptTokens)} / completion ${formatTokens(usage.completionTokens)}`)
        parts.push(`缓存命中 ${formatPercent(cacheHitRate(usage))}`)
        if (usage.estimatedRequests > 0) parts.push(`含 ${usage.estimatedRequests} 次本地估算`)
    }
    return parts.join(' · ')
}
