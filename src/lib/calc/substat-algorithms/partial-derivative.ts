import type { EchoContribution, CharSubstatAnalysis, SubstatContribution } from '../result.types'
import type { EchoSlotConfig } from '../config.types'
import { cloneEchoesWithoutAllSubstats } from '../compute'
import {
    aggregateSubstats,
    assembleSubstatAnalysis,
    diffTotals,
    makeEchoContribution,
    makeSubstatContribution,
    type CharacterDamageContext
} from './shared'

/** @desc 把某声骸的某个副词条数值抬高 delta */
const cloneEchoesWithIncreasedSubstat = (
    echoes: EchoSlotConfig[],
    echoIdx: number,
    substatIdx: number,
    delta: number
): EchoSlotConfig[] =>
    echoes.map((echo, ei) =>
        ei !== echoIdx
            ? echo
            : {
                  ...echo,
                  substats: echo.substats.map((sub, si) =>
                      si === substatIdx ? { ...sub, value: sub.value + delta } : sub
                  )
              }
    )

/** @desc 有限差分步长：至少 0.5，避免小数值词条被浮点噪声淹没 */
const getEpsilon = (value: number): number => Math.max(0.5, Math.abs(value) * 0.05)

/**
 * @desc 偏导数算法：对每个副词条施加微小增量 ε，用有限差分估出当前面板下的偏导，再乘词条当前值。
 *
 * 回答的是「再刷这一条能涨多少」，而不是「这条现在值多少」—— 两者在满暴/溢出场景下会分叉。
 */
export const analyzeCharacterSubstats = (ctx: CharacterDamageContext): CharSubstatAnalysis => {
    const echoes: EchoContribution[] = []
    const allSubstats: SubstatContribution[] = []

    ctx.echoes.forEach((echo, ei) => {
        if (echo.substats.length === 0) return
        const substats = echo.substats
            .map((sub, si) => {
                const epsilon = getEpsilon(sub.value)
                const boosted = ctx.recompute({ echoes: cloneEchoesWithIncreasedSubstat(ctx.echoes, ei, si, epsilon) })
                const slope = diffTotals(boosted, ctx.baseline)
                return makeSubstatContribution({
                    type: sub.type,
                    value: sub.value,
                    unit: sub.unit,
                    contribution: {
                        norm: (slope.norm / epsilon) * sub.value,
                        rig: (slope.rig / epsilon) * sub.value,
                        noCrit: (slope.noCrit / epsilon) * sub.value
                    },
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
