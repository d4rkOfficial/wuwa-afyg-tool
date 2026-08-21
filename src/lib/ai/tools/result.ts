// 结果域工具（Phase 4）：读取当前配置下的伤害计算结果、单条目乘区溯源、数据分析
import { defineTool } from './registry'
import { computeAll } from '$lib/calc/compute'
import { getAllDamageEntries, getCalcState, getConditionProfile } from '$lib/calc/calculation.store.svelte'
import { getConfig } from '$lib/calc/config.store.svelte'
import { buildDamageSegments, type DamageTraceCtx } from '$lib/calc/damage-trace'
import { aggregateDirectDamageByType } from '$lib/calc/utils'
import { algorithms, ALGORITHMS_INFO } from '$lib/calc/substat-algorithms'
import type { AlgorithmId } from '$lib/calc/substat-algorithms/types'
import type { ResultEntry, CharSubstatAnalysis } from '$lib/calc/result.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import { getActiveProject } from '$lib/data/project.svelte'
import { getCharacterInfo, getWeaponInfo } from '$lib/api/data-cache'
import { getRefLines, getOpBlocks } from '$lib/calc/timeline.store.svelte'

const str = (v: unknown): string => String(v ?? '').trim()

/** @desc 构建 computeAll 的输入上下文（与结果页同源）：队伍角色/武器的 info map + 计算结果条目 */
async function buildComputeContext(): Promise<{
    entries: ResultEntry[]
    ctx: DamageTraceCtx
    project: NonNullable<ReturnType<typeof getActiveProject>>
}> {
    const p = getActiveProject()
    if (!p) throw new Error('当前没有活动工程')
    const calc = getCalcState()
    const config = getConfig()

    const charNames = p.team.map((s) => s.character).filter((c): c is string => !!c)
    const weaponNames = p.team.map((s) => s.weapon).filter((w): w is string => !!w)
    const [charInfos, weaponInfos] = await Promise.all([
        Promise.all(charNames.map((n) => getCharacterInfo(n).catch(() => null))),
        Promise.all(weaponNames.map((n) => getWeaponInfo(n).catch(() => null)))
    ])
    const charInfoMap: Record<string, CharacterInfo> = {}
    charNames.forEach((n, i) => {
        if (charInfos[i]) charInfoMap[n] = charInfos[i]!
    })
    const weaponInfoMap: Record<string, WeaponInfo> = {}
    weaponNames.forEach((n, i) => {
        if (weaponInfos[i]) weaponInfoMap[n] = weaponInfos[i]!
    })

    const conditionProfile = getConditionProfile()
    const entries = computeAll(
        getAllDamageEntries(),
        calc.buffSets,
        calc.damageEntryBuffSetIds,
        calc.damageEntryDamageTypes,
        config,
        p.team,
        charInfoMap,
        weaponInfoMap,
        conditionProfile
    )
    return {
        entries,
        project: p,
        ctx: {
            buffSets: calc.buffSets,
            damageEntryBuffSetIds: calc.damageEntryBuffSetIds,
            damageEntryDamageTypes: calc.damageEntryDamageTypes,
            configState: config,
            team: p.team,
            charInfoMap,
            weaponInfoMap,
            conditionProfile
        }
    }
}

/** @desc 应用凹暴/不暴/未命中模式（与结果页 applyModes 同口径） */
function applyModes(sourceEntries: ResultEntry[]): ResultEntry[] {
    const ra = getActiveProject()?.resultAnalysis
    const rigIds = new Set(ra?.rigCritEntryIds ?? [])
    const noCritIds = new Set(ra?.noCritEntryIds ?? [])
    const missIds = new Set(ra?.missEntryIds ?? [])
    return sourceEntries.map((e) => {
        if (missIds.has(e.id)) {
            return { ...e, expectedPerHit: 0, totalDamage: 0, totalDamageRaw: 0 }
        }
        if (rigIds.has(e.id)) {
            return { ...e, expectedPerHit: e.critPerHit, totalDamage: e.critPerHit }
        }
        if (noCritIds.has(e.id)) {
            return { ...e, expectedPerHit: e.nonCritPerHit, totalDamage: e.nonCritPerHit }
        }
        return e
    })
}

