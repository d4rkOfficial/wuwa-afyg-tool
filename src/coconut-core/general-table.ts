import type { PanelDim } from './actions'

export type ElementEnum = string

export type ActionId = string | symbol

export type FormulaId = string | symbol

export type BuffId = string

export type CalculationFormula = FormulaId

export interface Stat {
    key: string
    value: string
}

export interface StatRef {
    refStat: ActionId
    baseLine: number
    sourceUnit: string
    targetUnit: string
    lowerLimit: number
    Upperlimit: number
}

export type BuffValue = string | StatRef

export type BuffWrite = 'add' | 'override'

export type BuffScope = 'panel'

export interface BuffEffect {
    applyTo: ActionId
    value: BuffValue
    write?: BuffWrite
    only?: BuffScope
    element?: ElementEnum
}

export type BuffRole = 'stat'

export interface Buff {
    id: BuffId
    effects: readonly BuffEffect[]
    role?: BuffRole
}

export interface Damage {
    value: string
    base?: PanelDim

    hits?: number
    activated_buffs: readonly BuffId[]
    element: ElementEnum
    formula: CalculationFormula
}

export interface DamageEntry {
    source: string
    damages: Damage[]
}

export interface GeneralTable {
    global_buffs: readonly BuffId[]
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
