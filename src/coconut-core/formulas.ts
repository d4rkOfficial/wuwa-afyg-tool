import { TARGET_SCALARS } from '$coconut/actions'
import type { CharacterPanel, TargetPanel } from '$coconut/panel'
import type { CalculationFormula } from '$coconut/general-table'
import type { MultiplierDisplay } from '$coconut/result'

export interface FormulaCtx {
    panel: CharacterPanel
    target: TargetPanel
    element: string
    damageTypes: string[]
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

export const DEFAULT_CHAR_LEVEL = 90

export const readInput = (name: Readonly<NumericInput>, ctx: FormulaCtx): number => {
    if (name.startsWith('target.')) {
        const key = name.slice('target.'.length)
        if (key === 'defense') return ctx.target.defense
        const scalar = TARGET_SCALARS[key]
        if (scalar) return scalar(ctx.target)
        return ctx.target.zones[key] ?? 0
    }
    if (name === 'const.charLevel') return ctx.panel.zones.charLevel ?? DEFAULT_CHAR_LEVEL
    return ctx.panel.zones[name] ?? 0
}

const resolveInputs = (handle: FormulaHandle, ctx: FormulaCtx): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const name of handle.inputs) out[name] = readInput(name, ctx)
    for (const sub of handle.uses) {
        out[sub.id] =
            sub.inputs.length === 1
                ? (value: number) => sub.compute({ [sub.inputs[0]!]: value }, ctx)
                : (args: Record<string, number>) => sub.compute(args, ctx)
    }
    return out
}

export const evaluateHandle = (handle: FormulaHandle, ctx: FormulaCtx): number =>
    handle.compute(resolveInputs(handle, ctx), ctx)

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

export const PANEL_BASE_DEFAULT = '攻击'

export const FORMULAS_DEFAULT_COEFF = 716.2

export const PANEL_BASE_TYPES: Record<string, { dim: 'atk' | 'hp' | 'def'; unit: string }> = {
    攻击: { dim: 'atk', unit: '攻击' },
    生命: { dim: 'hp', unit: '生命' },
    防御: { dim: 'def', unit: '防御' },
    偏谐系数: { dim: 'atk', unit: '偏谐系数' }
}

const pctPlusOne = defineFormula(
    {
        id: 'pctPlusOne',
        label: '百分比 → 乘子',
        inputs: ['v'] as const,
        version: 1,
        display: (value) => ({ mode: 'delta', pct: (value - 1) * 100, digits: 1 })
    },
    ({ v }) => 1 + v / 100
)

export const deepenMultiplier = defineFormula(
    {
        id: 'deepen',
        label: '加深区',
        inputs: ['deepenDmg'] as const,
        uses: [pctPlusOne] as const,
        version: 1,
        display: (value) => ({ mode: 'delta', pct: (value - 1) * 100, digits: 1 })
    },
    (r) => r.pctPlusOne(r.deepenDmg)
)

export const bonusMultiplier = defineFormula(
    {
        id: 'bonus',
        label: '增伤区',
        inputs: ['bonusDmg'] as const,
        version: 1,
        display: (value) => ({ mode: 'delta', pct: (value - 1) * 100, digits: 1 })
    },
    ({ bonusDmg }) => 1 + bonusDmg / 100
)

export const vulnMultiplier = defineFormula(
    {
        id: 'vuln',
        label: '易伤区',
        inputs: ['dmgTakenInc'] as const,
        uses: [pctPlusOne] as const,
        version: 1,
        display: (value) => ({ mode: 'delta', pct: (value - 1) * 100, digits: 1 })
    },
    (r) => r.pctPlusOne(r.dmgTakenInc)
)

export const resistMultiplier = defineFormula(
    {
        id: 'resist',
        label: '抗性区',
        inputs: ['resPen', 'resDown'] as const,
        version: 1,
        display: () => ({ mode: 'factor', digits: 4 })
    },
    ({ resPen, resDown }, ctx) => computeResMulti((ctx.target.resistances[ctx.element] ?? 0) / 100, resPen, resDown)
)

export const defenseMultiplier = defineFormula(
    {
        id: 'defense',
        label: '防御区',
        inputs: ['defPen', 'defDown', 'target.defense'] as const,
        version: 1,
        display: () => ({ mode: 'factor', digits: 4 })
    },
    (r, ctx) => computeDefMulti(r['target.defense'], r.defPen, r.defDown, ctx.panel.zones.charLevel ?? 90)
)

