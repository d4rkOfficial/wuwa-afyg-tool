/**
 * @desc 一次完整结算的输入（工具箱内部契约：编译成 `GeneralTable` + 基础数值的原料）。
 */
import type { BuffInstance, DamageEntry } from '$lib/calc/calculation.types'
import type { ConfigState } from '$lib/calc/config.types'
import type { CharSlot } from '$lib/types/project'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { ConditionProfile } from '$lib/calc/compute'

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
