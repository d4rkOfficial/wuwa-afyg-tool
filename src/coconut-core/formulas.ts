/**
 * @desc 公式注册表：**乘子**（公式链上的一个乘法因子）与**公式**（基值配方 + 有序乘子链）。
 *
 * 一个公式 = `{ base, chain, critBase, canCrit }`；乘子是具名纯函数，声明自己读哪些输入。
 * 「大公式 = 小公式的组合」由 `uses` 表达：`r.<子公式>(x)` 只对声明过的子公式存在（编译期保证）。
 *
 * 从这里派生出去的消费者（不再各自手抄）：
 * - 结果页乘区明细（`ResultEntry.multiplierZones`）
 * - 乘区溯源段（`damage-trace` 的 `segments` 顺序与membership）
 * - 拉表可用作用白名单（哪些作用能被某类条目吃）
 */
import { CHAR_LEVEL } from '$lib/consts/game-terms'
import { TARGET_SCALARS } from '$coconut/actions'
import type { CharacterPanel, TargetPanel } from '$coconut/panel'
import type { CalculationFormula } from '$coconut/general-table'
import type { MultiplierDisplay } from '$coconut/result'

/** @desc 公式求值上下文：两侧面板 + 条目身份 */
export interface FormulaCtx {
    panel: CharacterPanel
    /** @desc 目标面板：敌人配置 + Buff 对目标侧作用的写入 */
    target: TargetPanel
    /** @desc 条目伤害属性（元素） */
    element: string
    /** @desc 条目已解析的伤害类型 */
    damageTypes: string[]
    /** @desc 增伤区里按条目属性取到的元素加成合计（%） */
    elementBonus: number
    /** @desc 增伤区里按条目伤害类型取到的类型加成合计（%） */
    typeBonus: number
}

/** @desc 数值输入名：面板作用 id，或 `target.` / `enemy.` / `const.` 前缀的保留输入 */
export type NumericInput = string

/** @desc 已解析的输入（由 `inputs` 声明推导出的对象类型） */
type Resolved<I extends readonly NumericInput[]> = { readonly [K in I[number]]: number }

/** @desc 子公式调用器：单输入子公式暴露标量签名，多输入子公式暴露对象签名 */
type Invokers<U extends readonly FormulaHandle[]> = {
    readonly [H in U[number] as H['id']]: H['inputs'] extends readonly [unknown]
        ? (value: number) => number
        : (args: Record<string, number>) => number
}

export interface FormulaHandle<
    Id extends string = string,
    I extends readonly NumericInput[] = readonly NumericInput[]
> {
    readonly id: Id
    readonly label: string
    readonly inputs: I
    readonly uses: readonly FormulaHandle[]
    readonly version: number
    readonly compute: (resolved: Record<string, unknown>, ctx: FormulaCtx) => number
    /** @desc 乘区的**结构化**展示参数（格式化在界面层 `formatMultiplierDisplay`） */
    readonly display: (value: number, ctx: FormulaCtx) => MultiplierDisplay
}

/**
 * @desc 注册一个公式（唯一入口）。
 *
 * `inputs` / `uses` 是声明即类型：`compute` 的入参对象只含声明过的输入，
 * 调用未声明过的子公式无法通过编译（`r.<id>(…)` 只对 `uses` 里的项存在）。
 */
export const defineFormula = <
    Id extends string,
    I extends readonly NumericInput[],
    U extends readonly FormulaHandle[] = []
>(
    spec: {
        id: Id
        label: string
        inputs: I
        uses?: U
        version: number
        display: (value: number, ctx: FormulaCtx) => MultiplierDisplay
    },
    compute: (resolved: Resolved<I> & Invokers<U>, ctx: FormulaCtx) => number
): FormulaHandle<Id, I> => ({
    id: spec.id,
    label: spec.label,
    inputs: spec.inputs,
    uses: spec.uses ?? [],
    version: spec.version,
    display: spec.display,
    compute: (resolved, ctx) => compute(resolved as Resolved<I> & Invokers<U>, ctx)
})

// ────────────────────────────── 输入解析 ──────────────────────────────

const FIXED_INPUTS: Record<string, number> = { 'const.charLevel': CHAR_LEVEL }

