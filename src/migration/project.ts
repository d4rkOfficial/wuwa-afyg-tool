/**
 * @desc 工程数据的对外迁移入口：版本读取、兼容视图派生与 migrateProject。
 */

import type { ConfigState } from '$lib/calc/config.types'
import type { TimelineData } from '$lib/calc/timeline.types'
import type { CharSlot, CustomHit, PhaseKey, Project, ProjectV2, ResultAnalysisData } from '$lib/types/project'
import { PROJECT_VERSION } from '$lib/types/project'
import { migrateCalcState, normalizeCalcState } from './buff'
import {
    DEFAULT_SLOTS,
    VERSIONLESS_ASSUME_CURRENT_AFTER,
    asRecord,
    deepClone,
    genId,
    isRecord,
    normalizeTeam,
    pickNum,
    teamLockedOf,
    type ComparisonPoint
} from './shared'
import { dedupeDamageBlockIds, migrateHeavyPressOpBlocks } from './timeline'
import { PROJECT_MIGRATIONS } from './versions'

// ── 兼容视图同步：新结构 ↔ 视图字段 ──

/** @desc 由新结构派生视图字段（新代码请直接用 encounter / buffs） */
const syncLegacyViews = (p: ProjectV2): Project => {
    const phases = {
        team: { locked: p.encounter.teamLocked, data: null as unknown },
        timeline: { locked: p.encounter.timeline.locked, data: p.encounter.timeline.data },
        calculation: { locked: p.encounter.calculation.locked, data: p.encounter.calculation.data },
        config: { locked: p.encounter.config.locked, data: p.encounter.config.data }
    }
    return {
        ...p,
        phases,
        buffSets: p.buffs,
        conditionProfile: conditionProfileFromTeam(p.team)
    }
}

/** @desc 由角色槽位上的链/精炼档位派生条件系统读取用的 conditionProfile */
export const conditionProfileFromTeam = (
    team: [CharSlot, CharSlot, CharSlot]
): {
    chains: number[]
    refinements: number[]
} => ({
    chains: DEFAULT_SLOTS.map((i) => team[i]?.chain ?? 0),
    refinements: DEFAULT_SLOTS.map((i) => team[i]?.refinement ?? 1)
})

/**
 * @desc 读取数据的版本号：无版本号（老导出格式 / 老 IndexedDB）视为 0。
 *
 * `exportedAt` = 「这份数据是什么时候产出的」：工具导出时写 `Date.now()`，工坊落库时写**上传时刻**。
 * 缺版本号但产出时间晚于 {@link VERSIONLESS_ASSUME_CURRENT_AFTER} 的，按「中转站吃掉了版本号」处理，
 * 断言为当前最新版 —— 否则会被误判成 v0 而重跑 `bindPaneEffectSources`（见该常量的注释）。
 * 缺版本号**且**没有可信 `exportedAt`（或早于门槛）时，仍按 0 走完整迁移链。
 */
export const readVersion = (raw: Record<string, unknown>): number => {
    const version = raw.version
    if (typeof version === 'number' && Number.isFinite(version)) return version
    const exportedAt = raw.exportedAt
    if (
        typeof exportedAt === 'number' &&
        Number.isFinite(exportedAt) &&
        exportedAt >= VERSIONLESS_ASSUME_CURRENT_AFTER
    ) {
        return PROJECT_VERSION
    }
    return 0
}

