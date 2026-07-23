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
    phases: {
        team: PhaseState
        timeline: PhaseState
        calculation: PhaseState
        config: PhaseState
    }
}

export type PhaseKey = 'team' | 'timeline' | 'calculation' | 'config'

export interface ResultAnalysisData {
    timings: { refLineId: string; seconds: number }[]
}
