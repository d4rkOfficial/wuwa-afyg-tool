/**
 * @desc 计算核的求值入口：`GeneralTable` → 每段伤害的数值 + 乘区明细。
 *
 * 这里**没有条件、没有规则、没有技能文案推断**：表里出现的 buff 一律生效。
 * 「哪些 buff 属于这一段」是调用方在编译表时求的值，内核不做二次判断。
 */
import { ELEMENTS, ELEMENT_BONUS_MAP } from '$lib/consts/game-terms'
import { EFFECT_BASE_VALUE } from '$lib/consts/effect-data'
import { ACTION_MAP, REF_SOURCE_MAP } from '$coconut/actions'
import { CRIT_ACTION_IDS, FORMULAS, FORMULAS_DEFAULT_COEFF, type FormulaDef } from '$coconut/formulas'
import { evaluateFormula } from '$coconut/evaluate'
import {
    applyZone,
    emptyPanel,
    emptyTargetPanel,
    recomputeTotals,
    type CharacterPanel,
    type TargetPanel
} from '$coconut/panel'
import { STAT_WRITES } from '$coconut/stats'
import {
    parseValue,
    type CalculationFormula,
    type Damage,
    type GeneralTable,
    type StatRef
} from '$coconut/general-table'
import type { BuffContribution, CoreResult, DamageResult } from '$coconut/result'

/** @desc 角色基础属性（由调用方注册；数值为 90 级白值） */
export interface CharacterBaseStats {
    atk: number
    hp: number
    def: number
    /** @desc 伤害属性（用于抗性区取哪一档抗性） */
    element: string
    /** @desc 谐度破坏增幅（缺省 0） */
    tuneBreakBoost?: number
}

/** @desc 武器基础属性（只提供白值；副属性由调用方编译进词条） */
export interface WeaponBaseStats {
    atk: number
}

/** @desc 注册表：id → 基础属性 */
export interface KernelRegistries {
    characterOf: (id: string) => CharacterBaseStats | null | undefined
    weaponOf: (id: string) => WeaponBaseStats | null | undefined
    /** @desc 敌人类型 → 偏谐系数（处决 / 偏谐响应基值） */
    enemyCoefficientOf: (type: string) => number | undefined
}

/** @desc 数值串 → 数字（`'12.6%'` → 12.6；无法解析按 0，不让坏数据炸整次结算） */
const num = (value: string | number | undefined): number => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0
    const raw = Number.parseFloat(String(value ?? '').replace('%', ''))
    return Number.isFinite(raw) ? raw : 0
}

/** @desc 单位换算：先把源值归一成小数，再按目标单位还原 */
const convertUnit = (value: number, sourceUnit: string, targetUnit: string): number => {
    const normalized = sourceUnit === '%' ? value / 100 : value
    return targetUnit === '%' ? normalized * 100 : normalized
}

/** @desc 引用求值：读取来源面板量 → 减去起算线 → 单位换算 → 夹进上下限 */
export const resolveStatRef = (ref: StatRef, panel: CharacterPanel, target: TargetPanel): number => {
    const source = REF_SOURCE_MAP.get(ref.refStat)
    if (!source) return 0
    const raw = convertUnit(source.get(panel, target) - ref.baseLine, ref.sourceUnit, ref.targetUnit)
    const lower = Number.isFinite(ref.lowerLimit) ? ref.lowerLimit : raw
    const upper = Number.isFinite(ref.Upperlimit) ? ref.Upperlimit : raw
    return Math.min(Math.max(raw, Math.min(lower, upper)), Math.max(lower, upper))
}

/** @desc 双暴词条（系数基类条目不参与）——由乘子链声明推导，不手抄词条或作用名 */
const CRIT_STAT_KEYS = new Set(
    Object.entries(STAT_WRITES)
        .filter(([, write]) => write.kind === 'action' && CRIT_ACTION_IDS.includes(write.action))
        .map(([key]) => key)
)

/** @desc 词条 → 面板（内核侧唯一入口；`STAT_WRITES` 是词条落点表） */
const applyStat = (panel: CharacterPanel, key: string, value: string): void => {
    const write = STAT_WRITES[key]
    if (!write || write.kind === 'none') return
    if (write.kind === 'elementBonus') {
        const element = ELEMENT_BONUS_MAP[key]
        if (!element) return
        panel.elementBonus[element] = (panel.elementBonus[element] ?? 0) + num(value)
        return
    }
    // 类型加成没有「伤害类型」字段可对，须由调用方编译成 bonusDmg buff
    if (write.kind !== 'action') return
    applyZone(panel, write.action, num(value))
}

