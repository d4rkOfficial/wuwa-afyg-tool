export interface RefLine {
    id: string
    time: number
}

export interface OpBlock {
    id: string
    trackIndex: number
    time: number
    key: string
    desc: string
    intro: boolean
}

export interface SkillHit {
    hitName: string
    skillType: string
    ratio: string
    element: string
    character: string
    hits?: number
}

export interface SkillPickerGroup {
    type: string
    hits: { name: string; ratio: string; element: string }[]
}

export interface NonDirectEntry {
    name: string
    category: '处决' | '响应' | '效应'
    layers: number
    responders?: string[]
}

export interface DamageBlock {
    id: string
    trackIndex: number
    sourceType: 'op' | 'ref'
    sourceId: string
    skillHits: SkillHit[]
    nonDirectEntries: NonDirectEntry[]
}