defineTool('get_result_summary', {
    description:
        '基于当前配装/Buff/条件配置计算并返回伤害结果摘要：每个伤害条目的期望伤害（含暴击）与全队总伤害。可用来回答“这套配置伤害多少”“哪个技能伤害最高”。',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
        const { entries } = await buildComputeContext()
        const applied = applyModes(entries)
        const total = applied.reduce((sum, e) => sum + (e.totalDamage ?? 0), 0)
        return {
            total,
            entries: applied.map((e) => ({
                id: e.id,
                displayName: e.displayName,
                character: e.character,
                element: e.element,
                hits: e.hits,
                totalDamage: e.totalDamage,
                perHit: e.totalDamage > 0 && e.hits > 0 ? Math.round(e.totalDamage / e.hits) : 0
            }))
        }
    }
})

defineTool('get_result_entry_breakdown', {
    description:
        '查询单条伤害结果条目及其全部乘区溯源（每段的数值与来源：基础值/白值/绿值、增伤/加深/易伤/抗性/防御/免伤/集谐/终伤/特殊/暴击等乘区，各乘区的 buff 来源与折算贡献）。entryId 用 get_result_summary 获取。用于回答“这条伤害是怎么算出来的”“哪个 buff 贡献最大”“为什么这条伤害偏低”。',
    parameters: {
        type: 'object',
        properties: { entryId: { type: 'string', description: '伤害条目 id（get_result_summary 获取）' } },
        required: ['entryId']
    },
    handler: async (args) => {
        const entryId = str(args.entryId)
        if (!entryId) throw new Error('缺少 entryId')
        const { entries, ctx } = await buildComputeContext()
        const entry = entries.find((e) => e.id === entryId)
        if (!entry) throw new Error(`未找到伤害条目：${entryId}（先用 get_result_summary 查询当前条目 id）`)

        const ra = getActiveProject()?.resultAnalysis
        const missIds = new Set(ra?.missEntryIds ?? [])
        const missed = missIds.has(entry.id)
        const segments = buildDamageSegments(entry, ctx, missed)

        return {
            entry: {
                id: entry.id,
                displayName: entry.displayName,
                character: entry.character,
                element: entry.element,
                hits: entry.hits,
                ratioNum: entry.ratioNum,
                baseUnit: entry.baseUnit,
                canCrit: entry.canCrit
            },
            perHit: {
                raw: entry.rawPerHit,
                expected: entry.expectedPerHit,
                nonCrit: entry.nonCritPerHit,
                crit: entry.critPerHit
            },
            totalDamage: entry.totalDamage,
            breakdown: {
                baseUnit: segments.baseUnit,
                baseLabel: segments.baseLabel,
                isCoeff: segments.isCoeff,
                baseWhite: segments.baseWhite,
                baseGreen: segments.baseGreen,
                totalStat: segments.totalStat,
                ratioPct: segments.ratioPct,
                extraRatioPct: segments.extraRatioPct,
                ratioIncludesExtra: segments.ratioIncludesExtra,
                hits: segments.hits,
                baseValue: segments.baseValue,
                baseParts: segments.baseParts,
                preCrit: segments.preCrit,
                crit: segments.crit,
                segments: segments.segments.map((s) => ({
                    id: s.id,
                    label: s.label,
                    value: s.value,
                    detail: s.detail,
                    parts: s.parts
                }))
            }
        }
    }
})

