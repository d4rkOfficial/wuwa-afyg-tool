export interface DamageEntry {
    id: string
    character?: string
    skillType?: string
    hitName: string
    displayName: string
    isEffect: boolean
    isTuneBreak: boolean
    isTuneResponse: boolean
    ratioValue: number
    ratioUnit: '%' | 'fixed'
    damageBaseType: string
    damageElement: string
    sourceTimelineBlockId: string
}

import type { ZoneId } from './calculation.consts'

export interface ZoneDef {
    id: string
    label: string
    unit: '%' | 'flat'
}

export interface ZoneRef {
    characterIdx: number
    zoneId: string
    threshold: number
    pct: number
    lower?: number
    upper?: number
}

export type BuffValue = number | ZoneRef

export type Buff = Partial<Record<ZoneId, BuffValue>>

export interface BuffZoneValue {
    zoneId: ZoneId
    value: number
    ref?: ZoneRef
}

export interface BuffSet {
    id: string
    name: string
    zones: BuffZoneValue[]
    scope: 'all' | number[]
}

export interface CalcState {
    buffSets: BuffSet[]
    damageEntryBuffSetIds: Record<string, string[]>
    damageEntryDamageTypes: Record<string, string[]>
}
