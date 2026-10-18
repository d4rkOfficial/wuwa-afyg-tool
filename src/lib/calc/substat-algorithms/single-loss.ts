import type { EchoContribution, CharSubstatAnalysis, SubstatContribution } from '../result.types'
import { cloneEchoesWithoutAllSubstats, cloneEchoesWithoutSubstat } from '../compute'
import {
    aggregateSubstats,
    assembleSubstatAnalysis,
    diffTotals,
    makeEchoContribution,
    makeSubstatContribution,
    type CharacterDamageContext
} from './shared'

/**
 * @desc 单条损失算法：依次移除每个副词条后重算，用「伤害损失」衡量该词条价值。
 *
 * 直观、快，但忽略词条间交互（暴击与暴伤的配合等）—— 这也是另外两种算法存在的理由。
 */
export const analyzeCharacterSubstats = (ctx: CharacterDamageContext): CharSubstatAnalysis => {
    const echoes: EchoContribution[] = []
    const allSubstats: SubstatContribution[] = []

    ctx.echoes.forEach((echo, ei) => {
        if (echo.substats.length === 0) return
        const substats = echo.substats
            .map((sub, si) =>
                makeSubstatContribution({
                    type: sub.type,
                    value: sub.value,
                    unit: sub.unit,
                    contribution: diffTotals(
                        ctx.baseline,
                        ctx.recompute({ echoes: cloneEchoesWithoutSubstat(ctx.echoes, ei, si) })
                    ),
                    baseline: ctx.baseline
                })
            )
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
