import type { ActionRegistry, PanelDim } from './actions'
import type { CharacterPanel, TargetPanel } from './panel'
import type { ActionId, CalculationFormula, FormulaId } from './general-table'

export interface FormulaCtx {
    panel: CharacterPanel
    target: TargetPanel
    element: string
    damageTypes: string[]

    consts: Readonly<Record<string, number>>
}

export type NumericInput = string | symbol

type Resolved<I extends readonly NumericInput[]> = { readonly [K in I[number]]: number }

type Invokers<U extends readonly FormulaHandle[]> = {
    readonly [H in U[number] as H['id']]: H['inputs'] extends readonly [unknown]
        ? (value: number) => number
        : (args: Record<string, number>) => number
}

export interface FormulaHandle<
    Id extends FormulaId = FormulaId,
    I extends readonly NumericInput[] = readonly NumericInput[]
> {
    readonly id: Id
    readonly inputs: I
    readonly uses: readonly FormulaHandle[]
    readonly compute: (resolved: Record<PropertyKey, unknown>, ctx: FormulaCtx) => number
}

export type MultiplierDef = FormulaHandle

export const defineFormula = <
    Id extends FormulaId,
    I extends readonly NumericInput[],
    U extends readonly FormulaHandle[] = []
>(
    spec: { id: Id; inputs: I; uses?: U },
    compute: (resolved: Resolved<I> & Invokers<U>, ctx: FormulaCtx) => number
): FormulaHandle<Id, I> => ({
    id: spec.id,
    inputs: spec.inputs,
    uses: spec.uses ?? [],
    compute: (resolved, ctx) => compute(resolved as Resolved<I> & Invokers<U>, ctx)
})

export type CritBase = string

export type BaseRecipe =
    | { kind: 'panelStat'; dim?: PanelDim }
    | { kind: 'zone'; id: ActionId; round?: boolean }
    | { kind: 'targetStat'; field: ActionId }
    | { kind: 'fixed' }

export interface FormulaDef {
    id: CalculationFormula
    base: BaseRecipe
    chain: readonly FormulaHandle[]
    critBase: CritBase
}

export interface FormulaRegistry {
    multipliers: ReadonlyMap<ActionId, FormulaHandle>
    multiplierOrder: readonly ActionId[]
    formulas: ReadonlyMap<FormulaId, FormulaDef>
    actions: ActionRegistry
}

export const readTargetField = (registry: FormulaRegistry, key: ActionId, target: TargetPanel): number => {
    const field = registry.actions.map.get(key)?.targetField ?? key
    const kind = registry.actions.targetFieldKinds.get(field)
    if (kind === 'scalar') return target.scalars[field] ?? 0
    if (kind === 'text') return 0
    if (kind === 'map') return 0
    return target.zones[field] ?? 0
}

export const readInput = (registry: FormulaRegistry, name: NumericInput, ctx: FormulaCtx): number => {
    if (typeof name !== 'string') return ctx.panel.zones[name] ?? 0
    if (name.startsWith('target.')) return readTargetField(registry, name.slice('target.'.length), ctx.target)
    if (name.startsWith('const.')) return ctx.consts[name.slice('const.'.length)] ?? 0
    return ctx.panel.zones[name] ?? 0
}

const resolveInputs = (
    registry: FormulaRegistry,
    handle: FormulaHandle,
    ctx: FormulaCtx
): Record<PropertyKey, unknown> => {
    const out: Record<PropertyKey, unknown> = {}
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
    formulas: readonly FormulaDef[]
    actions: ActionRegistry
}): FormulaRegistry => {
    const multiplierList = [...args.multipliers]
    const multiplierMap = new Map(multiplierList.map((multiplier) => [multiplier.id, multiplier]))
    if (multiplierMap.size !== multiplierList.length) throw new Error('[coconut-core] multiplier ids must be unique')
    const order = multiplierList.map((multiplier) => multiplier.id)
    const formulas = new Map(args.formulas.map((def) => [def.id, def] as const))
    if (formulas.size !== args.formulas.length) throw new Error('[coconut-core] formula ids must be unique')
    if (formulas.size === 0) throw new Error('[coconut-core] at least one formula must be registered')
    for (const def of formulas.values()) {
        let last = -1
        for (const handle of def.chain) {
            const at = order.indexOf(handle.id)
            if (at < 0)
                throw new Error(`[coconut-core] formula ${String(def.id)}: unknown multiplier ${String(handle.id)}`)
            if (at <= last)
                throw new Error(
                    `[coconut-core] formula ${String(def.id)}: multiplier order must follow registration order`
                )
            last = at
        }
    }
    return {
        multipliers: multiplierMap,
        multiplierOrder: order,
        formulas,
        actions: args.actions
    }
}

export const formulaOfRegistry = (registry: FormulaRegistry, id: CalculationFormula): FormulaDef => {
    const def = registry.formulas.get(id)
    if (!def) throw new Error(`[coconut-core] unknown formula: ${String(id)}`)
    return def
}
