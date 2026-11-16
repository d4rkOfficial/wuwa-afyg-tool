/**
 * @desc 计算核的唯一输入结构：**一张扁平表**。
 *
 * 设计约束（对应「内核最小、干净」）：
 * - 表里只有「已经确定的事实」：用哪些角色/武器、哪些词条、哪些 buff 生效、每一段伤害的倍率与属性；
 * - 没有任何条件、规则、链阶、词条方案、技能文案推断 —— 那些是调用方的业务，由调用方求值后压进这张表；
 * - 值一律用字符串表达（`'12.6%'` / `'200%生命'`），单位由字符串自己说清楚，数值精度不在序列化层丢。
 */
import type { PanelDim } from '$coconut/actions'
import type { CritActionId } from '$coconut/formulas'
import { BASE_SUFFIXES, DEFAULT_PANEL_DIM } from '$coconut/stats'

/** @desc 属性（伤害元素）。取值见 `ELEMENTS`（物理 冷凝 热熔 导电 气动 衍射 湮灭） */
export type ElementEnum = string
/** @desc 敌人类型（处决 / 偏谐响应按类型取基值系数） */
export type EnemyTypeEnum = string

/** @desc 伤害公式：直伤 / 处决与偏谐响应 / 效应 / 固定值 */
export type CalculationFormula = 'direct' | 'tune' | 'effect' | 'fixed'

/** @desc 角色侧属性作用（攻击固定值 / 暴击率 / 增伤 …），取值见 `ACTIONS` 里 `side: 'character'` 的 id */
export type CharacterStatEnum = string

/** @desc 目标侧属性作用（减防 / 减抗 / 穿免 …），取值见 `ACTIONS` 里 `side: 'target'` 的 id */
export type EnemyStatEnum = string

/** @desc 乘子级作用（同奏层数 / 集谐层数 …），取值见 `ACTIONS` 里的乘子输入 id */
export type MultiEnum = string

/** @desc 暴击率（落点 id 由乘子声明推导） */
export type CritRate = CritActionId
/** @desc 暴击伤害（落点 id 由乘子声明推导） */
export type CritDMG = CritActionId

/** @desc 一条 buff 作用的落点 */
export type ApplyToEnum = CharacterStatEnum | EnemyStatEnum | MultiEnum | CritRate | CritDMG

/** @desc 词条键（攻击% / 生命 / 暴击率 …），落点表见 `STAT_ACTIONS` */
export type StatKeyEnum = string

/** @desc 一条词条：键 + 值（`'12.6%'` / `'150'`） */
export interface Stat {
    key: StatKeyEnum
    value: string
}

/**
 * @desc 引用（转模）：把某个面板量按单位换算后作为本条作用的数值。
 *
 * `baseLine` 是起算线（低于它的部分不参与），`sourceUnit` / `targetUnit` 表达换算
 * （`'%'` ↔ 数值：`%` → 数值 = ×100），结果夹在 `[lowerLimit, Upperlimit]` 内。
 */
export interface StatRef {
    refStat: StatKeyEnum
    baseLine: number
    sourceUnit: string
    targetUnit: string
    lowerLimit: number
    Upperlimit: number
}

/** @desc buff 作用的数值：字面值或引用 */
export type BuffValue = string | StatRef

/** @desc 一条 buff 作用 */
export interface BuffEffect {
    applyTo: ApplyToEnum
    value: BuffValue
}

/** @desc 一条 buff：身份 + 唯一作用 */
export interface Buff {
    id: string
    effect: BuffEffect
}

/** @desc 一段伤害 */
export interface Damage {
    /** @desc 倍率串：`'2.5'` 绝对值 / `'250%'` 百分比 / `'2.5生命'` 生命上限倍数 / 固定值公式时是固定伤害 */
    value: string
    /** @desc 这一段生效的 buff（调用方已经判定完毕，内核不再求值条件） */
    activated_buffs: Buff[]
    /** @desc 属性 */
    element: ElementEnum
    /** @desc 公式 */
    formula: CalculationFormula
}

/** @desc 一个伤害来源（角色 id，或 `非角色` 之类的外部来源标识）的全部伤害 */
export interface DamageEntry {
    source: string
    damages: Damage[]
}

/** @desc 各属性抗性（%），顺序与 `ELEMENTS` 逐项对应 */
export type EnemyBaseResistance = readonly number[]

/** @desc 敌人：`[类型, 等级, 防御, 各属性抗性]` */
export type EnemyInput = readonly [EnemyTypeEnum, number, number, EnemyBaseResistance]

/** @desc 计算核的唯一输入 */
export interface GeneralTable {
    /** @desc 队伍角色 id（下标与 `weapons` / `main_stats` / `sub_stats` 对齐） */
    characters: readonly string[]
    /** @desc 每个角色的武器 id */
    weapons: readonly string[]
    /** @desc 每个角色 1–3 条等效主词条 */
    main_stats: readonly (readonly Stat[])[]
    /** @desc 每个角色 5 条副词条 */
    sub_stats: readonly (readonly Stat[])[]
    /** @desc Buff 目录（被 `Damage.activated_buffs` 引用或直接内联的权威定义） */
    buffs: readonly Buff[]
    /** @desc 全部伤害条目 */
    damage_entries: readonly DamageEntry[]
    /** @desc 敌人 */
    enemy: EnemyInput
}

/** @desc 倍率串解析结果 */
export interface ParsedValue {
    /** @desc 有效倍率（`'250%'` → 2.5，`'2.5'` → 2.5） */
    ratio: number
    /** @desc 基值取自面板三维的哪一项 */
    base: PanelDim
}

/**
 * @desc 解析倍率串：`'2.5'` / `'250%'` / `'2.5生命'` / `'250%生命'`。
 *
 * 约定：不带基准后缀按 `DEFAULT_PANEL_DIM` 算；`%` 表示除以 100。无法解析的输入按 0 处理
 * （不抛错，表来自调用方，坏数据不应该让整次计算崩掉）。
 */
export const parseValue = (value: string): ParsedValue => {
    const text = String(value ?? '').trim()
    let base: PanelDim = DEFAULT_PANEL_DIM
    let rest = text
    for (const [suffix, dim] of BASE_SUFFIXES) {
        if (rest.endsWith(suffix)) {
            base = dim
            rest = rest.slice(0, -suffix.length).trim()
            break
        }
    }
    const percent = rest.endsWith('%')
    if (percent) rest = rest.slice(0, -1).trim()
    const raw = Number.parseFloat(rest)
    if (!Number.isFinite(raw)) return { ratio: 0, base }
    return { ratio: percent ? raw / 100 : raw, base }
}
