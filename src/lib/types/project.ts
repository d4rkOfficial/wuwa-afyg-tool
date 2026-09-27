import type { BuffInstance, CalcState } from '$lib/calc/calculation.types'
import type { ConfigState } from '$lib/calc/config.types'
import type { TimelineData } from '$lib/calc/timeline.types'

export interface SelectedSet {
    name: string
    pieces: number
}

export interface EchoSlot {
    name: string | null
    cost: number
}

export interface CharSlot {
    character: string | null
    weapon: string | null
    triggerSets: SelectedSet[]
    echoes: [EchoSlot, EchoSlot, EchoSlot, EchoSlot, EchoSlot]
    /** @desc 该角色的共鸣链档位（0-6）；链阶真源，随工程持久化，不跨工程共享 */
    chain?: number
    /** @desc 该角色佩戴武器的精炼档位（0-5，0 表示「无专」）；链阶真源，随工程持久化 */
    refinement?: number
}

export interface PhaseState {
    locked: boolean
    data: unknown
}

export interface CustomHit {
    id: string
    name: string
    flatValue: number
    pctValue: number
    pctUnit: string
    element: string
    /** @desc 段数（从多段倍率取段时写入；绑定到操作块时作为默认 ×N） */
    hits?: number
}

/** @desc 工程某一个阶段的锁定/数据状态（新结构显式字段化） */
export interface PhaseStateV2<T> {
    locked: boolean
    data: T | null
}

/** @desc 新工程结构的四阶段容器：取代无类型的 phases[phase].data */
export interface EncounterState {
    teamLocked: boolean
    timeline: PhaseStateV2<TimelineData>
    calculation: PhaseStateV2<CalcState>
    config: PhaseStateV2<ConfigState>
}

// ── 新工程结构（version 2）──

export const PROJECT_VERSION = 2

export interface ProjectV2 {
    version: number
    id: string
    name: string
    createdAt: number
    archived?: boolean
    team: [CharSlot, CharSlot, CharSlot]
    /** @desc 四阶段数据的显式容器 */
    encounter: EncounterState
    /** @desc 拉表页 Buff 实例列表（一切皆 buff：一个实例可含多个同名变体，各带子条件） */
    buffs: BuffInstance[]
    customSkillHits: Record<string, CustomHit[]>
    analysis?: ResultAnalysisData
    comparison?: { chains: number[]; refinements: number[] }[]
    lockedTeamKey?: string
    lockedTeamNames?: string[]
}

/**
 * 兼容层的工程类型：新结构字段（version/encounter/buffs/analysis/comparison）为**唯一真源**，
 * 仅 `phases` 与 `conditionProfile` 作为过渡期视图保留（由 project store 单向派生），
 * 逐步把调用点迁移到新字段后再删除。
 */
export interface Project extends ProjectV2 {
    /** @desc 过渡期视图：由 encounter 派生，写入时同步到 encounter */
    phases: {
        team: PhaseState
        timeline: PhaseState
        calculation: PhaseState
        config: PhaseState
    }
    /** @desc 过渡期视图：由 team 槽位的链/精炼档位派生 */
    conditionProfile?: { chains: number[]; refinements: number[] }
    /** @desc 过渡期视图：buffs 的别名 */
    buffSets?: BuffInstance[]
}

export type { PhaseKey } from '$lib/consts/game-terms'

export interface ResultAnalysisData {
    /** 时间记点：seconds 为 null 表示「未填写」（名称未解析出时间，不参与分段），可手动填秒数 */
    timings: { refLineId: string; seconds: number | null }[]
    rigCritEntryIds?: string[]
    noCritEntryIds?: string[]
    missEntryIds?: string[]
}