defineTool('get_data_analysis', {
    description:
        '查询结果页「数据分析」弹窗的全部分析结果：全队总伤害与 DPS、队伍伤害占比（各角色）、各角色直伤类型占比（普攻/重击/共技/共解等）、三种词条贡献算法（single-loss 单减损 / shapley 夏普利 / partial-derivative 偏导）的副词条贡献明细。用于回答“队伍 DPS 多少”“各角色伤害占比”“该优先升什么词条”“三算法结论是否一致”。',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
        const { entries, project, ctx } = await buildComputeContext()
        const applied = applyModes(entries)
        const total = applied.reduce((s, e) => s + e.totalDamage, 0)

        // 队伍伤害占比（各角色）
        const charMap = new Map<string, { total: number; count: number }>()
        for (const e of applied) {
            const cur = charMap.get(e.character) ?? { total: 0, count: 0 }
            cur.total += e.totalDamage
            cur.count++
            charMap.set(e.character, cur)
        }
        const charSummaries = [...charMap.entries()].map(([character, d]) => ({
            character,
            totalDamage: d.total,
            entryCount: d.count,
            share: total > 0 ? d.total / total : 0
        }))

        // 角色直伤类型占比
        const directDamageByType = aggregateDirectDamageByType(applied).map((agg) => ({
            character: agg.character,
            total: agg.total,
            slices: agg.slices.map((sl) => ({
                label: sl.label,
                value: sl.value,
                share: agg.total > 0 ? sl.value / agg.total : 0
            }))
        }))

        // 时间记点 → 总时长 → DPS（与数据分析弹窗同口径：末个有效记点的秒数为总时长）
        const timings = project.resultAnalysis?.timings ?? []
        const refLines = getRefLines()
        const validTimings = [...timings]
            .filter((t) => refLines.some((r) => r.id === t.refLineId) && t.seconds !== null)
            .sort((a, b) => {
                const ap = refLines.find((r) => r.id === a.refLineId)?.pos ?? 0
                const bp = refLines.find((r) => r.id === b.refLineId)?.pos ?? 0
                return ap - bp
            })
        const totalDur = validTimings.length > 0 ? validTimings[validTimings.length - 1]!.seconds! : 0
        const overallDps = totalDur > 0 ? total / totalDur : null

        // DPS 分段（各时间区间伤害）
        const opBlocks = getOpBlocks()
        const blockPosMap = new Map<string, number>()
        for (const b of opBlocks) blockPosMap.set(b.id, b.pos)
        const dpsSegments: Array<{
            startSeconds: number
            endSeconds: number
            totalDamage: number
            charDamages: Record<string, number>
            otherDamage: number
        }> = []
        if (validTimings.length > 0) {
            let prevRefPos = 0
            let prevSeconds = 0
            for (const t of validTimings) {
                const rl = refLines.find((r) => r.id === t.refLineId)
                if (!rl) continue
                const span = t.seconds! - prevSeconds
                if (span <= 0) {
                    prevRefPos = rl.pos
                    prevSeconds = t.seconds!
                    continue
                }
                const segEntries = applied.filter((e) => {
                    const p = blockPosMap.get(e.sourceTimelineBlockId)
                    return p !== undefined && p >= prevRefPos && p < rl.pos
                })
                const segTotal = segEntries.reduce((s, e) => s + e.totalDamage, 0)
                const charDmg: Record<string, number> = {}
                let otherDmg = 0
                for (const e of segEntries) {
                    if (project.team.some((s) => s.character === e.character)) {
                        charDmg[e.character] = (charDmg[e.character] ?? 0) + e.totalDamage
                    } else {
                        otherDmg += e.totalDamage
                    }
                }
                dpsSegments.push({
                    startSeconds: prevSeconds,
                    endSeconds: t.seconds!,
                    totalDamage: segTotal,
                    charDamages: charDmg,
                    otherDamage: otherDmg
                })
                prevRefPos = rl.pos
                prevSeconds = t.seconds!
            }
        }

        // 三算法词条贡献
        const rigIds = new Set(project.resultAnalysis?.rigCritEntryIds ?? [])
        const noCritIds = new Set(project.resultAnalysis?.noCritEntryIds ?? [])
        const missIds = new Set(project.resultAnalysis?.missEntryIds ?? [])
        const calc = getCalcState()
        const config = getConfig()
        const dmgEntries = getAllDamageEntries()
        const allAlgoResults: Record<string, CharSubstatAnalysis[]> = {}
        for (const info of ALGORITHMS_INFO) {
            const fn = algorithms[info.id as AlgorithmId]
            allAlgoResults[info.id] = fn(
                dmgEntries,
                calc.buffSets,
                calc.damageEntryBuffSetIds,
                calc.damageEntryDamageTypes,
                config,
                project.team,
                ctx.charInfoMap,
                ctx.weaponInfoMap,
                rigIds,
                noCritIds,
                missIds
            )
        }

        return {
            totalDamage: total,
            totalDurationSeconds: totalDur,
            overallDps,
            charSummaries,
            directDamageByType,
            dpsSegments,
            timingsCount: validTimings.length,
            algorithms: ALGORITHMS_INFO.map((info) => ({
                id: info.id,
                name: info.name,
                description: info.description,
                results: allAlgoResults[info.id]
            }))
        }
    }
})
