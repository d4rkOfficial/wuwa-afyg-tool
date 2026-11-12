import type { BuffConf } from '../calculation.types'
import type { BuffContribution, BuffFolderContribution, BuffZoneContribution, CharBuffAnalysis } from '../result.types'
import { getBoundBuffSets, getTargetSideSourceBuffs } from '../compute'
import { ZONE_MAP } from '../calculation.consts'
import { BUFF_PATH_SEP, buffFolderPath } from '../buff-name'
import { diffTotals, pctOf, type AnalysisInputs, type CharacterDamageContext } from './shared'

/**
 * @desc **Buff 对某角色直伤的贡献**：口径 = 「把这条 Buff 从该角色条目的绑定里拿掉，伤害损失多少」。
 *
 * 为什么用「移除损失」而不是像副词条那样给三套算法：
 * - 副词条有数量上限（每个声骸 5 条），Shapley 的 2ᵏ 枚举可行；Buff 动辄几十条，2ⁿ 不可行；
 * - 「移除损失」直接回答用户最关心的问题：「这条 Buff 现在值多少伤害」。
 *
 * **只用当前配置口径**：凹暴 / 不暴 / 未命中已经在结果页勾选过，贡献与分析面板都只看生效后的实际伤害。
 * 代价是逐条损失之和不等于「全部 Buff 总贡献」（乘算叠加导致 1+1 ≠ 2），
 * 因此结果里同时给出 `buffTotal`（移除全部生效 Buff 后的差值）作为参照，界面必须说明两者口径不同。
 *
 * 多乘区 Buff 额外给出**逐乘区移除损失**（单乘区移除同样是非线性的，仅作量级参考）。
 * 文件夹（Buff 全名 `文件夹A\短名`）额外给出**整组移除损失**：把该文件夹内全部生效 Buff 一起拿掉。
 */

/** @desc 单条贡献的判定阈值：±0.5 以下的抖动（浮点/四舍五入）视为无贡献 */
const NEGLIGIBLE = 0.5

const isNegligible = (value: number): boolean => Math.abs(value) < NEGLIGIBLE

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
    total: number
): BuffZoneContribution[] => {
    if (buff.zones.length <= 1) {
        return buff.zones.map((zone) => ({
            zoneId: zone.zoneId,
            label: zoneLabelOf(zone.zoneId),
            contribution: total
        }))
    }
    const out: BuffZoneContribution[] = []
    buff.zones.forEach((zone, zi) => {
        const loss = diffTotals(ctx.baseline, ctx.recompute({ buffSets: buffsWithoutZone(inputs, buff.id, zi) })).actual
        if (isNegligible(loss)) return
        out.push({
            zoneId: zone.zoneId,
            label: zoneLabelOf(zone.zoneId),
            contribution: loss
        })
    })
    return out.length > 0
        ? out.sort((a, b) => b.contribution - a.contribution)
        : buff.zones.map((zone) => ({
              zoneId: zone.zoneId,
              label: zoneLabelOf(zone.zoneId),
              contribution: 0
          }))
}

/** @desc 一个文件夹（含中间层级）在本次分析里对应的 Buff 集合 */
interface FolderGroup {
    path: string[]
    /** 该文件夹下全部候选 Buff id（含被显示阈值过滤掉的，整组移除时要一起拿掉） */
    buffIds: string[]
    /** 仍然显示中的 Buff 条数（= 展开后可看到的明细行数） */
    displayedCount: number
}

/** @desc 按 Buff 全名的文件夹前缀归组：每条 Buff 会加入它每一层祖先文件夹 */
const folderGroupsOf = (effective: readonly EffectiveBuff[], displayedIds: ReadonlySet<string>): FolderGroup[] => {
    const map = new Map<string, FolderGroup>()
    for (const { buff } of effective) {
        const parts = buffFolderPath(buff.name)
        for (let depth = 1; depth <= parts.length; depth++) {
            const path = parts.slice(0, depth)
            const key = path.join(BUFF_PATH_SEP)
            const group = map.get(key) ?? { path, buffIds: [], displayedCount: 0 }
            group.buffIds.push(buff.id)
            if (displayedIds.has(buff.id)) group.displayedCount += 1
            map.set(key, group)
        }
    }
    return [...map.values()].filter((group) => group.displayedCount > 0)
}

/**
 * @desc 文件夹的整组移除损失：把该文件夹内全部生效 Buff 一起移除后的伤害差值。
 *
 * 只有一条 Buff 的文件夹直接复用该条贡献（同一次重算），避免无意义的重算。
 * 与逐条求和刻意不同：乘算叠加下「整组」< Σ，界面只展示整组，Σ 不再混进同一行。
 */
const folderContributionsOf = (
    ctx: CharacterDamageContext,
    inputs: AnalysisInputs,
    effective: readonly EffectiveBuff[],
    buffs: readonly BuffContribution[]
): BuffFolderContribution[] => {
    const displayedIds = new Set(buffs.map((buff) => buff.id))
    const contributionById = new Map(buffs.map((buff) => [buff.id, buff.contribution]))
    return folderGroupsOf(effective, displayedIds)
        .map((group) => {
            const contribution =
                group.buffIds.length === 1
                    ? (contributionById.get(group.buffIds[0]) ?? 0)
                    : diffTotals(
                          ctx.baseline,
                          ctx.recompute({ damageEntryBuffSetIds: bindingsWithout(ctx, inputs, group.buffIds) })
                      ).actual
            return {
                path: group.path,
                contribution,
                contribPct: pctOf(contribution, ctx.baseline.actual)
            }
        })
        .sort((a, b) => b.contribution - a.contribution)
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

    const buffs: BuffContribution[] = effective
        .flatMap(({ buff, entryCount }) => {
            const loss = diffTotals(
                ctx.baseline,
                ctx.recompute({ damageEntryBuffSetIds: bindingsWithout(ctx, inputs, [buff.id]) })
            )
            if (isNegligible(loss.actual)) return []
            return [
                {
                    id: buff.id,
                    name: buff.name,
                    entryCount,
                    zones: zoneContributionsOf(ctx, inputs, buff, loss.actual),
                    contribution: loss.actual,
                    contribPct: pctOf(loss.actual, ctx.baseline.actual),
                    ...(buff.origin ? { origin: buff.origin } : {}),
                    ...(buff.starred ? { starred: true } : {})
                }
            ]
        })
        .sort((a, b) => b.contribution - a.contribution)

    const buffTotal = ctx.baseline.actual - noBuff.actual

    return {
        character: ctx.character,
        totalDamage: ctx.baseline.actual,
        noBuffDamage: noBuff.actual,
        buffTotal,
        buffTotalPct: pctOf(buffTotal, ctx.baseline.actual),
        buffs,
        folders: folderContributionsOf(ctx, inputs, effective, buffs)
    }
}
