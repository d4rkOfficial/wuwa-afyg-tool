/**
 * @desc **注册层**：计算核需要的全部游戏数据与数学定义都在这里。
 *
 * 内核只认「形状」，不认具体作用 / 乘子 / 公式；这份文件是唯一的注册来源。
 * 新增一个作用、换一套公式、改倍率串协议，都只改这里（不动内核）。
 *
 * 这里**只放内核会读的字段**：展示文案、分组、展示形态、调用方能力标记全部在 `display-meta.ts`。
 */
import {
    createActionRegistry,
    refWrittenBy as refWrittenByOf,
    writtenByOf as writtenByOfRegistry,
    type ActionCombine,
    type ActionRegistry,
    type ActionSide,
    type BuffActionDef,
    type PanelDim,
    type RefSourceDef
} from '$coconut/actions'
import { CoconutCore, type ActionId, type CharacterPanel, type CoconutCoreConfig, type ConstantDef } from '$coconut'
import {
    createFormulaRegistry,
    defineFormula,
    type CritBase,
    type FormulaCtx,
    type FormulaDef,
    type FormulaHandle,
    type MultiplierDef
} from '$coconut/formulas'
import {
    applyZone as applyZoneOf,
    emptyPanel as emptyPanelOf,
    emptyTargetPanel as emptyTargetPanelOf,
    recomputeTotals as recomputeTotalsOf,
    zoneOf as zoneOfOf
} from '$coconut/panel'
import { appPanelOf, clonePanel, type AppPanel } from './panel-ops'
import {
    evaluateFormula as evaluateFormulaOf,
    type FormulaEvaluation,
    type FormulaEvaluationInput
} from '$coconut/evaluate'
import { formulaMetaOf } from './display-meta'

// ─────────────────────────── 作用表（游戏数据） ───────────────────────────

const ACTION_TABLE = [
    {
        id: 'atkBase',
        side: 'character',
        combine: 'sum',
        panel: { base: 'atk' },
        overridable: true,
        init: 0
    },
    {
        id: 'hpBase',
        side: 'character',
        combine: 'sum',
        panel: { base: 'hp' },
        overridable: true,
        init: 0
    },
    {
        id: 'defBase',
        side: 'character',
        combine: 'sum',
        panel: { base: 'def' },
        overridable: true,
        init: 0
    },
    {
        id: 'charLevel',
        side: 'character',
        combine: 'sum',
        overridable: true,
        init: 0
    },
    {
        id: 'atkFlat',
        side: 'character',
        combine: 'sum',
        panel: { flat: 'atk', total: 'atk' },
        overridable: true,
        init: 0
    },
    {
        id: 'hpFlat',
        side: 'character',
        combine: 'sum',
        panel: { flat: 'hp', total: 'hp' },
        overridable: true,
        init: 0
    },
    {
        id: 'defFlat',
        side: 'character',
        combine: 'sum',
        panel: { flat: 'def', total: 'def' },
        overridable: true,
        init: 0
    },
    {
        id: 'tuneBreakBoost',
        side: 'character',
        combine: 'sum',
        overridable: true,
        init: 0
    },
    {
        id: 'atkPct',
        side: 'character',
        combine: 'sum',
        panel: { pct: 'atk' },
        overridable: false,
        init: 0
    },
    {
        id: 'hpPct',
        side: 'character',
        combine: 'sum',
        panel: { pct: 'hp' },
        overridable: false,
        init: 0
    },
    {
        id: 'defPct',
        side: 'character',
        combine: 'sum',
        panel: { pct: 'def' },
        overridable: false,
        init: 0
    },
    {
        id: 'recharge',
        side: 'character',
        combine: 'sum',
        overridable: true,
        init: 100
    },
    {
        id: 'offTuneBuildupRate',
        side: 'character',
        combine: 'sum',
        overridable: true,
        init: 100
    },
    {
        id: 'critRate',
        side: 'character',
        combine: 'sum',
        overridable: true,
        init: 5,
        initCoeff: 0
    },
    {
        id: 'critDmg',
        side: 'character',
        combine: 'sum',
        overridable: true,
        init: 150,
        initCoeff: 100
    },
    {
        id: 'bonusDmg',
        side: 'character',
        combine: 'sum',
        overridable: true,
        init: 0
    },
    {
        id: 'deepenDmg',
        side: 'character',
        combine: 'sum',
        overridable: true,
        init: 0
    },
    {
        id: 'dmgTakenInc',
        side: 'character',
        combine: 'sum',
        overridable: true,
        init: 0
    },
    {
        id: 'finalDmg',
        side: 'character',
        combine: 'sum',
        overridable: true,
        init: 0
    },
    {
        id: 'specialFinal1',
        side: 'character',
        combine: 'sum',
        overridable: true,
        init: 0
    },
    {
        id: 'specialFinal2',
        side: 'character',
        combine: 'multiply',
        overridable: true,
        init: 1
    },
    {
        id: 'extraRatio',
        side: 'character',
        combine: 'sum',
        overridable: false,
        init: 0
    },
    {
        id: 'defDown',
        side: 'character',
        combine: 'sum',
        overridable: true,
        init: 0
    },
    {
        id: 'resDown',
        side: 'character',
        combine: 'sum',
        overridable: true,
        init: 0
    },
    {
        id: 'resPen',
        side: 'character',
        combine: 'sum',
        overridable: true,
        init: 0
    },
    {
        id: 'defPen',
        side: 'character',
        combine: 'sum',
        overridable: true,
        init: 0
    },
    {
        id: 'dmgRedPen',
        side: 'character',
        combine: 'sum',
        overridable: true,
        init: 0
    },
    {
        id: 'enemyDmgReduction',
        side: 'target',
        combine: 'sum',
        overridable: true,
        init: 0,
        targetField: 'dmgReduction'
    },
    {
        id: 'tuneStrainLayer',
        side: 'target',
        combine: 'sum',
        overridable: true,
        init: 0
    },
    {
        id: 'unisonBoonLayer',
        side: 'character',
        combine: 'sum',
        overridable: true,
        init: 0
    },
    {
        id: 'effectCoeff',
        side: 'character',
        combine: 'sum',
        overridable: true,
        init: 0
    },
    {
        id: 'enemyCoeff',
        side: 'target',
        combine: 'sum',
        overridable: true,
        init: 0,
        targetField: 'coefficient'
    },
    {
        id: 'enemyDefense',
        side: 'target',
        combine: 'sum',
        overridable: true,
        init: 0,
        targetField: 'defense'
    },
    {
        id: 'enemyType',
        side: 'target',
        combine: 'sum',
        overridable: true,
        init: 0,
        targetField: 'type'
    },
    {
        id: 'resistance',
        side: 'target',
        combine: 'sum',
        overridable: true,
        init: 0,
        targetField: 'resistance'
    }
] as const satisfies readonly BuffActionDef[]

