export interface RefLine {
    id: string
    time: string
    pos: number
}

export interface OpBlock {
    id: string
    trackIndex: number
    pos: number
    key: string
    desc: string
    intro: boolean
    switchback: boolean
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

export interface CustomHit {
    id: string
    name: string
    flatValue: number
    pctValue: number
    pctUnit: string
    element: string
}

export interface TimelineData {
    refLines: RefLine[]
    opBlocks: OpBlock[]
    damageBlocks: DamageBlock[]
}
