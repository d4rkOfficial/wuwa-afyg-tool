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
    for (const handle of def.chain) {
        const value = evaluateHandle(registry, handle, ctx)
        product *= value
        multipliers.push({ id: handle.id, value })
    }
    return { multipliers, product }
}
