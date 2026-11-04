// 全局 Buff 自动绑定：必须同时覆盖「作用域命中的条目」与「引用了该角色面板的条目」。
//
// 回归背景：仇远固有天赋（scope=[1]）并入全局后，只绑到仇远自己的条目；
// 队友的伤害段引用仇远暴击率时，被引用面板里看不到这 8% 暴击 → 转模少算。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { rebuildGlobalBindings, type GlobalBindingEntry } from '$lib/calc/global-bindings'
import { computeOneEntry, DEFAULT_CONDITION_PROFILE } from '$lib/calc/compute'
import type { BuffConf, DamageEntry } from '$lib/calc/calculation.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { CharSlot } from '$lib/types/project'
import type { ConfigState, EchoSlotConfig } from '$lib/calc/config.types'

const CHAR_A = '测试角色甲'
const CHAR_B = '测试角色乙'
const TEAM = [{ character: CHAR_A }, { character: CHAR_B }] as { character: string | null }[]

const buff = (patch: Partial<BuffConf> & Pick<BuffConf, 'id' | 'scope' | 'zones'>): BuffConf => ({
    name: patch.id,
    ...patch
})

describe('全局 Buff 绑定：作用域条目 + 引用条目', () => {
    const refB = buff({
        id: 'refB',
        scope: 'all',
        zones: [{ zoneId: 'critDmg', value: 0, ref: { characterIdx: 1, zoneId: 'critRate', threshold: 0, pct: 100 } }]
    })
    const selfB = buff({ id: 'selfB', scope: [1], global: true, zones: [{ zoneId: 'critRate', value: 8 }] })
    const teamAll = buff({ id: 'teamAll', scope: 'all', global: true, zones: [{ zoneId: 'atkPct', value: 10 }] })
    const selfA = buff({ id: 'selfA', scope: [0], zones: [{ zoneId: 'critRate', value: 5 }] })
    const buffs = [refB, selfB, teamAll, selfA]

    const entries: GlobalBindingEntry[] = [
        { id: 'eA', character: CHAR_A, isEffect: false },
        { id: 'eB', character: CHAR_B, isEffect: false },
        { id: 'eC', character: null, isEffect: true }
    ]

    it('引用了乙的甲条目也拿到乙的全局自 Buff；无关条目与无引用条目不被撑大', () => {
        const bindings = { eA: [refB.id], eB: [], eC: [] }
        const next = rebuildGlobalBindings({ entries, team: TEAM, buffs, globalIds: ['selfB', 'teamAll'], bindings })
        assert.deepEqual(next.eA, [refB.id, selfB.id, teamAll.id], '甲条目引用了乙 → 必须带上乙的全局固有天赋')
        assert.deepEqual(next.eB, [selfB.id, teamAll.id], '乙自己的条目按作用域拿到')
        assert.deepEqual(next.eC, [teamAll.id], '效应条目只拿全队作用域的全局 Buff')
    })

    it('旧的全局绑定先剥离，不会残留', () => {
        const bindings = { eA: [refB.id, selfB.id], eB: [selfB.id], eC: [] }
        const next = rebuildGlobalBindings({ entries, team: TEAM, buffs, globalIds: ['selfB'], bindings })
        assert.deepEqual(next.eA, [refB.id, selfB.id], '引用条目保留自己 + 重新挂上的全局自 Buff')
        assert.deepEqual(next.eB, [selfB.id])
        assert.equal(next.eC, undefined, '没有适用全局 Buff 的条目不该留下空数组')
        assert.ok(!next.eA.includes(selfA.id), '非全局 Buff 不参与自动绑定')
    })

    it('没有全局 Buff 时原样返回', () => {
        const bindings = { eA: [refB.id] }
        assert.deepEqual(rebuildGlobalBindings({ entries, team: TEAM, buffs, globalIds: [], bindings }), bindings)
    })
})

// ── 端到端：同一条转模，全局自 Buff 绑定前后读数必须差 8% ──

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
const charInfoMap: Record<string, CharacterInfo> = { [CHAR_A]: charInfo, [CHAR_B]: charInfo }
const weaponInfoMap: Record<string, WeaponInfo> = {}
const team = [
    { character: CHAR_A, weapon: null },
    { character: CHAR_B, weapon: null }
] as unknown as CharSlot[]
const configState: ConfigState = {
    characters: [
        { echoes: [EMPTY_ECHO(), EMPTY_ECHO(), EMPTY_ECHO(), EMPTY_ECHO(), EMPTY_ECHO()] },
        { echoes: [EMPTY_ECHO(), EMPTY_ECHO(), EMPTY_ECHO(), EMPTY_ECHO(), EMPTY_ECHO()] },
        { echoes: [EMPTY_ECHO(), EMPTY_ECHO(), EMPTY_ECHO(), EMPTY_ECHO(), EMPTY_ECHO()] }
    ],
    enemy: { type: 'BOSS', level: 90, defense: 1000, resistances: {}, dmgReduction: 0 }
}

const entry: DamageEntry = {
    id: 'eA',
    character: CHAR_A,
    hitName: '测试伤害',
    displayName: '测试伤害',
    isEffect: false,
    isTuneBreak: false,
    isTuneResponse: false,
    ratioValue: 100,
    ratioUnit: '%',
    damageBaseType: '攻击',
    damageElement: '冷凝',
    sourceTimelineBlockId: 'b1',
    hits: 1
}

const run = (bindings: Record<string, string[]>, buffs: BuffConf[]) =>
    computeOneEntry(
        entry,
        0,
        configState.characters[0].echoes,
        buffs,
        bindings,
        {},
        configState,
        team,
        charInfoMap,
        weaponInfoMap,
        DEFAULT_CONDITION_PROFILE
    )

describe('全局自 Buff 参与被引用面板', () => {
    const refB = buff({
        id: 'refB',
        scope: 'all',
        zones: [{ zoneId: 'critDmg', value: 0, ref: { characterIdx: 1, zoneId: 'critRate', threshold: 0, pct: 100 } }]
    })
    const selfB = buff({ id: 'selfB', scope: [1], global: true, zones: [{ zoneId: 'critRate', value: 8 }] })

    it('只绑转模 Buff 时乙的面板是 5%；自动绑定全局固有天赋后是 13%', () => {
        const withoutGlobal = run({ eA: [refB.id] }, [refB, selfB])
        const bindings = rebuildGlobalBindings({
            entries: [{ id: 'eA', character: CHAR_A, isEffect: false }],
            team: TEAM,
            buffs: [refB, selfB],
            globalIds: [selfB.id],
            bindings: { eA: [refB.id] }
        })
        const withGlobal = run(bindings, [refB, selfB])
        assert.ok(bindings.eA.includes(selfB.id), '甲条目引用了乙 → 自动挂上乙的全局自 Buff')
        assert.equal(withoutGlobal.critDmg, 1.55, '乙面板 5% 暴击 → 转模 +5% 暴伤')
        assert.equal(withGlobal.critDmg, 1.63, '乙面板 5%+8%=13% 暴击 → 转模 +13% 暴伤')
    })
})
