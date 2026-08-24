import type { DamageEntry, BuffSet } from '../calculation.types'
import type { ConfigState, EchoSlotConfig } from '../config.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { CharSlot } from '$lib/types/project'
import type { CharSubstatAnalysis, SubstatContribution, EchoContribution } from '../result.types'
import type { ConditionProfile } from '../compute'
import {
    computeAll,
    getCharFullStatsForChar,
    computeOneEntry,
    cloneEchoesWithoutAllSubstats,
    DEFAULT_CONDITION_PROFILE
} from '../compute'

function factorial(n: number): number {
    let r = 1
    for (let i = 2; i <= n; i++) r *= i
    return r
}

function buildSubsetEchoes(echoes: EchoSlotConfig[], echoIdx: number, keepIndices: number[]): EchoSlotConfig[] {
    return echoes.map((echo, ei) => {
        if (ei !== echoIdx) return echo
        return {
            ...echo,
            substats: echo.substats.filter((_, si) => keepIndices.includes(si))
        }
    })
}

export function computeSubstatContributions(
    damageEntries: DamageEntry[],
    buffSets: BuffSet[],
    damageEntryBuffSetIds: Record<string, string[]>,
    damageEntryDamageTypes: Record<string, string[]>,
    configState: ConfigState,
    team: CharSlot[],
    charInfoMap: Record<string, CharacterInfo>,
    weaponInfoMap: Record<string, WeaponInfo>,
    rigCritEntryIds: Set<string>,
    noCritEntryIds: Set<string>,
    missEntryIds: Set<string>,
    conditionProfile: ConditionProfile = DEFAULT_CONDITION_PROFILE
): CharSubstatAnalysis[] {
    const allEntries = computeAll(
        damageEntries,
        buffSets,
        damageEntryBuffSetIds,
        damageEntryDamageTypes,
        configState,
        team,
        charInfoMap,
        weaponInfoMap,
        conditionProfile
    )

    const charNames = team.map((s) => s.character).filter((c): c is string => c !== null)

    return charNames.map((charName, ci) => {
        // 未命中条目伤害恒为 0，直接过滤（等价于归零，占比/贡献口径不变）
        const charEntries = allEntries.filter((e) => e.character === charName && !missEntryIds.has(e.id))
        const charDmgEntries = damageEntries.filter((e) => e.character === charName && !missEntryIds.has(e.id))

        const baselineNorm = charEntries.reduce((s, e) => s + e.totalDamageRaw, 0)
        const baselineRig = charEntries.reduce(
            (s, e) => s + (rigCritEntryIds.has(e.id) ? e.critPerHit : e.totalDamageRaw),
            0
        )
        const baselineNoCrit = charEntries.reduce(
            (s, e) => s + (noCritEntryIds.has(e.id) ? e.nonCritPerHit : e.totalDamageRaw),
            0
        )

        const echoes = configState.characters[ci]?.echoes ?? []

        const baseFullStats = team.map((_, i) => {
            const echos = i === ci ? echoes : (configState.characters[i]?.echoes ?? [])
            return getCharFullStatsForChar(
                i,
                echos,
                damageEntries,
                buffSets,
                damageEntryBuffSetIds,
                charInfoMap,
                team,
                weaponInfoMap,
                conditionProfile
            )
        })

        function computeDamageForEchoes(
            modEchoes: EchoSlotConfig[],
            rig: boolean
        ): {
            norm: number
            rigVal: number
            noCritVal: number
        } {
            const modFullStats = baseFullStats.map((fs, i) => {
                if (i !== ci) return fs
                return getCharFullStatsForChar(
                    ci,
                    modEchoes,
                    damageEntries,
                    buffSets,
                    damageEntryBuffSetIds,
                    charInfoMap,
                    team,
                    weaponInfoMap,
                    conditionProfile
                )
            })

            let norm = 0
            let rigVal = 0
            let noCritVal = 0
            for (const de of charDmgEntries) {
                const re = computeOneEntry(
                    de,
                    ci,
                    modEchoes,
                    modFullStats,
                    buffSets,
                    damageEntryBuffSetIds,
                    damageEntryDamageTypes,
                    configState,
                    team,
                    charInfoMap,
                    weaponInfoMap,
                    conditionProfile
                )
                norm += re.totalDamageRaw
                rigVal += rig && rigCritEntryIds.has(re.id) ? re.critPerHit : re.totalDamageRaw
                noCritVal += noCritEntryIds.has(re.id) ? re.nonCritPerHit : re.totalDamageRaw
            }
            return { norm, rigVal, noCritVal }
        }

        const info: EchoContribution[] = []
        const allSubstats: SubstatContribution[] = []

        const emptyEchoes = cloneEchoesWithoutAllSubstats(echoes)
        const emptyDamage = computeDamageForEchoes(emptyEchoes, true)

        for (let ei = 0; ei < echoes.length; ei++) {
            const echo = echoes[ei]
            const k = echo.substats.length
            if (k === 0) continue

            // precompute v(S) for all 2^k subsets
            const subsetCache = new Map<string, { norm: number; rigVal: number; noCritVal: number }>()
            for (let mask = 0; mask < 1 << k; mask++) {
                const keep: number[] = []
                for (let i = 0; i < k; i++) {
                    if (mask & (1 << i)) keep.push(i)
                }
                const modEchoes = buildSubsetEchoes(echoes, ei, keep)
                const dmg = computeDamageForEchoes(modEchoes, true)
                subsetCache.set(mask.toString(), dmg)
            }

            // precompute Shapley weights for subset sizes
            const weights: number[] = []
            for (let s = 0; s < k; s++) {
                weights[s] = (factorial(s) * factorial(k - s - 1)) / factorial(k)
            }

            const echoSubstats: SubstatContribution[] = []

            for (let si = 0; si < k; si++) {
                const sub = echo.substats[si]
                let shapleyNorm = 0
                let shapleyRig = 0
                let shapleyNoCrit = 0

                for (let mask = 0; mask < 1 << k; mask++) {
                    if (mask & (1 << si)) continue

                    const s = popcount(mask)
                    const maskWith = mask | (1 << si)

                    const vS = subsetCache.get(mask.toString())!
                    const vSwith = subsetCache.get(maskWith.toString())!

                    shapleyNorm += weights[s] * (vSwith.norm - vS.norm)
                    shapleyRig += weights[s] * (vSwith.rigVal - vS.rigVal)
                    shapleyNoCrit += weights[s] * (vSwith.noCritVal - vS.noCritVal)
                }

                echoSubstats.push({
                    type: sub.type,
                    value: sub.value,
                    unit: sub.unit,
                    contributionNorm: shapleyNorm,
                    contributionRig: shapleyRig,
                    contribPctNorm: baselineNorm > 0 ? (shapleyNorm / baselineNorm) * 100 : 0,
                    contribPctRig: baselineRig > 0 ? (shapleyRig / baselineRig) * 100 : 0,
                    contributionNoCrit: shapleyNoCrit,
                    contribPctNoCrit: baselineNoCrit > 0 ? (shapleyNoCrit / baselineNoCrit) * 100 : 0
                })
            }

            echoSubstats.sort((a, b) => b.contributionNorm - a.contributionNorm)

            const echoTotalNorm = echoSubstats.reduce((s, sub) => s + sub.contributionNorm, 0)
            const echoTotalRig = echoSubstats.reduce((s, sub) => s + sub.contributionRig, 0)
            const echoTotalNoCrit = echoSubstats.reduce((s, sub) => s + sub.contributionNoCrit, 0)

            const mainStat = echo.mainStat?.type ?? ''
            info.push({
                cost: echo.cost,
                mainStat,
                substats: echoSubstats,
                totalNorm: echoTotalNorm,
                totalRig: echoTotalRig,
                totalPctNorm: baselineNorm > 0 ? (echoTotalNorm / baselineNorm) * 100 : 0,
                totalPctRig: baselineRig > 0 ? (echoTotalRig / baselineRig) * 100 : 0,
                totalNoCrit: echoTotalNoCrit,
                totalPctNoCrit: baselineNoCrit > 0 ? (echoTotalNoCrit / baselineNoCrit) * 100 : 0
            })

            allSubstats.push(...echoSubstats)
        }

        const aggMap = new Map<string, SubstatContribution>()
        for (const s of allSubstats) {
            const existing = aggMap.get(s.type)
            if (existing) {
                existing.contributionNorm += s.contributionNorm
                existing.contributionRig += s.contributionRig
                existing.contributionNoCrit += s.contributionNoCrit
                existing.value += s.value
            } else {
                aggMap.set(s.type, { ...s })
            }
        }
        const aggregated = [...aggMap.values()].map((s) => ({
            ...s,
            contribPctNorm: baselineNorm > 0 ? (s.contributionNorm / baselineNorm) * 100 : 0,
            contribPctRig: baselineRig > 0 ? (s.contributionRig / baselineRig) * 100 : 0,
            contribPctNoCrit: baselineNoCrit > 0 ? (s.contributionNoCrit / baselineNoCrit) * 100 : 0
        }))
        aggregated.sort((a, b) => b.contributionNorm - a.contributionNorm)

        const substatTotalNorm = baselineNorm - emptyDamage.norm
        const substatTotalRig = baselineRig - emptyDamage.rigVal
        const substatTotalNoCrit = baselineNoCrit - emptyDamage.noCritVal

        return {
            character: charName,
            totalDamageNorm: baselineNorm,
            totalDamageRig: baselineRig,
            totalDamageNoCrit: baselineNoCrit,
            substatTotalNorm,
            substatTotalRig,
            substatTotalPctNorm: baselineNorm > 0 ? (substatTotalNorm / baselineNorm) * 100 : 0,
            substatTotalPctRig: baselineRig > 0 ? (substatTotalRig / baselineRig) * 100 : 0,
            substatTotalNoCrit,
            substatTotalPctNoCrit: baselineNoCrit > 0 ? (substatTotalNoCrit / baselineNoCrit) * 100 : 0,
            echoes: info,
            aggregated
        }
    })
}

function popcount(value: number): number {
    // SWAR 位计数：复用中间值而非重赋值入参（纯函数式约束）
    const a = value - ((value >>> 1) & 0x55555555)
    const b = (a & 0x33333333) + ((a >>> 2) & 0x33333333)
    const c = (b + (b >>> 4)) & 0x0f0f0f0f
    return (c * 0x01010101) >>> 24
}
