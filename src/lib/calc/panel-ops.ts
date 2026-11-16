/**
 * @desc 面板操作补充（工具箱自用）：拷贝、取单值、写模式类型。
 *
 * 内核只保留「建面板 / 写作用 / 算合计」三件事，这三样留在 app。
 * 「元素加成 / 伤害类型加成」是工具箱自己的口径（内核只认 `bonusDmg` 一个作用），
 * 所以它们挂在 app 的 `AppPanel` 上，不进内核的面板类型。
 */
import type { CharacterPanel } from '$coconut'

/** @desc 单次写入的形态 */
export type ZoneWrite = 'add' | 'override'

/** @desc 工具箱用的面板：内核面板 + 元素/类型加成表 */
export interface AppPanel extends CharacterPanel {
    elementBonus: Record<string, number>
    typeBonus: Record<string, number>
}

/** @desc 给内核面板补上工具箱自己的两张加成表（初值为空表） */
export const appPanelOf = (panel: CharacterPanel): AppPanel => ({ ...panel, elementBonus: {}, typeBonus: {} })

/** @desc 深拷贝面板（增删写入时用；引用型值的写入不得串味到原面板） */
export const clonePanel = (panel: AppPanel): AppPanel => ({
    zones: { ...panel.zones },
    base: { ...panel.base },
    total: { ...panel.total },
    elementBonus: { ...panel.elementBonus },
    typeBonus: { ...panel.typeBonus }
})

/** @desc 读某作用的落值（缺省 0） */
export const zoneOf = (panel: CharacterPanel, actionId: string): number => panel.zones[actionId] ?? 0
