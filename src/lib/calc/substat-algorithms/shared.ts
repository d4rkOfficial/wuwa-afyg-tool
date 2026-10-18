import type { BuffConf, DamageEntry } from '../calculation.types'
import type { ConfigState, EchoSlotConfig } from '../config.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { CharSlot } from '$lib/types/project'
import type { CharSubstatAnalysis, EchoContribution, ResultEntry, SubstatContribution } from '../result.types'
import { cloneEchoesWithoutAllSubstats, computeAll, computeOneEntry, type ConditionProfile } from '../compute'
import { buildStandardSlots } from '../standard-substats'

/**
 * @desc 直伤贡献分析（副词条 / Buff）的共用底座。
 *
 * 三件事只在**这一处**定义，避免各算法各写一遍而口径漂移：
 * 1. 基线：与结果页同一份 `computeAll`（同参数同配置），不是另算一遍；
 * 2. 重算：任何「移除/改动」都走 `computeOneEntry`（引擎同一实现），差值即贡献；
 * 3. 装配：`CharSubstatAnalysis` / 声骸小计 / 词条类型汇总的百分比与排序口径。
 */

/** @desc 引擎入参（与 `computeAll` 一一对应，只把三个 id 集合换成 Set 便于内部判定） */
export interface AnalysisInputs {
    damageEntries: DamageEntry[]
    buffSets: BuffConf[]
    damageEntryBuffSetIds: Record<string, string[]>
    damageEntryDamageTypes: Record<string, string[]>
    configState: ConfigState
    team: CharSlot[]
    charInfoMap: Record<string, CharacterInfo>
    weaponInfoMap: Record<string, WeaponInfo>
    rigCritEntryIds: Set<string>
    noCritEntryIds: Set<string>
    missEntryIds: Set<string>
    conditionProfile: ConditionProfile
}

/** @desc 三口径伤害（期望 / 凹暴 / 不暴）：分析里所有贡献都用这一组数表达 */
export interface DamageTotals {
    norm: number
    rig: number
    noCrit: number
}

/** @desc 重算时的改动：只给需要换的那一项，其余沿用原配置 */
export interface RecomputeOverrides {
    echoes?: EchoSlotConfig[]
    buffSets?: BuffConf[]
    damageEntryBuffSetIds?: Record<string, string[]>
}

/**
 * @desc 单个角色的分析上下文。
 *
 * `index` 是**队伍槽位下标**（不是过滤掉空位后的序号）：`configState.characters` 与 `team` 都按槽位索引，
 * 旧实现用过滤后的序号取声骸，空槽位存在时会读错角色的声骸。
 */
export interface CharacterDamageContext {
    index: number
    character: string
    /** 该角色当前声骸配置（按槽位取） */
    echoes: EchoSlotConfig[]
    /** 该角色参与分析的条目（已剔除「未命中」条目：其伤害恒为 0，等价于归零） */
    damageEntries: DamageEntry[]
    /** 原配置下的三口径伤害（= 结果页口径） */
    baseline: DamageTotals
    /** 按改动重算该角色三口径伤害 */
    recompute: (overrides?: RecomputeOverrides) => DamageTotals
    /** @desc 表级 14 词方案（标准 43311 + 中位档 14 词）下的对照分；角色信息缺失时为 null */
    standard: StandardScore | null
}

/** @desc 表级 14 词分的原始组成：分数 = 副词条总贡献 / 该方案下的角色总伤 */
export interface StandardScore {
    pctNorm: number
    substatNorm: number
    totalNorm: number
}

export const zeroTotals = (): DamageTotals => ({ norm: 0, rig: 0, noCrit: 0 })

/** @desc 两个口径相减（按字段逐个减，供「移除前后损失」共用） */
export const diffTotals = (a: DamageTotals, b: DamageTotals): DamageTotals => ({
    norm: a.norm - b.norm,
    rig: a.rig - b.rig,
    noCrit: a.noCrit - b.noCrit
})

