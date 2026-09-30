/**
 * @desc 一切皆 buff：内置 Buff 源清单。
 *
 * 除用户配置的 Buff 实例外，角色白值/武器/声骸、敌人配置（防御·抗性·免伤）、以及伤害公式的
 * 固有乘区（暴击区、防御区、抗性区、免伤区、集谐区、同奏区、倍率区）同样是「影响伤害计算的东西」，
 * 因此也以 buff 实例的形式参与计算 —— 它们由引擎内置生成，不出现在拉表页的 Buff 列表中，
 * 但会在乘区溯源（damage-trace）里以同一口径列出。
 */

/** @desc 内置源 id 前缀（与用户 Buff 实例 id 空间隔离） */
export const BUILTIN_PREFIX = 'builtin:'

export type BuiltinSourceKind = 'character' | 'weapon' | 'echo' | 'enemy' | 'formula' | 'tune'

export interface BuiltinBuffSourceDef {
    /** @desc 内置源 id（唯一） */
    id: string
    /** @desc 界面显示名 */
    label: string
    kind: BuiltinSourceKind
    /** @desc 该源产出的乘区键（界面/文档展示与 AI 说明用） */
    zones: string[]
    /** @desc 一句话说明 */
    desc: string
}

/** @desc 角色/武器/声骸/敌人/谐度等内置 Buff 源定义 */
export const BUILTIN_BUFF_SOURCES: BuiltinBuffSourceDef[] = [
    {
        id: `${BUILTIN_PREFIX}character`,
        label: '角色面板',
        kind: 'character',
        zones: ['atkFlat', 'atkPct', 'hpFlat', 'hpPct', 'defFlat', 'defPct', 'critRate', 'critDmg', 'recharge'],
        desc: '角色 90 级白值 + 武器白值，作为固定值/百分比乘区的累加基线'
    },
    {
        id: `${BUILTIN_PREFIX}weapon`,
        label: '武器',
        kind: 'weapon',
        zones: ['atkFlat', 'critRate', 'critDmg', 'recharge'],
        desc: '武器 90 级基础攻击与副词条'
    },
    {
        id: `${BUILTIN_PREFIX}echo`,
        label: '声骸',
        kind: 'echo',
        zones: ['atkFlat', 'atkPct', 'hpFlat', 'hpPct', 'defFlat', 'defPct', 'critRate', 'critDmg', 'recharge'],
        desc: '5 件声骸的主词条 / 副主词条 / 副词条'
    },
    {
        id: `${BUILTIN_PREFIX}enemy`,
        label: '敌人配置',
        kind: 'enemy',
        zones: ['defense', 'resistances', 'dmgReduction'],
        desc: '敌人防御 / 属性抗性 / 免伤：以防御区、抗性区、免伤区参与公式'
    },
    {
        id: `${BUILTIN_PREFIX}tune`,
        label: '谐度破坏',
        kind: 'tune',
        zones: ['tuneBreakBoost', 'extraRatio'],
        desc: '谐度破坏增幅与处决/响应倍率'
    }
]

/** @desc 伤害公式固有乘区（同样以 buff 实例形式参与计算，不可由用户配置数值） */
export const FORMULA_ZONES: BuiltinBuffSourceDef[] = [
    {
        id: `${BUILTIN_PREFIX}multiplier`,
        label: '倍率区',
        kind: 'formula',
        zones: ['ratio'],
        desc: '技能倍率 ×(1 + 额外倍率)'
    },
    {
        id: `${BUILTIN_PREFIX}crit`,
        label: '暴击区',
        kind: 'formula',
        zones: ['critRate', 'critDmg'],
        desc: '1 + 暴击率×(暴击伤害-1)'
    },
    {
        id: `${BUILTIN_PREFIX}defense`,
        label: '防御区',
        kind: 'formula',
        zones: ['defPen', 'defDown'],
        desc: '800+8×等级 减伤公式，(1-减防)×(1-穿防) 独立乘算'
    },
    {
        id: `${BUILTIN_PREFIX}resist`,
        label: '抗性区',
        kind: 'formula',
        zones: ['resPen', 'resDown'],
        desc: '分段抗性公式（负抗减半收益 / 线性 / ≥80% 封顶）'
    },
    {
        id: `${BUILTIN_PREFIX}reduction`,
        label: '免伤区',
        kind: 'formula',
        zones: ['dmgRedPen'],
        desc: '1 - 敌人免伤 - 穿免'
    },
    {
        id: `${BUILTIN_PREFIX}bonus`,
        label: '增伤区',
        kind: 'formula',
        zones: ['bonusDmg'],
        desc: '1 + 加成% + 属性加成 + 类型加成'
    },
    {
        id: `${BUILTIN_PREFIX}deepen`,
        label: '加深区',
        kind: 'formula',
        zones: ['deepenDmg'],
        desc: '1 + 加深%（效应伤害也吃）'
    },
    {
        id: `${BUILTIN_PREFIX}vulnerability`,
        label: '易伤区',
        kind: 'formula',
        zones: ['dmgTakenInc'],
        desc: '1 + 易伤%（效应伤害不吃）'
    },
    {
        id: `${BUILTIN_PREFIX}tuneStrain`,
        label: '集谐区',
        kind: 'formula',
        zones: ['tuneStrainLayer', 'tuneBreakBoost'],
        desc: '1 + 0.0012 × 谐度破坏增幅 × 集谐·干涉层数（层数挂目标身上、全队一份）'
    },
    {
        id: `${BUILTIN_PREFIX}unison`,
        label: '同奏区',
        kind: 'formula',
        zones: ['unisonBoonLayer'],
        desc: '1 + 3% × 同奏增益层数（全伤害通用）'
    },
    { id: `${BUILTIN_PREFIX}final`, label: '终伤区', kind: 'formula', zones: ['finalDmg'], desc: '1 + 终伤%' },
    {
        id: `${BUILTIN_PREFIX}special`,
        label: '特殊区',
        kind: 'formula',
        zones: ['specialFinal1', 'specialFinal2'],
        desc: '(1 + 特殊终伤(1)%) × ∏(1 + 特殊终伤(2)%)'
    },
    {
        id: `${BUILTIN_PREFIX}tuneBreak`,
        label: '谐度增幅区',
        kind: 'formula',
        zones: ['tuneBreakBoost'],
        desc: '处决/偏谐响应：1 + 谐度破坏增幅%'
    }
]

/** @desc 全部内置源（角色/武器/声骸/敌人/谐度 + 公式固有乘区） */
export const ALL_BUILTIN_SOURCES: BuiltinBuffSourceDef[] = [...BUILTIN_BUFF_SOURCES, ...FORMULA_ZONES]

/** @desc 按 id 查询内置源定义 */
export const BUILTIN_SOURCE_MAP = new Map(ALL_BUILTIN_SOURCES.map((s) => [s.id, s]))
