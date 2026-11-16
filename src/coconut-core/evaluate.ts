import { evaluateHandle, formulaOfRegistry, type FormulaCtx, type FormulaRegistry } from './formulas'
import type { CharacterPanel, TargetPanel } from './panel'
import type { CalculationFormula } from './general-table'
import type { MultiplierZone } from './result'

export interface FormulaEvaluationInput {
    formula: CalculationFormula
    baseValue: number
    element: string
    panel: CharacterPanel
    target: TargetPanel
    consts?: Readonly<Record<string, number>>
    damageTypes?: readonly string[]
}

export interface FormulaEvaluation {
    multipliers: MultiplierZone[]
    product: number
    productNoCrit: number
    canCrit: boolean
    critDmgRatio: number
}

export const formulaCtxOf = (input: FormulaEvaluationInput): FormulaCtx => ({
    panel: input.panel,
    target: input.target,
    element: input.element,
    damageTypes: [...(input.damageTypes ?? [])],
    consts: input.consts ?? {}
})

export const evaluateFormula = (registry: FormulaRegistry, input: FormulaEvaluationInput): FormulaEvaluation => {
    const def = formulaOfRegistry(registry, input.formula)
    const ctx = formulaCtxOf(input)
    const multipliers: MultiplierZone[] = []
    let product = 1
    let productNoCrit = 1
    for (const handle of def.chain) {
        const value = evaluateHandle(registry, handle, ctx)
        product *= value
        if (handle.id !== registry.critMultiplier) productNoCrit *= value
        multipliers.push({ id: handle.id, label: handle.label, value, display: handle.display(value, ctx) })
    }
    return {
        multipliers,
        product,
        productNoCrit,
        canCrit: def.canCrit(input.panel, ctx),
        critDmgRatio: (input.panel.zones.critDmg ?? 0) / 100
    }
}
