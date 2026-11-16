import { createActionRegistry } from './actions'
import {
    computeGeneralTable,
    type CharacterBaseStats,
    type CoreRegistry,
    type EnemyBaseStats,
    type WeaponBaseStats
} from './compute'
import type { CoconutCoreConfig } from './config'
import { createFormulaRegistry } from './formulas'
import type { GeneralTable } from './general-table'
import type { CoreResult } from './result'

export interface BaseStats {
    characters: Readonly<Record<string, CharacterBaseStats>>
    weapons?: Readonly<Record<string, WeaponBaseStats>>
    enemy: EnemyBaseStats
}

export interface ComputeOptions {
    trace?: boolean
}

export class CoconutCore {
    private registry: CoreRegistry | null = null

    init(config: CoconutCoreConfig): this {
        const actions = createActionRegistry(config.actions, config.refSources)
        this.registry = {
            actions,
            formulas: createFormulaRegistry({
                multipliers: config.multipliers,
                formulas: config.formulas,
                critMultiplier: config.critMultiplier,
                critActions: config.critActions,
                actions
            })
        }
        return this
    }

    compute(table: GeneralTable, bases: BaseStats, options?: ComputeOptions): CoreResult {
        const registry = this.registry
        if (!registry) throw new Error('[coconut-core] not initialized: call init(config) first')
        return computeGeneralTable(
            registry,
            table,
            {
                characterOf: (id) => bases.characters[id] ?? null,
                weaponOf: (id) => bases.weapons?.[id] ?? null,
                enemy: bases.enemy
            },
            options
        )
    }
}

export type { CharacterBaseStats, EnemyBaseStats, WeaponBaseStats }