/** @desc 把引擎结果条目按「凹暴/不暴」勾选折算成三口径合计（口径与结果页 applyModes 前的原始期望一致） */
const totalsOf = (entries: ResultEntry[], inputs: AnalysisInputs): DamageTotals =>
    entries.reduce<DamageTotals>(
        (acc, e) => ({
            norm: acc.norm + e.totalDamageRaw,
            rig: acc.rig + (inputs.rigCritEntryIds.has(e.id) ? e.critPerHit : e.totalDamageRaw),
            noCrit: acc.noCrit + (inputs.noCritEntryIds.has(e.id) ? e.nonCritPerHit : e.totalDamageRaw)
        }),
        zeroTotals()
    )

/** @desc 百分比（基线为 0 时返回 0，避免除零产生 NaN 污染排序与展示） */
export const pctOf = (value: number, base: number): number => (base > 0 ? (value / base) * 100 : 0)

/**
 * @desc 建立全队各角色的分析上下文：基线只算一次 `computeAll`，之后每个角色各自持有重算闭包。
 *
 * 没有伤害条目的角色**仍然保留**（基线为 0）：界面按队伍槽位渲染角色页签，缺项会让页签数量跳动。
 */
export const prepareAnalysis = (inputs: AnalysisInputs): CharacterDamageContext[] => {
    const allEntries = computeAll(
        inputs.damageEntries,
        inputs.buffSets,
        inputs.damageEntryBuffSetIds,
        inputs.damageEntryDamageTypes,
        inputs.configState,
        inputs.team,
        inputs.charInfoMap,
        inputs.weaponInfoMap,
        inputs.conditionProfile
    )

    return inputs.team.flatMap((slot, index) => {
        const character = slot.character
        if (!character) return []
        const damageEntries = inputs.damageEntries.filter(
            (e) => e.character === character && !inputs.missEntryIds.has(e.id)
        )
        const echoes = inputs.configState.characters[index]?.echoes ?? []
        const baseline = totalsOf(
            allEntries.filter((e) => e.character === character && !inputs.missEntryIds.has(e.id)),
            inputs
        )

        const recompute = (overrides: RecomputeOverrides = {}): DamageTotals => {
            const modEchoes = overrides.echoes ?? echoes
            const modBuffSets = overrides.buffSets ?? inputs.buffSets
            const modBindings = overrides.damageEntryBuffSetIds ?? inputs.damageEntryBuffSetIds
            let totals = zeroTotals()
            for (const de of damageEntries) {
                const re = computeOneEntry(
                    de,
                    index,
                    modEchoes,
                    modBuffSets,
                    modBindings,
                    inputs.damageEntryDamageTypes,
                    inputs.configState,
                    inputs.team,
                    inputs.charInfoMap,
                    inputs.weaponInfoMap,
                    inputs.conditionProfile
                )
                totals = {
                    norm: totals.norm + re.totalDamageRaw,
                    rig: totals.rig + (inputs.rigCritEntryIds.has(re.id) ? re.critPerHit : re.totalDamageRaw),
                    noCrit: totals.noCrit + (inputs.noCritEntryIds.has(re.id) ? re.nonCritPerHit : re.totalDamageRaw)
                }
            }
            return totals
        }

        /**
         * 表级 14 词分：把该角色换成标准方案（43311 满级主词条 + 14 条中位档副词条）后，
         * 用同一套分数公式再算一遍 —— 「这套配装 vs 标准表」的对照基准。
         * 只重算该角色（其它角色声骸原样），与当前配置的分数完全同口径。
         */
        const charInfo = inputs.charInfoMap[character]
        const standard: StandardScore | null = charInfo
            ? (() => {
                  const slots = buildStandardSlots({
                      element: charInfo.element,
                      statNodes: charInfo.statNodes,
                      tags: charInfo.tags
                  })
                  const total = recompute({ echoes: slots })
                  const empty = recompute({ echoes: cloneEchoesWithoutAllSubstats(slots) })
                  const substat = total.norm - empty.norm
                  return { pctNorm: pctOf(substat, total.norm), substatNorm: substat, totalNorm: total.norm }
              })()
            : null

        return [{ index, character, echoes, damageEntries, baseline, recompute, standard }]
    })
}