/** @desc 解析一个输入名：`target.` 前缀读目标面板，`const.` 读常量，其余读角色面板作用值 */
export const readInput = (name: Readonly<NumericInput>, ctx: FormulaCtx): number => {
    if (name.startsWith('target.')) {
        const key = name.slice('target.'.length)
        if (key === 'defense') return ctx.target.defense
        const scalar = TARGET_SCALARS[key]
        if (scalar) return scalar(ctx.target)
        return ctx.target.zones[key] ?? 0
    }
    if (name === 'const.charLevel') return CHAR_LEVEL
    if (name in FIXED_INPUTS) return FIXED_INPUTS[name]
    return ctx.panel.zones[name] ?? 0
}

/** @desc 把声明过的输入打包成对象；子公式调用器同批注入 */
const resolveInputs = (handle: FormulaHandle, ctx: FormulaCtx): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const name of handle.inputs) out[name] = readInput(name, ctx)
    for (const sub of handle.uses) {
        out[sub.id] =
            sub.inputs.length === 1
                ? (value: number) => sub.compute({ [sub.inputs[0]!]: value }, ctx)
                : (args: Record<string, number>) => sub.compute(args, ctx)
    }
    return out
}

/** @desc 求值一个公式（子公式调用器按需注入，缓存由调用方负责） */
export const evaluateHandle = (handle: FormulaHandle, ctx: FormulaCtx): number =>
    handle.compute(resolveInputs(handle, ctx), ctx)

// ────────────────────────────── 乘子算式 ──────────────────────────────

/** @desc 防御区：`(800 + 8×角色等级) / (敌人防御×(1-减防)×(1-穿防) + 同上)`，下限 1% */
export const computeDefMulti = (defense: number, defPen: number, defDown: number): number => {
    const defEff = Math.max(defense * (1 - defDown / 100) * (1 - defPen / 100), 0)
    const charTerm = 800 + 8 * CHAR_LEVEL
    return Math.max(charTerm / (defEff + charTerm), 0.01)
}

/**
 * @desc 抗性区（分段公式，effResist 为有效抗性，单位小数，可负）
 * - 抗性 < 0（被穿成负）：`1 + |抗性| / 2`（减半收益）
 * - `0 <= 抗性 < 80%`：`1 - 抗性`（线性减免）
 * - `抗性 >= 80%`：`1 / ((抗性 + 0.2) × 5)`（封顶，防接近 100% 时伤害归零）
 */
export const computeResMulti = (baseResist: number, resPen: number, resDown: number): number => {
    const effResist = baseResist - resPen / 100 - resDown / 100
    if (effResist < 0) return 1 + Math.abs(effResist) / 2
    if (effResist < 0.8) return 1 - effResist
    return 1 / ((effResist + 0.2) * 5)
}

/** @desc 面板基类条目的伤害基值类型 → 三维维度 + 展示单位（未列出的类型按 `PANEL_BASE_DEFAULT` 结算） */
export const PANEL_BASE_DEFAULT = '攻击'

/** @desc 偏谐系数的兜底值：调用方没给该敌人类型的系数时用它 */
export const FORMULAS_DEFAULT_COEFF = 716.2

export const PANEL_BASE_TYPES: Record<string, { dim: 'atk' | 'hp' | 'def'; unit: string }> = {
    攻击: { dim: 'atk', unit: '攻击' },
    生命: { dim: 'hp', unit: '生命' },
    防御: { dim: 'def', unit: '防御' },
    偏谐系数: { dim: 'atk', unit: '偏谐系数' }
}

// ────────────────────────────── 小公式（可复用） ──────────────────────────────

/** @desc `1 + v/100`（加深 / 违伤 / 终伤 / 谐度 / 增伤 / 集谐都用它，注册一次） */
const pctPlusOne = defineFormula(
    {
        id: 'pctPlusOne',
        label: '百分比 → 乘子',
        inputs: ['v'] as const,
        version: 1,
        display: (value) => ({ mode: 'delta', pct: (value - 1) * 100, digits: 1 })
    },
    ({ v }) => 1 + v / 100
)

// ────────────────────────────── 乘子（角色侧 / 目标侧 / 系数） ──────────────────────────────

/** @desc 加深区（直伤 / 效应吃，处决不吃） */
export const deepenMultiplier = defineFormula(
    {
        id: 'deepen',
        label: '加深区',
        inputs: ['deepenDmg'] as const,
        uses: [pctPlusOne] as const,
        version: 1,
        display: (value) => ({ mode: 'delta', pct: (value - 1) * 100, digits: 1 })
    },
    (r) => r.pctPlusOne(r.deepenDmg)
)