export const BUFF_ACTIONS: readonly BuffActionDef[] = ACTION_TABLE

/** @desc 「效应系数」作用 id（效应条目的基值来自这一维面板属性） */
export const EFFECT_COEFF_ACTION = 'effectCoeff'

/** @desc 「角色等级」作用 id（内核以 `const.charLevel` 读取，防御区用） */
export const CHAR_LEVEL_ACTION = 'charLevel'

/** @desc 「谐度破坏增幅」作用 id（角色自带属性，编译成 buff 写入面板） */
export const TUNE_BREAK_BOOST_ACTION = 'tuneBreakBoost'

export type CalcActionId = (typeof ACTION_TABLE)[number]['id']

/** @desc 面板维度与取整口径（内核不预设有哪些维） */
export const PANEL_CONFIG = {
    dims: ['atk', 'hp', 'def'],
    rounding: 'round',
    aggregate: ({ base, flat, pct }: { base: number; flat: number; pct: number }) =>
        base + Math.round(flat + (base * pct) / 100)
} as const

/** @desc 目标侧字段的存储形态（内核按 kind 分派，不认字段名） */
export const TARGET_FIELDS = [
    { field: 'defense', kind: 'scalar' },
    { field: 'dmgReduction', kind: 'scalar' },
    { field: 'coefficient', kind: 'scalar' },
    { field: 'type', kind: 'text' },
    { field: 'resistance', kind: 'map' }
] as const

/** @desc 「额外倍率」作用的 id（内核只认这一个注入点，名字由这里给） */
export const RATIO_ZONE = 'extraRatio'

/** @desc 公式里 `const.<id>` 的来源（内核不预设有哪些常量） */
export const CONSTANTS: readonly ConstantDef[] = [
    { id: 'charLevel', get: (panel) => panel.zones[CHAR_LEVEL_ACTION] || DEFAULT_CHAR_LEVEL }
]

