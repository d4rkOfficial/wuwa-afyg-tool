/**
 * @desc 计算门面：**工具箱只做「编译 + 结果物化」，数值全部由内核给**。
 *
 * 流程：工程状态 → `GeneralTable`（编译）+ 基础数值（角色/武器/敌人，调用时传入）
 * → `CoconutCore.compute`（内核算面板与数值）→ 用内核产出的面板/乘区物化 `ResultEntry`。
 *
 * 为什么物化还留在工具箱：`ResultEntry` 是界面契约（倍率拆解、溯源辅助、兼容列），
 * 属于 app 的展示需求，不进内核。
 */
import { CoconutCore, type BaseStats, type CharacterBaseStats, type GeneralTable } from '$coconut'
import type { ComputeRequest } from '$lib/calc/request.types'
import { TUNE_COEFF_MAP, computeFormulaEntry } from '$lib/calc/compute'
import type { ResultEntry } from '$lib/calc/result.types'
import { VIRTUAL_EFFECT_PREFIX, compileGeneralTable } from '$lib/calc/compile'
import { NON_DIRECT_ELEMENT } from '$lib/consts/game-terms'
import { EFFECT_BASE_VALUE } from '$lib/consts/effect-data'

/** @desc 工程状态 → 内核要的基础数值（角色 / 武器 / 敌人全部在这里给） */
export const basesOfRequest = (request: ComputeRequest): BaseStats => {
    const characters: Record<string, CharacterBaseStats> = {}
    for (const [name, info] of Object.entries(request.charInfo)) {
        characters[name] = { ...info.lv90BaseStats, element: info.element }
    }
    for (const entry of request.entries) {
        if (entry.formula !== 'effect' || !entry.hitName) continue
        // 效应虚角色：只有「效应系数」这一维度（= 效应基础值），不参与三维面板
        characters[`${VIRTUAL_EFFECT_PREFIX}${entry.hitName}`] = {
            atk: 0,
            hp: 0,
            def: 0,
            element: (NON_DIRECT_ELEMENT as Record<string, string>)[entry.hitName] ?? '',
            coefficient: EFFECT_BASE_VALUE
        }
    }
    const weapons: Record<string, { atk: number }> = {}
    for (const [name, info] of Object.entries(request.weaponInfo)) weapons[name] = { atk: info.lv90BaseAtk }

    const enemy = request.config.enemy
    return {
        characters,
        weapons,
        enemy: {
            type: enemy.type,
            level: enemy.level,
            defense: enemy.defense,
            dmgReduction: enemy.dmgReduction,
            resistances: enemy.resistances,
            coefficient: TUNE_COEFF_MAP[enemy.type] ?? 716.2
        }
    }
}

/** @desc 编译 + 内核结算，返回表与按条目分组的结算结果 */
export const computeWithCore = (request: ComputeRequest) => {
    const table: GeneralTable = compileGeneralTable(request)
    const result = new CoconutCore().compute(table, basesOfRequest(request))
    return { table, result }
}

/** @desc 工程状态 → `ResultEntry[]`（与引擎 `computeAll` 同形状） */
export const computeAllViaCore = (request: ComputeRequest): ResultEntry[] => {
    const { result } = computeWithCore(request)
    return request.entries.map((entry, entryIndex) => {
        const segments = result.damages.filter((damage) => damage.entryIndex === entryIndex)
        const first = segments[0]!
        const damageTypes = [...(request.damageTypes?.[entry.id] ?? [])]
        return computeFormulaEntry(entry, first.panel, first.target, damageTypes)
    })
}

/** @desc 与引擎 `computeAll` 同位置参数的入口（调用处只换 import，不改实参顺序） */
export const computeAllCore = (
    entries: ComputeRequest['entries'],
    buffs: ComputeRequest['buffs'],
    bindings: ComputeRequest['bindings'],
    damageTypes: ComputeRequest['damageTypes'],
    config: ComputeRequest['config'],
    team: ComputeRequest['team'],
    charInfo: ComputeRequest['charInfo'],
    weaponInfo: ComputeRequest['weaponInfo'],
    profile?: ComputeRequest['profile'],
    echoSkillText?: ComputeRequest['echoSkillText']
): ResultEntry[] =>
    computeAllViaCore({
        entries,
        buffs,
        bindings,
        damageTypes,
        config,
        team,
        charInfo,
        weaponInfo,
        profile,
        echoSkillText
    })
