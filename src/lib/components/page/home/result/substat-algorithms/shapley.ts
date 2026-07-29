import type { DamageEntry, BuffSet } from '../../calculation/calculation.types'
import type { ConfigState, EchoSlotConfig } from '../../config/config.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { CharSlot } from '$lib/data/types'
import type { CharSubstatAnalysis, SubstatContribution, EchoContribution } from '../result.types'
import {
    computeAll,
    getCharFullStatsForChar,
    computeOneEntry,
    cloneEchoesWithoutSubstat,
    cloneEchoesWithoutAllSubstats
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
    rigCritEntryIds: Set<string>
): CharSubstatAnalysis[] {
    const allEntries = computeAll(
        damageEntries,
        buffSets,
        damageEntryBuffSetIds,
        damageEntryDamageTypes,
        configState,
        team,
        charInfoMap,
        weaponInfoMap
    )

    const charNames = team.map((s) => s.character).filter((c): c is string => c !== null)

    return charNames.map((charName, ci) => {
        const charEntries = allEntries.filter((e) => e.character === charName)
        const charDmgEntries = damageEntries.filter((e) => e.character === charName)

        const baselineNorm = charEntries.reduce((s, e) => s + e.totalDamageRaw, 0)
        const baselineRig = charEntries.reduce((s, e) => {
            return s + (rigCritEntryIds.has(e.id) ? e.critPerHit : e.totalDamageRaw)
        }, 0)

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
                weaponInfoMap
            )
        })

        function computeDamageForEchoes(modEchoes: EchoSlotConfig[], rig: boolean): { norm: number; rigVal: number } {
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
                    weaponInfoMap
                )
            })

            let norm = 0
            let rigVal = 0
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
                    weaponInfoMap
                )
                norm += re.totalDamageRaw
                rigVal += rig && rigCritEntryIds.has(re.id) ? re.critPerHit : re.totalDamageRaw
            }
            return { norm, rigVal }
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
            const subsetCache = new Map<string, { norm: number; rigVal: number }>()
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

                for (let mask = 0; mask < 1 << k; mask++) {
                    if (mask & (1 << si)) continue

                    const s = popcount(mask)
                    const maskWith = mask | (1 << si)

                    const vS = subsetCache.get(mask.toString())!
                    const vSwith = subsetCache.get(maskWith.toString())!

                    shapleyNorm += weights[s] * (vSwith.norm - vS.norm)
                    shapleyRig += weights[s] * (vSwith.rigVal - vS.rigVal)
                }

                echoSubstats.push({
                    type: sub.type,
                    value: sub.value,
                    unit: sub.unit,
                    contributionNorm: shapleyNorm,
                    contributionRig: shapleyRig,
                    contribPctNorm: baselineNorm > 0 ? (shapleyNorm / baselineNorm) * 100 : 0,
                    contribPctRig: baselineRig > 0 ? (shapleyRig / baselineRig) * 100 : 0
                })
            }

            echoSubstats.sort((a, b) => b.contributionNorm - a.contributionNorm)

            const echoTotalNorm = echoSubstats.reduce((s, sub) => s + sub.contributionNorm, 0)
            const echoTotalRig = echoSubstats.reduce((s, sub) => s + sub.contributionRig, 0)

            const mainStat = echo.mainStat?.type ?? ''
            info.push({
                cost: echo.cost,
                mainStat,
                substats: echoSubstats,
                totalNorm: echoTotalNorm,
                totalRig: echoTotalRig,
                totalPctNorm: baselineNorm > 0 ? (echoTotalNorm / baselineNorm) * 100 : 0,
                totalPctRig: baselineRig > 0 ? (echoTotalRig / baselineRig) * 100 : 0
            })

            allSubstats.push(...echoSubstats)
        }

        const aggMap = new Map<string, SubstatContribution>()
        for (const s of allSubstats) {
            const existing = aggMap.get(s.type)
            if (existing) {
                existing.contributionNorm += s.contributionNorm
                existing.contributionRig += s.contributionRig
                existing.value += s.value
            } else {
                aggMap.set(s.type, { ...s })
            }
        }
        const aggregated = [...aggMap.values()].map((s) => ({
            ...s,
            contribPctNorm: baselineNorm > 0 ? (s.contributionNorm / baselineNorm) * 100 : 0,
            contribPctRig: baselineRig > 0 ? (s.contributionRig / baselineRig) * 100 : 0
        }))
        aggregated.sort((a, b) => b.contributionNorm - a.contributionNorm)

        const substatTotalNorm = baselineNorm - emptyDamage.norm
        const substatTotalRig = baselineRig - emptyDamage.rigVal

        return {
            character: charName,
            totalDamageNorm: baselineNorm,
            totalDamageRig: baselineRig,
            substatTotalNorm,
            substatTotalRig,
            substatTotalPctNorm: baselineNorm > 0 ? (substatTotalNorm / baselineNorm) * 100 : 0,
            substatTotalPctRig: baselineRig > 0 ? (substatTotalRig / baselineRig) * 100 : 0,
            echoes: info,
            aggregated
        }
    })
}

function popcount(x: number): number {
    x = x - ((x >>> 1) & 0x55555555)
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
    x = (x + (x >>> 4)) & 0x0f0f0f0f
    return (x * 0x01010101) >>> 24
}
