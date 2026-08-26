// 共鸣链 / 武器精炼对比：团队级资格判定（扁平，不按 conditionRefCharIdx 归属去重）。
// 「生效（挂载）」= buff id ∈ 全局绑定 或 任一伤害条目绑定（见 calculation.store）。
// 队友的条件 buff 即便 refIdx 指向他人，也可能通过 scope 影响本角色，故可设值取全队并集。
import type { BuffSet, DamageEntry } from '$lib/calc/calculation.types'

/** @desc 链/阶对比与数据分析弹窗共用的直伤类型色板（7 色循环，保证同组内不重复） */
export const COMPARISON_PALETTE = ['#6363f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#a855f7', '#ec4899']

export interface ComparisonEligibility {
    /** 可设共鸣链值（0-6，去重升序） */
    chains: number[]
    /** 可设武器精炼值（0-5，去重升序） */
    refinements: number[]
    eligible: boolean
    /** 不支持时的原因（入口按钮 tooltip） */
    reason: string | null
}

/** @desc 团队级对比资格：有挂载的链条件 buff 且有挂载的阶条件 buff 才支持对比 */
export function getComparisonEligibility(
    buffSets: BuffSet[],
    globalBuffSetIds: string[],
    entries: DamageEntry[],
    entryBindings: Record<string, string[]>
): ComparisonEligibility {
    const globalIds = new Set(globalBuffSetIds)
    const mounted = new Set<string>()
    for (const bs of buffSets) {
        let m = globalIds.has(bs.id)
        if (!m) {
            for (const ids of Object.values(entryBindings)) {
                if (ids.includes(bs.id)) {
                    m = true
                    break
                }
            }
        }
        if (m) mounted.add(bs.id)
    }

    const chains = new Set<number>()
    const refinements = new Set<number>()
    for (const bs of buffSets) {
        if (!bs.condition || !mounted.has(bs.id)) continue
        if (bs.condition.chain !== undefined && bs.condition.chain >= 0) chains.add(bs.condition.chain)
        if (bs.condition.refinement !== undefined && bs.condition.refinement >= 0)
            refinements.add(bs.condition.refinement)
    }

    const cs = [...chains].sort((a, b) => a - b)
    const rs = [...refinements].sort((a, b) => a - b)
    const eligible = cs.length > 0 && rs.length > 0
    const reason = eligible
        ? null
        : cs.length === 0 && rs.length === 0
          ? '本工程无生效的共鸣链/武器精炼条件 buff，不支持对比'
          : cs.length === 0
            ? '本工程无生效的共鸣链条件 buff，不支持对比'
            : '本工程无生效的武器精炼条件 buff，不支持对比'
    return { chains: cs, refinements: rs, eligible, reason }
}
