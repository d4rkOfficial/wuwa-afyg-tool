import { ACTION_MAP, BUFF_ACTIONS, type ActionId, type PanelDim } from '$coconut/actions'
import type { CritBase } from '$coconut/formulas'

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

const PANEL_WRITERS: Record<PanelDim, { flat?: string; pct?: string }> = (() => {
    const out: Record<PanelDim, { flat?: string; pct?: string }> = {
        atk: {},
        hp: {},
        def: {}
    }
    for (const action of BUFF_ACTIONS) {
        if (!('panel' in action) || !action.panel) continue
        const { flat, pct } = action.panel as { flat?: PanelDim; pct?: PanelDim }
        if (flat) out[flat].flat = action.id
        if (pct) out[pct].pct = action.id
    }
    return out
})()

const DIMS: readonly PanelDim[] = [
    ...new Set(
        BUFF_ACTIONS.flatMap((a) =>
            a.panel ? [a.panel.flat, a.panel.pct, a.panel.total].filter((d): d is PanelDim => d !== undefined) : []
        )
    )
]

export const emptyPanel = (critBase: CritBase = 'panel'): CharacterPanel => {
    const zones: Record<string, number> = {}
    for (const action of BUFF_ACTIONS) {
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
    panel: CharacterPanel,
    actionId: string,
    value: number,
    write: 'add' | 'override' = 'add'
): void => {
    const def = ACTION_MAP.get(actionId)
    if (!def || def.side !== 'character') return
    const effective: 'add' | 'override' = write === 'override' && !def.overridable ? 'add' : write

    if (def.combine === 'multiply') {
        const prev = panel.zones[actionId] ?? def.init
        panel.zones[actionId] = effective === 'override' ? 1 + value / 100 : prev * (1 + value / 100)
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

export const recomputeTotals = (panel: CharacterPanel): void => {
    for (const dim of DIMS) {
        const flat = PANEL_WRITERS[dim].flat ? (panel.zones[PANEL_WRITERS[dim].flat!] ?? 0) : 0
        const pct = PANEL_WRITERS[dim].pct ? (panel.zones[PANEL_WRITERS[dim].pct!] ?? 0) : 0
        panel.total[dim] = panel.base[dim] + Math.round(flat + (panel.base[dim] * pct) / 100)
    }
}

export const zoneOf = (panel: CharacterPanel, actionId: ActionId | string): number => panel.zones[actionId] ?? 0
