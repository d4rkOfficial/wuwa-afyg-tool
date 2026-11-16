import type { CharacterPanel, TargetPanel } from './panel'
import type { ActionId, CalculationFormula } from './general-table'

export interface MultiplierZone {
    id: ActionId
    value: number
}

export interface BuffContribution {
    buffId: string
    applyTo: readonly ActionId[]
    deltaExpected: number
    share: number
}

export interface DamageResult {
    entryIndex: number
    damageIndex: number
    source: string
    element: string
    formula: CalculationFormula
    baseValue: number
    expectedRaw: number
    expected: number
    multipliers: MultiplierZone[]
    panel: CharacterPanel
    target: TargetPanel
    contributions: BuffContribution[]
}

export interface CoreResult {
    damages: DamageResult[]
    total: number
}