/** @desc 基础面板：白值 + 词条（不含 buff） */
const basePanelOf = (
    table: GeneralTable,
    registries: KernelRegistries,
    charIndex: number,
    critBase: 'panel' | 'coefficient'
): CharacterPanel => {
    const panel = emptyPanel(critBase)
    const char = registries.characterOf(table.characters[charIndex] ?? '')
    const weapon = registries.weaponOf(table.weapons[charIndex] ?? '')
    if (char) {
        panel.base.atk = Math.round(char.atk + (weapon?.atk ?? 0))
        panel.base.hp = Math.round(char.hp)
        panel.base.def = Math.round(char.def)
        panel.zones.tuneBreakBoost = Math.round(char.tuneBreakBoost ?? 0)
    }
    // 系数基类条目：双暴是它自己临时的一份，词条双暴不参与（决议 D1）
    const skipCrit = critBase === 'coefficient'
    for (const stat of table.main_stats[charIndex] ?? []) {
        if (skipCrit && CRIT_STAT_KEYS.has(stat.key)) continue
        applyStat(panel, stat.key, stat.value)
    }
    for (const stat of table.sub_stats[charIndex] ?? []) {
        if (skipCrit && CRIT_STAT_KEYS.has(stat.key)) continue
        applyStat(panel, stat.key, stat.value)
    }
    recomputeTotals(panel)
    return panel
}

/** @desc 目标面板：敌人配置 + 目标侧 buff（免伤落在 `dmgReduction`，其余落在 `zones`） */
const targetPanelOf = (
    table: GeneralTable,
    buffs: readonly { effect: { applyTo: string; value: unknown } }[]
): TargetPanel => {
    const panel = emptyTargetPanel()
    const [type, , defense, resistances] = table.enemy
    panel.type = type
    panel.defense = num(defense)
    ELEMENTS.forEach((element, index) => {
        panel.resistances[element] = num(resistances[index])
    })
    for (const buff of buffs) {
        const def = ACTION_MAP.get(buff.effect.applyTo)
        if (!def || def.side !== 'target') continue
        const value = typeof buff.effect.value === 'string' ? num(buff.effect.value) : 0
        if (def.targetField) panel[def.targetField] += value
        else panel.zones[def.id] = (panel.zones[def.id] ?? 0) + value
    }
    return panel
}

/** @desc 把一段伤害的 buff 分批：角色侧（写面板）/ 目标侧 / 引用（需面板就绪后再解析） */
const splitBuffs = (damage: Damage) => {
    const literal: { applyTo: string; value: number }[] = []
    const refs: { applyTo: string; ref: StatRef }[] = []
    const targetSide: { effect: { applyTo: string; value: unknown } }[] = []
    for (const buff of damage.activated_buffs) {
        const def = ACTION_MAP.get(buff.effect.applyTo)
        if (!def) continue
        if (def.side === 'target') {
            targetSide.push(buff)
            continue
        }
        if (typeof buff.effect.value === 'string') literal.push({ applyTo: def.id, value: num(buff.effect.value) })
        else refs.push({ applyTo: def.id, ref: buff.effect.value })
    }
    return { literal, refs, targetSide }
}

/** @desc 结算一段伤害的面板（词条 + 角色侧 buff + 引用） */
const panelOfDamage = (
    table: GeneralTable,
    registries: KernelRegistries,
    charIndex: number,
    critBase: 'panel' | 'coefficient',
    damage: Damage,
    target: TargetPanel
): CharacterPanel => {
    const panel = basePanelOf(table, registries, charIndex, critBase)
    const { literal, refs } = splitBuffs(damage)
    for (const write of literal) applyZone(panel, write.applyTo, write.value)
    recomputeTotals(panel)
    // 引用读的是「加了字面 buff 之后」的面板，解析完再算一次合计
    if (refs.length > 0) {
        for (const { applyTo, ref } of refs) applyZone(panel, applyTo, resolveStatRef(ref, panel, target))
        recomputeTotals(panel)
    }
    return panel
}

/** @desc 一段伤害的公式（`fixed` 由 `formula` 字段直接给出） */
const formulaOfDamage = (damage: Damage): CalculationFormula => damage.formula

