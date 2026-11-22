/**
 * @desc **游戏数据底座**：作用表、引用来源、面板维度、目标侧字段、常量、倍率追加点。
 *
 * 这里只放「鸣潮 1.0 就存在」的那一份；后续版本新增的作用（谐度破坏增幅、偏谐系数、效应系数、
 * 集谐干涉层数、同奏增益层数）单独成条，由 `versions.ts` 的版本块追加。
 *
 * 内核只认形状：展示文案 / 分组 / 展示形态全部在 `$lib/calc/display-meta.ts`。
 */
import type { BuffActionDef, PanelConfig, RefSourceDef, TargetFieldDef } from '$coconut-core/actions'
import type { ConstantDef } from '$coconut-core/config'

// ─────────────────────────── 作用表（鸣潮 1.0） ───────────────────────────

export const ACTIONS_1_0 = [
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

// ─────────────────────── 作用表（后续版本新增，逐版追加） ───────────────────────

/** @desc 鸣潮 3.0 处决：谐度破坏增幅 */
export const TUNE_BREAK_BOOST = {
    id: 'tuneBreakBoost',
    side: 'character',
    combine: 'sum',
    overridable: true,
    init: 0
} as const satisfies BuffActionDef

/** @desc 鸣潮 3.0 处决：偏谐系数（目标侧标量） */
export const ENEMY_COEFF = {
    id: 'enemyCoeff',
    side: 'target',
    combine: 'sum',
    overridable: true,
    init: 0,
    targetField: 'coefficient'
} as const satisfies BuffActionDef

/** @desc 鸣潮 2.0 效应：效应系数（效应结算的基值） */
export const EFFECT_COEFF = {
    id: 'effectCoeff',
    side: 'character',
    combine: 'sum',
    overridable: true,
    init: 0
} as const satisfies BuffActionDef

/** @desc 鸣潮 3.0 集谐区：集谐干涉层数（目标侧，全队共用一份） */
export const TUNE_STRAIN_LAYER = {
    id: 'tuneStrainLayer',
    side: 'target',
    combine: 'sum',
    overridable: true,
    init: 0
} as const satisfies BuffActionDef

/** @desc 鸣潮 3.7 同奏区：同奏增益层数 */
export const UNISON_BOON_LAYER = {
    id: 'unisonBoonLayer',
    side: 'character',
    combine: 'sum',
    overridable: true,
    init: 0
} as const satisfies BuffActionDef

/** @desc 全部作用 id（各版本并集）：展示元数据与界面按它做完备性检查 */
export type CalcActionId =
    | (typeof ACTIONS_1_0)[number]['id']
    | (typeof TUNE_BREAK_BOOST)['id']
    | (typeof ENEMY_COEFF)['id']
    | (typeof EFFECT_COEFF)['id']
    | (typeof TUNE_STRAIN_LAYER)['id']
    | (typeof UNISON_BOON_LAYER)['id']

// ─────────────────────────── 面板 / 目标侧 / 常量 ───────────────────────────

/** @desc 面板维度与取整口径（内核不预设有哪些维） */
export const PANEL_CONFIG = {
    dims: ['atk', 'hp', 'def'],
    rounding: 'round',
    aggregate: ({ base, flat, pct }: { base: number; flat: number; pct: number }) =>
        base + Math.round(flat + (base * pct) / 100)
} as const satisfies PanelConfig

/** @desc 目标侧字段的存储形态（内核按 kind 分派，不认字段名） */
export const TARGET_FIELDS = [
    { field: 'defense', kind: 'scalar' },
    { field: 'dmgReduction', kind: 'scalar' },
    { field: 'coefficient', kind: 'scalar' },
    { field: 'type', kind: 'text' },
    { field: 'resistance', kind: 'map' }
] as const satisfies readonly TargetFieldDef[]

/** @desc 「额外倍率」作用的 id（内核只认这一个注入点，名字由这里给） */
export const RATIO_ZONE = 'extraRatio'

export const DEFAULT_CHAR_LEVEL = 90

/** @desc 公式里 `const.<id>` 的来源（内核不预设有哪些常量） */
export const CONSTANTS: readonly ConstantDef[] = [
    { id: 'charLevel', get: (panel) => panel.zones[CHAR_LEVEL_ACTION] || DEFAULT_CHAR_LEVEL }
]

/** @desc 「效应系数」作用 id（效应条目的基值来自这一维面板属性） */
export const EFFECT_COEFF_ACTION = 'effectCoeff'

/** @desc 「角色等级」作用 id（内核以 `const.charLevel` 读取，防御区用） */
export const CHAR_LEVEL_ACTION = 'charLevel'

/** @desc 「谐度破坏增幅」作用 id（角色自带属性，编译成 buff 写入面板） */
export const TUNE_BREAK_BOOST_ACTION = 'tuneBreakBoost'

// ─────────────────────────── 引用来源（由作用表派生） ───────────────────────────

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

const REF_ACTION_SET = new Set<string>(REF_ACTIONS)

/** @desc 白值 / 合计引用：不来自作用表，恒在 */
const BASE_REF_SOURCES: readonly RefSourceDef[] = [
    { id: 'baseAtk', get: (p) => p.base.atk, writes: 'atk' },
    { id: 'totalAtk', get: (p) => p.total.atk, writes: 'atk' },
    { id: 'baseHp', get: (p) => p.base.hp, writes: 'hp' },
    { id: 'totalHp', get: (p) => p.total.hp, writes: 'hp' },
    { id: 'baseDef', get: (p) => p.base.def, writes: 'def' },
    { id: 'totalDef', get: (p) => p.total.def, writes: 'def' }
]

/**
 * @desc 引用来源：白值 / 当前面板 / 目标侧标量（内核只读 `id` 与 `get`）。
 *
 * 由当版作用表派生：作用表加了什么，引用来源就跟着有什么，版本块不必重复登记。
 */
export const refSourcesOf = (actions: readonly BuffActionDef[]): readonly RefSourceDef[] => [
    ...BASE_REF_SOURCES,
    ...actions
        .filter((action) => REF_ACTION_SET.has(String(action.id)) && action.targetField === undefined)
        .map((action): RefSourceDef => ({
            id: action.id,
            get: (p, t) => (action.side === 'target' ? (t.zones[action.id] ?? 0) : (p.zones[action.id] ?? 0))
        })),
    ...actions
        .filter((action) => action.targetField !== undefined)
        .map((action): RefSourceDef => {
            const field = action.targetField!
            const kind = TARGET_FIELDS.find((entry) => entry.field === field)?.kind ?? 'scalar'
            return {
                id: action.id,
                get: (_p, t) =>
                    kind === 'scalar' ? (t.scalars[field] ?? 0) : kind === 'map' ? 0 : Number(t.text[field] ?? 0) || 0
            }
        })
]
