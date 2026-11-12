/**
 * @desc 乘区级生效条件（伤害属性 / 伤害类型）的求值与归一化。
 *
 * 分层（已定稿）：
 *   1. **Buff 级** —— 链/阶、伤害名、角色面板、敌人类型、Buff 依赖等规则，统一在 `rules.ts` + `BuffInstance.rules`
 *   2. **乘区级** —— 挂在具体乘区条目上，**只允许**伤害类型 / 伤害属性（本文件）
 */

import type { BuffCondition } from './calculation.types'
import { DAMAGE_TYPE_SHORT } from '$lib/consts/game-terms'

/** @desc 条件是否为空（无任何子句） */
export const isConditionEmpty = (cond: BuffCondition | undefined): boolean => {
    if (!cond) return true
    return (cond.elements?.length ?? 0) === 0 && (cond.damageTypes?.length ?? 0) === 0
}

/** @desc 乘区级条件求值上下文：条目属性 + 已解析的伤害类型 */
export interface ConditionContext {
    /** @desc 伤害属性（无条目上下文时不传 → 带属性条件的乘区不生效） */
    element?: string
    /** @desc 已解析的伤害类型列表 */
    damageTypes?: string[]
}

/**
 * @desc 判定乘区级生效条件。
 *
 * 组合口径（固定，没有可选项）：
 * - **伤害类型**：内部「或」—— 列出多个类型时，命中任意一个即满足
 * - **伤害属性**：内部「或」—— 同上
 * - **类别之间**：「与」—— 类型条件与属性条件必须同时满足（各自为空则视为满足）
 * - 需要条目上下文（伤害属性 / 伤害类型）的子句，在没有条目上下文时视为不满足
 */
export const evaluateCondition = (cond: BuffCondition | undefined, ctx: ConditionContext): boolean => {
    if (!cond) return true

    // ── 类别 1：伤害类型（内部或）──
    if (cond.damageTypes?.length) {
        const types = ctx.damageTypes ?? []
        if (ctx.element === undefined || !cond.damageTypes.some((dt) => types.includes(dt))) return false
    }

    // ── 类别 2：伤害属性（内部或）──
    if (cond.elements?.length) {
        if (ctx.element === undefined || !cond.elements.includes(ctx.element)) return false
    }

    return true
}

/** @desc 条件摘要文案（界面 chip / 工具说明共用） */
export const describeCondition = (cond: BuffCondition | undefined): string => {
    if (!cond) return '无条件'
    const groups: string[] = []
    // 属性 / 类型各自内部为「或」，两类之间为「且」
    if (cond.elements?.length) groups.push(cond.elements.join(' 或 '))
    if (cond.damageTypes?.length) groups.push(cond.damageTypes.join(' 或 '))
    return groups.length ? groups.join(' 且 ') : '无条件'
}

/**
 * @desc 乘区条件**徽标**文案（乘区列表里跟在乘区名后的短摘要，仅供展示）。
 *
 * 口径：
 * - 伤害类型在前、伤害属性在后，各自的多项用 `/` 连接，两类之间用 `·` 连接
 * - 只命中一类时只输出该类；条件为空时返回空串（调用方据此不渲染徽标）
 * - 伤害类型取简称（`DAMAGE_TYPE_SHORT`），属性取原名
 * - 文案内**不出现任何括号**（徽标位于窄行内，超长由界面自行 `truncate`）
 *
 * 与 `describeCondition` 的分工：后者是完整口径的工具说明，这里只服务于乘区行的紧凑徽标。
 */
export const describeZoneConditionBadge = (cond: BuffCondition | undefined): string => {
    if (!cond) return ''
    const types = (cond.damageTypes ?? []).map((dt) => DAMAGE_TYPE_SHORT[dt] ?? dt)
    const elements = cond.elements ?? []
    return [types.join('/'), elements.join('/')].filter((part) => part.length > 0).join('·')
}

// ── 条件归一化（迁移与界面共用的唯一入口）──

/**
 * @desc 归一化乘区级生效条件：只保留 `elements` / `damageTypes`。
 * 历史字段（`chains` / `refinements` / `chain` / `refinement` / `logic`）一律丢弃 ——
 * 链阶已迁到 Buff 级 `rules`，乘区级不再承载。
 */
export const normalizeCondition = (cond: BuffCondition | undefined): BuffCondition => {
    if (!cond) return {}
    const out: BuffCondition = {}
    const raw = cond as Record<string, unknown>
    if (Array.isArray(raw.elements)) {
        const elements = (raw.elements as unknown[]).filter((e): e is string => typeof e === 'string' && !!e)
        if (elements.length > 0) out.elements = [...new Set(elements)]
    }
    if (Array.isArray(raw.damageTypes)) {
        const damageTypes = (raw.damageTypes as unknown[]).filter((d): d is string => typeof d === 'string' && !!d)
        if (damageTypes.length > 0) out.damageTypes = [...new Set(damageTypes)]
    }
    return out
}

/** @desc 归一化乘区级条件：裁剪为「伤害类型 / 伤害属性」并丢弃空条件 */
export const normalizeZoneCondition = (cond: BuffCondition | undefined): BuffCondition | undefined => {
    const normalized = normalizeCondition(cond)
    return isConditionEmpty(normalized) ? undefined : normalized
}