/** @desc 可被当作引用来源读取的作用（引用来源的展示名在 `display-meta.ts`） */
const REF_ACTIONS: readonly CalcActionId[] = [
    'tuneBreakBoost',
    'recharge',
    'offTuneBuildupRate',
    'critRate',
    'critDmg',
    'enemyDmgReduction',
    'tuneStrainLayer',
    'unisonBoonLayer',
    'effectCoeff',
    'enemyCoeff'
]

const REF_ACTION_SET = new Set<ActionId>(REF_ACTIONS)

/** @desc 引用来源：白值 / 当前面板 / 目标侧标量（内核只读 `id` 与 `get`） */
export const REF_SOURCES: readonly RefSourceDef[] = [
    { id: 'baseAtk', get: (p) => p.base.atk, writes: 'atk' },
    { id: 'totalAtk', get: (p) => p.total.atk, writes: 'atk' },
    { id: 'baseHp', get: (p) => p.base.hp, writes: 'hp' },
    { id: 'totalHp', get: (p) => p.total.hp, writes: 'hp' },
    { id: 'baseDef', get: (p) => p.base.def, writes: 'def' },
    { id: 'totalDef', get: (p) => p.total.def, writes: 'def' },
    ...BUFF_ACTIONS.filter((a) => REF_ACTION_SET.has(a.id) && a.targetField === undefined).map((a): RefSourceDef => ({
        id: a.id,
        get: (p, t) => (a.side === 'target' ? (t.zones[a.id] ?? 0) : (p.zones[a.id] ?? 0))
    })),
    ...BUFF_ACTIONS.filter((a) => a.targetField !== undefined).map((a): RefSourceDef => {
        const field = a.targetField!
        const kind = TARGET_FIELDS.find((entry) => entry.field === field)?.kind ?? 'scalar'
        return {
            id: a.id,
            get: (_p, t) =>
                kind === 'scalar' ? (t.scalars[field] ?? 0) : kind === 'map' ? 0 : Number(t.text[field] ?? 0) || 0
        }
    })
]

export const REF_SOURCE_MAP: ReadonlyMap<ActionId, RefSourceDef> = new Map(REF_SOURCES.map((s) => [s.id, s]))

const refWrittenByMap = (refId: ActionId): ActionId[] => {
    const dimOf: Record<string, PanelDim> = {
        baseAtk: 'atk',
        totalAtk: 'atk',
        baseHp: 'hp',
        totalHp: 'hp',
        baseDef: 'def',
        totalDef: 'def'
    }
    const dim = typeof refId === 'string' ? dimOf[refId] : undefined
    if (dim)
        return BUFF_ACTIONS.filter((a) => a.panel?.flat === dim || a.panel?.pct === dim || a.panel?.total === dim).map(
            (a) => a.id
        )
    return REF_SOURCE_MAP.has(refId) ? [refId] : []
}

// ─────────────────────────── 乘子与公式（游戏数学） ───────────────────────────

export const DEFAULT_CHAR_LEVEL = 90

export const PANEL_BASE_DEFAULT = '攻击'

export const PANEL_BASE_TYPES: Record<string, { dim: PanelDim; unit: string }> = {
    攻击: { dim: 'atk', unit: '攻击' },
    生命: { dim: 'hp', unit: '生命' },
    防御: { dim: 'def', unit: '防御' },
    偏谐系数: { dim: 'atk', unit: '偏谐系数' }
}

/** @desc 防御区：防御减伤公式（注册层自己的数学，内核不认识它） */
const computeDefMulti = (defense: number, defPen: number, defDown: number, charLevel: number): number => {
    const defEff = Math.max(defense * (1 - defDown / 100) * (1 - defPen / 100), 0)
    const charTerm = 800 + 8 * charLevel
    return Math.max(charTerm / (defEff + charTerm), 0.01)
}

/** @desc 抗性区：分段抗性公式（同上） */
const computeResMulti = (baseResist: number, resPen: number, resDown: number): number => {
    const effResist = baseResist - resPen / 100 - resDown / 100
    if (effResist < 0) return 1 + Math.abs(effResist) / 2
    if (effResist < 0.8) return 1 - effResist
    return 1 / ((effResist + 0.2) * 5)
}

const pctPlusOne = defineFormula(
    {
        id: 'pctPlusOne',
        inputs: ['v'] as const
    },
    ({ v }) => 1 + v / 100
)

const deepenMultiplier = defineFormula(
    {
        id: 'deepen',
        inputs: ['deepenDmg'] as const,
        uses: [pctPlusOne] as const
    },
    (r) => r.pctPlusOne(r.deepenDmg)
)

