/**
 * @desc Buff 作用注册表：**一个 Buff 能对计算做的某一件事**（决议 D5 / D6 / D17–D30）。
 *
 * 这张表取代原先分散的六处声明：`ZONE_DEFS`（id/label/unit）、`ZONE_SECTIONS`（分组）、
 * `ZONE_NO_REF_IDS`、`ZONE_NO_OVERRIDE_IDS`、`TARGET_SIDE_ZONE_IDS`、`ZONE_REF_DEFS`
 * 以及 `zone-ops.ts` 里逐条手写的写入算子。每一行的含义：
 *
 * - `side`：值落在**角色面板**还是**目标面板**（后者全队一份，目前只有集谐层数）；
 * - `combine` / `panel`：多次写入如何合并、是否参与三维派生（`flat` / `pct` / `total`）；
 * - `init` / `initCoeff`：初值（系数基类条目口径另给一份，用于双暴 0% / 100%）；
 * - `overridable`：界面是否提供「覆盖」开关（引擎侧写模式恒合法）；
 * - `damageMatchable`：能否挂「伤害匹配」条件（伤害属性 / 伤害类型）——
 *   热熔加成 / 热熔暴击率成立，热熔共鸣效率 / 热熔集谐层数不成立；
 * - `ref`：是否可作为引用（转模）来源。
 *
 * 「乘区」一词从此只指公式链上的**乘子**（增伤区 / 防御区 / 暴击区…），本表是「作用」。
 */
import type { CharacterPanel, TargetPanel } from '$coconut/panel'

/** @desc 值落在哪一侧面板 */
export type ActionSide = 'character' | 'target'

/** @desc 多次写入的合并方式：累加 / 连乘（`acc *= 1 + v/100`） */
export type ActionCombine = 'sum' | 'multiply'

/** @desc 三维维度 */
export type PanelDim = 'atk' | 'hp' | 'def'

/** @desc 分组标题的顺序（与旧 `ZONE_SECTIONS` 逐字一致，UI 保持原状） */
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
    /** @desc 作用 id（与旧 zoneId 字符串一致，持久化不需要改名） */
    id: string
    label: string
    unit: '%' | 'flat'
    group: ActionGroup
    side: ActionSide
    combine: ActionCombine
    /** @desc 三维派生声明：`flat`/`pct` 参与 `total = base + flat + base×pct/100`；`total` 表示覆盖时直接写合计 */
    panel?: { flat?: PanelDim; pct?: PanelDim; total?: PanelDim }
    /** @desc 界面是否提供「覆盖」写入（引擎侧写模式恒合法，这里只表达界面能力） */
    overridable: boolean
    /** @desc 能否挂「伤害匹配」条件（伤害属性 / 伤害类型） */
    damageMatchable: boolean
    /** @desc 初值（缺省 0；连乘类为 1） */
    init: number
    /** @desc 系数基类条目口径下的初值（缺省同 `init`） */
    initCoeff?: number
    /** @desc 可作为引用（转模）来源 */
    ref?: {
        /** @desc 引用下拉里的显示名（与作用名可能不同，如「攻击固定值」→「攻击白值」这类三维来源在 `REF_SOURCES`） */
        label: string
    }
    /** @desc 目标面板上的**标量**字段（不落 `zones` 的那种）：免伤、偏谐系数 */
    targetField?: 'dmgReduction' | 'coefficient'
}

/**
 * @desc 全部 Buff 作用（顺序 = 界面「添加作用」右栏与旧 `ZONE_DEFS` 的顺序，逐项对齐以免 UI 变动）。
 *
 * 字面量表：只用于推导 `ActionId` 联合类型（`as const`），对外统一以 `BUFF_ACTIONS` 暴露。
 */
