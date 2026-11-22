/**
 * @desc **公式与乘子序**：基值配方 + 有序乘子链 + 暴击口径。
 *
 * 内核要求「链序 = 乘子注册序」（`createFormulaRegistry` 会当场校验），所以每一版都写一行
 * 完整的乘子序；相邻两行的差别就是那一版新增的乘区。
 *
 * 两条口径写成两个函数，而不是每版抄一遍链：
 * - 直伤吃全部乘区，**不吃**谐度区（谐度区只给处决 / 偏谐响应）；
 * - 系数基类（处决 / 效应）**不吃**增伤区。
 */
import type { CritBase, FormulaDef, FormulaHandle } from '$coconut-core/formulas'
import { MULTIPLIERS, type MultiplierId } from './multipliers'

/** @desc 乘子序（鸣潮 1.0） */
export const ORDER_1_0: readonly MultiplierId[] = [
    'deepen',
    'bonus',
    'vuln',
    'resist',
    'defense',
    'final',
    'special',
    'crit'
]

/** @desc 乘子序（鸣潮 2.0）：效应不新增乘区，沿用 1.0 的乘子序 */
export const ORDER_2_0: readonly MultiplierId[] = [
    'deepen',
    'bonus',
    'vuln',
    'resist',
    'defense',
    'final',
    'special',
    'crit'
]

/** @desc 乘子序（鸣潮 3.0）：处决带来谐度区、集谐带来集谐区，集谐区紧随减防、谐度区在其后 */
export const ORDER_3_0: readonly MultiplierId[] = [
    'deepen',
    'bonus',
    'vuln',
    'resist',
    'defense',
    'tuneStrain',
    'tuneBreak',
    'final',
    'special',
    'crit'
]

/** @desc 乘子序（鸣潮 3.7）：同奏区排在谐度区之后 */
export const ORDER_3_7: readonly MultiplierId[] = [
    'deepen',
    'bonus',
    'vuln',
    'resist',
    'defense',
    'tuneStrain',
    'tuneBreak',
    'unison',
    'final',
    'special',
    'crit'
]

/** @desc 按乘子序取出手柄，可选地去掉若干乘区 */
export const chainOf = (order: readonly MultiplierId[], ...drop: readonly MultiplierId[]): readonly FormulaHandle[] =>
    order.filter((id) => !drop.includes(id)).map((id) => MULTIPLIERS[id])

/** @desc 直伤链：全部乘区，去掉谐度区 */
export const directChain = (order: readonly MultiplierId[]): readonly FormulaHandle[] => chainOf(order, 'tuneBreak')

/** @desc 系数基类链（处决 / 效应）：去掉增伤区 */
export const coeffChain = (order: readonly MultiplierId[]): readonly FormulaHandle[] => chainOf(order, 'bonus')

// ─────────────────────────── 四种基值配方 ───────────────────────────

/** @desc 基值 = 面板合计（维度由条目自己给，缺省为注册的第一个维度） */
const PANEL_STAT = { kind: 'panelStat' } as const

/** @desc 基值 = 目标侧偏谐系数（处决 / 偏谐响应） */
const TARGET_COEFF = { kind: 'targetStat', field: 'coefficient' } as const

/** @desc 基值 = 效应系数落值（先取整） */
const ZONE_EFFECT = { kind: 'zone', id: 'effectCoeff', round: true } as const

/** @desc 基值 = 条目自带的固定伤害值 */
const FIXED = { kind: 'fixed' } as const

/** @desc 公式定义（`id` 同时是界面与表里的公式名） */
export const formula = (
    id: string,
    base: FormulaDef['base'],
    chain: readonly FormulaHandle[],
    critBase: CritBase
): FormulaDef => ({ id, base, chain, critBase })

export { FIXED, PANEL_STAT, TARGET_COEFF, ZONE_EFFECT }

/** @desc 工具箱展示层用的公式名联合（`display-meta.ts` 的 `FORMULA_META` 按它做完备性检查） */
export type FormulaKey = 'direct' | 'tune' | 'effect' | 'fixed'
