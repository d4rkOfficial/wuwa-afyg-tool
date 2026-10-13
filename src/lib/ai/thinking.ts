/**
 * @desc 思考强度（thinking level）：档位定义 + 到各协议请求参数的映射（纯逻辑，无副作用）。
 *
 * 为什么要独立成文件：思考强度有两个消费者，口径必须一致 ——
 *   ① 配置文件里的持久化默认（`AiProfile.reasoningEffort`，见 `config.svelte.ts`）
 *   ② 助手弹窗里的会话级覆盖（`session-overrides.svelte.ts`）
 * 两者共用同一套档位，避免「设置里 3 档、弹窗里 4 档」这种半路的类型错配。
 *
 * `off` 的语义是**省略思考参数**，而不是发送一个「关」的值：
 *   - Chat Completions：省略 `reasoning_effort`（`client.ts` 里 `if (options.reasoningEffort)` 已按此处理）
 *   - Responses API：省略 `reasoning.effort`（`responses.ts`）
 * 故「关」在不支持思考参数的服务商上也是安全的，不需要按服务商分支。
 */

/** @desc 思考强度档位（`off` = 不发送该参数） */
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high'

/** @desc 协议层真正会写进请求体的档位（`off` 不在此列，它代表省略参数） */
export type ReasoningEffort = 'low' | 'medium' | 'high'

/** @desc 全部档位，按由弱到强排列（UI 直接照此顺序渲染） */
export const THINKING_LEVELS: readonly ThinkingLevel[] = ['off', 'low', 'medium', 'high']

/** @desc 档位文案（设置弹窗与助手弹窗共用一份，不各写一遍） */
export const THINKING_LABELS: Record<ThinkingLevel, string> = {
    off: '关',
    low: '低',
    medium: '中',
    high: '高'
}

/** @desc 档位取值是否合法（收窄用） */
export const isThinkingLevel = (value: unknown): value is ThinkingLevel =>
    value === 'off' || value === 'low' || value === 'medium' || value === 'high'

/**
 * @desc 把任意来源的值归一为合法档位。
 * 非法 / 缺失一律回落 `medium` —— 与 `config.svelte.ts` 原先读盘容错（「非 low/high 即 medium」）一致，
 * 故老数据不会因为新增 `off` 档而被改写。
 */
export const coerceThinkingLevel = (value: unknown): ThinkingLevel => (isThinkingLevel(value) ? value : 'medium')

/**
 * @desc 档位 → 协议参数。
 * @returns `off` 返回 `undefined`，调用方据此**省略**该字段（而不是传一个假值）。
 */
export const toReasoningEffort = (level: ThinkingLevel): ReasoningEffort | undefined =>
    level === 'off' ? undefined : level

/** @desc 档位文案 */
export const thinkingLabel = (level: ThinkingLevel): string => THINKING_LABELS[level]