export const migrateProject = (raw: unknown): Project => {
    let data = isRecord(raw) ? { ...raw } : {}
    for (const migration of PROJECT_MIGRATIONS) {
        if (readVersion(data) >= PROJECT_VERSION) break
        if (readVersion(data) >= migration.to) continue
        data = migration.migrate(data)
    }

    const encounter = asRecord(data.encounter)
    /**
     * @desc 四阶段数据源：真源 `encounter.<phase>.data` 优先，缺失时**逐阶段**回落到兼容期视图
     * `phases[<phase>].data`。
     *
     * 为什么必须有这条回落：`buildExportFile` 导出的文件（本地导出 / 分享上传）写的是视图 `phases`
     * 而不是 `encounter`，而顶层 `version` 已经是当前版本 —— 迁移链一步都不跑，于是 encounter 被读成空，
     * 导出的工程一导入就只剩队伍配置（排轴 / 拉表 / 词条配置 / buff 列表全空）。
     * 只看 encounter 的写法还把「老导出文件」一起坑了，回落能同时修好已经导出的存量文件。
     */
    const legacyPhases = asRecord(data.phases)
    const rawPhase = (key: PhaseKey): Record<string, unknown> => asRecord(encounter[key])
    const viewPhase = (key: PhaseKey): Record<string, unknown> => asRecord(legacyPhases[key])
    const phaseData = (key: PhaseKey): unknown =>
        rawPhase(key).data !== undefined ? rawPhase(key).data : (viewPhase(key).data ?? null)
    const phaseLocked = (key: PhaseKey): boolean => rawPhase(key).locked === true || viewPhase(key).locked === true

    const team = normalizeTeam(data.team)
    // 归一化拉表态（清理空全局 buff / [配置] 自动块 / 旧类型名）并落实「链阶条件二选一」拆分
    const normalizedCalc = migrateCalcState(phaseData('calculation'))
    const calcState = normalizeCalcState(normalizedCalc)
    /**
     * @desc 旧「备注即重击」的普攻块升级为独立重击块，**与版本无关地幂等兜底**。
     *
     * 为什么要兜底而不只依赖 v4→v5：工坊下载件的 `project.version` 会被中转站吃掉，`readVersion`
     * 对「无版本号 + 产出时间晚于门槛」的文件直接断言为当前版本（见 VERSIONLESS_ASSUME_CURRENT_AFTER），
     * 迁移链一步都不跑；只在链里做会让这些下载件永远停在旧形态。
     */
    const timelineData = dedupeDamageBlockIds(migrateHeavyPressOpBlocks(phaseData('timeline')))

    const project: ProjectV2 = {
        version: PROJECT_VERSION,
        id: typeof data.id === 'string' && data.id ? data.id : genId('project'),
        name: typeof data.name === 'string' && data.name ? data.name : '未命名工程',
        createdAt: pickNum(data.createdAt, Date.now()),
        ...(data.archived === true ? { archived: true } : {}),
        team,
        encounter: {
            // 视图侧的队伍锁定标记在 `phases.team.locked`（与 migrateV0toV1 同口径），不是 `phases.teamLocked`
            teamLocked: teamLockedOf(encounter) || teamLockedOf(legacyPhases) || viewPhase('team').locked === true,
            timeline: { locked: phaseLocked('timeline'), data: timelineData as TimelineData | null },
            calculation: { locked: phaseLocked('calculation'), data: calcState },
            config: { locked: phaseLocked('config'), data: phaseData('config') as ConfigState | null }
        },
        buffs: calcState.buffSets,
        customSkillHits: isRecord(data.customSkillHits) ? (data.customSkillHits as Record<string, CustomHit[]>) : {},
        ...(isRecord(data.analysis) ? { analysis: data.analysis as unknown as ResultAnalysisData } : {}),
        ...(Array.isArray(data.comparison) ? { comparison: data.comparison as ComparisonPoint[] } : {}),
        ...(typeof data.lockedTeamKey === 'string' ? { lockedTeamKey: data.lockedTeamKey } : {}),
        ...(Array.isArray(data.lockedTeamNames) ? { lockedTeamNames: data.lockedTeamNames as string[] } : {})
    }
    return syncLegacyViews(project)
}

/** @desc 由工程派生用于保存的精简快照（不落视图字段） */
export const toPlainProject = (p: Project): ProjectV2 => {
    const { phases: _phases, conditionProfile: _profile, buffSets: _buffs, ...rest } = p
    return deepClone(rest)
}
