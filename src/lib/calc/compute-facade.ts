/**
 * @desc 计算门面：**工具箱只做「编译 + 结果物化」，数值全部由内核给**。
 *
 * 流程：工程状态 → `GeneralTable`（编译）→ `CoconutCore.compute`（内核算面板与数值）
 * → 用内核产出的面板/乘区物化界面需要的 `ResultEntry`。
 *
 * 为什么物化还留在工具箱：`ResultEntry` 是界面契约（倍率拆解、溯源辅助、兼容列），
 * 属于 app 的展示需求，不进内核。
 */
import { CoconutCore, type GeneralTable } from '$coconut'
import type { ComputeRequest } from '$lib/calc/core'
import { computeFormulaEntry } from '$lib/calc/compute'
import type { ResultEntry } from '$lib/calc/result.types'
import { compileGeneralTable } from '$lib/calc/compile'

/** @desc 用工程里的基础数据建内核（角色/武器白值、敌人偏谐系数由工程提供） */
export const coreOfRequest = (request: ComputeRequest): CoconutCore => {
    const core = new CoconutCore()
    core.registerCharacterBaseStats((id) => {
        const info = request.charInfo[id]
        if (!info) return null
        return { ...info.lv90BaseStats, element: info.element }
    })
    core.registerWeaponBaseStats((id) => {
        const info = request.weaponInfo[id]
        return info ? { atk: info.lv90BaseAtk } : null
    })
    return core
}

/** @desc 编译 + 内核结算，返回表与按条目分组的结算结果 */
export const computeWithCore = (request: ComputeRequest) => {
    const table: GeneralTable = compileGeneralTable(request)
    const result = coreOfRequest(request).compute(table)
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
