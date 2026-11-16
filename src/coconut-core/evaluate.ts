/**
 * @desc 公式链的唯一求值实现：给定「基值 + 两侧面板 + 属性」，产出乘区明细与乘积。
 *
 * 内核与工具箱都调它：基值怎么解析由调用方决定（内核按倍率串、工具箱按条目的复合倍率），
 * 但**乘子怎么算只有这一份**。
 */
import { FORMULAS, type FormulaCtx, evaluateHandle } from '$coconut/formulas'
import type { CharacterPanel, TargetPanel } from '$coconut/panel'
import type { CalculationFormula } from '$coconut/general-table'
import type { MultiplierZone } from '$coconut/result'

/** @desc 求值输入 */
export interface FormulaEvaluationInput {
    formula: CalculationFormula
    /** @desc 单段基值（已含倍率与额外倍率修正） */
    baseValue: number
    /** @desc 伤害属性 */
    element: string
    panel: CharacterPanel
    target: TargetPanel
    /** @desc 元素加成合计（%）；缺省按面板里该属性的词条加成 */
    elementBonus?: number
    /** @desc 类型加成合计（%）；工具箱已把类型加成折进 `bonusDmg` 时缺省 0 */
    typeBonus?: number
}

/** @desc 求值结果 */
export interface FormulaEvaluation {
    /** @desc 乘区明细（顺序 = 公式链规范顺序） */
    multipliers: MultiplierZone[]
    /** @desc 含暴击率的乘子乘积 */
    product: number
    /** @desc 不含暴击区的乘子乘积 */
    productNoCrit: number
    /** @desc 该公式在本面板下是否吃暴击 */
    canCrit: boolean
    /** @desc 暴击伤害倍率（`critDmg / 100`） */
    critDmgRatio: number
}

/** @desc 组装公式上下文（类型加成由调用方预先折进 `bonusDmg`，这里只按属性取元素加成） */
export const formulaCtxOf = (input: FormulaEvaluationInput): FormulaCtx => ({
    panel: input.panel,
    target: input.target,
    element: input.element,
    damageTypes: [],
    elementBonus: input.elementBonus ?? input.panel.elementBonus[input.element] ?? 0,
    typeBonus: input.typeBonus ?? 0
})

/** @desc 求值一条公式链 */
export const evaluateFormula = (input: FormulaEvaluationInput): FormulaEvaluation => {
    const def = FORMULAS[input.formula]
    const ctx = formulaCtxOf(input)
    const multipliers: MultiplierZone[] = []
    let product = 1
    let productNoCrit = 1
    for (const handle of def.chain) {
        const value = evaluateHandle(handle, ctx)
        product *= value
        if (handle.id !== 'crit') productNoCrit *= value
        multipliers.push({ id: handle.id, label: handle.label, value, display: handle.display(value, ctx) })
    }
    return {
        multipliers,
        product,
        productNoCrit,
        canCrit: def.canCrit(input.panel, ctx),
        critDmgRatio: (input.panel.zones.critDmg ?? 0) / 100
    }
}
