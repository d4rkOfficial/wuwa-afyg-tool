/**
 * @desc 数据分析弹窗（`data-analysis-modal.svelte`）拆分后，外壳与 `analysis/` 各分区组件共享的数据形状。
 *
 * 这些形状只服务结果页这一个弹窗（外壳 `$derived` 产出、分区组件消费），故与组件同目录；
 * 按 AGENTS §4，只有跨路由复用的类型才放 `$lib/`。
 */

/** @desc 时间记点：参考线 id + 秒数（null = 名称解析不出、未填写） */
export interface Timing {
    refLineId: string
    seconds: number | null
}

/** @desc 选中范围统计口径（总计 = 整段，时段 = 该段）：KPI 大卡片与分段表合计行共用 */
export interface RangeStats {
    damage: number
    entryCount: number
    perChar: Record<string, { damage: number; count: number }>
    effectDamages: Record<string, number>
    effectElements: Record<string, string>
    effectCounts: Record<string, number>
    span: number
    dps: number
}

/** @desc KPI「角色伤害」卡：配队角色按当前口径伤害降序（头像叠底、元素色上色） */
export interface CharCard {
    character: string
    damage: number
    count: number
    element: string
    icon: string
}

/** @desc KPI「效应伤害」卡：非配队条目按来源效应分流，按当前口径伤害降序（元素色上色，无叠底图） */
export interface EffectCard {
    label: string
    damage: number
    count: number
    element: string
}

/** @desc 单个 DPS 分段（两个相邻时间记点之间） */
export interface DpsSegment {
    startSeconds: number
    endSeconds: number
    totalDamage: number
    entryCount: number
    charDamages: Record<string, number>
    charCounts: Record<string, number>
    effectDamages: Record<string, number>
    effectElements: Record<string, string>
    effectCounts: Record<string, number>
}

/** @desc 分段合计（与分段表内部一致） */
export interface SegTotals {
    perChar: Record<string, number>
    effectDamages: Record<string, number>
    total: number
}

/** @desc 伤害占比条的一项：配队角色在前、效应分流在后，颜色为元素色 + 按贡献淡化 */
export interface ShareItem {
    key: string
    label: string
    damage: number
    color: string
}
