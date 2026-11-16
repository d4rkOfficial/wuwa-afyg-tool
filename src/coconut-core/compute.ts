/**
 * @desc 计算核的求值入口：`GeneralTable` → 每段伤害的数值 + 乘区明细。
 *
 * 这里**没有条件、没有规则、没有技能文案推断**：表里出现的 buff 一律生效。
 * 「哪些 buff 属于这一段」是调用方在编译表时求的值，内核不做二次判断。
 */
import { ACTION_MAP, REF_SOURCE_MAP } from '$coconut/actions'
import { CRIT_ACTION_IDS, FORMULAS, type FormulaDef } from '$coconut/formulas'
import { evaluateFormula } from '$coconut/evaluate'
import {
    applyZone,
    emptyPanel,
    emptyTargetPanel,
    recomputeTotals,
    type CharacterPanel,
    type TargetPanel
} from '$coconut/panel'
import {
    parseValue,
    type CalculationFormula,
    type Damage,
    type GeneralTable,
    type StatRef
} from '$coconut/general-table'
import type { BuffContribution, CoreResult, DamageResult } from '$coconut/result'

/** @desc 角色基础属性（调用时传入；数值为 90 级白值） */
export interface CharacterBaseStats {
    atk: number
    hp: number
    def: number
    /** @desc 伤害属性（用于抗性区取哪一档抗性） */
    element: string
    /** @desc 角色等级（防御区口径；缺省 90） */
    level?: number
    /** @desc 谐度破坏增幅（缺省 0） */
    tuneBreakBoost?: number
    /**
     * @desc 效应系数（缺省 0）：效应的「虚角色」用它承载效应基础值（3674），
     * 伤害倍率是该段的层数倍率 —— 系数始终是面板属性，不混进攻击 / 生命 / 防御。
     */
    coefficient?: number
}

/** @desc 武器基础属性（只提供白值；副属性由调用方编译进词条） */
export interface WeaponBaseStats {
    atk: number
}

/** @desc 敌人基础数值（调用时传入） */
export interface EnemyBaseStats {
    /** @desc 敌人类型（只作标识 / 展示） */
    type: string
    level: number
    defense: number
    /** @desc 敌人免伤（%） */
    dmgReduction: number
    /** @desc 各属性抗性（%），按**属性名**给，不依赖任何下标顺序 */
    resistances: Readonly<Record<string, number>>
    /** @desc 偏谐系数（处决 / 偏谐响应的基值来源） */
    coefficient: number
}

/** @desc 一次结算的基础数值来源 */
export interface KernelBases {
    characterOf: (id: string) => CharacterBaseStats | null | undefined
    weaponOf: (id: string) => WeaponBaseStats | null | undefined
    enemy: EnemyBaseStats
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

/** @desc 词条→作用 id 的解析属于调用方：内核只把 `Stat.key` 当作用 id 写进面板 */
const applyStat = (panel: CharacterPanel, key: string, value: string): void => {
    if (CRIT_ACTION_IDS.includes(key) && panel.zones[key] === undefined) return
    applyZone(panel, key, num(value))
}

/** @desc 基础面板：白值 + 词条（不含 buff） */
const basePanelOf = (
    table: GeneralTable,
    bases: KernelBases,
    charIndex: number,
    critBase: 'panel' | 'coefficient'
): CharacterPanel => {
    const panel = emptyPanel(critBase)
    const char = bases.characterOf(table.characters[charIndex] ?? '')
    const weapon = bases.weaponOf(table.weapons[charIndex] ?? '')
    if (char) {
        panel.base.atk = Math.round(char.atk + (weapon?.atk ?? 0))
        panel.base.hp = Math.round(char.hp)
        panel.base.def = Math.round(char.def)
        panel.zones.charLevel = char.level ?? 90
        panel.zones.tuneBreakBoost = Math.round(char.tuneBreakBoost ?? 0)
        panel.zones.effectCoeff = char.coefficient ?? 0
    }
    // 系数基类条目：双暴是它自己临时的一份，词条双暴不参与（决议 D1）
    const skipCrit = critBase === 'coefficient'
    for (const stat of table.main_stats[charIndex] ?? []) {
        if (skipCrit && CRIT_ACTION_IDS.includes(stat.key)) continue
        applyStat(panel, stat.key, stat.value)
    }
    for (const stat of table.sub_stats[charIndex] ?? []) {
        if (skipCrit && CRIT_ACTION_IDS.includes(stat.key)) continue
        applyStat(panel, stat.key, stat.value)
    }
    recomputeTotals(panel)
    return panel
}

/** @desc 目标面板：敌人基础数值（调用方传入）+ 目标侧 buff（免伤/系数落在标量字段，其余落在 `zones`） */
const targetPanelOf = (
    bases: KernelBases,
    buffs: readonly { effect: { applyTo: string; value: unknown } }[]
): TargetPanel => {
    const panel = emptyTargetPanel()
    const enemy = bases.enemy
    panel.type = enemy.type
    panel.defense = num(enemy.defense)
    panel.dmgReduction = num(enemy.dmgReduction)
    panel.coefficient = num(enemy.coefficient)
    for (const [element, value] of Object.entries(enemy.resistances)) {
        panel.resistances[element] = num(value)
    }
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
    bases: KernelBases,
    charIndex: number,
    critBase: 'panel' | 'coefficient',
    damage: Damage,
    target: TargetPanel
): CharacterPanel => {
    const panel = basePanelOf(table, bases, charIndex, critBase)
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

/** @desc 基值解析（四条公式的唯一分支点：读哪块面板的哪个属性 × 倍率） */
const baseValueOf = (def: FormulaDef, damage: Damage, panel: CharacterPanel, target: TargetPanel): number => {
    const extraRatio = (panel.zones.extraRatio ?? 0) / 100
    if (def.base.kind === 'fixed') return num(damage.value)
    if (def.base.kind === 'targetStat') {
        // 处决 / 偏谐响应：系数是**敌人面板属性**
        return target[def.base.field] * (num(damage.value) + extraRatio)
    }
    if (def.base.dim === 'effectCoeff') {
        // 效应：系数是**虚角色面板属性**，倍率是该段的层数倍率
        return Math.round((panel.zones.effectCoeff ?? 0) * (num(damage.value) + extraRatio))
    }
    const parsed = parseValue(damage.value)
    return panel.total[parsed.base] * (parsed.ratio + extraRatio)
}

/** @desc 单段结算（`excludeBuffId` 用于溯源：把这一条 buff 摘掉再算一遍） */
const computeDamage = (
    table: GeneralTable,
    bases: KernelBases,
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
    const target = targetPanelOf(bases, targetSide)
    const panel = panelOfDamage(table, bases, charIndex, critBase, damage, target)
    const baseValue = baseValueOf(def, damage, panel, target)
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
    bases: KernelBases,
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
        const without = computeDamage(table, bases, entryIndex, damageIndex, charIndex, buff.id)
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
    bases: KernelBases,
    options?: { trace?: boolean }
): CoreResult => {
    const damages: DamageResult[] = []
    for (const [entryIndex, entry] of table.damage_entries.entries()) {
        const charIndex = table.characters.indexOf(entry.source)
        for (const [damageIndex] of entry.damages.entries()) {
            const damage = computeDamage(table, bases, entryIndex, damageIndex, charIndex)
            if (options?.trace) {
                damage.contributions = contributionsOf(table, bases, entryIndex, damageIndex, charIndex, damage)
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
