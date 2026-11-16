import { FORMULAS, type FormulaCtx, evaluateHandle } from '$coconut/formulas'
import type { CharacterPanel, TargetPanel } from '$coconut/panel'
import type { CalculationFormula } from '$coconut/general-table'
import type { MultiplierZone } from '$coconut/result'

export interface FormulaEvaluationInput {
    formula: CalculationFormula
    baseValue: number
    element: string
    panel: CharacterPanel
    target: TargetPanel
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
    damageTypes: []
})

export const evaluateFormula = (input: FormulaEvaluationInput): FormulaEvaluation => {
    const def = FORMULAS[input.formula]
    const ctx = formulaCtxOf(input)
    const multipliers: MultiplierZone[] = []
    let product = 1
    let productNoCrit = 1
    for (const handle of def.chain) {
        const value = evaluateHandle(handle, ctx)
        product *= value
        if (handle.id !== 'crit') productNoCrit *= value
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
