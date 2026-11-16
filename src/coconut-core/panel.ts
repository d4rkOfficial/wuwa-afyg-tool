import type { ActionRegistry, PanelDim } from './actions'
import type { ActionId } from './general-table'
import type { CritBase } from './formulas'

export interface CharacterPanel {
    zones: Record<PropertyKey, number>
    base: Record<PanelDim, number>
    total: Record<PanelDim, number>
}

export interface TargetPanel {
    scalars: Record<ActionId, number>
    maps: Record<ActionId, Record<string, number>>
    text: Record<ActionId, string>
    zones: Record<PropertyKey, number>
}

export const emptyTargetPanel = (): TargetPanel => ({ scalars: {}, maps: {}, text: {}, zones: {} })

export type ZoneWrite = 'add' | 'override'

export const emptyPanel = (registry: ActionRegistry, critBase: CritBase = ''): CharacterPanel => {
    const zones: Record<PropertyKey, number> = {}
    for (const action of registry.list) {
        if (action.side !== 'character') continue
        zones[action.id] = critBase === 'coefficient' && action.initCoeff !== undefined ? action.initCoeff : action.init
    }
    const base: Record<PanelDim, number> = {}
    const total: Record<PanelDim, number> = {}
    for (const dim of registry.dims) {
        base[dim] = 0
        total[dim] = 0
    }
    return { zones, base, total }
}

export const clonePanel = (panel: CharacterPanel): CharacterPanel => ({
    zones: { ...panel.zones },
    base: { ...panel.base },
    total: { ...panel.total }
})

export const applyZone = (
    registry: ActionRegistry,
    panel: CharacterPanel,
    actionId: ActionId,
    value: number,
    write: ZoneWrite = 'add'
): void => {
    const def = registry.map.get(actionId)
    if (!def || def.side !== 'character') return
    const effective: ZoneWrite = write === 'override' && !def.overridable ? 'add' : write

    if (def.combine === 'multiply') {
        const prev = panel.zones[actionId] ?? def.init
        panel.zones[actionId] = effective === 'override' ? 1 + value / 100 : prev * (1 + value / 100)
        return
    }
    if (def.panel?.base) {
        const key = def.panel.base
        panel.base[key] = effective === 'override' ? value : (panel.base[key] ?? 0) + value
        return
    }
    if (effective === 'override') {
        if (def.panel?.total) {
            panel.total[def.panel.total] = value
            return
        }
        panel.zones[actionId] = value
        return
    }
    panel.zones[actionId] = (panel.zones[actionId] ?? def.init) + value
}

export const roundPanelBase = (registry: ActionRegistry, panel: CharacterPanel): void => {
    if (registry.rounding !== 'round') return
    for (const dim of registry.dims) panel.base[dim] = Math.round(panel.base[dim] ?? 0)
}

export const recomputeTotals = (registry: ActionRegistry, panel: CharacterPanel): void => {
    for (const dim of registry.dims) {
        const writers = registry.panelWriters[dim]
        const flat = writers?.flat !== undefined ? (panel.zones[writers.flat] ?? 0) : 0
        const pct = writers?.pct !== undefined ? (panel.zones[writers.pct] ?? 0) : 0
        panel.total[dim] = registry.aggregate({ base: panel.base[dim] ?? 0, flat, pct })
    }
}

export const zoneOf = (panel: CharacterPanel, actionId: ActionId): number => panel.zones[actionId] ?? 0

export type { PanelDim }
