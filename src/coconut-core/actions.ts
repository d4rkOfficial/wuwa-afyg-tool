import type { CharacterPanel, TargetPanel } from '$coconut/panel'

export type ActionSide = 'character' | 'target'

export type ActionCombine = 'sum' | 'multiply'

export const DEFAULT_PANEL_DIM = 'atk' as const

export type PanelDim = 'atk' | 'hp' | 'def'

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

export type ActionGroup = (typeof ACTION_GROUPS)[number]

export interface BuffActionDef {
    id: string
    label: string
    unit: '%' | 'flat'
    group: ActionGroup
    side: ActionSide
    combine: ActionCombine
    panel?: { flat?: PanelDim; pct?: PanelDim; total?: PanelDim }
    overridable: boolean
    damageMatchable: boolean
    init: number
    initCoeff?: number
    ref?: {
        label: string
    }
    targetField?: 'dmgReduction' | 'coefficient'
}

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

export type ActionId = (typeof ACTION_TABLE)[number]['id']

export const ACTION_MAP: Map<string, BuffActionDef> = new Map(BUFF_ACTIONS.map((a) => [a.id, a]))

export const isTargetSide = (id: string): boolean => ACTION_MAP.get(id)?.side === 'target'

export const TARGET_SIDE_ACTIONS: Set<string> = new Set(
    BUFF_ACTIONS.filter((a) => a.side === 'target').map((a) => a.id)
)

export const DISPLAY_ONLY_ACTIONS = new Map<string, string>([
    ['recharge', '共鸣效率只作面板展示与引用来源，不参与伤害公式'],
    ['offTuneBuildupRate', '偏谐值累积效率只作面板展示与引用来源，不参与伤害公式']
])

export const actionAllowsCondition = (actionId: string): boolean => ACTION_MAP.get(actionId)?.damageMatchable === true

export interface RefSourceDef {
    id: string
    label: string
    unit: '%' | 'flat'
    side: 'character' | 'target'
    get: (panel: CharacterPanel, target: TargetPanel) => number
}

export const REF_SOURCES: RefSourceDef[] = [
    { side: 'character', id: 'baseAtk', label: '攻击白值', unit: 'flat', get: (p) => p.base.atk },
    { side: 'character', id: 'totalAtk', label: '当前攻击', unit: 'flat', get: (p) => p.total.atk },
    { side: 'character', id: 'baseHp', label: '生命白值', unit: 'flat', get: (p) => p.base.hp },
    { side: 'character', id: 'totalHp', label: '生命上限', unit: 'flat', get: (p) => p.total.hp },
    { side: 'character', id: 'baseDef', label: '防御白值', unit: 'flat', get: (p) => p.base.def },
    { side: 'character', id: 'totalDef', label: '当前防御', unit: 'flat', get: (p) => p.total.def },
    ...BUFF_ACTIONS.filter((a) => a.ref !== undefined && a.targetField === undefined).map((a): RefSourceDef => ({
        side: a.side === 'target' ? 'target' : 'character',
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
        get: (_p, t) => t[a.targetField!]
    }))
]

export const REF_SOURCE_MAP: Map<string, RefSourceDef> = new Map(REF_SOURCES.map((s) => [s.id, s]))

export const TARGET_SCALARS: Record<string, (target: TargetPanel) => number> = Object.fromEntries(
    BUFF_ACTIONS.filter((a) => a.targetField !== undefined).map((a) => [a.id, (t: TargetPanel) => t[a.targetField!]])
)

export const writtenByOf = (dim: PanelDim): string[] =>
    BUFF_ACTIONS.filter(
        (a) => a.panel !== undefined && (a.panel.flat === dim || a.panel.pct === dim || a.panel.total === dim)
    ).map((a) => a.id)

export const refWrittenBy = (refId: string): string[] => {
    const dimOf: Record<string, PanelDim> = {
        baseAtk: 'atk',
        totalAtk: 'atk',
        baseHp: 'hp',
        totalHp: 'hp',
        baseDef: 'def',
        totalDef: 'def'
    }
    const dim = dimOf[refId]
    if (dim) return writtenByOf(dim)
    return REF_SOURCE_MAP.has(refId) ? [refId] : []
}