export const dmgRedMultiplier = defineFormula(
    {
        id: 'dmgRed',
        label: '免伤区',
        inputs: ['dmgRedPen', 'target.enemyDmgReduction'] as const,
        version: 1,
        display: () => ({ mode: 'factor', digits: 4 })
    },
    (r) => 1 - r['target.enemyDmgReduction'] / 100 - r.dmgRedPen / 100
)

export const tuneStrainMultiplier = defineFormula(
    {
        id: 'tuneStrain',
        label: '集谐区',
        inputs: ['tuneBreakBoost', 'target.tuneStrainLayer'] as const,
        version: 1,
        display: (value, ctx) => ({
            mode: 'deltaWhenActive',
            pct: (value - 1) * 100,
            active: (ctx.target.zones.tuneStrainLayer ?? 0) > 0,
            activeDigits: 1,
            idleDigits: 4
        })
    },
    ({ tuneBreakBoost, 'target.tuneStrainLayer': layer }) => 1 + 0.0012 * tuneBreakBoost * layer
)

export const tuneBreakMultiplier = defineFormula(
    {
        id: 'tuneBreak',
        label: '谐度区',
        inputs: ['tuneBreakBoost'] as const,
        uses: [pctPlusOne] as const,
        version: 1,
        display: (value) => ({ mode: 'delta', pct: (value - 1) * 100, digits: 1 })
    },
    (r) => r.pctPlusOne(r.tuneBreakBoost)
)

export const unisonMultiplier = defineFormula(
    {
        id: 'unison',
        label: '同奏区',
        inputs: ['unisonBoonLayer'] as const,
        version: 1,
        display: (value, ctx) => ({
            mode: 'deltaWhenActive',
            pct: (value - 1) * 100,
            active: ctx.panel.zones.unisonBoonLayer > 0,
            activeDigits: 1,
            idleDigits: 4
        })
    },
    ({ unisonBoonLayer }) => 1 + 0.03 * unisonBoonLayer
)

export const finalMultiplier = defineFormula(
    {
        id: 'final',
        label: '终伤区',
        inputs: ['finalDmg'] as const,
        uses: [pctPlusOne] as const,
        version: 1,
        display: (value) => ({ mode: 'delta', pct: (value - 1) * 100, digits: 1 })
    },
    (r) => r.pctPlusOne(r.finalDmg)
)

export const specialMultiplier = defineFormula(
    {
        id: 'special',
        label: '特殊区',
        inputs: ['specialFinal1', 'specialFinal2'] as const,
        version: 1,
        display: () => ({ mode: 'factor', digits: 4 })
    },
    ({ specialFinal1, specialFinal2 }) => (specialFinal1 !== 0 ? 1 + specialFinal1 / 100 : 1) * specialFinal2
)

export const critMultiplier = defineFormula(
    {
        id: 'crit',
        label: '暴击区',
        inputs: ['critRate', 'critDmg'] as const,
        version: 1,
        display: (value) => ({
            mode: 'deltaWhenActive',
            pct: (value - 1) * 100,
            active: value !== 1,
            activeDigits: 1,
            idleDigits: 4
        })
    },
    ({ critRate, critDmg }) => 1 + (Math.min(critRate, 100) / 100) * (critDmg / 100 - 1)
)

export const MULTIPLIERS = {
    deepen: deepenMultiplier,
    bonus: bonusMultiplier,
    vuln: vulnMultiplier,
    resist: resistMultiplier,
    defense: defenseMultiplier,
    dmgRed: dmgRedMultiplier,
    tuneStrain: tuneStrainMultiplier,
    tuneBreak: tuneBreakMultiplier,
    unison: unisonMultiplier,
    final: finalMultiplier,
    special: specialMultiplier,
    crit: critMultiplier
} as const

export type MultiplierId = keyof typeof MULTIPLIERS

export const MULTIPLIER_ORDER: readonly MultiplierId[] = [
    'deepen',
    'bonus',
    'vuln',
    'resist',
    'defense',
    'dmgRed',
    'tuneStrain',
    'tuneBreak',
    'unison',
    'final',
    'special',
    'crit'
]

export type CritBase = 'panel' | 'coefficient'

export const CRIT_ACTION_IDS: readonly string[] = MULTIPLIERS.crit.inputs

export type CritActionId = (typeof MULTIPLIERS)['crit']['inputs'][number]

export const formulaAcceptsRef = (critBase: CritBase, actionId: string): boolean =>
    !(critBase === 'coefficient' && CRIT_ACTION_IDS.includes(actionId))

export type CalculationFormulaId = CalculationFormula