/** @desc 基值解析（四条公式的唯一分支点） */
const baseValueOf = (
    def: FormulaDef,
    damage: Damage,
    panel: CharacterPanel,
    target: TargetPanel,
    registries: KernelRegistries
): number => {
    const extraRatio = (panel.zones.extraRatio ?? 0) / 100
    if (def.base.kind === 'fixed') return num(damage.value)
    if (def.base.kind === 'effectTable') return EFFECT_BASE_VALUE * (num(damage.value) + extraRatio)
    if (def.base.kind === 'enemyCoeff') {
        const coeff = registries.enemyCoefficientOf(target.type) ?? FORMULAS_DEFAULT_COEFF
        return coeff * (num(damage.value) + extraRatio)
    }
    const parsed = parseValue(damage.value)
    return panel.total[parsed.base] * (parsed.ratio + extraRatio)
}

/** @desc 单段结算（`excludeBuffId` 用于溯源：把这一条 buff 摘掉再算一遍） */
const computeDamage = (
    table: GeneralTable,
    registries: KernelRegistries,
    entryIndex: number,
    damageIndex: number,
    charIndex: number,
    excludeBuffId?: string
): DamageResult => {
    const entry = table.damage_entries[entryIndex]!
    const raw = entry.damages[damageIndex]!
    const damage = excludeBuffId
        ? { ...raw, activated_buffs: raw.activated_buffs.filter((buff) => buff.id !== excludeBuffId) }
        : raw
    const formula = formulaOfDamage(damage)
    const def = FORMULAS[formula]
    const critBase = def.critBase
    const { targetSide } = splitBuffs(damage)
    const target = targetPanelOf(table, targetSide)
    const panel = panelOfDamage(table, registries, charIndex, critBase, damage, target)
    const baseValue = baseValueOf(def, damage, panel, target, registries)
    const evaluation = evaluateFormula({ formula, baseValue, element: damage.element, panel, target })

    const nonCritRaw = baseValue * evaluation.productNoCrit
    const expectedRaw = baseValue * evaluation.product
    const expected = Math.round(expectedRaw)

    return {
        entryIndex,
        damageIndex,
        source: entry.source,
        element: damage.element,
        formula: def.id,
        baseValue,
        nonCrit: Math.round(nonCritRaw),
        crit: evaluation.canCrit ? Math.round(nonCritRaw * evaluation.critDmgRatio) : expected,
        expected,
        multipliers: evaluation.multipliers,
        panel,
        target,
        contributions: []
    }
}

/** @desc 逐 buff 溯源：把每条 buff 单独摘掉重算，差值即它的贡献 */
const contributionsOf = (
    table: GeneralTable,
    registries: KernelRegistries,
    entryIndex: number,
    damageIndex: number,
    charIndex: number,
    full: DamageResult
): BuffContribution[] => {
    const damage = table.damage_entries[entryIndex]!.damages[damageIndex]!
    const seen = new Set<string>()
    const out: BuffContribution[] = []
    for (const buff of damage.activated_buffs) {
        if (seen.has(buff.id)) continue
        seen.add(buff.id)
        const without = computeDamage(table, registries, entryIndex, damageIndex, charIndex, buff.id)
        const deltaExpected = full.expected - without.expected
        out.push({
            buffId: buff.id,
            applyTo: buff.effect.applyTo,
            deltaExpected,
            share: full.expected === 0 ? 0 : deltaExpected / full.expected
        })
    }
    return out
}

/** @desc 结算整张表（`trace: true` 时为每段附带逐 buff 贡献） */
export const computeGeneralTable = (
    table: GeneralTable,
    registries: KernelRegistries,
    options?: { trace?: boolean }
): CoreResult => {
    const damages: DamageResult[] = []
    for (const [entryIndex, entry] of table.damage_entries.entries()) {
        const charIndex = table.characters.indexOf(entry.source)
        for (const [damageIndex] of entry.damages.entries()) {
            const damage = computeDamage(table, registries, entryIndex, damageIndex, charIndex)
            if (options?.trace) {
                damage.contributions = contributionsOf(table, registries, entryIndex, damageIndex, charIndex, damage)
            }
            damages.push(damage)
        }
    }
    return {
        damages,
        total: {
            nonCrit: damages.reduce((sum, d) => sum + d.nonCrit, 0),
            crit: damages.reduce((sum, d) => sum + d.crit, 0),
            expected: damages.reduce((sum, d) => sum + d.expected, 0)
        }
    }
}
