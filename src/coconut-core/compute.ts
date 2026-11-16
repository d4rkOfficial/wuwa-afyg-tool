import type { ActionRegistry } from './actions'
import type { ConstantDef } from './config'
import { evaluateFormula } from './evaluate'
import { formulaOfRegistry, readTargetField, type FormulaRegistry } from './formulas'
import {
    applyZone,
    emptyPanel,
    emptyTargetPanel,
    recomputeTotals,
    roundPanelBase,
    type CharacterPanel,
    type TargetPanel
} from './panel'
import {
    parseRatio,
    type ActionId,
    type Buff,
    type BuffEffect,
    type BuffWrite,
    type CalculationFormula,
    type Damage,
    type GeneralTable,
    type StatRef
} from './general-table'
import type { BuffContribution, CoreResult, DamageResult } from './result'

export interface CoreRegistry {
    actions: ActionRegistry
    formulas: FormulaRegistry
    constants: readonly ConstantDef[]
    ratioZone?: ActionId
}

type BuffIndex = ReadonlyMap<string, Buff>

const buffIndexOf = (table: GeneralTable): BuffIndex => new Map(table.buffs.map((buff) => [buff.id, buff]))

const resolveBuffs = (ids: readonly string[], index: BuffIndex): Buff[] =>
    ids.flatMap((id) => {
        const buff = index.get(id)
        return buff ? [buff] : []
    })

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

const isCoeffBase = (critBase: string): boolean => critBase === 'coefficient'

const effectEnabled = (effect: BuffEffect, critBase: string): boolean =>
    !(effect.only === 'panel' && isCoeffBase(critBase))

const planOf = (registry: CoreRegistry, buffs: readonly Buff[], critBase: string) => {
    const literal: { applyTo: ActionId; value: number; write: BuffWrite }[] = []
    const refs: { applyTo: ActionId; ref: StatRef }[] = []
    const targetEffects: BuffEffect[] = []
    for (const buff of buffs) {
        for (const effect of buff.effects) {
            if (!effectEnabled(effect, critBase)) continue
            const def = registry.actions.map.get(effect.applyTo)
            if (!def) continue
            if (def.side === 'target') {
                targetEffects.push(effect)
                continue
            }
            if (typeof effect.value !== 'string') {
                if ((effect.write ?? 'add') === 'add') refs.push({ applyTo: def.id, ref: effect.value })
                continue
            }
            literal.push({ applyTo: def.id, value: num(effect.value), write: effect.write ?? 'add' })
        }
    }
    return {
        literal: literal.filter((write) => write.write !== 'override'),
        refs,
        overrides: literal.filter((write) => write.write === 'override'),
        targetEffects
    }
}

const applyTargetEffect = (registry: CoreRegistry, panel: TargetPanel, effect: BuffEffect): void => {
    const def = registry.actions.map.get(effect.applyTo)
    if (!def) return
    const field = def.targetField
    const kind = field === undefined ? undefined : registry.actions.targetFieldKinds.get(field)
    if (field === undefined || kind === undefined) {
        const value = num(typeof effect.value === 'string' ? effect.value : 0)
        if (effect.write === 'override') panel.zones[def.id] = value
        else panel.zones[def.id] = (panel.zones[def.id] ?? 0) + value
        return
    }
    if (kind === 'text') {
        panel.text[field] = String(effect.value ?? '')
        return
    }
    const value = num(typeof effect.value === 'string' ? effect.value : 0)
    if (kind === 'map') {
        if (!effect.element) return
        const bucket = (panel.maps[field] ??= {})
        bucket[effect.element] = effect.write === 'override' ? value : (bucket[effect.element] ?? 0) + value
        return
    }
    panel.scalars[field] = effect.write === 'override' ? value : (panel.scalars[field] ?? 0) + value
}

const targetPanelOf = (registry: CoreRegistry, effects: readonly BuffEffect[]): TargetPanel => {
    const panel = emptyTargetPanel()
    for (const effect of effects) applyTargetEffect(registry, panel, effect)
    return panel
}

const panelOfDamage = (
    registry: CoreRegistry,
    critBase: string,
    buffs: readonly Buff[],
    target: TargetPanel
): CharacterPanel => {
    const panel = emptyPanel(registry.actions, critBase)
    const { literal, refs, overrides } = planOf(registry, buffs, critBase)
    for (const write of literal) applyZone(registry.actions, panel, write.applyTo, write.value)
    roundPanelBase(registry.actions, panel)
    recomputeTotals(registry.actions, panel)
    for (const { applyTo, ref } of refs) {
        applyZone(registry.actions, panel, applyTo, resolveStatRef(registry, ref, panel, target))
        recomputeTotals(registry.actions, panel)
    }
    for (const write of overrides) {
        applyZone(registry.actions, panel, write.applyTo, write.value, 'override')
    }
    return panel
}