export type BaseRecipe =
    | { kind: 'panelStat'; dim: 'auto' | 'effectCoeff' }
    | { kind: 'targetStat'; field: 'coefficient' }
    | { kind: 'fixed' }

export interface FormulaDef {
    id: CalculationFormulaId
    label: string
    base: BaseRecipe
    ratioBoosts: readonly string[]
    chain: readonly FormulaHandle[]
    critBase: 'panel' | 'coefficient'
    canCrit: (panel: CharacterPanel, ctx: FormulaCtx) => boolean
    critFallback: 'expected'
    reportsDamageTypes: boolean
}

const multiplierChain = (ids: readonly MultiplierId[]): readonly FormulaHandle[] => ids.map((id) => MULTIPLIERS[id])

export const FORMULAS: Record<CalculationFormulaId, FormulaDef> = {
    direct: {
        id: 'direct',
        label: '直伤',
        base: { kind: 'panelStat', dim: 'auto' },
        ratioBoosts: ['extraRatio'],
        chain: multiplierChain([
            'deepen',
            'bonus',
            'vuln',
            'resist',
            'defense',
            'dmgRed',
            'tuneStrain',
            'unison',
            'final',
            'special',
            'crit'
        ]),
        critBase: 'panel',
        canCrit: () => true,
        critFallback: 'expected',
        reportsDamageTypes: true
    },
    tune: {
        id: 'tune',
        label: '处决 / 偏谐响应',
        base: { kind: 'targetStat', field: 'coefficient' },
        ratioBoosts: ['extraRatio'],
        chain: multiplierChain([
            'deepen',
            'vuln',
            'resist',
            'defense',
            'dmgRed',
            'tuneStrain',
            'tuneBreak',
            'unison',
            'final',
            'special',
            'crit'
        ]),
        critBase: 'coefficient',
        canCrit: (panel) => panel.zones.critRate > 0,
        critFallback: 'expected',
        reportsDamageTypes: true
    },
    effect: {
        id: 'effect',
        label: '效应',
        base: { kind: 'panelStat', dim: 'effectCoeff' },
        ratioBoosts: ['extraRatio'],
        chain: multiplierChain([
            'deepen',
            'vuln',
            'resist',
            'defense',
            'dmgRed',
            'tuneStrain',
            'tuneBreak',
            'unison',
            'final',
            'special',
            'crit'
        ]),
        critBase: 'coefficient',
        canCrit: (panel) => panel.zones.critRate > 0,
        critFallback: 'expected',
        reportsDamageTypes: true
    },
    fixed: {
        id: 'fixed',
        label: '固定值',
        base: { kind: 'fixed' },
        ratioBoosts: [],
        chain: multiplierChain([]),
        critBase: 'panel',
        canCrit: () => false,
        critFallback: 'expected',
        reportsDamageTypes: true
    }
}

export const formulaOf = (entry: { formula: CalculationFormula; ratioUnit: string }): CalculationFormulaId =>
    entry.formula === 'direct' && entry.ratioUnit === 'fixed' ? 'fixed' : entry.formula

export const isEffectEntry = (entry: { formula: CalculationFormula }): boolean => entry.formula === 'effect'

export const usesCoefficientFormula = (entry: { formula: CalculationFormula; ratioUnit: string }): boolean =>
    FORMULAS[formulaOf(entry)].critBase === 'coefficient'

export const formulaActionClosure = (id: CalculationFormulaId): Set<string> => {
    const out = new Set<string>()
    for (const handle of FORMULAS[id].chain) {
        for (const input of handle.inputs) {
            if (input.startsWith('enemy.') || input.startsWith('const.')) continue
            out.add(input.replace(/^target\./, ''))
        }
    }
    for (const boost of FORMULAS[id].ratioBoosts) out.add(boost)
    const base = FORMULAS[id].base
    if (base.kind === 'panelStat' && base.dim !== 'auto') out.add(base.dim)
    if (base.kind === 'targetStat') out.add('enemyCoeff')
    return out
}

const assertChainOrder = (): void => {
    for (const def of Object.values(FORMULAS)) {
        let last = -1
        for (const handle of def.chain) {
            const at = MULTIPLIER_ORDER.indexOf(handle.id as MultiplierId)
            if (at < 0) throw new Error(`[formulas] ${def.id}: 未知乘子 ${handle.id}`)
            if (at <= last) throw new Error(`[formulas] ${def.id}: 乘子顺序必须与 MULTIPLIER_ORDER 一致`)
            last = at
        }
    }
}

assertChainOrder()
