import type { BuffActionDef, RefSourceDef, TargetFieldDef, PanelConfig } from './actions'
import type { FormulaDef, FormulaHandle } from './formulas'
import type { CharacterPanel, TargetPanel } from './panel'
import type { ActionId } from './general-table'

export interface ConstantDef {
    id: string
    get: (panel: CharacterPanel, target: TargetPanel) => number
}

export interface CoconutCoreConfig {
    actions: readonly BuffActionDef[]

    refSources: readonly RefSourceDef[]

    multipliers: readonly FormulaHandle[]

    formulas: readonly FormulaDef[]

    panel?: PanelConfig

    targetFields?: readonly TargetFieldDef[]

    constants?: readonly ConstantDef[]

    ratioZone?: ActionId
}
