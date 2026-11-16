import type { CharacterPanel, TargetPanel } from './panel'
import type { ActionId } from './general-table'

export type ActionSide = 'character' | 'target'

export type ActionCombine = 'sum' | 'multiply'

export type PanelDim = string

export type PanelRounding = 'round' | 'none'

export interface PanelConfig {
    dims?: readonly PanelDim[]
    rounding?: PanelRounding
    aggregate?: (args: { base: number; flat: number; pct: number }) => number
}

export type TargetFieldKind = 'scalar' | 'map' | 'text'

export interface TargetFieldDef {
    field: ActionId
    kind: TargetFieldKind
}

export interface BuffActionDef {
    id: ActionId
    side: ActionSide
    combine: ActionCombine
    panel?: { base?: PanelDim; flat?: PanelDim; pct?: PanelDim; total?: PanelDim }
    overridable: boolean
    init: number
    initCoeff?: number
    targetField?: ActionId
}

export interface RefSourceDef {
    id: ActionId
    get: (panel: CharacterPanel, target: TargetPanel) => number
    writes?: PanelDim
}

export interface ActionRegistry {
    list: readonly BuffActionDef[]
    map: ReadonlyMap<ActionId, BuffActionDef>

    refSources: readonly RefSourceDef[]
    refMap: ReadonlyMap<ActionId, RefSourceDef>

    targetFieldKinds: ReadonlyMap<ActionId, TargetFieldKind>

    panelWriters: Readonly<Record<PanelDim, { flat?: ActionId; pct?: ActionId }>>

    dims: readonly PanelDim[]
    rounding: PanelRounding
    aggregate: (args: { base: number; flat: number; pct: number }) => number
}

const panelDimsOf = (defs: readonly BuffActionDef[]): PanelDim[] => [
    ...new Set(
        defs.flatMap((action) =>
            action.panel
                ? [action.panel.base, action.panel.flat, action.panel.pct, action.panel.total].filter(
                      (d): d is PanelDim => d !== undefined
                  )
                : []
        )
    )
]

export const createActionRegistry = (
    defs: readonly BuffActionDef[],
    refSources: readonly RefSourceDef[],
    options: { panel?: PanelConfig; targetFields?: readonly TargetFieldDef[] } = {}
): ActionRegistry => {
    const list = [...defs]
    const map = new Map(list.map((action) => [action.id, action]))
    const dims = options.panel?.dims ? [...options.panel.dims] : panelDimsOf(list)
    const panelWriters: Record<PanelDim, { flat?: ActionId; pct?: ActionId }> = {}
    for (const dim of dims) panelWriters[dim] = {}
    for (const action of list) {
        if (!action.panel) continue
        const { flat, pct } = action.panel
        if (flat) panelWriters[flat]!.flat = action.id
        if (pct) panelWriters[pct]!.pct = action.id
    }
    return {
        list,
        map,
        refSources,
        refMap: new Map(refSources.map((source) => [source.id, source])),
        targetFieldKinds: new Map((options.targetFields ?? []).map((entry) => [entry.field, entry.kind] as const)),
        panelWriters,
        dims,
        rounding: options.panel?.rounding ?? 'round',
        aggregate: options.panel?.aggregate ?? (({ base, flat, pct }) => base + Math.round(flat + (base * pct) / 100))
    }
}

export const isTargetSide = (registry: ActionRegistry, id: ActionId): boolean => registry.map.get(id)?.side === 'target'

export const writtenByOf = (registry: ActionRegistry, dim: PanelDim): ActionId[] =>
    registry.list
        .filter(
            (action) =>
                action.panel !== undefined &&
                (action.panel.base === dim ||
                    action.panel.flat === dim ||
                    action.panel.pct === dim ||
                    action.panel.total === dim)
        )
        .map((action) => action.id)

export const refWrittenBy = (registry: ActionRegistry, refId: ActionId): ActionId[] => {
    const source = registry.refMap.get(refId)
    if (source?.writes !== undefined) return writtenByOf(registry, source.writes)
    return source ? [refId] : []
}
