/**
 * @desc **注册入口**：把 `$coconut-config` 的当前版本装成内核注册表，并补上工具箱自己的口径。
 *
 * 游戏数据与数学在 `src/coconut-config`（按版本链组织，见其 `versions.ts`）；本文件只做
 * 「实例化 + 展示/业务胶水」：注册表、面板操作转发、公式 id 判定、中文基值类型。
 *
 * `$coconut-core` 的注册辅助函数只允许在本文件与 `src/coconut-config/**` 使用（见
 * `scripts/check-calc-core.mjs` 的单一出口检查）。
 */
import { config as CURRENT, CRIT_ACTION_IDS, PANEL_CONFIG, TARGET_FIELDS } from '$coconut-config'
import { CoconutCore, type ActionId, type CharacterPanel, type CoconutCoreConfig } from '$coconut-core'
import {
    createActionRegistry,
    refWrittenBy as refWrittenByOf,
    writtenByOf as writtenByOfRegistry,
    type ActionRegistry,
    type BuffActionDef,
    type PanelDim,
    type RefSourceDef
} from '$coconut-core/actions'
import { evaluateFormula as evaluateFormulaOf } from '$coconut-core/evaluate'
import type { FormulaEvaluation, FormulaEvaluationInput } from '$coconut-core/evaluate'
import { createFormulaRegistry, type CritBase, type FormulaDef } from '$coconut-core/formulas'
import type { MultiplierId } from '$coconut-config'
import {
    applyZone as applyZoneOf,
    emptyPanel as emptyPanelOf,
    emptyTargetPanel as emptyTargetPanelOf,
    recomputeTotals as recomputeTotalsOf,
    zoneOf as zoneOfOf
} from '$coconut-core/panel'
import { formulaMetaOf } from './display-meta'
import { appPanelOf, clonePanel, type AppPanel } from './panel-ops'

// ─────────────────────────── 当前版本的注册数据 ───────────────────────────

export const BUFF_ACTIONS: readonly BuffActionDef[] = CURRENT.actions

export const REF_SOURCES: readonly RefSourceDef[] = CURRENT.refSources

export const REF_SOURCE_MAP: ReadonlyMap<ActionId, RefSourceDef> = new Map(
    REF_SOURCES.map((source) => [source.id, source])
)

/** @desc 公式定义列表（内核按数组接收，`id` 可为 symbol） */
export const FORMULA_LIST: readonly FormulaDef[] = CURRENT.formulas

/** @desc 乘子注册序（= 当前版本的乘子序，公式链的顺序必须与它一致） */
export const MULTIPLIER_ORDER: readonly MultiplierId[] = CURRENT.multipliers.map((handle) => handle.id as MultiplierId)

/** @desc 公式定义按 id 索引（界面与溯源按公式名取） */
export const FORMULAS: Record<string, FormulaDef> = Object.fromEntries(
    CURRENT.formulas.map((def) => [String(def.id), def])
)

export {
    CHAR_LEVEL_ACTION,
    CONSTANTS,
    CRIT_ACTION_IDS,
    CRIT_MULTIPLIER_ID,
    DEFAULT_CHAR_LEVEL,
    EFFECT_COEFF_ACTION,
    effectiveCritRate,
    MULTIPLIERS,
    PANEL_CONFIG,
    RATIO_ZONE,
    TARGET_FIELDS,
    TUNE_BREAK_BOOST_ACTION
} from '$coconut-config'
export type { CalcActionId, FormulaKey, MultiplierId } from '$coconut-config'

// ─────────────────────────── 工具箱口径（不进内核） ───────────────────────────

/** @desc 缺省基值类型（表里没填「伤害基准」时用） */
export const PANEL_BASE_DEFAULT = '攻击'

/** @desc 中文基值类型 → 面板维度与展示单位（表里的「伤害基准」就是这几个词） */
export const PANEL_BASE_TYPES: Record<string, { dim: PanelDim; unit: string }> = {
    攻击: { dim: 'atk', unit: '攻击' },
    生命: { dim: 'hp', unit: '生命' },
    防御: { dim: 'def', unit: '防御' },
    偏谐系数: { dim: 'atk', unit: '偏谐系数' }
}

// ─────────────────────────── 注册表实例（模块级唯一） ───────────────────────────

export const buildCoconutCoreConfig = (): CoconutCoreConfig => CURRENT

