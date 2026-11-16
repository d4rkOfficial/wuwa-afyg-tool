/**
 * @desc 词条注册表：**词条 label → 它写进面板的哪里**。
 *
 * 词条（声骸主词条 / 副词条 / 武器副词条）与 Buff 作用共用同一套落点，只是入口不同：
 * 面板作用直接写 `zones`，元素 / 类型加成写进面板的两份加成分组（增伤区按条目属性 / 类型取用）。
 */
import { ELEMENT_BONUS_MAP, TYPE_BONUS_MAP } from '$lib/consts/game-terms'

export type StatWrite =
    | { kind: 'action'; action: string }
    | { kind: 'elementBonus' }
    | { kind: 'typeBonus' }
    /** @desc 不进伤害公式的词条（如治疗加成） */
    | { kind: 'none' }

/** @desc 只由单个面板作用承载的词条 */
const ACTION_STATS: Record<string, string> = {
    攻击: 'atkFlat',
    生命: 'hpFlat',
    防御: 'defFlat',
    '攻击%': 'atkPct',
    '生命%': 'hpPct',
    '防御%': 'defPct',
    暴击率: 'critRate',
    暴击伤害: 'critDmg',
    共鸣效率: 'recharge'
}

/**
 * @desc 全部词条 → 写入点。元素 / 类型加成由常量映射推导（`冷凝伤害加成` → 元素加成、`普攻伤害加成` → 类型加成），
 * 不在这里重复罗列。
 */
export const STAT_WRITES: Record<string, StatWrite> = {
    ...Object.fromEntries(Object.entries(ACTION_STATS).map(([label, action]) => [label, { kind: 'action', action }])),
    ...Object.fromEntries(Object.keys(ELEMENT_BONUS_MAP).map((label) => [label, { kind: 'elementBonus' }])),
    ...Object.fromEntries(Object.keys(TYPE_BONUS_MAP).map((label) => [label, { kind: 'typeBonus' }])),
    治疗加成: { kind: 'none' }
}