/** @desc 组装单条词条贡献（三口径 + 相对基线的百分比） */
export const makeSubstatContribution = (args: {
    type: string
    value: number
    unit: string
    contribution: DamageTotals
    baseline: DamageTotals
}): SubstatContribution => {
    const { type, value, unit, contribution, baseline } = args
    return {
        type,
        value,
        unit,
        contributionNorm: contribution.norm,
        contributionRig: contribution.rig,
        contribPctNorm: pctOf(contribution.norm, baseline.norm),
        contribPctRig: pctOf(contribution.rig, baseline.rig),
        contributionNoCrit: contribution.noCrit,
        contribPctNoCrit: pctOf(contribution.noCrit, baseline.noCrit)
    }
}

/** @desc 组装声骸小计（内部词条已按期望贡献降序，调用方负责排序） */
export const makeEchoContribution = (args: {
    cost: number
    mainStat: string
    substats: SubstatContribution[]
    baseline: DamageTotals
}): EchoContribution => {
    const { cost, mainStat, substats, baseline } = args
    const totalNorm = substats.reduce((s, sub) => s + sub.contributionNorm, 0)
    const totalRig = substats.reduce((s, sub) => s + sub.contributionRig, 0)
    const totalNoCrit = substats.reduce((s, sub) => s + sub.contributionNoCrit, 0)
    return {
        cost,
        mainStat,
        substats,
        totalNorm,
        totalRig,
        totalPctNorm: pctOf(totalNorm, baseline.norm),
        totalPctRig: pctOf(totalRig, baseline.rig),
        totalNoCrit,
        totalPctNoCrit: pctOf(totalNoCrit, baseline.noCrit)
    }
}

/** @desc 按词条类型汇总（同名词条相加后重算百分比），按期望贡献降序 */
export const aggregateSubstats = (all: SubstatContribution[], baseline: DamageTotals): SubstatContribution[] => {
    const map = new Map<string, SubstatContribution>()
    for (const s of all) {
        const existing = map.get(s.type)
        if (!existing) {
            map.set(s.type, { ...s })
            continue
        }
        existing.contributionNorm += s.contributionNorm
        existing.contributionRig += s.contributionRig
        existing.contributionNoCrit += s.contributionNoCrit
        existing.value += s.value
    }
    return [...map.values()]
        .map((s) => ({
            ...s,
            contribPctNorm: pctOf(s.contributionNorm, baseline.norm),
            contribPctRig: pctOf(s.contributionRig, baseline.rig),
            contribPctNoCrit: pctOf(s.contributionNoCrit, baseline.noCrit)
        }))
        .sort((a, b) => b.contributionNorm - a.contributionNorm)
}

/**
 * @desc 组装单角色副词条分析结果。
 *
 * `empty` = 清空该角色全部副词条后的重算结果：`基线 - empty` 即「副词条总贡献」，
 * 与逐条贡献之和刻意不完全相等（词条间有交互），这也是三种算法各自要解释的差异。
 */
export const assembleSubstatAnalysis = (args: {
    character: string
    baseline: DamageTotals
    empty: DamageTotals
    echoes: EchoContribution[]
    aggregated: SubstatContribution[]
    standard: StandardScore | null
}): CharSubstatAnalysis => {
    const { character, baseline, empty, echoes, aggregated, standard } = args
    const total = diffTotals(baseline, empty)
    return {
        character,
        totalDamageNorm: baseline.norm,
        totalDamageRig: baseline.rig,
        totalDamageNoCrit: baseline.noCrit,
        substatTotalNorm: total.norm,
        substatTotalRig: total.rig,
        substatTotalPctNorm: pctOf(total.norm, baseline.norm),
        substatTotalPctRig: pctOf(total.rig, baseline.rig),
        substatTotalNoCrit: total.noCrit,
        substatTotalPctNoCrit: pctOf(total.noCrit, baseline.noCrit),
        echoes,
        aggregated,
        standardSubstatPctNorm: standard?.pctNorm ?? null,
        standardSubstatNorm: standard?.substatNorm ?? 0,
        standardTotalNorm: standard?.totalNorm ?? 0
    }
}
