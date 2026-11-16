import type { BuffActionDef, RefSourceDef } from './actions'
import type { FormulaDef, FormulaHandle } from './formulas'

export interface CoconutCoreConfig {
    actions: readonly BuffActionDef[]

    refSources: readonly RefSourceDef[]

    multipliers: readonly FormulaHandle[]

    formulas: Readonly<Record<string, FormulaDef>>

    critMultiplier: string

    critActions: readonly string[]
}
