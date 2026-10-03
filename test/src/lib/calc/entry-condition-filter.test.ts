// 引擎级回归：**已勾选**的 buff，如果它的（实例级 / 乘区级）属性或伤害类型条件与当前
// 伤害条目不匹配，绝不能把加成算进这条伤害里。
//
// 典型症状（用户报告）：带「普攻」条件的加成，被「共鸣技能类型」的伤害吃了。
// 这里直接跑完整引擎 computeOneEntry，用 finalDamage 数值对比来证明过滤真的生效，
// 而不是只读代码/只测判定函数。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeOneEntry, DEFAULT_CONDITION_PROFILE } from '$lib/calc/compute'
import type { BuffInstance, DamageEntry } from '$lib/calc/calculation.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { CharSlot } from '$lib/types/project'
import type { ConfigState, EchoSlotConfig } from '$lib/calc/config.types'

const CHAR = '测试角色'

/** @desc 最小可用角色数据：只要求引擎能算出面板，技能/节点/共鸣链留空 */
const charInfo: CharacterInfo = {
    rarity: 5,
    element: '冷凝',
    weaponType: '长刃',
    tags: [],
    lv90BaseStats: { hp: 10000, atk: 1000, def: 500, tuneBreakBoost: 0 },
    skills: [],
    statNodes: [],
    chains: []
}

const emptyEcho = (): EchoSlotConfig => ({ cost: 1, mainStat: null, secondMainStat: null, substats: [] })

const configState: ConfigState = {
    characters: [
        { echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] },
        { echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] },
        { echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] }
    ],
    enemy: { type: 'BOSS', level: 90, defense: 1000, resistances: {}, dmgReduction: 0 }
}

const team = [{ character: CHAR, weapon: null }] as unknown as CharSlot[]
const charInfoMap: Record<string, CharacterInfo> = { [CHAR]: charInfo }
const weaponInfoMap: Record<string, WeaponInfo> = {}

const ELEMENT = '冷凝'
const ENTRY_ID = 'e1'

const entry: DamageEntry = {
    id: ENTRY_ID,
    character: CHAR,
    hitName: '测试伤害',
    displayName: '测试伤害',
    isEffect: false,
    isTuneBreak: false,
    isTuneResponse: false,
    ratioValue: 100,
    ratioUnit: '%',
    damageBaseType: '攻击',
    damageElement: ELEMENT,
    sourceTimelineBlockId: 'b1',
    hits: 1
}

/**
 * @desc 跑一次完整引擎：buff 已绑定到该条目（模拟「已经勾选」），伤害类型显式配置。
 * 乘区用 specialFinal1（终伤乘区，乘 1+value/100），能直接看出加成有没有被计入。
 */
const damageWith = (damageTypes: string[], buffs: BuffInstance[]): number => {
    const damageEntryDamageTypes: Record<string, string[]> = damageTypes.length > 0 ? { [ENTRY_ID]: damageTypes } : {}
    const damageEntryBuffSetIds: Record<string, string[]> =
        buffs.length > 0 ? { [ENTRY_ID]: buffs.map((b) => b.id) } : {}
    const result = computeOneEntry(
        entry,
        0,
        [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()],
        buffs,
        damageEntryBuffSetIds,
        damageEntryDamageTypes,
        configState,
        team,
        charInfoMap,
        weaponInfoMap,
        DEFAULT_CONDITION_PROFILE
    )
    return result.totalDamage
}

const buff = (zones: BuffInstance['zones'], condition?: BuffInstance['condition']): BuffInstance =>
    ({
        id: 'buff1',
        name: '测试buff',
        scope: 'all',
        zones,
        ...(condition ? { condition } : {})
    }) as unknown as BuffInstance

const ZONE = { zoneId: 'specialFinal1', value: 20 } as never

const baseline = damageWith([], [])
/** @desc 无任何条件限制时的伤害（加成确实吃满了） */
const withBuff = damageWith([], [buff([ZONE])])

describe('引擎：已勾选的 buff 遇到不匹配的伤害条目时不得生效', () => {
    it('前置校验：同一个 buff 在无条件限制下确实提高了伤害', () => {
        assert.ok(withBuff > baseline, `预期 ${withBuff} > ${baseline}（无条件 buff 应生效）`)
    })

    it('乘区条件是「普攻」时，共鸣技能类型伤害吃不到该加成', () => {
        const conditioned = buff([
            { zoneId: 'specialFinal1', value: 20, condition: { damageTypes: ['普攻伤害'] } } as never
        ])
        assert.equal(
            damageWith(['共鸣技能伤害'], [conditioned]),
            damageWith(['共鸣技能伤害'], []),
            '普攻条件的加成被共鸣技能伤害吃掉了'
        )
    })

    it('乘区条件是「普攻」时，普攻类型伤害照常吃到加成', () => {
        const conditioned = buff([
            { zoneId: 'specialFinal1', value: 20, condition: { damageTypes: ['普攻伤害'] } } as never
        ])
        assert.ok(damageWith(['普攻伤害'], [conditioned]) > damageWith(['普攻伤害'], []), '条件命中时加成必须生效')
    })

    it('乘区条件是属性（导电）时，冷凝伤害吃不到该加成', () => {
        const conditioned = buff([{ zoneId: 'specialFinal1', value: 20, condition: { elements: ['导电'] } } as never])
        assert.equal(damageWith([], [conditioned]), damageWith([], []), '属性条件的加成被异属性伤害吃掉了')
    })

    it('实例级条件是「普攻」时，共鸣技能类型伤害同样吃不到（实例级也参与条目判定）', () => {
        const conditioned = buff([ZONE], { damageTypes: ['普攻伤害'] })
        assert.equal(
            damageWith(['共鸣技能伤害'], [conditioned]),
            damageWith(['共鸣技能伤害'], []),
            '实例级类型条件未参与条目判定'
        )
    })

    it('一个 buff 的多条乘区各自判定：不匹配那条不计入，无条件那条仍计入', () => {
        const mixed = buff([
            { zoneId: 'specialFinal1', value: 20, condition: { damageTypes: ['普攻伤害'] } } as never,
            { zoneId: 'specialFinal1', value: 30 } as never
        ])
        // 只有无条件的 +30% 生效，普攻条件的 +20% 不生效
        assert.equal(
            damageWith(['共鸣技能伤害'], [mixed]),
            damageWith(['共鸣技能伤害'], [buff([{ zoneId: 'specialFinal1', value: 30 } as never])]),
            '不匹配的乘区条目被错误计入'
        )
    })
})
