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
}

export interface Project {
    id: string
    name: string
    createdAt: number
    team: [CharSlot, CharSlot, CharSlot]
    customSkillHits: Record<string, CustomHit[]>
    resultAnalysis?: ResultAnalysisData
    lockedTeamKey?: string
    lockedTeamNames?: string[]
    archived?: boolean
    conditionProfile?: { chains: number[]; refinements: number[] }
    phases: {
        team: PhaseState
        timeline: PhaseState
        calculation: PhaseState
        config: PhaseState
    }
}

export type { PhaseKey } from '$lib/consts/game-terms'

export interface ResultAnalysisData {
    /** 时间记点：seconds 为 null 表示「未填写」（名称未解析出时间，不参与分段），可手动填秒数 */
    timings: { refLineId: string; seconds: number | null }[]
    rigCritEntryIds?: string[]
    noCritEntryIds?: string[]
    missEntryIds?: string[]
}
