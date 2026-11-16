/**
 * @desc 计算核的公共出口（**导出库的唯一入口**）。
 *
 * 只暴露纯计算所需的东西：请求对象 + 结果形状 + 注册表 + 溯源。
 * 纯度由 `scripts/check-calc-core.mjs` 把关 —— 从本文件出发的 import 闭包不允许出现
 * `$app/*`、`$lib/data/*`、`*.svelte.ts`（Runes store），也不允许触达副词条分析算法。
 *
 * 构建：`node scripts/build-calc-lib.mjs` → `dist/calc-core/index.js`（单文件 ESM，零外部依赖）。
 * 类型：直接引用 `src/coconut-core/engine/core/index.ts`（TS 消费方按源码取类型）。
 */

// ── 纯计算入口（请求对象）──
export { computeEntry, computeProject, type ComputeRequest } from './engine'

// ── 结果形状 ──
export type { MultiplierDisplay, MultiplierZone, RatioFactor, ResultEntry } from '$lib/calc/result.types'

// ── 输入形状 ──
export type {
    BuffCondition,
    BuffInstance,
    BuffRule,
    BuffZoneValue,
    CalculationFormulaId,
    DamageEntry,
    EnemyTypeKind,
    ZoneRef
} from '$lib/calc/calculation.types'
export type { CharEchoConfig, ConfigState, EchoSlotConfig, EnemyConfig } from '$lib/calc/config.types'
export { DEFAULT_CONDITION_PROFILE, type ConditionProfile } from '$lib/calc/compute'

// ── 注册表（自描述能力：作用 / 乘子 / 公式 / 引用来源）──
export {
    ACTION_GROUPS,
    ACTION_MAP,
    BUFF_ACTIONS,
    DISPLAY_ONLY_ACTIONS,
    REF_SOURCES,
    REF_SOURCE_MAP,
    actionAllowsCondition,
    refWrittenBy,
    writtenByOf,
    type BuffActionDef
} from '$coconut/actions'
export {
    FORMULAS,
    MULTIPLIER_ORDER,
    MULTIPLIERS,
    PANEL_BASE_TYPES,
    formulaActionClosure,
    formulaOf,
    type CalculationFormulaId as FormulaId,
    type FormulaDef,
    type MultiplierId
} from '$coconut/formulas'

// ── 交换格式（字符串值只在导出边界出现）──
export {
    decodeBuff,
    decodeEffect,
    decodeValue,
    encodeBuff,
    encodeEffect,
    encodeValue,
    type EncodedBuff,
    type EncodedEffect,
    type ValueUnit
} from './codec'

// ── 溯源（结果核验 / 贡献分解）──
export {
    buildDamageSegments,
    type DamageFactorRow,
    type DamageSegment,
    type DamageSegments,
    type DamageTraceCtx,
    type TracePart
} from '$lib/calc/damage-trace'

// ── 面板（两侧）──
export type { CharacterPanel, PanelTriple, TargetPanel } from '$coconut/panel'