const ACTION_TABLE = [
    // ── 基本固定值 ──
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

    // ── 基本百分比 ──
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

    // ── 双暴 ──
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

    // ── 常见增伤拐 ──
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

    // ── 特殊增伤拐或倍率提升 ──
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

    // ── 倍率追加或锚定 ──
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

    // ── 使目标 ──
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

    // ── 对目标 ──
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

    // ── 层数相关独立终伤 ──
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

    // ── 系数类基值（效应 / 处决响应的「系数」各自是面板属性，不混进三维）──
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

/** @desc 全部作用（统一形态：逐项迭代不丢失可选字段） */
export const BUFF_ACTIONS: readonly BuffActionDef[] = ACTION_TABLE

/** @desc 作用 id 联合类型（由注册表推导，不手写） */
export type ActionId = (typeof ACTION_TABLE)[number]['id']

/** @desc 作用定义查询表（key 用宽 string：历史数据 / 导入数据可能带已下线的作用） */
export const ACTION_MAP: Map<string, BuffActionDef> = new Map(BUFF_ACTIONS.map((a) => [a.id, a]))

/** @desc 某作用是否落在目标面板（旧 `TARGET_SIDE_ZONE_IDS` 的派生形态） */
export const isTargetSide = (id: string): boolean => ACTION_MAP.get(id)?.side === 'target'

/** @desc 目标侧作用集合（旧 `TARGET_SIDE_ZONE_IDS`） */
export const TARGET_SIDE_ACTIONS: Set<string> = new Set(
    BUFF_ACTIONS.filter((a) => a.side === 'target').map((a) => a.id)
)

/**
 * @desc **不进任何公式、也不参与三维派生**的作用 → 理由。
 *
 * 只作面板展示与引用（转模）来源。静态闸门（`test/src/coconut-core/engine/formula-registry.test.ts`）
 * 要求每个作用要么被某个乘子读、要么参与三维派生、要么登记在这里 —— 新增作用忘记接线会直接失败。
 */
export const DISPLAY_ONLY_ACTIONS = new Map<string, string>([
    ['recharge', '共鸣效率只作面板展示与引用来源，不参与伤害公式'],
    ['offTuneBuildupRate', '偏谐值累积效率只作面板展示与引用来源，不参与伤害公式']
])

/** @desc 该作用能否挂「伤害匹配」条件（伤害属性 / 伤害类型） */
export const actionAllowsCondition = (actionId: string): boolean => ACTION_MAP.get(actionId)?.damageMatchable === true

// ────────────────────────────── 引用（转模）来源 ──────────────────────────────

/**
 * @desc 可作为引用（转模）来源的**面板属性**：三维白值 / 合计 + 声明了 `ref` 的作用。
 *
 * `writtenBy` 由 `panel` 声明推导：某个三维维度的写入口是声明了该维度 `flat`/`pct`/`total`
 * 的作用；其余（充能 / 谐度增幅 / 双暴 / 层数）是「id 与作用 id 同名」的恒等情况。
 * 因此旧 `pane-effects.ts` 的 `PANEL_TO_ZONES` 不再需要手抄。
 */
export interface RefSourceDef {
    id: string
    label: string
    unit: '%' | 'flat'
    /** @desc 值从哪个面板读：角色侧（每人一份）还是目标侧（全队一份） */
    side: 'character' | 'target'
    /** @desc 读面板（只用到自己那一侧的那个参数） */
    get: (panel: CharacterPanel, target: TargetPanel) => number
}

/**
 * @desc 可作为引用（转模）来源的属性：角色三维白值 / 合计 + 声明了 `ref` 的作用
 * + 目标侧（敌人防御 / 免伤 / 集谐层数）。
 *
 * `writtenBy` 由 `panel` 声明推导：某个三维维度的写入口是声明了该维度 `flat`/`pct`/`total`
 * 的作用；其余（充能 / 谐度增幅 / 双暴 / 层数）是「id 与作用 id 同名」的恒等情况。
 */
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
    // 免伤是目标面板上的标量字段（非 `zones`），单独登记
    ...BUFF_ACTIONS.filter((a) => a.targetField !== undefined).map((a): RefSourceDef => ({
        side: 'target',
        id: a.id,
        label: a.ref?.label ?? a.label,
        unit: a.unit,
        get: (_p, t) => t[a.targetField!]
    }))
]

export const REF_SOURCE_MAP: Map<string, RefSourceDef> = new Map(REF_SOURCES.map((s) => [s.id, s]))

/**
 * @desc 目标面板上的**标量**输入（不落 `zones` 的那种）：公式里写 `target.<作用 id>` 时，
 * 由这张表决定读目标面板的哪个字段。
 */
export const TARGET_SCALARS: Record<string, (target: TargetPanel) => number> = Object.fromEntries(
    BUFF_ACTIONS.filter((a) => a.targetField !== undefined).map((a) => [a.id, (t: TargetPanel) => t[a.targetField!]])
)

/** @desc 三维维度 → 会改写它的作用 id（影响源分析用；由 `panel` 声明推导） */
export const writtenByOf = (dim: PanelDim): string[] =>
    BUFF_ACTIONS.filter(
        (a) => a.panel !== undefined && (a.panel.flat === dim || a.panel.pct === dim || a.panel.total === dim)
    ).map((a) => a.id)

/** @desc 某引用来源会被哪些作用改写（三维来源走 `writtenByOf`，其余按 id 同名） */
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
