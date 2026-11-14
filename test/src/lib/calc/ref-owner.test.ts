// 引用（转模）归属回归：`ZoneRef.characterIdx = -1` 必须读**本条目所属角色**的面板（出伤者）。
//
// 背景：Buff 集里的「出伤者」档导入后就是 -1。引擎三处 `panelOf` 都要把它归一到本条目角色：
// 否则「通用（scope=all）套装 buff 按出伤者攻击换算」会读错人，实体不在配队时还会静默变 0
// （`buildEntryPanel(-1)` 因 `team[-1]` 为空直接返回空面板）。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeOneEntry } from '$lib/calc/compute'
import type { BuffInstance, DamageEntry } from '$lib/calc/calculation.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { CharSlot } from '$lib/types/project'
import type { ConfigState, EchoSlotConfig } from '$lib/calc/config.types'

const CHAR_A = '角色甲'
const CHAR_B = '角色乙'
const ENTRY_ID = 'e1'

const charInfoOf = (atk: number): CharacterInfo => ({
    rarity: 5,
    element: '导电',
    weaponType: '长刃',
    tags: [],
    lv90BaseStats: { hp: 10000, atk, def: 500, tuneBreakBoost: 0 },
    skills: [],
    statNodes: [],
    chains: []
})

const charInfoMap: Record<string, CharacterInfo> = {
    [CHAR_A]: charInfoOf(1000),
    [CHAR_B]: charInfoOf(2000)
}
const weaponInfoMap: Record<string, WeaponInfo> = {}

const emptyEcho = (): EchoSlotConfig => ({ cost: 1, mainStat: null, secondMainStat: null, substats: [] })
type Echoes = ConfigState['characters'][number]['echoes']
const echoes = (): Echoes => [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()]

const configState: ConfigState = {
    characters: [{ echoes: echoes() }, { echoes: echoes() }, { echoes: echoes() }],
    enemy: { type: 'BOSS', level: 90, defense: 1000, resistances: {}, dmgReduction: 0 }
}
const team = [
    { character: CHAR_A, weapon: null },
    { character: CHAR_B, weapon: null },
    { character: null, weapon: null }
] as unknown as CharSlot[]

/** 伤害条目属于 1 号位（乙），所以「出伤者」= 1 号位 */
const entry: DamageEntry = {
    id: ENTRY_ID,
    character: CHAR_B,
    hitName: '测试伤害',
    displayName: '测试伤害',
    isEffect: false,
    isTuneBreak: false,
    isTuneResponse: false,
    ratioValue: 100,
    ratioUnit: '%',
    damageBaseType: '攻击',
    damageElement: '导电',
    sourceTimelineBlockId: 'b1',
    hits: 1
}

const buffOf = (id: string, zones: BuffInstance['zones']): BuffInstance =>
    ({ id, name: id, scope: [0, 1], zones }) as unknown as BuffInstance

/** 通用 buff：`extraRatio += 目标角色攻击 × 10%`（引用归属可调） */
const refBuff = (characterIdx: number): BuffInstance =>
    buffOf('ref', [
        {
            zoneId: 'extraRatio',
            value: 0,
            ref: { characterIdx, zoneId: 'totalAtk', threshold: 0, pct: 10 }
        }
    ])

const damageWith = (buffs: BuffInstance[]): number =>
    computeOneEntry(
        entry,
        1,
        echoes(),
        buffs,
        buffs.length > 0 ? { [ENTRY_ID]: buffs.map((b) => b.id) } : {},
        {},
        configState,
        team,
        charInfoMap,
        weaponInfoMap,
        { chains: [0, 0, 0], refinements: [1, 1, 1] }
    ).totalDamage

const base = damageWith([])

describe('引用归属：-1 = 出伤者（本条目所属角色）', () => {
    it('-1 与「本条目角色槽位」读数一致', () => {
        assert.equal(
            damageWith([refBuff(-1)]),
            damageWith([refBuff(1)]),
            '-1 必须解析成本条目所属的 1 号位（乙），而不是别的槽位'
        )
    })

    it('与本角色槽位不同时读数不同（1 号位攻击 2000 > 0 号位 1000）', () => {
        assert.ok(damageWith([refBuff(-1)]) > damageWith([refBuff(0)]), '出伤者=乙，攻击更高')
        assert.ok(damageWith([refBuff(0)]) > base, '引用 0 号位也仍生效（只是数值更小）')
    })

    it('实体不在配队（归属槽位 -1）时不再静默变 0', () => {
        // 这是 Buff 集「出伤者」导入后的典型形态：owner 为 -1、ref.characterIdx 也是 -1
        assert.ok(damageWith([refBuff(-1)]) > base, '引用必须按本条目角色解算，而不是空面板')
    })
})
