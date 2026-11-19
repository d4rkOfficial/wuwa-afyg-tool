/**
 * @desc **外部元数据层**：展示文案、展示分组、乘区展示形态，以及只被调用方（界面 / 溯源 / AI 工具）使用的能力标记。
 *
 * 这些字段**不进内核**：`CoconutCoreConfig` 与内核类型里没有任何 label / unit / group / display，
 * 内核只按 id 定位；展示与调用方能力全部留在这里，按 id 取（`ACTION_META` / `MULTIPLIER_META` / `FORMULA_META`）。
 *
 * 三张表都用「完整键」声明（`Record<CalcActionId, …>` 等），少一个 id 或多一个 id 都是类型错误，
 * 因此与注册层 `core-config.ts` 天然同步。
 */
import type { CharacterPanel, FormulaCtx, FormulaId } from '$coconut-core'
import type { CalcActionId, FormulaKey, MultiplierId } from './core-config'

// ─────────────────────────── 乘区展示形态 ───────────────────────────

export type MultiplierDisplay =
    | { mode: 'delta'; pct: number; digits: number }
    | { mode: 'factor'; digits: number }
    | { mode: 'deltaWhenActive'; pct: number; active: boolean; activeDigits: number; idleDigits: number }

export type MultiplierDisplayFn = (value: number, ctx: FormulaCtx) => MultiplierDisplay

// ─────────────────────────── 作用（乘区）元数据 ───────────────────────────

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

export interface ActionMeta {
    label: string
    unit: '%' | 'flat'
    group: ActionGroup
    /** 内部作用：出现在面板里但不作为可配置乘区暴露 */
    internal?: true
    /** 允许按伤害条件匹配 */
    damageMatchable?: true
    /** 该作用作为引用来源时的展示名（引用来源的注册在 `core-config.ts` 的 `REF_ACTIONS`） */
    refName?: string
}

export const ACTION_META: Record<CalcActionId, ActionMeta> = {
    atkBase: { label: '攻击白值', unit: 'flat', group: '基本固定值', internal: true },
    hpBase: { label: '生命白值', unit: 'flat', group: '基本固定值', internal: true },
    defBase: { label: '防御白值', unit: 'flat', group: '基本固定值', internal: true },
    charLevel: { label: '角色等级', unit: 'flat', group: '基本固定值', internal: true },
    atkFlat: { label: '攻击固定值', unit: 'flat', group: '基本固定值' },
    hpFlat: { label: '生命固定值', unit: 'flat', group: '基本固定值' },
    defFlat: { label: '防御固定值', unit: 'flat', group: '基本固定值' },
    tuneBreakBoost: { label: '谐度破坏增幅', unit: 'flat', group: '基本固定值', refName: '谐度破坏增幅' },
    atkPct: { label: '攻击百分比', unit: '%', group: '基本百分比' },
    hpPct: { label: '生命百分比', unit: '%', group: '基本百分比' },
    defPct: { label: '防御百分比', unit: '%', group: '基本百分比' },
    recharge: { label: '共鸣效率', unit: '%', group: '基本百分比', refName: '共鸣效率' },
    offTuneBuildupRate: { label: '偏谐值累积效率', unit: '%', group: '基本百分比', refName: '偏谐值累积效率' },
    critRate: { label: '暴击率', unit: '%', group: '双暴', damageMatchable: true, refName: '暴击率' },
    critDmg: { label: '暴击伤害', unit: '%', group: '双暴', damageMatchable: true, refName: '暴击伤害' },
    bonusDmg: { label: '加成(增伤区)', unit: '%', group: '常见增伤拐', damageMatchable: true },
    deepenDmg: { label: '加深(加深区)', unit: '%', group: '常见增伤拐', damageMatchable: true },
    dmgTakenInc: { label: '伤害提升(易伤区)', unit: '%', group: '常见增伤拐', damageMatchable: true },
    finalDmg: { label: '最终伤害(终伤区)', unit: '%', group: '常见增伤拐', damageMatchable: true },
    specialFinal1: { label: '特殊终伤(1)', unit: '%', group: '特殊增伤拐或倍率提升', damageMatchable: true },
    specialFinal2: { label: '特殊终伤(2)', unit: '%', group: '特殊增伤拐或倍率提升', damageMatchable: true },
    extraRatio: { label: '额外倍率', unit: '%', group: '倍率追加或锚定', damageMatchable: true },
    defDown: { label: '防御降低(减防)', unit: '%', group: '使目标', damageMatchable: true },
    resDown: { label: '抗性降低(减抗)', unit: '%', group: '使目标', damageMatchable: true },
    resPen: { label: '属性抗性无视(穿抗)', unit: '%', group: '对目标', damageMatchable: true },
    defPen: { label: '防御无视(穿防)', unit: '%', group: '对目标', damageMatchable: true },
    dmgRedPen: { label: '免伤无视(穿免)', unit: '%', group: '对目标', damageMatchable: true },
    enemyDmgReduction: { label: '敌人免伤', unit: '%', group: '使目标', damageMatchable: true, refName: '敌人免伤' },
    tuneStrainLayer: { label: '集谐干涉层数', unit: 'flat', group: '层数相关独立终伤', refName: '集谐干涉层数' },
    unisonBoonLayer: { label: '同奏增益层数', unit: 'flat', group: '层数相关独立终伤', refName: '同奏增益层数' },
    effectCoeff: { label: '效应系数', unit: 'flat', group: '基本固定值', refName: '效应系数' },
    enemyCoeff: { label: '偏谐系数', unit: 'flat', group: '使目标', refName: '偏谐系数' },
    enemyDefense: { label: '敌人防御', unit: 'flat', group: '使目标', internal: true, refName: '敌人防御' },
    enemyType: { label: '敌人类型', unit: 'flat', group: '使目标', internal: true },
    resistance: { label: '属性抗性', unit: '%', group: '使目标', internal: true }
}

