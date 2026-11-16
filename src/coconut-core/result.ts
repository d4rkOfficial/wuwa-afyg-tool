import type { CharacterPanel, TargetPanel } from '$coconut/panel'
import type { CalculationFormula } from '$coconut/general-table'

export type MultiplierDisplay =
    | { mode: 'delta'; pct: number; digits: number }
    | { mode: 'factor'; digits: number }
    | { mode: 'deltaWhenActive'; pct: number; active: boolean; activeDigits: number; idleDigits: number }

export interface MultiplierZone {
    id: string
    label: string
    value: number
    display: MultiplierDisplay
}

export interface BuffContribution {
    buffId: string
    applyTo: string
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
    nonCrit: number
    crit: number
    expected: number
    multipliers: MultiplierZone[]
    panel: CharacterPanel
    target: TargetPanel
    contributions: BuffContribution[]
}

export interface CoreResult {
    damages: DamageResult[]
    total: {
        nonCrit: number
        crit: number
        expected: number
    }
}
