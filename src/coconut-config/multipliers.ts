/**
 * @desc **乘子（乘区）**：防御区 / 抗性区 / 双暴等数学定义，以及引擎不认识的游戏口径。
 *
 * 每个乘子只关心自己读哪些输入；`MULTIPLIERS` 的键名就是注册层对外的 id，
 * 具体顺序由 `formulas.ts` 的版本序决定（内核要求「链序 = 注册序」）。
 */
import { defineFormula } from '$coconut-core/formulas'
import { DEFAULT_CHAR_LEVEL } from './data'

/** @desc 防御区：防御减伤公式（注册层自己的数学，内核不认识它） */
const computeDefMulti = (defense: number, defPen: number, defDown: number, charLevel: number): number => {
    const defEff = Math.max(defense * (1 - defDown / 100) * (1 - defPen / 100), 0)
    const charTerm = 800 + 8 * charLevel
    return Math.max(charTerm / (defEff + charTerm), 0.01)
}

/** @desc 抗性区：分段抗性公式（同上） */
const computeResMulti = (baseResist: number, resPen: number, resDown: number): number => {
    const effResist = baseResist - resPen / 100 - resDown / 100
    if (effResist < 0) return 1 + Math.abs(effResist) / 2
    if (effResist < 0.8) return 1 - effResist
    return 1 / ((effResist + 0.2) * 5)
}

/**
 * @desc **等效暴击率**：低于 0 视为必不暴，高于 100 视为必暴。
 *
 * 只裁「算成暴击时用的暴击率」，面板原值一律保留（负值与 >100 都要留着，
 * 「暴击超过 100 的部分转成暴击伤害」这类引用读的就是原值）。
 */
export const effectiveCritRate = (critRate: number): number => Math.min(Math.max(critRate, 0), 100)

const pctPlusOne = defineFormula(
    {
        id: 'pctPlusOne',
        inputs: ['v'] as const
    },
    ({ v }) => 1 + v / 100
)

const deepenMultiplier = defineFormula(
    {
        id: 'deepen',
        inputs: ['deepenDmg'] as const,
        uses: [pctPlusOne] as const
    },
    (r) => r.pctPlusOne(r.deepenDmg)
)

const bonusMultiplier = defineFormula(
    {
        id: 'bonus',
        inputs: ['bonusDmg'] as const
    },
    ({ bonusDmg }) => 1 + bonusDmg / 100
)

/**
 * @desc 易伤/免伤区：对敌易伤、免伤无视（穿免）、敌人免伤同一乘区、加算。
 */
const vulnMultiplier = defineFormula(
    {
        id: 'vuln',
        inputs: ['dmgTakenInc', 'dmgRedPen', 'target.enemyDmgReduction'] as const
    },
    ({ dmgTakenInc, dmgRedPen, 'target.enemyDmgReduction': enemyDmgReduction }) =>
        Math.max(0, 1 + (dmgTakenInc - dmgRedPen - enemyDmgReduction) / 100)
)

const resistMultiplier = defineFormula(
    {
        id: 'resist',
        inputs: ['resPen', 'resDown'] as const
    },
    ({ resPen, resDown }, ctx) =>
        computeResMulti((ctx.target.maps.resistance?.[ctx.element] ?? 0) / 100, resPen, resDown)
)

const defenseMultiplier = defineFormula(
    {
        id: 'defense',
        inputs: ['defPen', 'defDown', 'target.defense'] as const
    },
    (r, ctx) => computeDefMulti(r['target.defense'], r.defPen, r.defDown, ctx.consts.charLevel ?? DEFAULT_CHAR_LEVEL)
)

/** @desc 集谐区（鸣潮 3.0）：谐度破坏增幅 × 集谐干涉层数 */
const tuneStrainMultiplier = defineFormula(
    {
        id: 'tuneStrain',
        inputs: ['tuneBreakBoost', 'target.tuneStrainLayer'] as const
    },
    ({ tuneBreakBoost, 'target.tuneStrainLayer': layer }) => 1 + 0.0012 * tuneBreakBoost * layer
)

/** @desc 谐度区（鸣潮 3.0 处决） */
const tuneBreakMultiplier = defineFormula(
    {
        id: 'tuneBreak',
        inputs: ['tuneBreakBoost'] as const,
        uses: [pctPlusOne] as const
    },
    (r) => r.pctPlusOne(r.tuneBreakBoost)
)

/** @desc 同奏区（鸣潮 3.7） */
const unisonMultiplier = defineFormula(
    {
        id: 'unison',
        inputs: ['unisonBoonLayer'] as const
    },
    ({ unisonBoonLayer }) => 1 + 0.03 * unisonBoonLayer
)

const finalMultiplier = defineFormula(
    {
        id: 'final',
        inputs: ['finalDmg'] as const,
        uses: [pctPlusOne] as const
    },
    (r) => r.pctPlusOne(r.finalDmg)
)

const specialMultiplier = defineFormula(
    {
        id: 'special',
        inputs: ['specialFinal1', 'specialFinal2'] as const
    },
    ({ specialFinal1, specialFinal2 }) => (specialFinal1 !== 0 ? 1 + specialFinal1 / 100 : 1) * specialFinal2
)

const critMultiplier = defineFormula(
    {
        id: 'crit',
        inputs: ['critRate', 'critDmg'] as const
    },
    ({ critRate, critDmg }) => 1 + (effectiveCritRate(critRate) / 100) * (critDmg / 100 - 1)
)

export const MULTIPLIERS = {
    deepen: deepenMultiplier,
    bonus: bonusMultiplier,
    vuln: vulnMultiplier,
    resist: resistMultiplier,
    defense: defenseMultiplier,
    tuneStrain: tuneStrainMultiplier,
    tuneBreak: tuneBreakMultiplier,
    unison: unisonMultiplier,
    final: finalMultiplier,
    special: specialMultiplier,
    crit: critMultiplier
} as const

export type MultiplierId = keyof typeof MULTIPLIERS

/** @desc 暴击乘子 id（「不暴击」链路要排除它） */
export const CRIT_MULTIPLIER_ID = 'crit'

export const CRIT_ACTION_IDS: readonly (string | symbol)[] = MULTIPLIERS.crit.inputs
