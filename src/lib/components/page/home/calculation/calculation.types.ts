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
    burstLayers?: number
    hits: number
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
    discrete?: boolean
    divisor?: number
    multiplier?: number
}

export type BuffValue = number | ZoneRef

export type Buff = Partial<Record<ZoneId, BuffValue>>

export interface BuffZoneValue {
    zoneId: ZoneId
    value: number
    ref?: ZoneRef
    override?: boolean
}

// 生效条件（可同时设置多项，全部满足才生效）：
//   chain      = 角色共鸣链 ≥ chain（1-6）
//   refinement = 武器精炼 ≥ refinement（1-5）
//   elements   = 伤害属性（多选，含物理）
//   damageTypes= 伤害类型（多选，普攻/重击/…伤害）
export interface BuffCondition {
    chain?: number
    refinement?: number
    elements?: string[]
    damageTypes?: string[]
}

export interface BuffSet {
    id: string
    name: string
    zones: BuffZoneValue[]
    scope: 'all' | number[]
    starred?: boolean
    global?: boolean
    condition?: BuffCondition
    conditionRefCharIdx?: number
}

export interface CalcState {
    buffSets: BuffSet[]
    damageEntryBuffSetIds: Record<string, string[]>
    damageEntryDamageTypes: Record<string, string[]>
}
