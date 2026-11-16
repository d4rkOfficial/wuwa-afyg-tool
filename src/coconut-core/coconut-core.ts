import { createActionRegistry } from './actions'
import { computeGeneralTable, type CoreRegistry } from './compute'
import type { CoconutCoreConfig } from './config'
import { createFormulaRegistry } from './formulas'
import type { GeneralTable } from './general-table'
import type { CoreResult } from './result'

export interface ComputeOptions {
    trace?: boolean
}

export class CoconutCore {
    private registry: CoreRegistry | null = null

    init(config: CoconutCoreConfig): this {
        const actions = createActionRegistry(config.actions, config.refSources, {
            panel: config.panel,
            targetFields: config.targetFields
        })
        this.registry = {
            actions,
            formulas: createFormulaRegistry({
                multipliers: config.multipliers,
                formulas: config.formulas,
                actions
            }),
            constants: config.constants ?? [],
            ratioZone: config.ratioZone
        }
        return this
    }

    compute(table: GeneralTable, options?: ComputeOptions): CoreResult {
        const registry = this.registry
        if (!registry) throw new Error('[coconut-core] not initialized: call init(config) first')
        return computeGeneralTable(registry, table, options)
    }
}
