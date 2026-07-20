export interface DamageEntry {
    id: string
    character: string
    hitName: string
    skillType: string
    element: string
    ratio: string
    ratioNum: number
    hits: number
    sourceType: 'op' | 'ref'
    time: number
}

export interface ZoneDef {
    id: string
    label: string
    unit: '%' | 'flat'
}

export interface BuffZoneValue {
    zoneId: string
    value: number
    sourceRef?: { character: string; ratio: number }
}

export interface BuffBlock {
    id: string
    name: string
    zones: BuffZoneValue[]
}

export interface CalcState {
    blocks: BuffBlock[]
    entryBlockIds: Record<string, string[]>
}
