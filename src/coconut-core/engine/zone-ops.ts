/**
 * @desc 角色面板与作用写入的唯一实现（决议 D5 / D11 / D15）。
 *
 * 面板的值不再是一堆具名字段，而是 `zones: Record<ActionId, number>`：
 * **每一条「Buff 作用」只声明一次落点与合并语义**（见 `registry/actions.ts`），
 * 本文件按声明泛化执行，不再有「一个乘区一段 lambda」的手抄表。
 *
 * 写入口径：
 *
 * | 声明                       | `add`                | `override`        |
 * | -------------------------- | -------------------- | ----------------- |
 * | `combine: 'sum'`           | `v += value`         | `v = value`       |
 * | `combine: 'sum'` + 不可覆盖 | `v += value`         | 同 `add`（退让）  |
 * | `combine: 'multiply'`      | `v *= 1 + value/100` | `v = 1 + value/100` |
 * | `panel.total` 三维固定值    | `v += value`         | 直接写 `total[dim]` |
 *
 * 「不可覆盖」是**界面能力**（是否给出覆盖开关），引擎侧写模式恒合法 ——
 * 旧实现里它表现为 `addOnly`（overridable=false 的乘区把 override 当 add）。
 */

import { ACTION_MAP, BUFF_ACTIONS, type ActionId, type PanelDim } from '$coconut/engine/registry/actions'
import type { CritBase } from '$coconut/engine/registry/formulas'

export interface PanelTriple {
    atk: number
    hp: number
    def: number
}

/** @desc 角色面板：作用落值 + 白值 + 三维合计 + 词条来源的加成分组 */
export interface CharacterPanel {
    /** @desc 全部角色侧作用的落值（含 `init`） */
    zones: Record<string, number>
    /** @desc 白值（角色 90 级白值 + 武器白值） */
    base: PanelTriple
    /** @desc 三维合计（`recomputeTotals` 的产物） */
    total: PanelTriple
    /** @desc 元素伤害加成（词条来源；键是属性名，不是作用 id） */
    elementBonus: Record<string, number>
    /** @desc 伤害类型加成（词条来源；键是类型短名） */
    typeBonus: Record<string, number>
}

/** @desc 目标面板：敌人配置 + Buff 对目标侧作用的写入（全队一份，按条目构建） */
export interface TargetPanel {
    type: string
    /** @desc 敌人防御（配置初值；引擎只吃这个值，不吃敌人等级） */
    defense: number
    /** @desc 敌人免伤（%） */
    dmgReduction: number
    /** @desc 各属性抗性（%） */
    resistances: Record<string, number>
    /** @desc 目标侧作用的落值（`side: 'target'`，由 Buff 写入） */
    zones: Record<string, number>
}

export const emptyTargetPanel = (): TargetPanel => ({
    type: '',
    defense: 0,
    dmgReduction: 0,
    resistances: {},
    zones: {}
})

/** @desc 单次写入的形态 */
export type ZoneWrite = 'add' | 'override'

/** @desc 三维维度 → 喂该维度的 `flat` / `pct` 作用 id（由注册表的 `panel` 声明推导，不手抄） */
const PANEL_WRITERS: Record<PanelDim, { flat?: string; pct?: string }> = (() => {
    const out: Record<PanelDim, { flat?: string; pct?: string }> = {
        atk: {},
        hp: {},
        def: {}
    }
    for (const action of BUFF_ACTIONS) {
        if (!('panel' in action) || !action.panel) continue
        const { flat, pct } = action.panel as { flat?: PanelDim; pct?: PanelDim }
        if (flat) out[flat].flat = action.id
        if (pct) out[pct].pct = action.id
    }
    return out
})()

const DIMS: readonly PanelDim[] = [
    ...new Set(
        BUFF_ACTIONS.flatMap((a) =>
            a.panel ? [a.panel.flat, a.panel.pct, a.panel.total].filter((d): d is PanelDim => d !== undefined) : []
        )
    )
]

/** @desc 空面板：每个角色侧作用按注册表初值填充（系数口径取 `initCoeff`，双暴从 0% / 100% 起） */
export const emptyPanel = (critBase: CritBase = 'panel'): CharacterPanel => {
    const zones: Record<string, number> = {}
    for (const action of BUFF_ACTIONS) {
        if (action.side !== 'character') continue
        zones[action.id] = critBase === 'coefficient' && action.initCoeff !== undefined ? action.initCoeff : action.init
    }
    return {
        zones,
        base: { atk: 0, hp: 0, def: 0 },
        total: { atk: 0, hp: 0, def: 0 },
        elementBonus: {},
        typeBonus: {}
    }
}

/** @desc 深拷贝面板（增删写入时用；引用型值的写入不得串味到原面板） */
export const clonePanel = (panel: CharacterPanel): CharacterPanel => ({
    zones: { ...panel.zones },
    base: { ...panel.base },
    total: { ...panel.total },
    elementBonus: { ...panel.elementBonus },
    typeBonus: { ...panel.typeBonus }
})

/**
 * @desc 按作用键写入面板（唯一出口）。
 *
 * 未知作用键静默忽略（迁移 / 导入容错）；目标侧作用不写角色面板 ——
 * 它们由 `compute.ts` 的 `targetSideZonesOf` 从绑定的 Buff 直接聚合。
 */
export const applyZone = (panel: CharacterPanel, actionId: string, value: number, write: ZoneWrite = 'add'): void => {
    const def = ACTION_MAP.get(actionId)
    if (!def || def.side !== 'character') return
    const effective: ZoneWrite = write === 'override' && !def.overridable ? 'add' : write

    if (def.combine === 'multiply') {
        const prev = panel.zones[actionId] ?? def.init
        panel.zones[actionId] = effective === 'override' ? 1 + value / 100 : prev * (1 + value / 100)
        return
    }
    if (effective === 'override') {
        if (def.panel?.total) {
            panel.total[def.panel.total] = value
            return
        }
        panel.zones[actionId] = value
        return
    }
    panel.zones[actionId] = (panel.zones[actionId] ?? def.init) + value
}

/** @desc 由 `flat` / `pct` 合计重算三维面板（追加或覆盖乘区后调用，保证转模引用读到最新面板） */
export const recomputeTotals = (panel: CharacterPanel): void => {
    for (const dim of DIMS) {
        const flat = PANEL_WRITERS[dim].flat ? (panel.zones[PANEL_WRITERS[dim].flat!] ?? 0) : 0
        const pct = PANEL_WRITERS[dim].pct ? (panel.zones[PANEL_WRITERS[dim].pct!] ?? 0) : 0
        panel.total[dim] = panel.base[dim] + Math.round(flat + (panel.base[dim] * pct) / 100)
    }
}

/** @desc 读某作用的落值（缺省 0） */
export const zoneOf = (panel: CharacterPanel, actionId: ActionId | string): number => panel.zones[actionId] ?? 0
