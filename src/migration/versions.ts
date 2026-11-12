/**
 * @desc 工程版本迁移链（v0 → 当前版本）。
 */

import type { ConfigState } from '$lib/calc/config.types'
import type { TimelineData } from '$lib/calc/timeline.types'
import { bindPaneEffectSources, entryOwnersFromTimeline } from '$lib/calc/pane-effects'
import type { PhaseKey, ResultAnalysisData } from '$lib/types/project'
import { migrateCalcState } from './buff'
import { migrateBuffFolderNaming } from './buff-folders'
import {
    DEFAULT_SLOTS,
    asRecord,
    lockedOf,
    normalizeTeam,
    pickNum,
    teamLockedOf,
    type ComparisonPoint,
    type Migration
} from './shared'
import { migrateHeavyPressOpBlocks } from './timeline'

/** @desc 迁移 v0（无版本号的 phases[].data 结构）→ v1（显式 encounter + 链阶落到角色槽位 + variant 归一化） */
const migrateV0toV1: Migration = {
    from: 0,
    to: 1,
    migrate(raw) {
        const phases = asRecord(raw.phases)
        const phaseData = (key: PhaseKey): unknown => asRecord(phases[key]).data ?? null
        const phaseLocked = (key: PhaseKey): boolean => asRecord(phases[key]).locked === true

        const team = normalizeTeam(raw.team)
        const calcState = migrateCalcState(phaseData('calculation'))

        // 旧 conditionProfile → 角色槽位链/精炼（链阶真源是 team）
        const profile = asRecord(raw.conditionProfile)
        const chains = Array.isArray(profile.chains) ? profile.chains : []
        const refinements = Array.isArray(profile.refinements) ? profile.refinements : []
        for (const i of DEFAULT_SLOTS) {
            team[i].chain = Math.max(0, pickNum(chains[i], team[i].chain ?? 0))
            team[i].refinement = pickNum(refinements[i], team[i].refinement ?? 1)
        }

        return {
            ...raw,
            version: 1,
            team,
            encounter: {
                teamLocked: phaseLocked('team'),
                timeline: { locked: phaseLocked('timeline'), data: phaseData('timeline') as TimelineData | null },
                calculation: { locked: phaseLocked('calculation'), data: calcState },
                config: { locked: phaseLocked('config'), data: phaseData('config') as ConfigState | null }
            },
            buffs: calcState.buffSets,
            analysis:
                (raw.resultAnalysis as ResultAnalysisData | undefined) ??
                (raw.analysis as ResultAnalysisData | undefined),
            comparison: (raw.comparisonPoints ?? raw.comparison ?? undefined) as ComparisonPoint[] | undefined
        }
    }
}

/** @desc 迁移 v1 → v2（当前版本）：清理空全局 buff 残留、统一没有变体的 buff、链阶落到角色槽位 */
const migrateV1toV2: Migration = {
    from: 1,
    to: 2,
    migrate(raw) {
        const encounter = asRecord(raw.encounter)
        const calcRaw = asRecord(encounter.calculation).data ?? asRecord(raw.calc)
        const calcState = migrateCalcState(calcRaw)
        const team = normalizeTeam(raw.team)

        return {
            ...raw,
            version: 2,
            team,
            encounter: {
                teamLocked: teamLockedOf(encounter),
                timeline: {
                    locked: lockedOf(encounter, 'timeline'),
                    data: (asRecord(encounter.timeline).data ?? null) as TimelineData | null
                },
                calculation: { locked: lockedOf(encounter, 'calculation'), data: calcState },
                config: {
                    locked: lockedOf(encounter, 'config'),
                    data: (asRecord(encounter.config).data ?? null) as ConfigState | null
                }
            },
            buffs: calcState.buffSets
        }
    }
}