const baseValueOf = (
    registry: CoreRegistry,
    def: ReturnType<typeof formulaOfRegistry>,
    damage: Damage,
    panel: CharacterPanel,
    target: TargetPanel
): number => {
    const hits = hitsOf(damage)
    const extraRatio = registry.ratioZone === undefined ? 0 : ((panel.zones[registry.ratioZone] ?? 0) / 100) * hits
    if (def.base.kind === 'fixed') return num(damage.value)
    if (def.base.kind === 'targetStat') {
        return readTargetField(registry.formulas, def.base.field, target) * (num(damage.value) + extraRatio)
    }
    if (def.base.kind === 'zone') {
        const value = (panel.zones[def.base.id] ?? 0) * (num(damage.value) + extraRatio)
        return def.base.round ? Math.round(value) : value
    }
    const dim = damage.base ?? def.base.dim ?? registry.actions.dims[0]
    if (dim === undefined) throw new Error('[coconut-core] no panel dimension registered')
    return (panel.total[dim] ?? 0) * (parseRatio(damage.value) + extraRatio)
}

const computeDamage = (
    registry: CoreRegistry,
    table: GeneralTable,
    buffIndex: BuffIndex,
    globalBuffs: readonly Buff[],
    entryIndex: number,
    damageIndex: number,
    excludeBuffId?: string
): DamageResult => {
    const entry = table.damage_entries[entryIndex]!
    const damage = entry.damages[damageIndex]!
    const keep = (buff: Buff): boolean => buff.id !== excludeBuffId
    const buffs = [...globalBuffs.filter(keep), ...resolveBuffs(damage.activated_buffs, buffIndex).filter(keep)]
    const formula: CalculationFormula = damage.formula
    const def = formulaOfRegistry(registry.formulas, formula)
    const { targetEffects } = planOf(registry, buffs, def.critBase)
    const target = targetPanelOf(registry, targetEffects)
    const panel = panelOfDamage(registry, def.critBase, buffs, target)
    const baseValue = baseValueOf(registry, def, damage, panel, target)
    const consts: Record<string, number> = {}
    for (const constant of registry.constants) consts[constant.id] = constant.get(panel, target)
    const evaluation = evaluateFormula(registry.formulas, {
        formula,
        baseValue,
        element: damage.element,
        panel,
        target,
        consts
    })

    const expectedRaw = baseValue * evaluation.product
    const expected = Math.round(expectedRaw)

    return {
        entryIndex,
        damageIndex,
        source: entry.source,
        element: damage.element,
        formula: def.id,
        baseValue,
        expectedRaw,
        expected,
        multipliers: evaluation.multipliers,
        panel,
        target,
        contributions: []
    }
}

const contributionsOf = (
    registry: CoreRegistry,
    table: GeneralTable,
    buffIndex: BuffIndex,
    globalBuffs: readonly Buff[],
    entryIndex: number,
    damageIndex: number,
    full: DamageResult
): BuffContribution[] => {
    const damage = table.damage_entries[entryIndex]!.damages[damageIndex]!
    const seen = new Set<string>()
    const out: BuffContribution[] = []
    const ids = [...globalBuffs.map((buff) => buff.id), ...damage.activated_buffs]
    for (const buffId of ids) {
        if (seen.has(buffId)) continue
        seen.add(buffId)
        const buff = buffIndex.get(buffId)
        if (!buff || buff.role === 'stat') continue
        const without = computeDamage(registry, table, buffIndex, globalBuffs, entryIndex, damageIndex, buffId)
        const deltaExpected = full.expected - without.expected
        out.push({
            buffId,
            applyTo: buff.effects.map((effect) => effect.applyTo),
            deltaExpected,
            share: full.expected === 0 ? 0 : deltaExpected / full.expected
        })
    }
    return out
}

export const computeGeneralTable = (
    registry: CoreRegistry,
    table: GeneralTable,
    options?: { trace?: boolean }
): CoreResult => {
    const buffIndex = buffIndexOf(table)
    const globalBuffs = resolveBuffs(table.global_buffs, buffIndex)
    const damages: DamageResult[] = []
    for (const [entryIndex, entry] of table.damage_entries.entries()) {
        for (const [damageIndex] of entry.damages.entries()) {
            const damage = computeDamage(registry, table, buffIndex, globalBuffs, entryIndex, damageIndex)
            if (options?.trace) {
                damage.contributions = contributionsOf(
                    registry,
                    table,
                    buffIndex,
                    globalBuffs,
                    entryIndex,
                    damageIndex,
                    damage
                )
            }
            damages.push(damage)
        }
    }
    return {
        damages,
        total: damages.reduce((sum, damage) => sum + damage.expected, 0)
    }
}
