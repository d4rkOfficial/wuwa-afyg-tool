/**
 * @desc 计算核本体：**注册基础数据，喂一张 `GeneralTable`，直接出结果**。
 *
 * 外部用法：
 * ```ts
 * const core = new CoconutCore()
 * core.registerCharacterBaseStats((id) => ({ atk: 400, hp: 10000, def: 500, element: '属性名' }))
 * core.registerWeaponBaseStats((id) => ({ atk: 587 }))
 * const result = core.compute(table)
 * ```
 *
 * 内核不认识「某个具体角色/武器叫什么」，也不知道某个 buff 什么时候生效 ——
 * 前者靠注册，后者靠调用方在表里写明。
 */
import {
    computeGeneralTable,
    type CharacterBaseStats,
    type KernelRegistries,
    type WeaponBaseStats
} from '$coconut/compute'
import type { GeneralTable } from '$coconut/general-table'
import type { CoreResult } from '$coconut/result'

/** @desc 基础属性来源：函数按需查，或直接给一张 id → 属性表 */
export type CharacterStatsSource = (id: string) => CharacterBaseStats | null | undefined
export type WeaponStatsSource = (id: string) => WeaponBaseStats | null | undefined
export type EnemyCoefficientSource = (type: string) => number | undefined

/** @desc 注册表（不变式：注册项按 id 覆盖，后注册的生效） */
export class CoconutCore {
    private characterOf: CharacterStatsSource = () => null
    private weaponOf: WeaponStatsSource = () => null
    private enemyCoefficientOf: EnemyCoefficientSource = () => undefined

    /** @desc 注册角色基础属性（90 级白值 + 属性 + 谐度破坏增幅） */
    registerCharacterBaseStats(source: CharacterStatsSource | Record<string, CharacterBaseStats>): this {
        this.characterOf = typeof source === 'function' ? source : (id) => source[id]
        return this
    }

    /** @desc 注册武器基础属性（只提供白值；副属性请编译进词条） */
    registerWeaponBaseStats(source: WeaponStatsSource | Record<string, WeaponBaseStats>): this {
        this.weaponOf = typeof source === 'function' ? source : (id) => source[id]
        return this
    }

    /** @desc 注册敌人类型的偏谐系数（处决 / 偏谐响应的基值系数） */
    registerEnemyCoefficients(source: EnemyCoefficientSource | Record<string, number>): this {
        this.enemyCoefficientOf = typeof source === 'function' ? source : (type) => source[type]
        return this
    }

    /** @desc 结算整张表（`trace: true` 时为每段附带逐 buff 贡献，供溯源 / 贡献分析） */
    compute(table: GeneralTable, options?: { trace?: boolean }): CoreResult {
        const registries: KernelRegistries = {
            characterOf: this.characterOf,
            weaponOf: this.weaponOf,
            enemyCoefficientOf: this.enemyCoefficientOf
        }
        return computeGeneralTable(table, registries, options)
    }
}

export type { CharacterBaseStats, WeaponBaseStats }
