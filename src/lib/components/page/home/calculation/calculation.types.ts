export interface DamageItem {
    id: string
    character?: string
    skillType?: string
    hitName: string
    isEffect: boolean
    isTuneBreak: boolean
    isTuneReaction: boolean
    ratioValue: number
    ratioUnit: '%' | 'fixed'
    damageBaseType: string
    damageElement: string
    damageBlockId: string
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
