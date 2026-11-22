/**
 * @desc **版本链**：鸣潮每一版带来的核心改动都在这里，写成一串「上一版 + 本版新增」的对象。
 *
 * 只有最后一版被应用使用（`config`）；前面的版本是口径历史，`satisfies CoconutCoreConfig`
 * 保证它们仍然是一份合法配置。新增一个版本＝复制上一块、改 `actions` / `multipliers` / `formulas`。
 *
 * 两条硬约束（内核 `createFormulaRegistry` 当场校验）：
 * 1. 公式链里的乘子必须按 `ORDER_x` 的顺序出现；
 * 2. 乘子序里新增的乘区，链里也必须在同一相对位置。
 */
import type { CoconutCoreConfig } from '$coconut-core'
import {
    ACTIONS_1_0,
    CONSTANTS,
    EFFECT_COEFF,
    ENEMY_COEFF,
    PANEL_CONFIG,
    RATIO_ZONE,
    refSourcesOf,
    TARGET_FIELDS,
    TUNE_BREAK_BOOST,
    TUNE_STRAIN_LAYER,
    UNISON_BOON_LAYER
} from './data'
import {
    chainOf,
    coeffChain,
    directChain,
    FIXED,
    formula,
    ORDER_1_0,
    ORDER_2_0,
    ORDER_3_0,
    ORDER_3_7,
    PANEL_STAT,
    TARGET_COEFF,
    ZONE_EFFECT
} from './formulas'

const ACTIONS_2_0 = [...ACTIONS_1_0, EFFECT_COEFF]
const ACTIONS_3_0 = [...ACTIONS_2_0, TUNE_BREAK_BOOST, ENEMY_COEFF, TUNE_STRAIN_LAYER]
const ACTIONS_3_7 = [...ACTIONS_3_0, UNISON_BOON_LAYER]

/** @desc 鸣潮 1.0：直伤与固定值，双暴按面板 */
export const v1_0 = {
    actions: ACTIONS_1_0,
    refSources: refSourcesOf(ACTIONS_1_0),
    multipliers: chainOf(ORDER_1_0),
    formulas: [formula('direct', PANEL_STAT, directChain(ORDER_1_0), 'panel'), formula('fixed', FIXED, [], 'panel')],
    panel: PANEL_CONFIG,
    targetFields: TARGET_FIELDS,
    constants: CONSTANTS,
    ratioZone: RATIO_ZONE
} satisfies CoconutCoreConfig

/** @desc 鸣潮 2.0：加入效应（效应系数），效应条目以系数基类公式结算 */
export const v2_0 = {
    ...v1_0,
    actions: ACTIONS_2_0,
    refSources: refSourcesOf(ACTIONS_2_0),
    multipliers: chainOf(ORDER_2_0),
    formulas: [...v1_0.formulas, formula('effect', ZONE_EFFECT, coeffChain(ORDER_2_0), 'coefficient')]
} satisfies CoconutCoreConfig

/** @desc 鸣潮 3.0：加入处决（谐度破坏、偏谐系数）与集谐区（集谐干涉层数），并带来谐度区与集谐区 */
export const v3_0 = {
    ...v2_0,
    actions: ACTIONS_3_0,
    refSources: refSourcesOf(ACTIONS_3_0),
    multipliers: chainOf(ORDER_3_0),
    formulas: [
        formula('direct', PANEL_STAT, directChain(ORDER_3_0), 'panel'),
        formula('tune', TARGET_COEFF, coeffChain(ORDER_3_0), 'coefficient'),
        formula('effect', ZONE_EFFECT, coeffChain(ORDER_3_0), 'coefficient'),
        formula('fixed', FIXED, [], 'panel')
    ]
} satisfies CoconutCoreConfig

/** @desc 鸣潮 3.7：加入同奏区 */
export const v3_7 = {
    ...v3_0,
    actions: ACTIONS_3_7,
    refSources: refSourcesOf(ACTIONS_3_7),
    multipliers: chainOf(ORDER_3_7),
    formulas: [
        formula('direct', PANEL_STAT, directChain(ORDER_3_7), 'panel'),
        formula('tune', TARGET_COEFF, coeffChain(ORDER_3_7), 'coefficient'),
        formula('effect', ZONE_EFFECT, coeffChain(ORDER_3_7), 'coefficient'),
        formula('fixed', FIXED, [], 'panel')
    ]
} satisfies CoconutCoreConfig

/** @desc 应用口径：当前游戏版本的一份配置 */
export const config = v3_7