/** @desc 增伤区（加成 + 按属性/类型的词条加成；系数基类条目不吃） */
export const bonusMultiplier = defineFormula(
    {
        id: 'bonus',
        label: '增伤区',
        inputs: ['bonusDmg'] as const,
        version: 1,
        display: (value) => ({ mode: 'delta', pct: (value - 1) * 100, digits: 1 })
    },
    ({ bonusDmg }, ctx) => 1 + (bonusDmg + ctx.elementBonus + ctx.typeBonus) / 100
)

/** @desc 易伤区（效应不吃） */
export const vulnMultiplier = defineFormula(
    {
        id: 'vuln',
        label: '易伤区',
        inputs: ['dmgTakenInc'] as const,
        uses: [pctPlusOne] as const,
        version: 1,
        display: (value) => ({ mode: 'delta', pct: (value - 1) * 100, digits: 1 })
    },
    (r) => r.pctPlusOne(r.dmgTakenInc)
)

/** @desc 抗性区（跨侧：角色侧穿/减抗 × 目标属性抗性） */
export const resistMultiplier = defineFormula(
    {
        id: 'resist',
        label: '抗性区',
        inputs: ['resPen', 'resDown'] as const,
        version: 1,
        display: () => ({ mode: 'factor', digits: 4 })
    },
    ({ resPen, resDown }, ctx) => computeResMulti((ctx.target.resistances[ctx.element] ?? 0) / 100, resPen, resDown)
)

/** @desc 防御区（跨侧：角色侧穿/减防 × 目标防御） */
export const defenseMultiplier = defineFormula(
    {
        id: 'defense',
        label: '防御区',
        inputs: ['defPen', 'defDown', 'target.defense'] as const,
        version: 1,
        display: () => ({ mode: 'factor', digits: 4 })
    },
    (r) => computeDefMulti(r['target.defense'], r.defPen, r.defDown)
)

/** @desc 免伤区（跨侧：角色侧穿免 × 目标免伤作用） */
export const dmgRedMultiplier = defineFormula(
    {
        id: 'dmgRed',
        label: '免伤区',
        inputs: ['dmgRedPen', 'target.enemyDmgReduction'] as const,
        version: 1,
        display: () => ({ mode: 'factor', digits: 4 })
    },
    (r) => 1 - r['target.enemyDmgReduction'] / 100 - r.dmgRedPen / 100
)

/** @desc 集谐区：`1 + 0.12% × 该角色谐度破坏增幅 × 目标侧集谐·干涉层数` */
export const tuneStrainMultiplier = defineFormula(
    {
        id: 'tuneStrain',
        label: '集谐区',
        inputs: ['tuneBreakBoost', 'target.tuneStrainLayer'] as const,
        version: 1,
        display: (value, ctx) => ({
            mode: 'deltaWhenActive',
            pct: (value - 1) * 100,
            active: (ctx.target.zones.tuneStrainLayer ?? 0) > 0,
            activeDigits: 1,
            idleDigits: 4
        })
    },
    ({ tuneBreakBoost, 'target.tuneStrainLayer': layer }) => 1 + 0.0012 * tuneBreakBoost * layer
)

/** @desc 谐度区：`1 + 谐度破坏增幅%`（处决/响应吃，直伤/效应不吃） */
export const tuneBreakMultiplier = defineFormula(
    {
        id: 'tuneBreak',
        label: '谐度区',
        inputs: ['tuneBreakBoost'] as const,
        uses: [pctPlusOne] as const,
        version: 1,
        display: (value) => ({ mode: 'delta', pct: (value - 1) * 100, digits: 1 })
    },
    (r) => r.pctPlusOne(r.tuneBreakBoost)
)

/** @desc 同奏区：`1 + 3% × 同奏增益层数` */
export const unisonMultiplier = defineFormula(
    {
        id: 'unison',
        label: '同奏区',
        inputs: ['unisonBoonLayer'] as const,
        version: 1,
        display: (value, ctx) => ({
            mode: 'deltaWhenActive',
            pct: (value - 1) * 100,
            active: ctx.panel.zones.unisonBoonLayer > 0,
            activeDigits: 1,
            idleDigits: 4
        })
    },
    ({ unisonBoonLayer }) => 1 + 0.03 * unisonBoonLayer
)

/** @desc 终伤区 */
export const finalMultiplier = defineFormula(
    {
        id: 'final',
        label: '终伤区',
        inputs: ['finalDmg'] as const,
        uses: [pctPlusOne] as const,
        version: 1,
        display: (value) => ({ mode: 'delta', pct: (value - 1) * 100, digits: 1 })
    },
    (r) => r.pctPlusOne(r.finalDmg)
)

