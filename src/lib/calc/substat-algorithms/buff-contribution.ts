import type { BuffConf } from '../calculation.types'
import type { BuffContribution, BuffZoneContribution, CharBuffAnalysis } from '../result.types'
import { getBoundBuffSets, getTargetSideSourceBuffs } from '../compute'
import { ZONE_MAP } from '../calculation.consts'
import { diffTotals, pctOf, type AnalysisInputs, type CharacterDamageContext } from './shared'

/**
 * @desc **Buff 对某角色直伤的贡献**：口径 = 「把这条 Buff 从该角色条目的绑定里拿掉，伤害损失多少」。
 *
 * 为什么用「移除损失」而不是像副词条那样给三套算法：
 * - 副词条有数量上限（每个声骸 5 条），Shapley 的 2ᵏ 枚举可行；Buff 动辄几十条，2ⁿ 不可行；
 * - 「移除损失」直接回答用户最关心的问题：「这条 Buff 现在值多少伤害」。
 *
 * 代价是逐条损失之和不等于「全部 Buff 总贡献」（乘算叠加导致 1+1 ≠ 2），
 * 因此结果里同时给出 `buffTotal*`（移除全部生效 Buff 后的差值）作为参照，界面必须说明两者口径不同。
 *
 * 多乘区 Buff 额外给出**逐乘区移除损失**（单乘区移除同样是非线性的，仅作量级参考）。
 */

/** @desc 单条贡献的判定阈值：±0.5 以下的抖动（浮点/四舍五入）视为无贡献 */
const NEGLIGIBLE = 0.5

const isNegligible = (totals: { norm: number; rig: number; noCrit: number }): boolean =>
    Math.abs(totals.norm) < NEGLIGIBLE && Math.abs(totals.rig) < NEGLIGIBLE && Math.abs(totals.noCrit) < NEGLIGIBLE

/** @desc 某条 Buff 在该角色条目上生效的次数（绑定到几条伤害条目） */
interface EffectiveBuff {
    buff: BuffConf
    entryCount: number
}

/**
 * @desc 该角色条目上的 **Buff 候选集**（并集，之后由「移除损失是否为 0」做最终判定）。
 *
 * 两路合并，缺一会漏掉真实贡献：
 * 1. `getBoundBuffSets`（按**本角色**作用域 + 实例级条件）—— 常规的自身增益与目标侧乘区；
 * 2. `getTargetSideSourceBuffs`（**忽略作用域**）—— 作用域指向**别的角色**的 Buff 也可能通过
 *    转模引用（`ZoneRef`）把该角色的面板借给本条伤害用，此时它对**本角色**的伤害有贡献，
 *    但按作用域判定会把它们全部漏掉。多列出的无关 Buff 会被后面的损失阈值自然过滤掉。
 */
const candidateBuffsOf = (
    ctx: CharacterDamageContext,
    inputs: AnalysisInputs,
    echoDescByEntry: Record<string, string>
): EffectiveBuff[] => {
    const map = new Map<string, EffectiveBuff>()
    for (const entry of ctx.damageEntries) {
        /** @desc 本条目上的并集（同一 Buff 只计一次；entryCount 表达「绑定到几条条目」） */
        const perEntry = new Map<string, BuffConf>()
        for (const buff of getBoundBuffSets(
            entry,
            ctx.index,
            inputs.buffSets,
            inputs.damageEntryBuffSetIds,
            inputs.damageEntryDamageTypes,
            inputs.conditionProfile,
            inputs.charInfoMap,
            echoDescByEntry
        )) {
            perEntry.set(buff.id, buff)
        }
        for (const buff of getTargetSideSourceBuffs(
            entry,
            inputs.buffSets,
            inputs.damageEntryBuffSetIds,
            inputs.damageEntryDamageTypes,
            inputs.conditionProfile,
            inputs.charInfoMap,
            echoDescByEntry
        )) {
            if (!perEntry.has(buff.id)) perEntry.set(buff.id, buff)
        }
        for (const [id, buff] of perEntry) {
            const existing = map.get(id)
            if (existing) existing.entryCount += 1
            else map.set(id, { buff, entryCount: 1 })
        }
    }
    return [...map.values()]
}

/** @desc 从该角色全部条目的绑定里去掉指定 Buff（只影响本角色条目，其它角色条目原样） */
const bindingsWithout = (
    ctx: CharacterDamageContext,
    inputs: AnalysisInputs,
    removeIds: readonly string[]
): Record<string, string[]> => {
    if (removeIds.length === 0) return inputs.damageEntryBuffSetIds
    const next: Record<string, string[]> = { ...inputs.damageEntryBuffSetIds }
    for (const entry of ctx.damageEntries) {
        const ids = next[entry.id]
        if (!ids) continue
        const kept = ids.filter((id) => !removeIds.includes(id))
        if (kept.length !== ids.length) next[entry.id] = kept
    }
    return next
}

