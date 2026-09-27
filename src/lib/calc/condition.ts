/**
 * @desc 生效条件求值（链条件 + 阶条件 + 伤害属性 / 伤害类型）与条件归一化。
 *
 * 按「挂载位置」分两个层级，共用同一套求值口径：
 *   1. Buff 实例级 —— 链条件 / 阶条件**只能挂在这里**（整个 Buff 的硬性条件）
 *   2. 乘区级 —— 挂在具体乘区上：伤害类型 / 伤害属性
 */

import type { BuffCondition } from './calculation.types'

/** @desc 条件挂载层级：buff=实例级（可含链/阶硬性条件）；zone=乘区级 */
export type ConditionScope = 'buff' | 'zone'

/** @desc 某层级是否允许出现链条件 / 阶条件（链阶只能挂在整个 Buff 上） */
export const scopeAllowsChainRefinement = (scope: ConditionScope): boolean => scope === 'buff'

/** @desc 条件是否为空（无任何子句） */
export const isConditionEmpty = (cond: BuffCondition | undefined): boolean => {
    if (!cond) return true
    return (
        (cond.chains?.length ?? 0) === 0 &&
        (cond.refinements?.length ?? 0) === 0 &&
        cond.chain === undefined &&
        cond.refinement === undefined &&
        (cond.elements?.length ?? 0) === 0 &&
        (cond.damageTypes?.length ?? 0) === 0
    )
}

/** @desc 按层级裁剪条件：乘区级强制剥离链条件与阶条件（它们只作为整个 Buff 的硬性条件） */
export const normalizeConditionForScope = (cond: BuffCondition, scope: ConditionScope): BuffCondition => {
    if (scopeAllowsChainRefinement(scope)) return cond
    const next: BuffCondition = { ...cond }
    delete next.chains
    delete next.refinements
    delete next.chain
    delete next.refinement
    return next
}

/** @desc 条件求值上下文：除条件自身数据外，还需要条目属性/伤害类型与角色链/精炼档位 */
export interface ConditionContext {
    /** @desc 伤害属性（条目级条件用；角色级聚合时不传 -> 带属性条件的 buff 不生效） */
    element?: string
    /** @desc 已解析的伤害类型列表（条目级条件用） */
    damageTypes?: string[]
    /** @desc 角色槽位链/精炼档位读取（chains/refinements 条件用） */
    chains: number[]
    refinements: number[]
    /** @desc 旧字段 chain/refinement 的参考角色槽位（缺省 0） */
    refCharIdx?: number
}

/**
 * @desc 判定生效条件。
 * - 无任何子句 -> true
 * - `logic: 'or'` -> 任一子句满足即生效；默认 `and` -> 全部满足才生效
 * - 链/阶子句**互斥**：同一个条件里若同时出现链与阶，只判定链条件（见下方运行时护栏）
 * - 属性/类型子句：无条目上下文（element/damageTypes 未提供）时视为不生效
 */
export const evaluateCondition = (cond: BuffCondition | undefined, ctx: ConditionContext): boolean => {
    if (!cond) return true
    const results: boolean[] = []

    /**
     * @desc 链条件与阶条件互斥：同一个 Buff 只能生效其中一个。
     * 界面已做互斥编辑、迁移会把同时带链与阶的 Buff 拆成两个；这里再做一道运行时护栏 ——
     * 若数据被其它途径（导入 / AI / 手改 JSON）写成了两者并存，则**只判定链条件**（阶条件整体忽略），
     * 保证「二选一」在任何路径下都成立。
     */
    const legacyRefIdx = ctx.refCharIdx ?? 0
    const hasChainClause = cond.chain !== undefined || (cond.chains?.length ?? 0) > 0
    if (hasChainClause) {
        for (const clause of cond.chains ?? []) {
            results.push((ctx.chains[clause.charIdx] ?? 0) >= clause.min)
        }
        if (cond.chain !== undefined) results.push((ctx.chains[legacyRefIdx] ?? 0) >= cond.chain)
    } else {
        for (const clause of cond.refinements ?? []) {
            results.push((ctx.refinements[clause.charIdx] ?? 1) >= clause.min)
        }
        if (cond.refinement !== undefined) results.push((ctx.refinements[legacyRefIdx] ?? 1) >= cond.refinement)
    }

    if (cond.elements?.length) {
        results.push(ctx.element !== undefined && cond.elements.includes(ctx.element))
    }
    if (cond.damageTypes?.length) {
        const types = ctx.damageTypes ?? []
        results.push(ctx.element !== undefined && cond.damageTypes.some((dt) => types.includes(dt)))
    }

    if (results.length === 0) return true
    return cond.logic === 'or' ? results.some(Boolean) : results.every(Boolean)
}

/** @desc 条件摘要文案（界面 chip / 工具说明共用） */
export const describeCondition = (
    cond: BuffCondition | undefined,
    slotName = (i: number) => `角色${i + 1}`
): string => {
    if (!cond) return '无条件'
    const parts: string[] = []
    const logic = cond.logic === 'or' ? ' 或 ' : ' 且 '
    for (const c of cond.chains ?? []) parts.push(`${slotName(c.charIdx)} ≥ ${c.min}链`)
    for (const c of cond.refinements ?? []) parts.push(`${slotName(c.charIdx)}武器 ≥ ${c.min}阶`)
    if (cond.chain !== undefined) parts.push(`共鸣链 ≥ ${cond.chain}`)
    if (cond.refinement !== undefined) parts.push(`武器精炼 ≥ ${cond.refinement}`)
    if (cond.elements?.length) parts.push(cond.elements.join('/'))
    if (cond.damageTypes?.length) parts.push(cond.damageTypes.join('/'))
    return parts.length ? parts.join(logic) : '无条件'
}

// ── 条件归一化（迁移与界面共用的唯一入口）──

/**
 * @desc 归一化生效条件。
 * - 过滤非法子句；旧字段 `chain` / `refinement` 升级为 `chains` / `refinements`（参考角色取 refCharIdx）
 * - 按层级裁剪：除 Buff 实例级外，链条件/阶条件一律剥离（链阶只能作为整个 Buff 的硬性条件）
 */
export const normalizeCondition = (
    cond: BuffCondition | undefined,
    scope: ConditionScope = 'buff',
    refCharIdx = 0
): BuffCondition => {
    if (!cond) return {}
    const next: BuffCondition = { ...cond }
    if (Array.isArray(cond.chains)) next.chains = cond.chains.filter((c) => c && typeof c.charIdx === 'number')
    if (Array.isArray(cond.refinements))
        next.refinements = cond.refinements.filter((c) => c && typeof c.charIdx === 'number')
    if (typeof cond.chain === 'number' && !next.chains?.length) next.chains = [{ charIdx: refCharIdx, min: cond.chain }]
    if (typeof cond.refinement === 'number' && !next.refinements?.length) {
        next.refinements = [{ charIdx: refCharIdx, min: cond.refinement }]
    }
    delete next.chain
    delete next.refinement
    if (!next.logic) delete next.logic
    return normalizeConditionForScope(next, scope)
}

/** @desc 归一化乘区级条件：裁剪为「伤害类型 / 伤害属性」并丢弃空条件 */
export const normalizeZoneCondition = (cond: BuffCondition | undefined): BuffCondition | undefined => {
    const normalized = normalizeCondition(cond, 'zone')
    return isConditionEmpty(normalized) ? undefined : normalized
}
