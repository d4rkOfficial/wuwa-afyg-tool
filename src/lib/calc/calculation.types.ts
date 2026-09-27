/** @desc 拉表页的伤害条目：由排轴时间线中的伤害块/非直伤条目派生而来，是「给谁配 Buff」的最小粒度 */
export interface DamageEntry {
    id: string
    character?: string
    skillType?: string
    hitName: string
    displayName: string
    isEffect: boolean
    isTuneBreak: boolean
    isTuneResponse: boolean
    ratioValue: number
    ratioUnit: '%' | 'fixed'
    damageBaseType: string
    damageElement: string
    sourceTimelineBlockId: string
    burstLayers?: number
    hits: number
}

/** @desc 乘区定义：id 对应计算引擎乘区键，label 为界面显示名，unit 表示数值单位（百分比/固定值） */
import type { ZoneId } from './calculation.consts'

export interface ZoneDef {
    id: string
    label: string
    unit: '%' | 'flat'
}

/** @desc 乘区引用：把某个角色属性（白值/面板等）按「超过阈值后的部分 ÷divisor×multiplier」折算进当前乘区（可带上下限 clamp、离散取整） */
export interface ZoneRef {
    characterIdx: number
    zoneId: string
    threshold: number
    pct: number
    lower?: number
    upper?: number
    discrete?: boolean
    divisor?: number
    multiplier?: number
}

/** @desc Buff 乘区值：普通数值或引用（引用时 value 不使用，实际值由 ref 计算） */
export type BuffValue = number | ZoneRef

/** @desc 一个 Buff 块内多个乘区的集合（key 为 ZoneId） */
export type Buff = Partial<Record<ZoneId, BuffValue>>

export interface BuffZoneValue {
    zoneId: ZoneId
    value: number
    ref?: ZoneRef
    override?: boolean
    /**
     * @desc ── 乘区级生效条件（条件挂在具体乘区上）──
     * 可挂：伤害类型条件、伤害属性条件
     * 不可挂：链条件、阶条件 —— 二者是**整个 Buff 的硬性条件**，只能设在 Buff 实例级（`BuffInstance.condition`）。
     * 不满足时仅该乘区不计入，同一条目的其它乘区照常生效。
     */
    condition?: BuffCondition
}

// ── 一切皆 buff：生效条件（链条件 / 阶条件 / 伤害类型 / 伤害属性）──

/**
 * @desc 生效条件。按「挂载位置」区分能力：
 * - **Buff 实例级**（`BuffInstance.condition`）：链条件、阶条件是硬性条件只能挂这里；也可挂类型/属性条件
 * - **乘区级**（`BuffZoneValue.condition`）：只允许类型 / 属性条件（链阶由实例级统一把关）
 * `logic` 决定各子句之间的组合方式（默认 and：全部满足）。
 */
export interface BuffCondition {
    logic?: 'and' | 'or'
    /** @desc 链条件：角色共鸣链档位 ≥ min（硬性条件，仅 Buff 实例级） */
    chains?: { charIdx: number; min: number }[]
    /** @desc 阶条件：武器精炼档位 ≥ min（硬性条件，仅 Buff 实例级） */
    refinements?: { charIdx: number; min: number }[]
    /** @desc 兼容旧结构：等价于 chains=[{ charIdx: conditionRefCharIdx, min: chain }] */
    chain?: number
    /** @desc 兼容旧结构：等价于 refinements=[{ charIdx: conditionRefCharIdx, min: refinement }] */
    refinement?: number
    /** @desc 伤害属性条件（多选，任一匹配即满足） */
    elements?: string[]
    /** @desc 伤害类型条件（多选，任一匹配即满足） */
    damageTypes?: string[]
}

/** @desc 同名变体：同一 Buff 实例下可配置多个同名乘区条目，各自带独立子条件与数值 */
export interface BuffVariant {
    id: string
    /** @desc 变体标签（界面区分用，如同名多乘区的「形态A」） */
    label?: string
    /** @desc 变体级子条件：不满足时该变体提供的乘区不计入 */
    condition?: BuffCondition
    /** @desc 该变体提供的乘区（可含引用转模 / 覆盖） */
    zones: BuffZoneValue[]
}

/** @desc Buff 实例来源：user=用户创建/迁移，builtin=引擎内置源（角色/武器/声骸/敌人/公式域） */
export type BuffSource = 'user' | 'builtin'

/**
 * @desc Buff 类实例（一切皆 buff 的统一载体）：一个实例持有一组同名的「变体」，每个变体提供乘区并带自己的子条件。
 * `scope` 决定作用范围：'all'=全队 / 角色槽位数组 / 空数组=仅效应伤害。
 */
export interface BuffInstance {
    id: string
    name: string
    /** @desc 同名变体列表；兼容期允许直接用 zones 表达单变体 */
    variants?: BuffVariant[]
    /** @desc 单变体快捷写法（与 variants 二选一；迁移与导入均归一化为 variants，并同步为首个变体的乘区视图） */
    zones: BuffZoneValue[]
    scope: 'all' | number[]
    starred?: boolean
    global?: boolean
    /** @desc 生效条件（整块外部门，满足后才逐变体判定子条件） */
    condition?: BuffCondition
    /** @desc 兼容旧结构：链/精炼条件的参考角色槽位 */
    conditionRefCharIdx?: number
    source?: BuffSource
    /** @desc 来源标注（角色 / 武器 / 声骸 / 套装 / 内置域），用于界面溯源与分组 */
    origin?: { entity?: string; kind?: string }
}

/** @desc 拉表页「某段伤害」的配置：伤害类型（条件判定写在 Buff 乘区上，不在此） */
export interface DamageEntryConfig {
    damageTypes?: string[]
}

/** @desc 拉表页计算状态的持久化快照（工程保存/导出用）：Buff 实例列表、条目↔Buff 绑定、条目配置 */
export interface CalcState {
    buffSets: BuffInstance[]
    damageEntryBuffSetIds: Record<string, string[]>
    damageEntryDamageTypes: Record<string, string[]>
    /** @desc 条目↔变体细粒度绑定：entryId → buffSetId → 变体 id 列表（缺省表示全部变体生效） */
    damageEntryBuffVariantIds?: Record<string, Record<string, string[]>>
}

/** @desc 兼容别名：Buff 块 == Buff 类实例 */
export type BuffSet = BuffInstance
