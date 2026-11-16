import { ACTION_MAP, DEFAULT_PANEL_DIM, REF_SOURCE_MAP } from '$coconut/actions'
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
    parseRatio,
    type CalculationFormula,
    type Damage,
    type GeneralTable,
    type StatRef
} from '$coconut/general-table'
import type { BuffContribution, CoreResult, DamageResult } from '$coconut/result'

export interface CharacterBaseStats {
    atk: number
    hp: number
    def: number
    element: string
    level?: number
    tuneBreakBoost?: number
    coefficient?: number
}

export interface WeaponBaseStats {
    atk: number
}

export interface EnemyBaseStats {
    type: string
    level: number
    defense: number
    dmgReduction: number
    resistances: Readonly<Record<string, number>>
    coefficient: number
}

export interface KernelBases {
    characterOf: (id: string) => CharacterBaseStats | null | undefined
    weaponOf: (id: string) => WeaponBaseStats | null | undefined
    enemy: EnemyBaseStats
}

const num = (value: string | number | undefined): number => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0
    const raw = Number.parseFloat(String(value ?? '').replace('%', ''))
    return Number.isFinite(raw) ? raw : 0
}

const convertUnit = (value: number, sourceUnit: string, targetUnit: string): number => {
    const normalized = sourceUnit === '%' ? value / 100 : value
    return targetUnit === '%' ? normalized * 100 : normalized
}

export const resolveStatRef = (ref: StatRef, panel: CharacterPanel, target: TargetPanel): number => {
    const source = REF_SOURCE_MAP.get(ref.refStat)
    if (!source) return 0
    const raw = convertUnit(source.get(panel, target) - ref.baseLine, ref.sourceUnit, ref.targetUnit)
    const lower = Number.isFinite(ref.lowerLimit) ? ref.lowerLimit : raw
    const upper = Number.isFinite(ref.Upperlimit) ? ref.Upperlimit : raw
    return Math.min(Math.max(raw, Math.min(lower, upper)), Math.max(lower, upper))
}

const applyStat = (panel: CharacterPanel, key: string, value: string): void => {
    if (CRIT_ACTION_IDS.includes(key) && panel.zones[key] === undefined) return
    applyZone(panel, key, num(value))
}

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
    if (refs.length > 0) {
        for (const { applyTo, ref } of refs) applyZone(panel, applyTo, resolveStatRef(ref, panel, target))
        recomputeTotals(panel)
    }
    return panel
}

const formulaOfDamage = (damage: Damage): CalculationFormula => damage.formula

const baseValueOf = (def: FormulaDef, damage: Damage, panel: CharacterPanel, target: TargetPanel): number => {
    const extraRatio = (panel.zones.extraRatio ?? 0) / 100
    if (def.base.kind === 'fixed') return num(damage.value)
    if (def.base.kind === 'targetStat') {
        return target[def.base.field] * (num(damage.value) + extraRatio)
    }
    if (def.base.dim === 'effectCoeff') {
        return Math.round((panel.zones.effectCoeff ?? 0) * (num(damage.value) + extraRatio))
    }
    return panel.total[damage.base ?? DEFAULT_PANEL_DIM] * (parseRatio(damage.value) + extraRatio)
}

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
