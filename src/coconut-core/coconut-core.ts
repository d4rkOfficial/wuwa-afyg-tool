import {
    computeGeneralTable,
    type CharacterBaseStats,
    type EnemyBaseStats,
    type WeaponBaseStats
} from '$coconut/compute'
import type { GeneralTable } from '$coconut/general-table'
import type { CoreResult } from '$coconut/result'

export interface BaseStats {
    characters: Readonly<Record<string, CharacterBaseStats>>
    weapons?: Readonly<Record<string, WeaponBaseStats>>
    enemy: EnemyBaseStats
}

export interface ComputeOptions {
    trace?: boolean
}

export class CoconutCore {
    compute(table: GeneralTable, bases: BaseStats, options?: ComputeOptions): CoreResult {
        return computeGeneralTable(
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
