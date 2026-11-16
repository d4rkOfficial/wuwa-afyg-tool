import type { ActionRegistry } from './actions'
import { evaluateFormula } from './evaluate'
import { formulaAcceptsRef, formulaOfRegistry, type FormulaRegistry } from './formulas'
import {
    applyZone,
    emptyPanel,
    emptyTargetPanel,
    recomputeTotals,
    type CharacterPanel,
    type TargetPanel
} from './panel'
import {
    parseRatio,
    type BuffWrite,
    type CalculationFormula,
    type Damage,
    type GeneralTable,
    type StatRef
} from './general-table'
import type { BuffContribution, CoreResult, DamageResult } from './result'

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

export interface CoreRegistry {
    actions: ActionRegistry
    formulas: FormulaRegistry
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

export const resolveStatRef = (
    registry: CoreRegistry,
    ref: StatRef,
    panel: CharacterPanel,
    target: TargetPanel
): number => {
    const source = registry.actions.refMap.get(ref.refStat)
    if (!source) return 0
    const raw = convertUnit(source.get(panel, target) - ref.baseLine, ref.sourceUnit, ref.targetUnit)
    const lower = Number.isFinite(ref.lowerLimit) ? ref.lowerLimit : raw
    const upper = Number.isFinite(ref.Upperlimit) ? ref.Upperlimit : raw
    return Math.min(Math.max(raw, Math.min(lower, upper)), Math.max(lower, upper))
}

const hitsOf = (damage: Damage): number => Math.max(1, Math.trunc(damage.hits ?? 1))

const applyStat = (registry: CoreRegistry, panel: CharacterPanel, key: string, value: string): void => {
    if (registry.formulas.critActions.includes(key) && panel.zones[key] === undefined) return
    applyZone(registry.actions, panel, key, num(value))
}

const basePanelOf = (
    registry: CoreRegistry,
    table: GeneralTable,
    bases: KernelBases,
    charIndex: number,
    critBase: string
): { panel: CharacterPanel; charLevel: number } => {
    const panel = emptyPanel(registry.actions, critBase)
    const char = bases.characterOf(table.characters[charIndex] ?? '')
    const weapon = bases.weaponOf(table.weapons[charIndex] ?? '')
    if (char) {
        panel.base.atk = Math.round(char.atk + (weapon?.atk ?? 0))
        panel.base.hp = Math.round(char.hp)
        panel.base.def = Math.round(char.def)
        panel.zones.tuneBreakBoost = Math.round(char.tuneBreakBoost ?? 0)
        panel.zones.effectCoeff = char.coefficient ?? 0
    }
    const skipCrit = critBase === 'coefficient'
    for (const stat of table.main_stats[charIndex] ?? []) {
        if (skipCrit && registry.formulas.critActions.includes(stat.key)) continue
        applyStat(registry, panel, stat.key, stat.value)
    }
    for (const stat of table.sub_stats[charIndex] ?? []) {
        if (skipCrit && registry.formulas.critActions.includes(stat.key)) continue
        applyStat(registry, panel, stat.key, stat.value)
    }
    recomputeTotals(registry.actions, panel)
    return { panel, charLevel: char?.level ?? 90 }
}

const targetPanelOf = (
    registry: CoreRegistry,
    bases: KernelBases,
    buffs: readonly { effect: { applyTo: string; value: unknown; write?: BuffWrite } }[]
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
    const overrides: { applyTo: string; value: number }[] = []
    for (const buff of buffs) {
        const def = registry.actions.map.get(buff.effect.applyTo)
        if (!def || def.side !== 'target') continue
        const value = typeof buff.effect.value === 'string' ? num(buff.effect.value) : 0
        if (buff.effect.write === 'override') {
            overrides.push({ applyTo: def.id, value })
            continue
        }
        if (def.targetField) {
            const field = def.targetField as 'dmgReduction' | 'coefficient'
            panel[field] += value
        } else panel.zones[def.id] = (panel.zones[def.id] ?? 0) + value
    }
    for (const write of overrides) {
        const def = registry.actions.map.get(write.applyTo)!
        if (def.combine === 'multiply') panel.zones[write.applyTo] = 1 + write.value / 100
        else if (def.targetField) {
            const field = def.targetField as 'dmgReduction' | 'coefficient'
            panel[field] = write.value
        } else panel.zones[def.id] = write.value
    }
    return panel
}

const splitBuffs = (registry: CoreRegistry, damage: Damage) => {
    const literal: { applyTo: string; value: number; write: BuffWrite }[] = []
    const refs: { applyTo: string; ref: StatRef }[] = []
    const targetSide: Damage['activated_buffs'] = []
    for (const buff of damage.activated_buffs) {
        const def = registry.actions.map.get(buff.effect.applyTo)
        if (!def) continue
        if (def.side === 'target') {
            targetSide.push(buff)
            continue
        }
        const write: BuffWrite = buff.effect.write ?? 'add'
        if (typeof buff.effect.value === 'string') {
            literal.push({ applyTo: def.id, value: num(buff.effect.value), write })
        } else if (write === 'add') refs.push({ applyTo: def.id, ref: buff.effect.value })
    }
    return {
        literal: literal.filter((write) => write.write !== 'override'),
        refs,
        overrides: literal.filter((write) => write.write === 'override'),
        targetSide
    }
}

const panelOfDamage = (
    registry: CoreRegistry,
    table: GeneralTable,
    bases: KernelBases,
    charIndex: number,
    critBase: string,
    damage: Damage,
    target: TargetPanel
): { panel: CharacterPanel; charLevel: number } => {
    const { panel, charLevel } = basePanelOf(registry, table, bases, charIndex, critBase)
    const { literal, refs, overrides } = splitBuffs(registry, damage)
    for (const write of literal) applyZone(registry.actions, panel, write.applyTo, write.value)
    recomputeTotals(registry.actions, panel)
    if (refs.length > 0) {
        for (const { applyTo, ref } of refs) {
            applyZone(registry.actions, panel, applyTo, resolveStatRef(registry, ref, panel, target))
            recomputeTotals(registry.actions, panel)
        }
    }
    for (const write of overrides) {
        applyZone(registry.actions, panel, write.applyTo, write.value, 'override')
    }
    return { panel, charLevel }
}

const baseValueOf = (
    registry: CoreRegistry,
    def: ReturnType<typeof formulaOfRegistry>,
    damage: Damage,
    panel: CharacterPanel,
    target: TargetPanel
): number => {
    const hits = hitsOf(damage)
    const extraRatio = ((panel.zones.extraRatio ?? 0) / 100) * hits
    if (def.base.kind === 'fixed') return num(damage.value)
    if (def.base.kind === 'targetStat') {
        return (
            Number((target as unknown as Record<string, number>)[def.base.field] ?? 0) *
            (num(damage.value) + extraRatio)
        )
    }
    if (def.base.dim === 'effectCoeff') {
        return Math.round((panel.zones.effectCoeff ?? 0) * (num(damage.value) + extraRatio))
    }
    const dim = damage.base ?? registry.actions.dims[0]
    if (!dim) throw new Error('[coconut-core] no panel dimension registered')
    return panel.total[dim as keyof typeof panel.total] * (parseRatio(damage.value) + extraRatio)
}

const computeDamage = (
    registry: CoreRegistry,
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
    const formula: CalculationFormula = damage.formula
    const def = formulaOfRegistry(registry.formulas, formula)
    const { targetSide } = splitBuffs(registry, damage)
    const target = targetPanelOf(registry, bases, targetSide)
    const { panel, charLevel } = panelOfDamage(registry, table, bases, charIndex, def.critBase, damage, target)
    const baseValue = baseValueOf(registry, def, damage, panel, target)
    const evaluation = evaluateFormula(registry.formulas, {
        formula,
        baseValue,
        element: damage.element,
        panel,
        target,
        consts: { charLevel }
    })

    const nonCritRaw = baseValue * evaluation.productNoCrit
    const expectedRaw = baseValue * evaluation.product
    const expected = Math.round(expectedRaw)
    const canCrit = evaluation.canCrit

    return {
        entryIndex,
        damageIndex,
        source: entry.source,
        element: damage.element,
        formula: def.id,
        baseValue,
        nonCritRaw,
        expectedRaw,
        nonCrit: Math.round(nonCritRaw),
        crit: canCrit ? Math.round(nonCritRaw * evaluation.critDmgRatio) : expected,
        expected,
        canCrit,
        multipliers: evaluation.multipliers,
        panel,
        target,
        contributions: []
    }
}

const contributionsOf = (
    registry: CoreRegistry,
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
        const without = computeDamage(registry, table, bases, entryIndex, damageIndex, charIndex, buff.id)
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
    registry: CoreRegistry,
    table: GeneralTable,
    bases: KernelBases,
    options?: { trace?: boolean }
): CoreResult => {
    const damages: DamageResult[] = []
    for (const [entryIndex, entry] of table.damage_entries.entries()) {
        const charIndex = table.characters.indexOf(entry.source)
        for (const [damageIndex] of entry.damages.entries()) {
            const damage = computeDamage(registry, table, bases, entryIndex, damageIndex, charIndex)
            if (options?.trace) {
                damage.contributions = contributionsOf(
                    registry,
                    table,
                    bases,
                    entryIndex,
                    damageIndex,
                    charIndex,
                    damage
                )
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

export { formulaAcceptsRef }