/** @desc 迁移 v2 → v3（当前版本）：引用语义修正 —— 把旧工程「跨角色副作用 buff」补勾到引用它们的伤害段 */
const migrateV2toV3: Migration = {
    from: 2,
    to: 3,
    migrate(raw) {
        const encounter = asRecord(raw.encounter)
        const calcContainer = asRecord(encounter.calculation)
        const calcState = migrateCalcState(calcContainer.data ?? asRecord(raw.calc))
        const team = normalizeTeam(raw.team)
        const owners = entryOwnersFromTimeline(asRecord(encounter.timeline).data)
        const bindings = bindPaneEffectSources(calcState.buffSets, calcState.damageEntryBuffSetIds, owners, team)

        return {
            ...raw,
            version: 3,
            team,
            encounter: {
                ...encounter,
                timeline: {
                    locked: lockedOf(encounter, 'timeline'),
                    data: (asRecord(encounter.timeline).data ?? null) as TimelineData | null
                },
                calculation: { ...calcContainer, data: { ...calcState, damageEntryBuffSetIds: bindings } },
                config: {
                    locked: lockedOf(encounter, 'config'),
                    data: (asRecord(encounter.config).data ?? null) as ConfigState | null
                }
            },
            buffs: calcState.buffSets
        }
    }
}

/** @desc 迁移 v3 → v4（当前版本）：乘区改名（历史 id 重映射）+ 「同名变体」拍平为单层乘区条目列表 */
const migrateV3toV4: Migration = {
    from: 3,
    to: 4,
    migrate(raw) {
        const encounter = asRecord(raw.encounter)
        const calcContainer = asRecord(encounter.calculation)
        // migrateCalcState 内部经 normalizeBuff → normalizeZones 完成：
        // ① 历史乘区 id（customFinalDmg / customFinalDmgMul）重映射为 specialFinal1 / specialFinal2
        // ② variants[] 拍平进 zones[]（变体级子条件下放到其每个条目），并丢弃已废弃的 damageEntryBuffVariantIds
        const calcState = migrateCalcState(calcContainer.data ?? asRecord(raw.calc))

        return {
            ...raw,
            version: 4,
            encounter: {
                ...encounter,
                calculation: { ...calcContainer, data: calcState }
            },
            buffs: calcState.buffSets
        }
    }
}

/** @desc 迁移 v4 → v5：旧「备注即重击」的普攻块升级为独立重击图标块 */
const migrateV4toV5: Migration = {
    from: 4,
    to: 5,
    migrate(raw) {
        const encounter = asRecord(raw.encounter)
        const phases = asRecord(raw.phases)
        // 真源 encounter 与兼容视图 phases 都可能承载四阶段数据（导出文件只写 phases），两处都洗一遍
        const patchTimeline = (container: Record<string, unknown>): Record<string, unknown> => {
            const phase = asRecord(container.timeline)
            const data = migrateHeavyPressOpBlocks(phase.data)
            if (data === phase.data) return container
            return { ...container, timeline: { ...phase, data } }
        }
        const nextEncounter = patchTimeline(encounter)
        const nextPhases = patchTimeline(phases)

        return {
            ...raw,
            version: 5,
            ...(nextEncounter === encounter ? {} : { encounter: nextEncounter }),
            ...(nextPhases === phases ? {} : { phases: nextPhases })
        }
    }
}

/** @desc 迁移 v5 → v6（当前版本）：Buff 文件夹命名迁移 + 旧导入按实体归档（声骸 / 套装 / 武器） */
const migrateV5toV6: Migration = {
    from: 5,
    to: 6,
    migrate(raw) {
        const encounter = asRecord(raw.encounter)
        const phases = asRecord(raw.phases)
        const encounterCalc = asRecord(encounter.calculation)
        const phasesCalc = asRecord(phases.calculation)
        // 真源 encounter 优先；本地导出 / 工坊文件只写兼容视图 phases
        const source = encounterCalc.data !== undefined ? encounterCalc.data : (phasesCalc.data ?? asRecord(raw.calc))
        const team = normalizeTeam(raw.team)
        const calcState = migrateBuffFolderNaming(migrateCalcState(source), team)
        return {
            ...raw,
            version: 6,
            team,
            buffs: calcState.buffSets,
            encounter: { ...encounter, calculation: { ...encounterCalc, data: calcState } },
            ...(phasesCalc.data !== undefined
                ? { phases: { ...phases, calculation: { ...phasesCalc, data: calcState } } }
                : {})
        }
    }
}

export const PROJECT_MIGRATIONS: Migration[] = [
    migrateV0toV1,
    migrateV1toV2,
    migrateV2toV3,
    migrateV3toV4,
    migrateV4toV5,
    migrateV5toV6
]
