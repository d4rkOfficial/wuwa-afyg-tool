// 溯源「集谐区 / 谐度区」分区回归。
//
// 需求：处决 / 偏谐响应吃的是 **谐度区** = `1 + 谐度破坏增幅%`，它与直伤的 **集谐区**
// （`1 + 0.12% × 谐度破坏增幅 × 目标侧集谐·干涉层数`）是两个独立乘区。
// 历史 bug：溯源把 `finalTuneStrainMulti + finalTuneBreakZone` 合并成一个「集谐区」段，
// 于是处决/响应的增幅被写成集谐区，读起来像是「集谐层数抬高了它」。
//
// 本文件钉住不变式：
// 1. 处决/响应：增幅进 `tuneBreak`（谐度区），`tune`（集谐区）恒为 1 且不列任何来源；
// 2. 直伤：增幅作为集谐区的因子留在 `tune`，`tuneBreak` 恒为 1 且不列来源（无幻影贡献）。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeOneEntry, DEFAULT_CONDITION_PROFILE } from '$lib/calc/compute'
import { buildDamageSegments, type DamageTraceCtx, type DamageSegment } from '$lib/calc/damage-trace'
import type { BuffInstance, BuffZoneValue, DamageEntry } from '$lib/calc/calculation.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { CharSlot } from '$lib/types/project'
import type { ConfigState, EchoSlotConfig } from '$lib/calc/config.types'

const CHAR = '测试角色'

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
const team = [{ character: CHAR, weapon: null }] as unknown as CharSlot[]
const emptyEcho = (): EchoSlotConfig => ({ cost: 1, mainStat: null, secondMainStat: null, substats: [] })

const config: ConfigState = {
    characters: [
        { echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] },
        { echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] },
        { echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] }
    ],
    enemy: { type: 'BOSS', level: 90, defense: 1000, resistances: {}, dmgReduction: 0 }
}

const directEntry: DamageEntry = {
    id: 'e1',
    character: CHAR,
    skillType: '常态攻击',
    hitName: '常态攻击第1段伤害',
    displayName: '常态攻击第1段(常态攻击)',
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

const tuneEntry: DamageEntry = {
    id: 'e2',
    character: CHAR,
    skillType: '谐度破坏',
    hitName: '谐度破坏',
    displayName: '谐度破坏',
    isEffect: false,
    isTuneBreak: true,
    isTuneResponse: false,
    ratioValue: 1600,
    ratioUnit: '%',
    damageBaseType: '偏谐系数',
    damageElement: '物理',
    sourceTimelineBlockId: 'b1',
    hits: 1
}

const zone = (zoneId: BuffZoneValue['zoneId'], value: number): BuffZoneValue => ({ zoneId, value })

const buff = (id: string, name: string, zones: BuffZoneValue[]): BuffInstance => ({ id, name, zones, scope: 'all' })

const run = (entry: DamageEntry, buffs: BuffInstance[], damageTypes: string[]) => {
    const boundIds = { [entry.id]: buffs.map((b) => b.id) }
    const typeMap = { [entry.id]: damageTypes }
    const result = computeOneEntry(
        entry,
        0,
        config.characters[0].echoes,
        buffs,
        boundIds,
        typeMap,
        config,
        team,
        charInfoMap,
        weaponInfoMap,
        DEFAULT_CONDITION_PROFILE
    )
    const ctx: DamageTraceCtx = {
        buffSets: buffs,
        damageEntryBuffSetIds: boundIds,
        damageEntryDamageTypes: typeMap,
        configState: config,
        team,
        charInfoMap,
        weaponInfoMap,
        conditionProfile: DEFAULT_CONDITION_PROFILE
    }
    const segs = buildDamageSegments(result, ctx)
    const segmentOf = (id: string): DamageSegment => {
        const found = segs.segments.find((s) => s.id === id)
        assert.ok(found, `溯源里应存在乘区段 ${id}`)
        return found
    }
    return { result, segs, segmentOf }
}

describe('处决/响应：谐度破坏增幅进「谐度区」，不写进「集谐区」', () => {
    const boost = buff('b1', '增幅之赐', [zone('tuneBreakBoost', 50)])

    it('谐度区 = 1 + 增幅%，来源只有谐度破坏增幅', () => {
        const { result, segmentOf } = run(tuneEntry, [boost], [])
        const tuneBreak = segmentOf('tuneBreak')
        assert.equal(tuneBreak.label, '谐度区')
        assert.equal(tuneBreak.value, 1.5, '1 + 50% = 1.5')
        assert.deepEqual(
            tuneBreak.parts.map((p) => p.label),
            ['谐度破坏增幅']
        )
        assert.equal(result.finalTuneBreakZone, 0.5)
    })

    it('集谐区恒为 1 且不列任何来源（增幅不属于集谐区）', () => {
        const { segmentOf } = run(tuneEntry, [boost], [])
        const strain = segmentOf('tune')
        assert.equal(strain.label, '集谐区')
        assert.equal(strain.value, 1, '处决/响应不吃集谐区')
        assert.deepEqual(strain.parts, [], '区值 1 时不得留下任何来源（幻影贡献）')
    })

    it('谐度区确实参与了结算：带上增幅的伤害 = 不带增幅 × 1.5', () => {
        const { result } = run(tuneEntry, [boost], [])
        const { result: plain } = run(tuneEntry, [], [])
        assert.ok(
            Math.abs(result.totalDamageRaw / plain.totalDamageRaw - 1.5) < 1e-9,
            `结算乘子应为 1.5（实测 ${result.totalDamageRaw / plain.totalDamageRaw}）`
        )
    })
})

describe('直伤：谐度破坏增幅是集谐区的因子，谐度区恒为 1', () => {
    const boost = buff('b2', '增幅之赐', [zone('tuneBreakBoost', 500)])
    const layers = buff('b3', '集谐之赐', [zone('tuneStrainLayer', 3)])

    it('集谐区 = 1 + 0.12% × 增幅 × 层数，来源含集谐层数与谐度破坏增幅', () => {
        const { segmentOf } = run(directEntry, [boost, layers], ['普攻伤害'])
        const strain = segmentOf('tune')
        assert.equal(strain.value, 1 + 0.0012 * 500 * 3, '1 + 0.12% × 500 × 3 = 2.8')
        assert.deepEqual(strain.parts.map((p) => p.label).sort(), ['谐度破坏增幅', '集谐层数'].sort())
    })

    it('谐度区恒为 1 且不列来源（直伤不读谐度区）', () => {
        const { segmentOf } = run(directEntry, [boost, layers], ['普攻伤害'])
        const tuneBreak = segmentOf('tuneBreak')
        assert.equal(tuneBreak.label, '谐度区')
        assert.equal(tuneBreak.value, 1)
        assert.deepEqual(tuneBreak.parts, [])
    })

    it('只有层数、没有增幅 → 集谐区保持 1 且不列来源', () => {
        const { segmentOf } = run(directEntry, [layers], ['普攻伤害'])
        assert.equal(segmentOf('tune').value, 1)
        assert.deepEqual(segmentOf('tune').parts, [])
    })
})