/** @desc 特殊区：`(1 + 特殊终伤(1)%) × 特殊终伤(2)连乘` */
export const specialMultiplier = defineFormula(
    {
        id: 'special',
        label: '特殊区',
        inputs: ['specialFinal1', 'specialFinal2'] as const,
        version: 1,
        display: () => ({ mode: 'factor', digits: 4 })
    },
    ({ specialFinal1, specialFinal2 }) => (specialFinal1 !== 0 ? 1 + specialFinal1 / 100 : 1) * specialFinal2
)

/** @desc 暴击区：`1 + min(暴击率,100)/100 × (暴击伤害/100 − 1)` */
export const critMultiplier = defineFormula(
    {
        id: 'crit',
        label: '暴击区',
        inputs: ['critRate', 'critDmg'] as const,
        version: 1,
        display: (value) => ({
            mode: 'deltaWhenActive',
            pct: (value - 1) * 100,
            active: value !== 1,
            activeDigits: 1,
            idleDigits: 4
        })
    },
    ({ critRate, critDmg }) => 1 + (Math.min(critRate, 100) / 100) * (critDmg / 100 - 1)
)

/** @desc 全部乘子（id → 公式句柄）；顺序由 `MULTIPLIER_ORDER` 决定 */
export const MULTIPLIERS = {
    deepen: deepenMultiplier,
    bonus: bonusMultiplier,
    vuln: vulnMultiplier,
    resist: resistMultiplier,
    defense: defenseMultiplier,
    dmgRed: dmgRedMultiplier,
    tuneStrain: tuneStrainMultiplier,
    tuneBreak: tuneBreakMultiplier,
    unison: unisonMultiplier,
    final: finalMultiplier,
    special: specialMultiplier,
    crit: critMultiplier
} as const

export type MultiplierId = keyof typeof MULTIPLIERS

/**
 * @desc 乘子链的**唯一规范顺序**（决议 D17）：数值无关（乘法可交换），只决定展示顺序。
 * 每条公式的链必须是它的子序列。
 */
export const MULTIPLIER_ORDER: readonly MultiplierId[] = [
    'deepen',
    'bonus',
    'vuln',
    'resist',
    'defense',
    'dmgRed',
    'tuneStrain',
    'tuneBreak',
    'unison',
    'final',
    'special',
    'crit'
]

/** @desc 双暴基准：角色面板口径（5% / 150%）还是系数口径（0% / 100%） */
export type CritBase = 'panel' | 'coefficient'

/** @desc 暴击区读取的作用 id（由注册表推导） */
export const CRIT_ACTION_IDS: readonly string[] = MULTIPLIERS.crit.inputs

/** @desc 暴击区读取的作用 id 的字面类型（由乘子声明推导，不在别处重写） */
export type CritActionId = (typeof MULTIPLIERS)['crit']['inputs'][number]

/**
 * @desc 某公式是否接受某作用的**引用写入**。
 *
 * 系数基类公式（处决 / 响应 / 效应）的双暴是它自己临时的一份，只接受直接数值写入 ——
 * 引用是把别的面板搬过来，对这种独立面板没有意义（决议 D24）。
 */
export const formulaAcceptsRef = (critBase: CritBase, actionId: string): boolean =>
    !(critBase === 'coefficient' && CRIT_ACTION_IDS.includes(actionId))

// ────────────────────────────── 公式 ──────────────────────────────

/** @desc 公式 id（内核的 `CalculationFormula`，对外沿用旧名以免调用方大改） */
export type CalculationFormulaId = CalculationFormula

/** @desc 基值配方：基值从哪来（面板三维 / 敌人类型系数 / 效应表系数 / 固定值） */
export type BaseRecipe = { kind: 'panelStat' } | { kind: 'enemyCoeff' } | { kind: 'effectTable' } | { kind: 'fixed' }

export interface FormulaDef {
    id: CalculationFormulaId
    label: string
    base: BaseRecipe
    /** @desc 倍率侧的额外修正（额外倍率） */
    ratioBoosts: readonly string[]
    chain: readonly FormulaHandle[]
    /** @desc 双暴基准：角色面板口径（5/150）还是系数口径（0/100） */
    critBase: 'panel' | 'coefficient'
    canCrit: (panel: CharacterPanel, ctx: FormulaCtx) => boolean
    /** @desc 不可暴击时「暴击 / 不暴击」两列的回填口径 */
    critFallback: 'expected'
    /**
     * @desc 结果里是否带出条目的伤害类型。
     * 处决 / 偏谐响应暂不带（它们的伤害类型要到阶段 2 引入「处决」类型后才有意义）。
     */
    reportsDamageTypes: boolean
}

