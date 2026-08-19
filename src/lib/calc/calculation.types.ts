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
}

// 生效条件（可同时设置多项，全部满足才生效）：
//   chain      = 角色共鸣链 ≥ chain（1-6）
//   refinement = 武器精炼 ≥ refinement（1-5）
//   elements   = 伤害属性（多选，含物理）
//   damageTypes= 伤害类型（多选，普攻/重击/…伤害）
/** @desc Buff 生效条件（可同时设置多项，全部满足才生效）：chain=角色共鸣链≥n；refinement=武器精炼≥n；elements=伤害属性（多选）；damageTypes=伤害类型（多选） */
export interface BuffCondition {
    chain?: number
    refinement?: number
    elements?: string[]
    damageTypes?: string[]
}

/** @desc Buff 块：一组乘区值 + 作用范围（all=全队 / 角色槽位数组 / 空数组=仅效应伤害）+ 全局/收藏/生效条件标记 */
export interface BuffSet {
    id: string
    name: string
    zones: BuffZoneValue[]
    scope: 'all' | number[]
    starred?: boolean
    global?: boolean
    condition?: BuffCondition
    conditionRefCharIdx?: number
}

/** @desc 拉表页计算状态的持久化快照（工程保存/导出用）：Buff 块列表、条目↔Buff 绑定、条目↔伤害类型绑定 */
export interface CalcState {
    buffSets: BuffSet[]
    damageEntryBuffSetIds: Record<string, string[]>
    damageEntryDamageTypes: Record<string, string[]>
}
