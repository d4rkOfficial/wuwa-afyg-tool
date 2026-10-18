import type { EchoContribution, CharSubstatAnalysis, SubstatContribution } from '../result.types'
import type { EchoSlotConfig } from '../config.types'
import { cloneEchoesWithoutAllSubstats } from '../compute'
import {
    aggregateSubstats,
    assembleSubstatAnalysis,
    diffTotals,
    makeEchoContribution,
    makeSubstatContribution,
    type CharacterDamageContext,
    type DamageTotals
} from './shared'

const factorial = (n: number): number => {
    let r = 1
    for (let i = 2; i <= n; i++) r *= i
    return r
}

/** @desc 只保留指定下标的副词条（同一角色其余声骸原样） */
const buildSubsetEchoes = (echoes: EchoSlotConfig[], echoIdx: number, keepIndices: number[]): EchoSlotConfig[] =>
    echoes.map((echo, ei) =>
        ei !== echoIdx ? echo : { ...echo, substats: echo.substats.filter((_, si) => keepIndices.includes(si)) }
    )

const popcount = (value: number): number => {
    // SWAR 位计数：复用中间值而非重赋值入参（纯函数式约束）
    const a = value - ((value >>> 1) & 0x55555555)
    const b = (a & 0x33333333) + ((a >>> 2) & 0x33333333)
    const c = (b + (b >>> 4)) & 0x0f0f0f0f
    return (c * 0x01010101) >>> 24
}

/**
 * @desc Shapley 算法：对同一声骸上的 k 个副词条枚举 2ᵏ 种子集，
 * 求每个词条在所有加入顺序下的平均边际贡献（理论上公平地计入词条交互）。
 *
 * 枚举以「只保留该声骸的某个子集」实现：其它声骸保持原配置，因此子集值 v(S) 与基线同口径。
 */
export const analyzeCharacterSubstats = (ctx: CharacterDamageContext): CharSubstatAnalysis => {
    const echoes: EchoContribution[] = []
    const allSubstats: SubstatContribution[] = []

    ctx.echoes.forEach((echo, ei) => {
        const k = echo.substats.length
        if (k === 0) return

        // v(S)：该声骸保留子集 S 时的三口径伤害
        const subsetCache = new Map<number, DamageTotals>()
        for (let mask = 0; mask < 1 << k; mask++) {
            const keep: number[] = []
            for (let i = 0; i < k; i++) if (mask & (1 << i)) keep.push(i)
            subsetCache.set(mask, ctx.recompute({ echoes: buildSubsetEchoes(ctx.echoes, ei, keep) }))
        }

        // 权重：|S|!(k-|S|-1)!/k!
        const weights = Array.from({ length: k }, (_, s) => (factorial(s) * factorial(k - s - 1)) / factorial(k))

        const substats = echo.substats
            .map((sub, si) => {
                let shapley = { norm: 0, rig: 0, noCrit: 0 }
                for (let mask = 0; mask < 1 << k; mask++) {
                    if (mask & (1 << si)) continue
                    const s = popcount(mask)
                    const vS = subsetCache.get(mask)!
                    const vSwith = subsetCache.get(mask | (1 << si))!
                    const delta = diffTotals(vSwith, vS)
                    shapley = {
                        norm: shapley.norm + weights[s] * delta.norm,
                        rig: shapley.rig + weights[s] * delta.rig,
                        noCrit: shapley.noCrit + weights[s] * delta.noCrit
                    }
                }
                return makeSubstatContribution({
                    type: sub.type,
                    value: sub.value,
                    unit: sub.unit,
                    contribution: shapley,
                    baseline: ctx.baseline
                })
            })
            .sort((a, b) => b.contributionNorm - a.contributionNorm)

        echoes.push(
            makeEchoContribution({
                cost: echo.cost,
                mainStat: echo.mainStat?.type ?? '',
                substats,
                baseline: ctx.baseline
            })
        )
        allSubstats.push(...substats)
    })

    const empty = ctx.recompute({ echoes: cloneEchoesWithoutAllSubstats(ctx.echoes) })
    return assembleSubstatAnalysis({
        character: ctx.character,
        baseline: ctx.baseline,
        empty,
        echoes,
        aggregated: aggregateSubstats(allSubstats, ctx.baseline),
        standard: ctx.standard
    })
}
