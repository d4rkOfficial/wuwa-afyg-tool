// 角色详情面板的链/阶门槛：必须与引擎一样识别新结构 chains/refinements。
//
// 回归背景：面板里曾只认旧字段 condition.chain / condition.refinement，
// 仇远 1 链的「暴击率 +20%」放入全局后，即使链档位是 0 也会被算进面板，
// 面板因此恒为 81.6%，与伤害结算（引擎按 0 链不生效）对不上。
import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeCharStats } from '$lib/components/page/home/config/character-detail-utils'
import { setConditionProfile } from '$lib/calc/calculation.store.svelte'
import type { BuffCondition, BuffInstance, CalcState } from '$lib/calc/calculation.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { CharSlot } from '$lib/types/project'
import type { ConfigState, EchoSlotConfig } from '$lib/calc/config.types'

const CHAR = '测试角色'
const EMPTY_ECHO = (): EchoSlotConfig => ({ cost: 1, mainStat: null, secondMainStat: null, substats: [] })

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
const charInfoMap: Record<string, CharacterInfo> = { [CHAR]: charInfo }
const weaponInfoMap: Record<string, WeaponInfo> = {}
const configState: ConfigState = {
    characters: [
        { echoes: [EMPTY_ECHO(), EMPTY_ECHO(), EMPTY_ECHO(), EMPTY_ECHO(), EMPTY_ECHO()] },
        { echoes: [EMPTY_ECHO(), EMPTY_ECHO(), EMPTY_ECHO(), EMPTY_ECHO(), EMPTY_ECHO()] },
        { echoes: [EMPTY_ECHO(), EMPTY_ECHO(), EMPTY_ECHO(), EMPTY_ECHO(), EMPTY_ECHO()] }
    ],
    enemy: { type: 'BOSS', level: 90, defense: 1000, resistances: {}, dmgReduction: 0 }
}
const slot: CharSlot = { character: CHAR, weapon: null, triggerSets: [], echoes: [] as unknown as CharSlot['echoes'] }

const globalBuff = (id: string, condition: BuffCondition, value: number): BuffInstance => ({
    id,
    name: id,
    scope: [0],
    global: true,
    condition,
    zones: [{ zoneId: 'critRate', value }]
})
const calcState = (buff: BuffInstance): CalcState => ({
    buffSets: [buff],
    damageEntryBuffSetIds: {},
    damageEntryDamageTypes: {}
})
const critRateOf = (buff: BuffInstance): number => {
    const stats = computeCharStats(slot, 0, charInfoMap, weaponInfoMap, configState, calcState(buff))
    assert.ok(stats)
    return stats.critRate
}

beforeEach(() => setConditionProfile({ chains: [0, 0, 0], refinements: [1, 1, 1] }))

describe('角色详情面板：链条件（新结构 chains）', () => {
    const buff = globalBuff('1链暴击', { chains: [{ charIdx: 0, min: 1 }] }, 20)

    it('0 链不计入 +20%', () => {
        assert.equal(critRateOf(buff), 5)
    })

    it('1 链计入 +20%', () => {
        setConditionProfile({ chains: [1, 0, 0], refinements: [1, 1, 1] })
        assert.equal(critRateOf(buff), 25)
    })

    it('旧字段 chain 仍按 conditionRefCharIdx 判定', () => {
        const legacy = globalBuff('旧链暴击', { chain: 1 }, 20)
        assert.equal(critRateOf(legacy), 5)
        setConditionProfile({ chains: [1, 0, 0], refinements: [1, 1, 1] })
        assert.equal(critRateOf(legacy), 25)
    })
})

describe('角色详情面板：阶条件（新结构 refinements）', () => {
    const buff = globalBuff('2阶暴击', { refinements: [{ charIdx: 0, min: 2 }] }, 10)

    it('1 阶不计入 +10%', () => {
        assert.equal(critRateOf(buff), 5)
    })

    it('2 阶计入 +10%', () => {
        setConditionProfile({ chains: [0, 0, 0], refinements: [2, 1, 1] })
        assert.equal(critRateOf(buff), 15)
    })

    it('链阶并存时只判定链（与引擎运行时护栏一致）', () => {
        const both = globalBuff(
            '链阶并存',
            { chains: [{ charIdx: 0, min: 1 }], refinements: [{ charIdx: 0, min: 2 }] },
            10
        )
        setConditionProfile({ chains: [0, 0, 0], refinements: [2, 1, 1] })
        assert.equal(critRateOf(both), 5, '链不满足 → 整体不生效，阶被忽略')
        setConditionProfile({ chains: [1, 0, 0], refinements: [1, 1, 1] })
        assert.equal(critRateOf(both), 15, '链满足 → 生效，阶不参与')
    })
})
