/**
 * @desc 计算核的输出结构：**每段伤害一条**，字段只描述这一段的数值与乘区明细。
 *
 * 与「界面结果表」解耦：界面需要什么列、怎么分组、怎么溯源，由调用方自己从这些字段派生。
 */
import type { CharacterPanel, TargetPanel } from '$coconut/panel'
import type { CalculationFormula } from '$coconut/general-table'

/** @desc 乘区的展示参数（格式化在调用方） */
export interface MultiplierDisplay {
    /** @desc `delta`：展示为「+x%」；`factor`：展示为「×x」；`deltaWhenActive`：生效时展示 `+x%`、未生效展示 `×x` */
    mode: 'delta' | 'factor' | 'deltaWhenActive'
    pct?: number
    digits?: number
    active?: boolean
    activeDigits?: number
    idleDigits?: number
}

/** @desc 一个乘子的求值结果 */
export interface MultiplierZone {
    id: string
    label: string
    value: number
    display: MultiplierDisplay
}

/** @desc 一条 buff 对某段伤害的贡献（溯源口径：把这条 buff 摘掉再算一遍的差值） */
export interface BuffContribution {
    buffId: string
    /** @desc 这条 buff 的作用落点（`applyTo`，便于按作用分组） */
    applyTo: string
    /** @desc 摘掉它之后期望伤害的变化（正数 = 它贡献了这么多伤害） */
    deltaExpected: number
    /** @desc 占这一段期望伤害的比例（可为负 / 大于 1） */
    share: number
}

/** @desc 一段伤害的结算结果 */
export interface DamageResult {
    /** @desc 所属条目下标（`GeneralTable.damage_entries`） */
    entryIndex: number
    /** @desc 条目内的第几段（`DamageEntry.damages`） */
    damageIndex: number
    /** @desc 来源（角色 id 或外部来源标识） */
    source: string
    /** @desc 伤害属性 */
    element: string
    /** @desc 公式 */
    formula: CalculationFormula
    /** @desc 基值（面板三维 × 倍率 / 偏谐系数 × 倍率 / 效应基础值 × 倍率 / 固定值） */
    baseValue: number
    /** @desc 不暴击 */
    nonCrit: number
    /** @desc 暴击（不吃暴击的公式回填期望值） */
    crit: number
    /** @desc 期望（含暴击率加权） */
    expected: number
    /** @desc 乘区明细（顺序 = 公式链的规范顺序） */
    multipliers: MultiplierZone[]
    /** @desc 该段用的角色面板（含词条与生效 buff） */
    panel: CharacterPanel
    /** @desc 该段用的目标面板（含目标侧 buff） */
    target: TargetPanel
    /** @desc 逐 buff 贡献（`compute(table, { trace: true })` 时给出，否则为空数组） */
    contributions: BuffContribution[]
}

/** @desc 一次结算的结果 */
export interface CoreResult {
    damages: DamageResult[]
    /** @desc 全部伤害段的合计 */
    total: {
        nonCrit: number
        crit: number
        expected: number
    }
}
