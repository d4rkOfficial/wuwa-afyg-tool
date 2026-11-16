/**
 * @desc 词条落点表（**工具箱业务**）：词条 label → 面板作用 id / 元素加成 / 类型加成。
 *
 * 内核不认识词条名：编译期在这里把 label 解析成作用 id（元素/类型加成再折成 per-伤害的 `bonusDmg`）。
 */
import { ELEMENT_BONUS_MAP, TYPE_BONUS_MAP } from '$lib/consts/game-terms'
import type { PanelDim } from '$coconut/actions'

/** @desc 倍率串的基准后缀 → 面板维度（语料只活在工具箱：内核收的是纯倍数 + 维度 id） */
export const BASE_SUFFIXES: readonly (readonly [string, PanelDim])[] = [
    ['生命', 'hp'],
    ['防御', 'def'],
    ['攻击', 'atk']
]

/** @desc 通用增伤作用 id（编译器把属性/类型加成折进它） */
export const BONUS_DMG_ACTION = 'bonusDmg'

/** @desc 倍率串不带基准时读哪一维 */
export const DEFAULT_PANEL_DIM = 'atk' as const

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

/** @desc 全部词条 → 写入点（元素/类型加成由常量映射推导，不重复罗列） */
export const STAT_WRITES: Record<string, StatWrite> = {
    ...Object.fromEntries(Object.entries(ACTION_STATS).map(([label, action]) => [label, { kind: 'action', action }])),
    ...Object.fromEntries(Object.keys(ELEMENT_BONUS_MAP).map((label) => [label, { kind: 'elementBonus' }])),
    ...Object.fromEntries(Object.keys(TYPE_BONUS_MAP).map((label) => [label, { kind: 'typeBonus' }])),
    治疗加成: { kind: 'none' }
}

/** @desc 词条 label → 面板作用 id（元素/类型加成没有单一落点，返回 null） */
export const statActionOf = (label: string): string | null => {
    const write = STAT_WRITES[label]
    return write?.kind === 'action' ? write.action : null
}
