/**
 * @desc 计算核的**值协议注册域**：倍率串基准后缀、缺省维度、通用增伤作用 id。
 *
 * 这里放的是「内核与调用方之间的书写约定」，不是游戏实体知识：
 * 调用方按这些约定写倍率串与词条落点，内核按同一份数据解析。
 */
import type { PanelDim } from '$coconut/actions'

/**
 * @desc 倍率串的基准后缀 → 面板三维维度（`'200%生命'` 读生命上限）。
 *
 * 这张表是协议数据：计算代码里不出现基准名字，只在解析时查它。
 */
export const BASE_SUFFIXES: readonly (readonly [string, PanelDim])[] = [
    ['生命', 'hp'],
    ['防御', 'def'],
    ['攻击', 'atk']
]

/** @desc 倍率串不带基准后缀时读哪一维（缺省攻击） */
export const DEFAULT_PANEL_DIM: PanelDim = 'atk'

/** @desc 通用增伤作用的 id：调用方把「属性 / 伤害类型加成」折进通用增伤时用它 */
export const BONUS_DMG_ACTION = 'bonusDmg'