const ACTIONS: ActionRegistry = createActionRegistry(BUFF_ACTIONS, REF_SOURCES, {
    panel: PANEL_CONFIG,
    targetFields: TARGET_FIELDS
})

const FORMULA_REGISTRY = createFormulaRegistry({
    multipliers: CURRENT.multipliers,
    formulas: FORMULA_LIST,
    actions: ACTIONS
})

/** @desc 注册层的内核实例（与 `buildCoconutCoreConfig()` 同源） */
export const createCoconutCore = (): CoconutCore => new CoconutCore().init(CURRENT)

// ─────────────────────────── 注册层导出的纯辅助 ───────────────────────────

export const ACTION_MAP: ReadonlyMap<ActionId, BuffActionDef> = ACTIONS.map

export const writtenByOf = (dim: PanelDim): ActionId[] => writtenByOfRegistry(ACTIONS, dim)

const refWrittenByMap = (refId: ActionId): ActionId[] => {
    const dimOf: Record<string, PanelDim> = {
        baseAtk: 'atk',
        totalAtk: 'atk',
        baseHp: 'hp',
        totalHp: 'hp',
        baseDef: 'def',
        totalDef: 'def'
    }
    const dim = typeof refId === 'string' ? dimOf[refId] : undefined
    if (dim)
        return BUFF_ACTIONS.filter((a) => a.panel?.flat === dim || a.panel?.pct === dim || a.panel?.total === dim).map(
            (a) => a.id
        )
    return REF_SOURCE_MAP.has(refId) ? [refId] : []
}

export const refWrittenBy = (refId: ActionId): ActionId[] =>
    refWrittenByOf(ACTIONS, refId).length > 0 ? refWrittenByOf(ACTIONS, refId) : refWrittenByMap(refId)

export const emptyPanel = (critBase: CritBase = 'panel'): AppPanel => appPanelOf(emptyPanelOf(ACTIONS, critBase))

export const emptyTargetPanel = emptyTargetPanelOf

export const applyZone = (
    panel: CharacterPanel,
    actionId: ActionId,
    value: number,
    write: 'add' | 'override' = 'add'
): void => applyZoneOf(ACTIONS, panel, actionId, value, write)

export const recomputeTotals = (panel: CharacterPanel): void => recomputeTotalsOf(ACTIONS, panel)

export { clonePanel }

export const zoneOf = zoneOfOf

export const evaluateFormula = (input: FormulaEvaluationInput): FormulaEvaluation =>
    evaluateFormulaOf(FORMULA_REGISTRY, input)

export const formulaAcceptsRef = (critBase: CritBase, actionId: ActionId): boolean =>
    !(critBase === 'coefficient' && CRIT_ACTION_IDS.includes(actionId))

export const formulaOf = (entry: { formula: string; ratioUnit: string }): string =>
    entry.formula === 'direct' && entry.ratioUnit === 'fixed' ? 'fixed' : entry.formula

export const isEffectEntry = (entry: { formula: string }): boolean => entry.formula === 'effect'

export const usesCoefficientFormula = (entry: { formula: string; ratioUnit: string }): boolean =>
    FORMULAS[formulaOf(entry)]!.critBase === 'coefficient'

export const formulaActionClosure = (id: string): Set<string> => {
    const out = new Set<string>()
    for (const handle of FORMULAS[id]!.chain) {
        for (const input of handle.inputs) {
            if (typeof input !== 'string') continue
            if (input.startsWith('target.')) {
                out.add(input.slice('target.'.length))
                continue
            }
            if (input.startsWith('const.')) continue
            out.add(input)
        }
    }
    for (const boost of formulaMetaOf(id)?.ratioBoosts ?? []) out.add(boost)
    const base = FORMULAS[id]!.base
    if (base.kind === 'panelStat' && base.dim !== undefined) out.add(base.dim)
    if (base.kind === 'zone') out.add(String(base.id))
    if (base.kind === 'targetStat') out.add('enemyCoeff')
    return out
}

export type {
    ActionCombine,
    ActionSide,
    ActionRegistry,
    BuffActionDef,
    CritBase,
    FormulaCtx,
    FormulaDef,
    FormulaHandle,
    MultiplierDef,
    PanelDim,
    RefSourceDef
} from '$coconut-core'
export type { FormulaEvaluation, FormulaEvaluationInput } from '$coconut-core/evaluate'