const bonusMultiplier = defineFormula(
    {
        id: 'bonus',
        inputs: ['bonusDmg'] as const
    },
    ({ bonusDmg }) => 1 + bonusDmg / 100
)

const vulnMultiplier = defineFormula(
    {
        id: 'vuln',
        inputs: ['dmgTakenInc'] as const,
        uses: [pctPlusOne] as const
    },
    (r) => r.pctPlusOne(r.dmgTakenInc)
)

const resistMultiplier = defineFormula(
    {
        id: 'resist',
        inputs: ['resPen', 'resDown'] as const
    },
    ({ resPen, resDown }, ctx) =>
        computeResMulti((ctx.target.maps.resistance?.[ctx.element] ?? 0) / 100, resPen, resDown)
)

const defenseMultiplier = defineFormula(
    {
        id: 'defense',
        inputs: ['defPen', 'defDown', 'target.defense'] as const
    },
    (r, ctx) => computeDefMulti(r['target.defense'], r.defPen, r.defDown, ctx.consts.charLevel ?? DEFAULT_CHAR_LEVEL)
)

const dmgRedMultiplier = defineFormula(
    {
        id: 'dmgRed',
        inputs: ['dmgRedPen', 'target.enemyDmgReduction'] as const
    },
    (r) => 1 - r['target.enemyDmgReduction'] / 100 - r.dmgRedPen / 100
)

const tuneStrainMultiplier = defineFormula(
    {
        id: 'tuneStrain',
        inputs: ['tuneBreakBoost', 'target.tuneStrainLayer'] as const
    },
    ({ tuneBreakBoost, 'target.tuneStrainLayer': layer }) => 1 + 0.0012 * tuneBreakBoost * layer
)

const tuneBreakMultiplier = defineFormula(
    {
        id: 'tuneBreak',
        inputs: ['tuneBreakBoost'] as const,
        uses: [pctPlusOne] as const
    },
    (r) => r.pctPlusOne(r.tuneBreakBoost)
)

const unisonMultiplier = defineFormula(
    {
        id: 'unison',
        inputs: ['unisonBoonLayer'] as const
    },
    ({ unisonBoonLayer }) => 1 + 0.03 * unisonBoonLayer
)

const finalMultiplier = defineFormula(
    {
        id: 'final',
        inputs: ['finalDmg'] as const,
        uses: [pctPlusOne] as const
    },
    (r) => r.pctPlusOne(r.finalDmg)
)

const specialMultiplier = defineFormula(
    {
        id: 'special',
        inputs: ['specialFinal1', 'specialFinal2'] as const
    },
    ({ specialFinal1, specialFinal2 }) => (specialFinal1 !== 0 ? 1 + specialFinal1 / 100 : 1) * specialFinal2
)

/**
 * @desc **等效暴击率**：低于 0 视为必不暴，高于 100 视为必暴。
 *
 * 只裁「算成暴击时用的暴击率」，面板原值一律保留（负值与 >100 都要留着，
 * 「暴击超过 100 的部分转成暴击伤害」这类引用读的就是原值）。
 */
export const effectiveCritRate = (critRate: number): number => Math.min(Math.max(critRate, 0), 100)

