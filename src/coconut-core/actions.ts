import type { CharacterPanel, TargetPanel } from './panel'

export type ActionSide = 'character' | 'target'

export type ActionCombine = 'sum' | 'multiply'

export type PanelDim = string

export interface BuffActionDef {
    id: string
    label: string
    unit: '%' | 'flat'
    group: string
    side: ActionSide
    combine: ActionCombine
    panel?: { flat?: PanelDim; pct?: PanelDim; total?: PanelDim }
    overridable: boolean
    damageMatchable: boolean
    init: number
    initCoeff?: number
    ref?: { label: string }
    targetField?: string
}

export interface RefSourceDef {
    id: string
    label: string
    unit: '%' | 'flat'
    side: ActionSide
    get: (panel: CharacterPanel, target: TargetPanel) => number
}

export interface ActionRegistry {
    list: readonly BuffActionDef[]
    map: ReadonlyMap<string, BuffActionDef>

    refSources: readonly RefSourceDef[]
    refMap: ReadonlyMap<string, RefSourceDef>

    targetScalars: Readonly<Record<string, (target: TargetPanel) => number>>

    panelWriters: Readonly<Record<PanelDim, { flat?: string; pct?: string }>>

    dims: readonly PanelDim[]
}

const panelDimsOf = (defs: readonly BuffActionDef[]): PanelDim[] => [
    ...new Set(
        defs.flatMap((action) =>
            action.panel
                ? [action.panel.flat, action.panel.pct, action.panel.total].filter(
                      (d): d is PanelDim => d !== undefined
                  )
                : []
        )
    )
]

export const createActionRegistry = (
    defs: readonly BuffActionDef[],
    refSources: readonly RefSourceDef[]
): ActionRegistry => {
    const list = [...defs]
    const map = new Map(list.map((action) => [action.id, action]))
    const panelWriters: Record<PanelDim, { flat?: string; pct?: string }> = {}
    for (const dim of panelDimsOf(list)) panelWriters[dim] = {}
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
        targetScalars: Object.fromEntries(
            list
                .filter((action) => action.targetField !== undefined)
                .map((action) => [
                    action.id,
                    (target: TargetPanel) =>
                        Number((target as unknown as Record<string, unknown>)[action.targetField!] ?? 0)
                ])
        ),
        panelWriters,
        dims: panelDimsOf(list)
    }
}

export const isTargetSide = (registry: ActionRegistry, id: string): boolean => registry.map.get(id)?.side === 'target'

export const actionAllowsCondition = (registry: ActionRegistry, actionId: string): boolean =>
    registry.map.get(actionId)?.damageMatchable === true

export const writtenByOf = (registry: ActionRegistry, dim: PanelDim): string[] =>
    registry.list
        .filter(
            (action) =>
                action.panel !== undefined &&
                (action.panel.flat === dim || action.panel.pct === dim || action.panel.total === dim)
        )
        .map((action) => action.id)

export const refWrittenBy = (registry: ActionRegistry, refId: string): string[] => {
    const dimOf: Record<string, PanelDim> = {
        baseAtk: 'atk',
        totalAtk: 'atk',
        baseHp: 'hp',
        totalHp: 'hp',
        baseDef: 'def',
        totalDef: 'def'
    }
    const dim = dimOf[refId]
    if (dim) return writtenByOf(registry, dim)
    return registry.refMap.has(refId) ? [refId] : []
}