/** @desc 该 Buff 去掉第 `zoneIndex` 个乘区后的 Buff 列表（其余 Buff 原样） */
const buffsWithoutZone = (inputs: AnalysisInputs, buffId: string, zoneIndex: number): BuffConf[] =>
    inputs.buffSets.map((buff) =>
        buff.id === buffId ? { ...buff, zones: buff.zones.filter((_, i) => i !== zoneIndex) } : buff
    )

const zoneLabelOf = (zoneId: string): string => ZONE_MAP.get(zoneId)?.label ?? zoneId

/** @desc 单乘区贡献：多乘区 Buff 逐乘区移除求损失，单乘区 Buff 直接等于总贡献 */
const zoneContributionsOf = (
    ctx: CharacterDamageContext,
    inputs: AnalysisInputs,
    buff: BuffConf,
    total: { norm: number; rig: number; noCrit: number }
): BuffZoneContribution[] => {
    if (buff.zones.length <= 1) {
        return buff.zones.map((zone) => ({
            zoneId: zone.zoneId,
            label: zoneLabelOf(zone.zoneId),
            contributionNorm: total.norm,
            contributionRig: total.rig,
            contributionNoCrit: total.noCrit
        }))
    }
    const out: BuffZoneContribution[] = []
    buff.zones.forEach((zone, zi) => {
        const loss = diffTotals(ctx.baseline, ctx.recompute({ buffSets: buffsWithoutZone(inputs, buff.id, zi) }))
        if (isNegligible(loss)) return
        out.push({
            zoneId: zone.zoneId,
            label: zoneLabelOf(zone.zoneId),
            contributionNorm: loss.norm,
            contributionRig: loss.rig,
            contributionNoCrit: loss.noCrit
        })
    })
    return out.length > 0
        ? out.sort((a, b) => b.contributionNorm - a.contributionNorm)
        : buff.zones.map((zone) => ({
              zoneId: zone.zoneId,
              label: zoneLabelOf(zone.zoneId),
              contributionNorm: 0,
              contributionRig: 0,
              contributionNoCrit: 0
          }))
}

/**
 * @desc 单角色 Buff 贡献分析（算法无关：Buff 只有「移除损失」一套口径）。
 *
 * `echoDescByEntry` 由调用方按「全部伤害条目」构建一次，用于复现引擎的伤害类型推导
 * （Buff 的乘区条件可能按伤害类型判定，缺了它会误判生效集合）。
 */
export const analyzeCharacterBuffs = (
    ctx: CharacterDamageContext,
    inputs: AnalysisInputs,
    echoDescByEntry: Record<string, string>
): CharBuffAnalysis => {
    const effective = candidateBuffsOf(ctx, inputs, echoDescByEntry)
    const noBuff = ctx.recompute({
        damageEntryBuffSetIds: bindingsWithout(
            ctx,
            inputs,
            effective.map((e) => e.buff.id)
        )
    })
    const total = diffTotals(ctx.baseline, noBuff)

    const buffs: BuffContribution[] = effective
        .flatMap(({ buff, entryCount }) => {
            const loss = diffTotals(
                ctx.baseline,
                ctx.recompute({ damageEntryBuffSetIds: bindingsWithout(ctx, inputs, [buff.id]) })
            )
            if (isNegligible(loss)) return []
            return [
                {
                    id: buff.id,
                    name: buff.name,
                    entryCount,
                    zones: zoneContributionsOf(ctx, inputs, buff, loss),
                    contributionNorm: loss.norm,
                    contributionRig: loss.rig,
                    contributionNoCrit: loss.noCrit,
                    contribPctNorm: pctOf(loss.norm, ctx.baseline.norm),
                    contribPctRig: pctOf(loss.rig, ctx.baseline.rig),
                    contribPctNoCrit: pctOf(loss.noCrit, ctx.baseline.noCrit),
                    ...(buff.origin ? { origin: buff.origin } : {}),
                    ...(buff.starred ? { starred: true } : {})
                }
            ]
        })
        .sort((a, b) => b.contributionNorm - a.contributionNorm)

    return {
        character: ctx.character,
        totalDamageNorm: ctx.baseline.norm,
        totalDamageRig: ctx.baseline.rig,
        totalDamageNoCrit: ctx.baseline.noCrit,
        noBuffDamageNorm: noBuff.norm,
        noBuffDamageRig: noBuff.rig,
        noBuffDamageNoCrit: noBuff.noCrit,
        buffTotalNorm: total.norm,
        buffTotalRig: total.rig,
        buffTotalNoCrit: total.noCrit,
        buffTotalPctNorm: pctOf(total.norm, ctx.baseline.norm),
        buffTotalPctRig: pctOf(total.rig, ctx.baseline.rig),
        buffTotalPctNoCrit: pctOf(total.noCrit, ctx.baseline.noCrit),
        buffs
    }
}
