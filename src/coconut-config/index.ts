/**
 * @desc 计算核的注册配置包：游戏数据（`data.ts`）、乘子（`multipliers.ts`）、公式与乘子序
 * （`formulas.ts`）、版本链（`versions.ts`）。对外只暴露当前版本的 `config` 与注册层要用的常量。
 */
export { config, v1_0, v2_0, v3_0, v3_7 } from './versions'
export { CRIT_ACTION_IDS, CRIT_MULTIPLIER_ID, effectiveCritRate, MULTIPLIERS } from './multipliers'
export type { MultiplierId } from './multipliers'
export type { FormulaKey } from './formulas'
export {
    CHAR_LEVEL_ACTION,
    CONSTANTS,
    DEFAULT_CHAR_LEVEL,
    EFFECT_COEFF_ACTION,
    PANEL_CONFIG,
    RATIO_ZONE,
    refSourcesOf,
    TARGET_FIELDS,
    TUNE_BREAK_BOOST_ACTION
} from './data'
export type { CalcActionId } from './data'
