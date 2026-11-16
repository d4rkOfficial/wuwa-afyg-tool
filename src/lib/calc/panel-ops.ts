/**
 * @desc 面板操作补充（工具箱自用）：拷贝、取单值、写模式类型。
 *
 * 内核只保留「建面板 / 写作用 / 算合计」三件事，这三样留在 app。
 */
import type { CharacterPanel } from '$coconut'

/** @desc 单次写入的形态 */
export type ZoneWrite = 'add' | 'override'

/** @desc 深拷贝面板（增删写入时用；引用型值的写入不得串味到原面板） */
export const clonePanel = (panel: CharacterPanel): CharacterPanel => ({
    zones: { ...panel.zones },
    base: { ...panel.base },
    total: { ...panel.total },
    elementBonus: { ...panel.elementBonus },
    typeBonus: { ...panel.typeBonus }
})

/** @desc 读某作用的落值（缺省 0） */
export const zoneOf = (panel: CharacterPanel, actionId: string): number => panel.zones[actionId] ?? 0
