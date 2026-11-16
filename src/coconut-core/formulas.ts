import type { ActionRegistry } from './actions'
import type { CharacterPanel, TargetPanel } from './panel'
import type { CalculationFormula } from './general-table'
import type { MultiplierDisplay } from './result'

export interface FormulaCtx {
    panel: CharacterPanel
    target: TargetPanel
    element: string
    damageTypes: string[]

    consts: Readonly<Record<string, number>>
}

export type NumericInput = string

type Resolved<I extends readonly NumericInput[]> = { readonly [K in I[number]]: number }

type Invokers<U extends readonly FormulaHandle[]> = {
    readonly [H in U[number] as H['id']]: H['inputs'] extends readonly [unknown]
        ? (value: number) => number
        : (args: Record<string, number>) => number
}

export interface FormulaHandle<
    Id extends string = string,
    I extends readonly NumericInput[] = readonly NumericInput[]
> {
    readonly id: Id
    readonly label: string
    readonly inputs: I
    readonly uses: readonly FormulaHandle[]
    readonly version: number
    readonly compute: (resolved: Record<string, unknown>, ctx: FormulaCtx) => number
    readonly display: (value: number, ctx: FormulaCtx) => MultiplierDisplay
}

export type MultiplierDef = FormulaHandle

export const defineFormula = <
    Id extends string,
    I extends readonly NumericInput[],
    U extends readonly FormulaHandle[] = []
>(
    spec: {
        id: Id
        label: string
        inputs: I
        uses?: U
        version: number
        display: (value: number, ctx: FormulaCtx) => MultiplierDisplay
    },
    compute: (resolved: Resolved<I> & Invokers<U>, ctx: FormulaCtx) => number
): FormulaHandle<Id, I> => ({
    id: spec.id,
    label: spec.label,
    inputs: spec.inputs,
    uses: spec.uses ?? [],
    version: spec.version,
    display: spec.display,
    compute: (resolved, ctx) => compute(resolved as Resolved<I> & Invokers<U>, ctx)
})

export type CritBase = string

export type BaseRecipe =
    { kind: 'panelStat'; dim: 'auto' | 'effectCoeff' } | { kind: 'targetStat'; field: string } | { kind: 'fixed' }

export interface FormulaDef {
    id: CalculationFormula
    label: string
    base: BaseRecipe
    ratioBoosts: readonly string[]
    chain: readonly FormulaHandle[]
    critBase: CritBase
    canCrit: (panel: CharacterPanel, ctx: FormulaCtx) => boolean
    critFallback: 'expected'
    reportsDamageTypes: boolean
}

export interface FormulaRegistry {
    multipliers: ReadonlyMap<string, FormulaHandle>
    multiplierOrder: readonly string[]
    formulas: ReadonlyMap<string, FormulaDef>

    critMultiplier: string

    critActions: readonly string[]
    actions: ActionRegistry
}

export const readInput = (registry: FormulaRegistry, name: NumericInput, ctx: FormulaCtx): number => {
    if (name.startsWith('target.')) {
        const key = name.slice('target.'.length)
        if (key === 'defense') return ctx.target.defense
        const scalar = registry.actions.targetScalars[key]
        if (scalar) return scalar(ctx.target)
        return ctx.target.zones[key] ?? 0
    }
    if (name.startsWith('const.')) return ctx.consts[name.slice('const.'.length)] ?? 0
    return ctx.panel.zones[name] ?? 0
}

const resolveInputs = (registry: FormulaRegistry, handle: FormulaHandle, ctx: FormulaCtx): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const name of handle.inputs) out[name] = readInput(registry, name, ctx)
    for (const sub of handle.uses) {
        out[sub.id] =
            sub.inputs.length === 1
                ? (value: number) => sub.compute({ [sub.inputs[0]!]: value }, ctx)
                : (args: Record<string, number>) => sub.compute(args, ctx)
    }
    return out
}

export const evaluateHandle = (registry: FormulaRegistry, handle: FormulaHandle, ctx: FormulaCtx): number =>
    handle.compute(resolveInputs(registry, handle, ctx), ctx)

export const createFormulaRegistry = (args: {
    multipliers: readonly FormulaHandle[]
    formulas: Readonly<Record<string, FormulaDef>>
    critMultiplier: string
    critActions: readonly string[]
    actions: ActionRegistry
}): FormulaRegistry => {
    const multiplierList = [...args.multipliers]
    const multiplierMap = new Map(multiplierList.map((multiplier) => [multiplier.id, multiplier]))
    if (multiplierMap.size !== multiplierList.length) throw new Error('[coconut-core] multiplier ids must be unique')
    if (!multiplierMap.has(args.critMultiplier)) {
        throw new Error(`[coconut-core] unknown crit multiplier: ${args.critMultiplier}`)
    }
    const order = multiplierList.map((multiplier) => multiplier.id)
    const formulas = new Map(Object.entries(args.formulas))
    if (formulas.size === 0) throw new Error('[coconut-core] at least one formula must be registered')
    for (const def of formulas.values()) {
        let last = -1
        for (const handle of def.chain) {
            const at = order.indexOf(handle.id)
            if (at < 0) throw new Error(`[coconut-core] formula ${def.id}: unknown multiplier ${handle.id}`)
            if (at <= last)
                throw new Error(`[coconut-core] formula ${def.id}: multiplier order must follow registration order`)
            last = at
        }
    }
    return {
        multipliers: multiplierMap,
        multiplierOrder: order,
        formulas,
        critMultiplier: args.critMultiplier,
        critActions: args.critActions,
        actions: args.actions
    }
}

export const formulaOfRegistry = (registry: FormulaRegistry, id: CalculationFormula): FormulaDef => {
    const def = registry.formulas.get(id)
    if (!def) throw new Error(`[coconut-core] unknown formula: ${id}`)
    return def
}

export const formulaAcceptsRef = (registry: FormulaRegistry, critBase: CritBase, actionId: string): boolean =>
    !(critBase === 'coefficient' && registry.critActions.includes(actionId))

export const computeDefMulti = (defense: number, defPen: number, defDown: number, charLevel = 90): number => {
    const defEff = Math.max(defense * (1 - defDown / 100) * (1 - defPen / 100), 0)
    const charTerm = 800 + 8 * charLevel
    return Math.max(charTerm / (defEff + charTerm), 0.01)
}

export const computeResMulti = (baseResist: number, resPen: number, resDown: number): number => {
    const effResist = baseResist - resPen / 100 - resDown / 100
    if (effResist < 0) return 1 + Math.abs(effResist) / 2
    if (effResist < 0.8) return 1 - effResist
    return 1 / ((effResist + 0.2) * 5)
}
