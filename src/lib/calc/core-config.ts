/**
 * @desc **注册层**：计算核需要的全部游戏数据与数学定义都在这里。
 *
 * 内核只认「形状」，不认具体作用 / 乘子 / 公式；这份文件是唯一的注册来源。
 * 新增一个作用、换一套公式、改倍率串协议，都只改这里（不动内核）。
 */
import {
    actionAllowsCondition as allowsConditionOf,
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
import { CoconutCore, type CharacterPanel, type CoconutCoreConfig } from '$coconut'
import {
    computeDefMulti as computeDefMultiOf,
    computeResMulti as computeResMultiOf,
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
    clonePanel as clonePanelOf,
    emptyPanel as emptyPanelOf,
    emptyTargetPanel as emptyTargetPanelOf,
    recomputeTotals as recomputeTotalsOf,
    zoneOf as zoneOfOf
} from '$coconut/panel'
import {
    evaluateFormula as evaluateFormulaOf,
    type FormulaEvaluation,
    type FormulaEvaluationInput
} from '$coconut/evaluate'
import type { MultiplierDisplay } from '$coconut'

// ─────────────────────────── 作用表（游戏数据） ───────────────────────────

export const ACTION_GROUPS = [
    '基本固定值',
    '基本百分比',
    '双暴',
    '常见增伤拐',
    '特殊增伤拐或倍率提升',
    '倍率追加或锚定',
    '使目标',
    '对目标',
    '层数相关独立终伤'
] as const

const ACTION_TABLE = [
    {
        id: 'atkFlat',
        label: '攻击固定值',
        unit: 'flat',
        group: '基本固定值',
        side: 'character',
        combine: 'sum',
        panel: { flat: 'atk', total: 'atk' },
        overridable: true,
        damageMatchable: false,
        init: 0
    },
    {
        id: 'hpFlat',
        label: '生命固定值',
        unit: 'flat',
        group: '基本固定值',
        side: 'character',
        combine: 'sum',
        panel: { flat: 'hp', total: 'hp' },
        overridable: true,
        damageMatchable: false,
        init: 0
    },
    {
        id: 'defFlat',
        label: '防御固定值',
        unit: 'flat',
        group: '基本固定值',
        side: 'character',
        combine: 'sum',
        panel: { flat: 'def', total: 'def' },
        overridable: true,
        damageMatchable: false,
        init: 0
    },
    {
        id: 'tuneBreakBoost',
        label: '谐度破坏增幅',
        unit: 'flat',
        group: '基本固定值',
        side: 'character',
        combine: 'sum',
        overridable: true,
        damageMatchable: false,
        init: 0,
        ref: { label: '谐度破坏增幅' }
    },
    {
        id: 'atkPct',
        label: '攻击百分比',
        unit: '%',
        group: '基本百分比',
        side: 'character',
        combine: 'sum',
        panel: { pct: 'atk' },
        overridable: false,
        damageMatchable: false,
        init: 0
    },
    {
        id: 'hpPct',
        label: '生命百分比',
        unit: '%',
        group: '基本百分比',
        side: 'character',
        combine: 'sum',
        panel: { pct: 'hp' },
        overridable: false,
        damageMatchable: false,
        init: 0
    },
    {
        id: 'defPct',
        label: '防御百分比',
        unit: '%',
        group: '基本百分比',
        side: 'character',
        combine: 'sum',
        panel: { pct: 'def' },
        overridable: false,
        damageMatchable: false,
        init: 0
    },
    {
        id: 'recharge',
        label: '共鸣效率',
        unit: '%',
        group: '基本百分比',
        side: 'character',
        combine: 'sum',
        overridable: true,
        damageMatchable: false,
        init: 100,
        ref: { label: '共鸣效率' }
    },
    {
        id: 'offTuneBuildupRate',
        label: '偏谐值累积效率',
        unit: '%',
        group: '基本百分比',
        side: 'character',
        combine: 'sum',
        overridable: true,
        damageMatchable: false,
        init: 100,
        ref: { label: '偏谐值累积效率' }
    },
    {
        id: 'critRate',
        label: '暴击率',
        unit: '%',
        group: '双暴',
        side: 'character',
        combine: 'sum',
        overridable: true,
        damageMatchable: true,
        init: 5,
        initCoeff: 0,
        ref: { label: '暴击率' }
    },
    {
        id: 'critDmg',
        label: '暴击伤害',
        unit: '%',
        group: '双暴',
        side: 'character',
        combine: 'sum',
        overridable: true,
        damageMatchable: true,
        init: 150,
        initCoeff: 100,
        ref: { label: '暴击伤害' }
    },
    {
        id: 'bonusDmg',
        label: '加成(增伤区)',
        unit: '%',
        group: '常见增伤拐',
        side: 'character',
        combine: 'sum',
        overridable: true,
        damageMatchable: true,
        init: 0
    },
    {
        id: 'deepenDmg',
        label: '加深(加深区)',
        unit: '%',
        group: '常见增伤拐',
        side: 'character',
        combine: 'sum',
        overridable: true,
        damageMatchable: true,
        init: 0
    },
    {
        id: 'dmgTakenInc',
        label: '伤害提升(易伤区)',
        unit: '%',
        group: '常见增伤拐',
        side: 'character',
        combine: 'sum',
        overridable: true,
        damageMatchable: true,
        init: 0
    },
    {
        id: 'finalDmg',
        label: '最终伤害(终伤区)',
        unit: '%',
        group: '常见增伤拐',
        side: 'character',
        combine: 'sum',
        overridable: true,
        damageMatchable: true,
        init: 0
    },
    {
        id: 'specialFinal1',
        label: '特殊终伤(1)',
        unit: '%',
        group: '特殊增伤拐或倍率提升',
        side: 'character',
        combine: 'sum',
        overridable: true,
        damageMatchable: true,
        init: 0
    },
    {
        id: 'specialFinal2',
        label: '特殊终伤(2)',
        unit: '%',
        group: '特殊增伤拐或倍率提升',
        side: 'character',
        combine: 'multiply',
        overridable: true,
        damageMatchable: true,
        init: 1
    },
    {
        id: 'extraRatio',
        label: '额外倍率',
        unit: '%',
        group: '倍率追加或锚定',
        side: 'character',
        combine: 'sum',
        overridable: false,
        damageMatchable: true,
        init: 0
    },
    {
        id: 'defDown',
        label: '防御降低(减防)',
        unit: '%',
        group: '使目标',
        side: 'character',
        combine: 'sum',
        overridable: true,
        damageMatchable: true,
        init: 0
    },
    {
        id: 'resDown',
        label: '抗性降低(减抗)',
        unit: '%',
        group: '使目标',
        side: 'character',
        combine: 'sum',
        overridable: true,
        damageMatchable: true,
        init: 0
    },
    {
        id: 'resPen',
        label: '属性抗性无视(穿抗)',
        unit: '%',
        group: '对目标',
        side: 'character',
        combine: 'sum',
        overridable: true,
        damageMatchable: true,
        init: 0
    },
    {
        id: 'defPen',
        label: '防御无视(穿防)',
        unit: '%',
        group: '对目标',
        side: 'character',
        combine: 'sum',
        overridable: true,
        damageMatchable: true,
        init: 0
    },
    {
        id: 'dmgRedPen',
        label: '免伤无视(穿免)',
        unit: '%',
        group: '对目标',
        side: 'character',
        combine: 'sum',
        overridable: true,
        damageMatchable: true,
        init: 0
    },
    {
        id: 'enemyDmgReduction',
        label: '敌人免伤',
        unit: '%',
        group: '使目标',
        side: 'target',
        combine: 'sum',
        overridable: true,
        damageMatchable: true,
        init: 0,
        ref: { label: '敌人免伤' },
        targetField: 'dmgReduction'
    },
    {
        id: 'tuneStrainLayer',
        label: '集谐干涉层数',
        unit: 'flat',
        group: '层数相关独立终伤',
        side: 'target',
        combine: 'sum',
        overridable: true,
        damageMatchable: false,
        init: 0,
        ref: { label: '集谐干涉层数' }
    },
    {
        id: 'unisonBoonLayer',
        label: '同奏增益层数',
        unit: 'flat',
        group: '层数相关独立终伤',
        side: 'character',
        combine: 'sum',
        overridable: true,
        damageMatchable: false,
        init: 0,
        ref: { label: '同奏增益层数' }
    },
    {
        id: 'effectCoeff',
        label: '效应系数',
        unit: 'flat',
        group: '基本固定值',
        side: 'character',
        combine: 'sum',
        overridable: true,
        damageMatchable: false,
        init: 0,
        ref: { label: '效应系数' }
    },
    {
        id: 'enemyCoeff',
        label: '偏谐系数',
        unit: 'flat',
        group: '使目标',
        side: 'target',
        combine: 'sum',
        overridable: true,
        damageMatchable: false,
        init: 0,
        ref: { label: '偏谐系数' },
        targetField: 'coefficient'
    }
] as const satisfies readonly BuffActionDef[]

export const BUFF_ACTIONS: readonly BuffActionDef[] = ACTION_TABLE

/** @desc 「效应系数」作用 id（效应条目的基值来自这一维面板属性） */
export const EFFECT_COEFF_ACTION = 'effectCoeff'

export type ActionId = (typeof ACTION_TABLE)[number]['id']

/** @desc 引用来源：白值 / 当前面板 / 目标侧标量（label 与读取函数都在注册层给） */
export const REF_SOURCES: readonly RefSourceDef[] = [
    { side: 'character', id: 'baseAtk', label: '攻击白值', unit: 'flat', get: (p) => p.base.atk },
    { side: 'character', id: 'totalAtk', label: '当前攻击', unit: 'flat', get: (p) => p.total.atk },
    { side: 'character', id: 'baseHp', label: '生命白值', unit: 'flat', get: (p) => p.base.hp },
    { side: 'character', id: 'totalHp', label: '生命上限', unit: 'flat', get: (p) => p.total.hp },
    { side: 'character', id: 'baseDef', label: '防御白值', unit: 'flat', get: (p) => p.base.def },
    { side: 'character', id: 'totalDef', label: '当前防御', unit: 'flat', get: (p) => p.total.def },
    ...BUFF_ACTIONS.filter((a) => a.ref !== undefined && a.targetField === undefined).map((a): RefSourceDef => ({
        side: a.side,
        id: a.id,
        label: a.ref!.label,
        unit: a.unit,
        get: (p, t) => (a.side === 'target' ? (t.zones[a.id] ?? 0) : (p.zones[a.id] ?? 0))
    })),
    { side: 'target', id: 'enemyDefense', label: '敌人防御', unit: 'flat', get: (_p, t) => t.defense },
    ...BUFF_ACTIONS.filter((a) => a.targetField !== undefined).map((a): RefSourceDef => ({
        side: 'target',
        id: a.id,
        label: a.ref?.label ?? a.label,
        unit: a.unit,
        get: (_p, t) => Number((t as unknown as Record<string, unknown>)[a.targetField!] ?? 0)
    }))
]

export const REF_SOURCE_MAP: ReadonlyMap<string, RefSourceDef> = new Map(REF_SOURCES.map((s) => [s.id, s]))

/** @desc 只供界面展示、不参与公式的作用 */
export const DISPLAY_ONLY_ACTIONS = new Map<string, string>([
    ['recharge', '共鸣效率只作面板展示与引用来源，不参与伤害公式'],
    ['offTuneBuildupRate', '偏谐值累积效率只作面板展示与引用来源，不参与伤害公式']
])

const refWrittenByMap = (refId: string): string[] => {
    const dimOf: Record<string, PanelDim> = {
        baseAtk: 'atk',
        totalAtk: 'atk',
        baseHp: 'hp',
        totalHp: 'hp',
        baseDef: 'def',
        totalDef: 'def'
    }
    const dim = dimOf[refId]
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

const deepenMultiplier = defineFormula(
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

const bonusMultiplier = defineFormula(
    {
        id: 'bonus',
        label: '增伤区',
        inputs: ['bonusDmg'] as const,
        version: 1,
        display: (value) => ({ mode: 'delta', pct: (value - 1) * 100, digits: 1 })
    },
    ({ bonusDmg }) => 1 + bonusDmg / 100
)

const vulnMultiplier = defineFormula(
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

const resistMultiplier = defineFormula(
    {
        id: 'resist',
        label: '抗性区',
        inputs: ['resPen', 'resDown'] as const,
        version: 1,
        display: () => ({ mode: 'factor', digits: 4 })
    },
    ({ resPen, resDown }, ctx) => computeResMultiOf((ctx.target.resistances[ctx.element] ?? 0) / 100, resPen, resDown)
)

const defenseMultiplier = defineFormula(
    {
        id: 'defense',
        label: '防御区',
        inputs: ['defPen', 'defDown', 'target.defense'] as const,
        version: 1,
        display: () => ({ mode: 'factor', digits: 4 })
    },
    (r, ctx) => computeDefMultiOf(r['target.defense'], r.defPen, r.defDown, ctx.consts.charLevel ?? DEFAULT_CHAR_LEVEL)
)

const dmgRedMultiplier = defineFormula(
    {
        id: 'dmgRed',
        label: '免伤区',
        inputs: ['dmgRedPen', 'target.enemyDmgReduction'] as const,
        version: 1,
        display: () => ({ mode: 'factor', digits: 4 })
    },
    (r) => 1 - r['target.enemyDmgReduction'] / 100 - r.dmgRedPen / 100
)

const tuneStrainMultiplier = defineFormula(
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

const tuneBreakMultiplier = defineFormula(
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

const unisonMultiplier = defineFormula(
    {
        id: 'unison',
        label: '同奏区',
        inputs: ['unisonBoonLayer'] as const,
        version: 1,
        display: (value, ctx) => ({
            mode: 'deltaWhenActive',
            pct: (value - 1) * 100,
            active: (ctx.panel.zones.unisonBoonLayer ?? 0) > 0,
            activeDigits: 1,
            idleDigits: 4
        })
    },
    ({ unisonBoonLayer }) => 1 + 0.03 * unisonBoonLayer
)

const finalMultiplier = defineFormula(
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

const specialMultiplier = defineFormula(
    {
        id: 'special',
        label: '特殊区',
        inputs: ['specialFinal1', 'specialFinal2'] as const,
        version: 1,
        display: () => ({ mode: 'factor', digits: 4 })
    },
    ({ specialFinal1, specialFinal2 }) => (specialFinal1 !== 0 ? 1 + specialFinal1 / 100 : 1) * specialFinal2
)

const critMultiplier = defineFormula(
    {
        id: 'crit',
        label: '暴击区',
        inputs: ['critRate', 'critDmg'] as const,
        version: 1,
        display: (value: number): MultiplierDisplay => ({
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

const MULTIPLIER_LIST: readonly FormulaHandle[] = MULTIPLIER_ORDER.map((id) => MULTIPLIERS[id])

/** @desc 暴击乘子 id（「不暴击」链路要排除它） */
const CRIT_MULTIPLIER_ID = 'crit'

export const CRIT_ACTION_IDS: readonly string[] = MULTIPLIERS.crit.inputs

const multiplierChain = (ids: readonly MultiplierId[]): readonly FormulaHandle[] => ids.map((id) => MULTIPLIERS[id])

export const FORMULAS: Record<string, FormulaDef> = {
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
        canCrit: (panel) => (panel.zones.critRate ?? 0) > 0,
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
        canCrit: (panel) => (panel.zones.critRate ?? 0) > 0,
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

// ─────────────────────────── 注册表实例（模块级唯一） ───────────────────────────

export const buildCoconutCoreConfig = (): CoconutCoreConfig => ({
    actions: BUFF_ACTIONS,
    refSources: REF_SOURCES,
    multipliers: MULTIPLIER_LIST,
    formulas: FORMULAS,
    critMultiplier: CRIT_MULTIPLIER_ID,
    critActions: CRIT_ACTION_IDS
})

const ACTIONS: ActionRegistry = createActionRegistry(BUFF_ACTIONS, REF_SOURCES)

const FORMULA_REGISTRY = createFormulaRegistry({
    multipliers: MULTIPLIER_LIST,
    formulas: FORMULAS,
    critMultiplier: CRIT_MULTIPLIER_ID,
    critActions: CRIT_ACTION_IDS,
    actions: ACTIONS
})

/** @desc 注册层的内核实例（与 `buildCoconutCoreConfig()` 同源） */
export const createCoconutCore = (): CoconutCore => new CoconutCore().init(buildCoconutCoreConfig())

// ─────────────────────────── 注册层导出的纯辅助 ───────────────────────────

export const ACTION_MAP: ReadonlyMap<string, BuffActionDef> = ACTIONS.map

export const actionAllowsCondition = (actionId: string): boolean => allowsConditionOf(ACTIONS, actionId)

export const writtenByOf = (dim: PanelDim): string[] => writtenByOfRegistry(ACTIONS, dim)

export const refWrittenBy = (refId: string): string[] =>
    refWrittenByOf(ACTIONS, refId).length > 0 ? refWrittenByOf(ACTIONS, refId) : refWrittenByMap(refId)

export const emptyPanel = (critBase: CritBase = 'panel'): CharacterPanel => emptyPanelOf(ACTIONS, critBase)

export const emptyTargetPanel = emptyTargetPanelOf

export const applyZone = (
    panel: CharacterPanel,
    actionId: string,
    value: number,
    write: 'add' | 'override' = 'add'
): void => applyZoneOf(ACTIONS, panel, actionId, value, write)

export const recomputeTotals = (panel: CharacterPanel): void => recomputeTotalsOf(ACTIONS, panel)

export const clonePanel = clonePanelOf

export const zoneOf = zoneOfOf

export const evaluateFormula = (input: FormulaEvaluationInput): FormulaEvaluation =>
    evaluateFormulaOf(FORMULA_REGISTRY, input)

export const formulaAcceptsRef = (critBase: CritBase, actionId: string): boolean =>
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
            if (input.startsWith('target.')) {
                out.add(input.slice('target.'.length))
                continue
            }
            if (input.startsWith('const.')) continue
            out.add(input)
        }
    }
    for (const boost of FORMULAS[id]!.ratioBoosts) out.add(boost)
    const base = FORMULAS[id]!.base
    if (base.kind === 'panelStat' && base.dim !== 'auto') out.add(base.dim)
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
