/**
 * @desc 计算核的**纯计算入口**：把引擎的 9 / 11 个位置参数收成一个请求对象。
 *
 * 这一层是「导出库」的稳定契约：`src/coconut-core/engine/core/index.ts` 只暴露这里的东西，
 * 调用方（外部项目 / Worker / AI 工具）不需要知道引擎内部函数签名。
 */
import type { BuffInstance, DamageEntry } from '$coconut/engine/calculation.types'
import type { ConfigState } from '$coconut/engine/config.types'
import type { ResultEntry } from '$coconut/engine/result.types'
import type { CharSlot } from '$lib/types/project'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import { DEFAULT_CONDITION_PROFILE, computeAll, computeOneEntry, type ConditionProfile } from '$coconut/engine/compute'

/** @desc 一次完整结算的输入 */
export interface ComputeRequest {
    /** @desc 伤害条目（由排轴时间线派生） */
    entries: readonly DamageEntry[]
    /** @desc 工程内的 Buff 实例 */
    buffs: readonly BuffInstance[]
    /** @desc 条目 → 绑定的 Buff id 列表 */
    bindings: Readonly<Record<string, readonly string[]>>
    /** @desc 条目 → 显式指定的伤害类型（缺省按技能/声骸文案推断） */
    damageTypes?: Readonly<Record<string, readonly string[]>>
    /** @desc 角色声骸配置 + 敌人配置 */
    config: ConfigState
    /** @desc 三个角色槽位（角色 / 武器 / 链 / 精炼） */
    team: readonly CharSlot[]
    /** @desc 角色数据（上游契约） */
    charInfo: Readonly<Record<string, CharacterInfo>>
    /** @desc 武器数据（上游契约） */
    weaponInfo: Readonly<Record<string, WeaponInfo>>
    /** @desc 链 / 阶档位（缺省 0 链 / 1 阶） */
    profile?: ConditionProfile
    /** @desc 声骸技能文案索引（伤害类型推导规则2）；缺省 = 规则2 不参与 */
    echoSkillText?: Readonly<Record<string, string>>
}

const toMutable = <T>(record: Readonly<Record<string, T>> | undefined): Record<string, T> => ({ ...(record ?? {}) })

/** @desc 只读数组的 Record → 可变数组的 Record（引擎入参是可变形态） */
const toMutableList = (record: Readonly<Record<string, readonly string[]>> | undefined): Record<string, string[]> =>
    Object.fromEntries(Object.entries(record ?? {}).map(([key, value]) => [key, [...value]]))

/** @desc 结算全部伤害条目（结果页 / 溯源 / 贡献分析的唯一入口） */
export const computeProject = (request: ComputeRequest): ResultEntry[] =>
    computeAll(
        [...request.entries],
        [...request.buffs],
        toMutableList(request.bindings),
        toMutableList(request.damageTypes),
        request.config,
        [...request.team],
        toMutable(request.charInfo),
        toMutable(request.weaponInfo),
        request.profile ?? DEFAULT_CONDITION_PROFILE,
        toMutable(request.echoSkillText)
    )

/** @desc 只重算一条伤害条目（贡献分析 / 单格刷新） */
export const computeEntry = (request: ComputeRequest, entry: DamageEntry, charIndex: number): ResultEntry =>
    computeOneEntry(
        entry,
        charIndex,
        request.config.characters[charIndex]?.echoes ?? [],
        [...request.buffs],
        toMutableList(request.bindings),
        toMutableList(request.damageTypes),
        request.config,
        [...request.team],
        toMutable(request.charInfo),
        toMutable(request.weaponInfo),
        request.profile ?? DEFAULT_CONDITION_PROFILE,
        toMutable(request.echoSkillText)
    )
