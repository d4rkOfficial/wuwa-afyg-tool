import type { DamageEntry, BuffSet } from '../../calculation/calculation.types'
import type { ConfigState, EchoSlotConfig } from '../../config/config.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { CharSlot } from '$lib/data/types'
import type { CharSubstatAnalysis, SubstatContribution, EchoContribution } from '../result.types'
import { computeAll, getCharFullStatsForChar, computeOneEntry, cloneEchoesWithoutSubstat } from '../compute'

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

        const info: EchoContribution[] = []
        const allSubstats: SubstatContribution[] = []

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

        for (let ei = 0; ei < echoes.length; ei++) {
            const echo = echoes[ei]
            if (echo.substats.length === 0) continue

            const echoSubstats: SubstatContribution[] = []

            for (let si = 0; si < echo.substats.length; si++) {
                const sub = echo.substats[si]
                const modified = cloneEchoesWithoutSubstat(echoes, ei, si)

                const modFullStats = baseFullStats.map((fs, i) => {
                    if (i !== ci) return fs
                    return getCharFullStatsForChar(
                        ci,
                        modified,
                        damageEntries,
                        buffSets,
                        damageEntryBuffSetIds,
                        charInfoMap,
                        team,
                        weaponInfoMap
                    )
                })

                let reducedNorm = 0
                let reducedRig = 0
                for (const de of charDmgEntries) {
                    const re = computeOneEntry(
                        de,
                        ci,
                        modified,
                        modFullStats,
                        buffSets,
                        damageEntryBuffSetIds,
                        damageEntryDamageTypes,
                        configState,
                        team,
                        charInfoMap,
                        weaponInfoMap
                    )
                    reducedNorm += re.totalDamageRaw
                    reducedRig += rigCritEntryIds.has(re.id) ? re.critPerHit : re.totalDamageRaw
                }

                const contribNorm = baselineNorm - reducedNorm
                const contribRig = baselineRig - reducedRig

                echoSubstats.push({
                    type: sub.type,
                    value: sub.value,
                    unit: sub.unit,
                    contributionNorm: contribNorm,
                    contributionRig: contribRig,
                    contribPctNorm: baselineNorm > 0 ? (contribNorm / baselineNorm) * 100 : 0,
                    contribPctRig: baselineRig > 0 ? (contribRig / baselineRig) * 100 : 0
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

        const substatTotalNorm = allSubstats.reduce((s, sub) => s + sub.contributionNorm, 0)
        const substatTotalRig = allSubstats.reduce((s, sub) => s + sub.contributionRig, 0)

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