const multiplierChain = (ids: readonly MultiplierId[]): readonly FormulaHandle[] => ids.map((id) => MULTIPLIERS[id])

export const FORMULAS: Record<CalculationFormulaId, FormulaDef> = {
    direct: {
        id: 'direct',
        label: '直伤',
        base: { kind: 'panelStat' },
        ratioBoosts: ['extraRatio'],
        chain: multiplierChain([
            'deepen',
            'bonus',
            'vuln',
            'resist',
            'defense',
            'dmgRed',
            'tuneStrain',
            'unison',
            'final',
            'special',
            'crit'
        ]),
        critBase: 'panel',
        canCrit: () => true,
        critFallback: 'expected',
        reportsDamageTypes: true
    },
    tune: {
        id: 'tune',
        label: '处决 / 偏谐响应',
        base: { kind: 'enemyCoeff' },
        ratioBoosts: ['extraRatio'],
        chain: multiplierChain([
            'vuln',
            'resist',
            'defense',
            'dmgRed',
            'tuneBreak',
            'unison',
            'final',
            'special',
            'crit'
        ]),
        critBase: 'coefficient',
        canCrit: (panel) => panel.zones.critRate > 0,
        critFallback: 'expected',
        reportsDamageTypes: true
    },
    effect: {
        id: 'effect',
        label: '效应',
        base: { kind: 'effectTable' },
        ratioBoosts: ['extraRatio'],
        chain: multiplierChain(['deepen', 'resist', 'defense', 'dmgRed', 'unison', 'final', 'special', 'crit']),
        critBase: 'coefficient',
        canCrit: (panel) => panel.zones.critRate > 0,
        critFallback: 'expected',
        reportsDamageTypes: true
    },
    fixed: {
        id: 'fixed',
        label: '固定值',
        base: { kind: 'fixed' },
        ratioBoosts: [],
        chain: multiplierChain([]),
        critBase: 'panel',
        canCrit: () => false,
        critFallback: 'expected',
        reportsDamageTypes: true
    }
}

/** @desc 条目 → 公式 id（取代原先散在四处的 `isEffect / isTuneBreak / isTuneResponse / 偏谐系数` 组合判据） */
export const formulaOf = (entry: { formula: CalculationFormula; ratioUnit: string }): CalculationFormulaId =>
    entry.formula === 'direct' && entry.ratioUnit === 'fixed' ? 'fixed' : entry.formula

/** @desc 该条目是否效应伤害（作用域语义：效应条目没有角色槽位） */
export const isEffectEntry = (entry: { formula: CalculationFormula }): boolean => entry.formula === 'effect'

/** @desc 条目是否走系数基类口径（双暴基准 0/100） */
export const usesCoefficientFormula = (entry: { formula: CalculationFormula; ratioUnit: string }): boolean =>
    FORMULAS[formulaOf(entry)].critBase === 'coefficient'

/**
 * @desc 某公式会读到的**面板作用**闭包（拉表可用性 / 影响源 / 静态闸门共用）。
 *
 * 输入名里 `enemy.` / `const.` 前缀的不是 Buff 作用（目标面板与常量），跳过；
 * `target.` 前缀的是目标侧作用，去掉前缀后就是作用 id。
 */
export const formulaActionClosure = (id: CalculationFormulaId): Set<string> => {
    const out = new Set<string>()
    for (const handle of FORMULAS[id].chain) {
        for (const input of handle.inputs) {
            if (input.startsWith('enemy.') || input.startsWith('const.')) continue
            out.add(input.replace(/^target\./, ''))
        }
    }
    for (const boost of FORMULAS[id].ratioBoosts) out.add(boost)
    return out
}

// ────────────────────────────── 注册期自检 ──────────────────────────────

/** @desc 每条链必须是 `MULTIPLIER_ORDER` 的子序列（防止顺序再次出现两套） */
const assertChainOrder = (): void => {
    for (const def of Object.values(FORMULAS)) {
        let last = -1
        for (const handle of def.chain) {
            const at = MULTIPLIER_ORDER.indexOf(handle.id as MultiplierId)
            if (at < 0) throw new Error(`[formulas] ${def.id}: 未知乘子 ${handle.id}`)
            if (at <= last) throw new Error(`[formulas] ${def.id}: 乘子顺序必须与 MULTIPLIER_ORDER 一致`)
            last = at
        }
    }
}

assertChainOrder()