/** @desc 只供界面展示、不参与公式的作用及其说明 */
export const DISPLAY_ONLY_ACTIONS = new Map<string, string>([
    ['recharge', '共鸣效率只作面板展示与引用来源，不参与伤害公式'],
    ['offTuneBuildupRate', '偏谐值累积效率只作面板展示与引用来源，不参与伤害公式']
])

/** @desc 取作用元数据；未登记的 id 返回 `undefined`（调用方按需兜底） */
export const actionMetaOf = (id: FormulaId): ActionMeta | undefined =>
    typeof id === 'string' ? ACTION_META[id as CalcActionId] : undefined

/** @desc 作用展示名（未登记的 id 退化为 id 本身） */
export const actionLabel = (id: FormulaId): string => actionMetaOf(id)?.label ?? String(id)

/** @desc 作用单位（未登记的 id 按百分比） */
export const actionUnit = (id: FormulaId): '%' | 'flat' => actionMetaOf(id)?.unit ?? '%'

/** @desc 作用所属展示分组 */
export const actionGroupOf = (id: FormulaId): ActionGroup | undefined => actionMetaOf(id)?.group

/** @desc 该作用作为引用来源时的展示名（未声明则用作用自己的展示名） */
export const actionRefLabel = (id: FormulaId): string => actionMetaOf(id)?.refName ?? actionLabel(id)

/** @desc 该作用是否允许按伤害条件匹配 */
export const actionAllowsCondition = (id: FormulaId): boolean => actionMetaOf(id)?.damageMatchable === true

// ─────────────────────────── 乘子元数据 ───────────────────────────

export interface MultiplierMeta {
    label: string
    display: MultiplierDisplayFn
}

const deltaDisplay = (value: number): MultiplierDisplay => ({
    mode: 'delta',
    pct: (value - 1) * 100,
    digits: 1
})

const factorDisplay: MultiplierDisplayFn = () => ({ mode: 'factor', digits: 4 })

export const MULTIPLIER_META: Record<MultiplierId, MultiplierMeta> = {
    deepen: { label: '加深区', display: deltaDisplay },
    bonus: { label: '增伤区', display: deltaDisplay },
    vuln: { label: '易伤/免伤区', display: deltaDisplay },
    resist: { label: '抗性区', display: factorDisplay },
    defense: { label: '防御区', display: factorDisplay },
    tuneStrain: {
        label: '集谐区',
        display: (value, ctx) => ({
            mode: 'deltaWhenActive',
            pct: (value - 1) * 100,
            active: (ctx.target.zones.tuneStrainLayer ?? 0) > 0,
            activeDigits: 1,
            idleDigits: 4
        })
    },
    tuneBreak: { label: '谐度区', display: deltaDisplay },
    unison: {
        label: '同奏区',
        display: (value, ctx) => ({
            mode: 'deltaWhenActive',
            pct: (value - 1) * 100,
            active: (ctx.panel.zones.unisonBoonLayer ?? 0) > 0,
            activeDigits: 1,
            idleDigits: 4
        })
    },
    final: { label: '终伤区', display: deltaDisplay },
    special: { label: '特殊区', display: factorDisplay },
    crit: {
        label: '暴击区',
        display: (value) => ({
            mode: 'deltaWhenActive',
            pct: (value - 1) * 100,
            active: value !== 1,
            activeDigits: 1,
            idleDigits: 4
        })
    }
}

