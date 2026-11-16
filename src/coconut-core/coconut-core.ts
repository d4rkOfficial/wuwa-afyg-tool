/**
 * @desc 计算核本体：**一张 `GeneralTable` + 一份基础数值，直接出结果**。
 *
 * 外部用法：
 * ```ts
 * const core = new CoconutCore()
 * const result = core.compute(table, {
 *     characters: { '角色id': { atk: 400, hp: 10000, def: 500, element: '属性名' } },
 *     weapons: { '武器id': { atk: 587 } },
 *     enemy: { type: '敌人类型', defense: 1000, dmgReduction: 5, resistances: {}, coefficient: 10027 }
 * })
 * ```
 *
 * 内核不认识具体角色 / 武器 / 敌人，也不持有任何注册表：**基础数值全部调用时传入**。
 */
import {
    computeGeneralTable,
    type CharacterBaseStats,
    type EnemyBaseStats,
    type WeaponBaseStats
} from '$coconut/compute'
import type { GeneralTable } from '$coconut/general-table'
import type { CoreResult } from '$coconut/result'

/** @desc 一次结算的全部基础数值（角色 / 武器 / 敌人） */
export interface BaseStats {
    /** @desc 角色 id → 基础属性（白值 + 属性 + 可选等级 / 谐度破坏增幅 / 效应系数） */
    characters: Readonly<Record<string, CharacterBaseStats>>
    /** @desc 武器 id → 基础属性（只提供白值；副属性请编译进词条） */
    weapons?: Readonly<Record<string, WeaponBaseStats>>
    /** @desc 敌人基础数值（防御 / 免伤 / 抗性 / 偏谐系数） */
    enemy: EnemyBaseStats
}

/** @desc 结算选项 */
export interface ComputeOptions {
    /** @desc 为每段伤害附带逐 buff 贡献（溯源用） */
    trace?: boolean
}

/** @desc 计算核（无状态：同一实例可反复结算） */
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
