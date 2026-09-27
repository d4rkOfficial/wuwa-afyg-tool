/**
 * @desc 生效条件求值（链条件 + 阶条件 + 伤害属性 / 伤害类型）与条件归一化。
 *
 * 按「挂载位置」分两个层级，共用同一套求值口径：
 *   1. Buff 实例级 —— 链条件 / 阶条件**只能挂在这里**（整个 Buff 的硬性条件）
 *   2. 乘区级 —— 挂在具体乘区上：伤害类型 / 伤害属性
 */

import type { BuffCondition } from './calculation.types'
import { DAMAGE_TYPE_SHORT } from '$lib/consts/game-terms'

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

/**
 * @desc 给「归属于某个角色、但自身没有任何链/阶硬性条件」的 Buff 补一道**角色本体门**
 * `chains: [{ charIdx: owner, min: 0 }]`（0 链 = 角色本体 = 未点共鸣链）。
 *
 * 为什么是链条件而不是阶条件：「本体」这个概念属于**链行** —— 链 = 角色共鸣链，0 链即角色本体；
 * 阶 = 武器精炼阶数，武器总有一个精炼档位（默认 1 阶），不存在「本体」档。
 * 因此导入角色来源的 buff 时补 0 链，既保留「挂在哪个角色身上」的归属（左侧列表归档到「角色名本体」），
 * 又不会因为档位把本体效果挡掉（`≥ 0 链` 恒成立）。
 */
export const withOwnerBodyGate = (cond: BuffCondition, owner: number): BuffCondition => {
    if (owner < 0) return cond
    if ((cond.chains?.length ?? 0) > 0 || (cond.refinements?.length ?? 0) > 0) return cond
    return { ...cond, chains: [{ charIdx: owner, min: 0 }] }
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
 *
 * 组合口径（固定，没有可选项）：
 * - **伤害类型**：内部「或」—— 列出多个类型时，命中任意一个即满足
 * - **伤害属性**：内部「或」—— 同上
 * - **类别之间**：「与」—— 类型条件、属性条件、链/阶门条件三者必须同时满足（各自为空则视为满足）
 * - **链 / 阶门条件**：二选一（同一个条件里同时出现链与阶时只判定链，见下方运行时护栏）；
 *   同类子句（如多条链要求）之间为「与」——全部满足才生效
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

    // ── 类别 3：链 / 阶门条件（二选一；同类子句内部为与）──
    const legacyRefIdx = ctx.refCharIdx ?? 0
    const chainClauses = [
        ...(cond.chains ?? []),
        ...(cond.chain !== undefined ? [{ charIdx: legacyRefIdx, min: cond.chain }] : [])
    ]
    const refineClauses = [
        ...(cond.refinements ?? []),
        ...(cond.refinement !== undefined ? [{ charIdx: legacyRefIdx, min: cond.refinement }] : [])
    ]
    /**
     * @desc 链条件与阶条件互斥：同一个 Buff 只能生效其中一个。
     * 界面已做互斥编辑、迁移会把同时带链与阶的 Buff 拆成两个；这里再做一道运行时护栏 ——
     * 若数据被其它途径（导入 / AI / 手改 JSON）写成了两者并存，则**只判定链条件**（阶条件整体忽略），
     * 保证「二选一」在任何路径下都成立。
     */
    if (chainClauses.length > 0) {
        if (!chainClauses.every((c) => (ctx.chains[c.charIdx] ?? 0) >= c.min)) return false
    } else if (refineClauses.length > 0) {
        if (!refineClauses.every((c) => (ctx.refinements[c.charIdx] ?? 1) >= c.min)) return false
    }

    return true
}

/** @desc 条件摘要文案（界面 chip / 工具说明共用） */
export const describeCondition = (
    cond: BuffCondition | undefined,
    slotName = (i: number) => `角色${i + 1}`
): string => {
    if (!cond) return '无条件'
    const groups: string[] = []
    const gate: string[] = []
    // 链 = 角色共鸣链：0 链 = 未点共鸣链的角色本体，因此「本体」只出现在链条件上
    for (const c of cond.chains ?? [])
        gate.push(c.min > 0 ? `${slotName(c.charIdx)} ≥ ${c.min}链` : `${slotName(c.charIdx)}本体`)
    // 阶 = 武器精炼阶数：一律按「≥ N 阶」描述（0 阶即 ≥ 0 阶，无「本体」一说）
    for (const c of cond.refinements ?? []) gate.push(`${slotName(c.charIdx)}武器 ≥ ${c.min}阶`)
    if (cond.chain !== undefined) gate.push(`共鸣链 ≥ ${cond.chain}`)
    if (cond.refinement !== undefined) gate.push(`武器精炼 ≥ ${cond.refinement}`)
    if (gate.length) groups.push(gate.join(' 且 '))
    // 属性 / 类型各自内部为「或」，与门条件之间为「且」
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
 * 与 `describeCondition` 的分工：后者是完整口径的工具说明（含链/阶、带括号分隔），
 * 这里只服务于乘区行的紧凑徽标。
 */
export const describeZoneConditionBadge = (cond: BuffCondition | undefined): string => {
    if (!cond) return ''
    const types = (cond.damageTypes ?? []).map((dt) => DAMAGE_TYPE_SHORT[dt] ?? dt)
    const elements = cond.elements ?? []
    return [types.join('/'), elements.join('/')].filter((part) => part.length > 0).join('·')
}

// ── 条件归一化（迁移与界面共用的唯一入口）──

/**
 * @desc 归一化生效条件。
 * - 过滤非法子句；旧字段 `chain` / `refinement` 升级为 `chains` / `refinements`（参考角色取 refCharIdx）
 * - 丢弃已废弃的 `logic`（组合口径固定：类内或、类间与）
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
    // 旧数据可能还带已废弃的 `logic` 字段（类型上已移除，这里显式清理）
    delete (next as Record<string, unknown>).logic
    return normalizeConditionForScope(next, scope)
}

/** @desc 归一化乘区级条件：裁剪为「伤害类型 / 伤害属性」并丢弃空条件 */
export const normalizeZoneCondition = (cond: BuffCondition | undefined): BuffCondition | undefined => {
    const normalized = normalizeCondition(cond, 'zone')
    return isConditionEmpty(normalized) ? undefined : normalized
}