export const multiplierMetaOf = (id: FormulaId): MultiplierMeta | undefined =>
    typeof id === 'string' ? MULTIPLIER_META[id as MultiplierId] : undefined

/** @desc 乘子展示名（未登记的 id 退化为 id 本身） */
export const multiplierLabel = (id: FormulaId): string => multiplierMetaOf(id)?.label ?? String(id)

/** @desc 乘子的展示形态（未登记的 id 按倍数展示） */
export const multiplierDisplayOf = (id: FormulaId, value: number, ctx: FormulaCtx): MultiplierDisplay =>
    multiplierMetaOf(id)?.display(value, ctx) ?? { mode: 'factor', digits: 4 }

/**
 * @desc 内核乘区明细 → 界面乘区明细：补上展示名与展示形态。
 *
 * 内核只给 `{ id, value }`，展示数据一律在这里按 id 查；两处调用（旧引擎 / 门面物化）共用同一份口径。
 */
export const multiplierZoneViewOf = (
    zone: { id: FormulaId; value: number },
    ctx: FormulaCtx
): { id: string; label: string; value: number; display: MultiplierDisplay } => ({
    id: String(zone.id),
    label: multiplierLabel(zone.id),
    value: zone.value,
    display: multiplierDisplayOf(zone.id, zone.value, ctx)
})

// ─────────────────────────── 公式元数据 ───────────────────────────

export interface FormulaMeta {
    label: string
    /** 该公式的条目能否暴击（结果页据此决定「暴击 / 不暴击」两列是否显示占位符） */
    canCrit: (panel: CharacterPanel, ctx: FormulaCtx) => boolean
    critFallback: 'expected'
    /** 是否需要推导伤害类型（与内核无关，调用方据此决定要不要算） */
    reportsDamageTypes: boolean
    /** 会把倍率追加到基值上的作用 id */
    ratioBoosts: readonly string[]
}

const coeffCanCrit = (panel: CharacterPanel): boolean => (panel.zones.critRate ?? 0) > 0

export const FORMULA_META: Record<FormulaKey, FormulaMeta> = {
    direct: {
        label: '直伤',
        canCrit: () => true,
        critFallback: 'expected',
        reportsDamageTypes: true,
        ratioBoosts: ['extraRatio']
    },
    tune: {
        label: '处决 / 偏谐响应',
        canCrit: coeffCanCrit,
        critFallback: 'expected',
        reportsDamageTypes: true,
        ratioBoosts: ['extraRatio']
    },
    effect: {
        label: '效应',
        canCrit: coeffCanCrit,
        critFallback: 'expected',
        reportsDamageTypes: true,
        ratioBoosts: ['extraRatio']
    },
    fixed: {
        label: '固定值',
        canCrit: () => false,
        critFallback: 'expected',
        reportsDamageTypes: true,
        ratioBoosts: []
    }
}

export const formulaMetaOf = (id: FormulaId): FormulaMeta | undefined =>
    typeof id === 'string' ? FORMULA_META[id as FormulaKey] : undefined

/** @desc 公式展示名（未登记的 id 退化为 id 本身） */
export const formulaLabel = (id: FormulaId): string => formulaMetaOf(id)?.label ?? String(id)

/** @desc 该公式的条目能否暴击（结果页据此决定「暴击 / 不暴击」两列是否显示占位符） */
export const formulaCanCrit = (id: FormulaId, panel: CharacterPanel, ctx: FormulaCtx): boolean =>
    formulaMetaOf(id)?.canCrit(panel, ctx) ?? false

/** @desc 该公式是否需要推导伤害类型 */
export const formulaReportsDamageTypes = (id: FormulaId): boolean => formulaMetaOf(id)?.reportsDamageTypes === true
