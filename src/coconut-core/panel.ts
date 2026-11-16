import type { ActionRegistry, PanelDim } from './actions'
import type { CritBase } from './formulas'

export interface PanelTriple {
    atk: number
    hp: number
    def: number
}

export interface CharacterPanel {
    zones: Record<string, number>
    base: PanelTriple
    total: PanelTriple
    elementBonus: Record<string, number>
    typeBonus: Record<string, number>
}

export interface TargetPanel {
    type: string
    defense: number
    dmgReduction: number
    coefficient: number
    resistances: Record<string, number>
    zones: Record<string, number>
}

export const emptyTargetPanel = (): TargetPanel => ({
    type: '',
    defense: 0,
    dmgReduction: 0,
    coefficient: 0,
    resistances: {},
    zones: {}
})

export type ZoneWrite = 'add' | 'override'

export const emptyPanel = (registry: ActionRegistry, critBase: CritBase = ''): CharacterPanel => {
    const zones: Record<string, number> = {}
    for (const action of registry.list) {
        if (action.side !== 'character') continue
        zones[action.id] = critBase === 'coefficient' && action.initCoeff !== undefined ? action.initCoeff : action.init
    }
    return {
        zones,
        base: { atk: 0, hp: 0, def: 0 },
        total: { atk: 0, hp: 0, def: 0 },
        elementBonus: {},
        typeBonus: {}
    }
}

export const clonePanel = (panel: CharacterPanel): CharacterPanel => ({
    zones: { ...panel.zones },
    base: { ...panel.base },
    total: { ...panel.total },
    elementBonus: { ...panel.elementBonus },
    typeBonus: { ...panel.typeBonus }
})

export const applyZone = (
    registry: ActionRegistry,
    panel: CharacterPanel,
    actionId: string,
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
    if (effective === 'override') {
        if (def.panel?.total) {
            panel.total[def.panel.total as 'atk' | 'hp' | 'def'] = value
            return
        }
        panel.zones[actionId] = value
        return
    }
    panel.zones[actionId] = (panel.zones[actionId] ?? def.init) + value
}

export const recomputeTotals = (registry: ActionRegistry, panel: CharacterPanel): void => {
    for (const dim of registry.dims) {
        const writers = registry.panelWriters[dim]
        const flat = writers.flat ? (panel.zones[writers.flat] ?? 0) : 0
        const pct = writers.pct ? (panel.zones[writers.pct] ?? 0) : 0
        const key = dim as 'atk' | 'hp' | 'def'
        panel.total[key] = panel.base[key] + Math.round(flat + (panel.base[key] * pct) / 100)
    }
}

export const zoneOf = (panel: CharacterPanel, actionId: string): number => panel.zones[actionId] ?? 0

export type { PanelDim }
