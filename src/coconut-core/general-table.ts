import type { PanelDim } from './actions'

export type ElementEnum = string
export type EnemyTypeEnum = string

export type CalculationFormula = string

export type CharacterStatEnum = string

export type EnemyStatEnum = string

export type MultiEnum = string

export type CritRate = string
export type CritDMG = string

export type ApplyToEnum = CharacterStatEnum | EnemyStatEnum | MultiEnum | CritRate | CritDMG

export type StatKeyEnum = string

export interface Stat {
    key: StatKeyEnum
    value: string
}

export interface StatRef {
    refStat: StatKeyEnum
    baseLine: number
    sourceUnit: string
    targetUnit: string
    lowerLimit: number
    Upperlimit: number
}

export type BuffValue = string | StatRef

export type BuffWrite = 'add' | 'override'

export interface BuffEffect {
    applyTo: ApplyToEnum
    value: BuffValue
    write?: BuffWrite
}

export interface Buff {
    id: string
    effect: BuffEffect
}

export interface Damage {
    value: string
    base?: PanelDim

    hits?: number
    activated_buffs: Buff[]
    element: ElementEnum
    formula: CalculationFormula
}

export interface DamageEntry {
    source: string
    damages: Damage[]
}

export type EnemyBaseResistance = readonly number[]

export interface GeneralTable {
    characters: readonly string[]
    weapons: readonly string[]
    main_stats: readonly (readonly Stat[])[]
    sub_stats: readonly (readonly Stat[])[]
    buffs: readonly Buff[]
    damage_entries: readonly DamageEntry[]
}

export const parseRatio = (value: string): number => {
    const text = String(value ?? '').trim()
    const percent = text.endsWith('%')
    const raw = Number.parseFloat(percent ? text.slice(0, -1).trim() : text)
    if (!Number.isFinite(raw)) return 0
    return percent ? raw / 100 : raw
}