const critMultiplier = defineFormula(
    {
        id: 'crit',
        inputs: ['critRate', 'critDmg'] as const
    },
    ({ critRate, critDmg }) => 1 + (effectiveCritRate(critRate) / 100) * (critDmg / 100 - 1)
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

const MULTIPLIER_LIST: readonly FormulaHandle[] = MULTIPLIER_ORDER.map((id) => MULTIPLIERS[id])

/** @desc 暴击乘子 id（「不暴击」链路要排除它） */
export const CRIT_MULTIPLIER_ID = 'crit'

export const CRIT_ACTION_IDS: readonly ActionId[] = MULTIPLIERS.crit.inputs

const multiplierChain = (ids: readonly MultiplierId[]): readonly FormulaHandle[] => ids.map((id) => MULTIPLIERS[id])

export type FormulaKey = 'direct' | 'tune' | 'effect' | 'fixed'

export const FORMULAS: Record<string, FormulaDef> = {
    direct: {
        id: 'direct',
        base: { kind: 'panelStat' },
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
        critBase: 'panel'
    },
    tune: {
        id: 'tune',
        base: { kind: 'targetStat', field: 'coefficient' },
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
        critBase: 'coefficient'
    },
    effect: {
        id: 'effect',
        base: { kind: 'zone', id: EFFECT_COEFF_ACTION, round: true },
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
        critBase: 'coefficient'
    },
    fixed: {
        id: 'fixed',
        base: { kind: 'fixed' },
        chain: multiplierChain([]),
        critBase: 'panel'
    }
}

/** @desc 公式定义列表（内核按数组接收，`id` 可为 symbol） */
export const FORMULA_LIST: readonly FormulaDef[] = Object.values(FORMULAS)

// ─────────────────────────── 注册表实例（模块级唯一） ───────────────────────────

export const buildCoconutCoreConfig = (): CoconutCoreConfig => ({
    actions: BUFF_ACTIONS,
    refSources: REF_SOURCES,
    multipliers: MULTIPLIER_LIST,
    formulas: FORMULA_LIST,
    panel: PANEL_CONFIG,
    targetFields: TARGET_FIELDS,
    constants: CONSTANTS,
    ratioZone: RATIO_ZONE
})

const ACTIONS: ActionRegistry = createActionRegistry(BUFF_ACTIONS, REF_SOURCES, {
    panel: PANEL_CONFIG,
    targetFields: TARGET_FIELDS
})

const FORMULA_REGISTRY = createFormulaRegistry({
    multipliers: MULTIPLIER_LIST,
    formulas: FORMULA_LIST,
    actions: ACTIONS
})

/** @desc 注册层的内核实例（与 `buildCoconutCoreConfig()` 同源） */
export const createCoconutCore = (): CoconutCore => new CoconutCore().init(buildCoconutCoreConfig())

// ─────────────────────────── 注册层导出的纯辅助 ───────────────────────────

export const ACTION_MAP: ReadonlyMap<ActionId, BuffActionDef> = ACTIONS.map

export const writtenByOf = (dim: PanelDim): ActionId[] => writtenByOfRegistry(ACTIONS, dim)

export const refWrittenBy = (refId: ActionId): ActionId[] =>
    refWrittenByOf(ACTIONS, refId).length > 0 ? refWrittenByOf(ACTIONS, refId) : refWrittenByMap(refId)

export const emptyPanel = (critBase: CritBase = 'panel'): AppPanel => appPanelOf(emptyPanelOf(ACTIONS, critBase))

export const emptyTargetPanel = emptyTargetPanelOf

export const applyZone = (
    panel: CharacterPanel,
    actionId: ActionId,
    value: number,
    write: 'add' | 'override' = 'add'
): void => applyZoneOf(ACTIONS, panel, actionId, value, write)

export const recomputeTotals = (panel: CharacterPanel): void => recomputeTotalsOf(ACTIONS, panel)

export { clonePanel }

export const zoneOf = zoneOfOf

export const evaluateFormula = (input: FormulaEvaluationInput): FormulaEvaluation =>
    evaluateFormulaOf(FORMULA_REGISTRY, input)

export const formulaAcceptsRef = (critBase: CritBase, actionId: ActionId): boolean =>
    !(critBase === 'coefficient' && CRIT_ACTION_IDS.includes(actionId))

export const formulaOf = (entry: { formula: string; ratioUnit: string }): string =>
    entry.formula === 'direct' && entry.ratioUnit === 'fixed' ? 'fixed' : entry.formula

export const isEffectEntry = (entry: { formula: string }): boolean => entry.formula === 'effect'

export const usesCoefficientFormula = (entry: { formula: string; ratioUnit: string }): boolean =>
    FORMULAS[formulaOf(entry)]!.critBase === 'coefficient'

export const formulaActionClosure = (id: string): Set<string> => {
    const out = new Set<string>()
    for (const handle of FORMULAS[id]!.chain) {
        for (const input of handle.inputs) {
            if (typeof input !== 'string') continue
            if (input.startsWith('target.')) {
                out.add(input.slice('target.'.length))
                continue
            }
            if (input.startsWith('const.')) continue
            out.add(input)
        }
    }
    for (const boost of formulaMetaOf(id)?.ratioBoosts ?? []) out.add(boost)
    const base = FORMULAS[id]!.base
    if (base.kind === 'panelStat' && base.dim !== undefined) out.add(base.dim)
    if (base.kind === 'zone') out.add(String(base.id))
    if (base.kind === 'targetStat') out.add('enemyCoeff')
    return out
}

export type {
    ActionCombine,
    ActionSide,
    BuffActionDef,
    CritBase,
    FormulaCtx,
    FormulaDef,
    MultiplierDef,
    PanelDim,
    RefSourceDef
}
export type { ActionRegistry, FormulaHandle }
export type { FormulaEvaluation, FormulaEvaluationInput }
