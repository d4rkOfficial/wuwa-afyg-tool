// 层数类乘区「可被引用」+ 自定义层数回归。
//
// 两件事：
// 1. 集谐干涉层数 / 同奏增益层数 / 自定义层数(1)(2)(3) 都可以配引用（转模），导入时不再被剥掉 ref；
// 2. 自定义层数是**纯计数器**：会累加进面板，但不进入任何伤害乘区（与共鸣效率同性质）。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { ZONE_DEFS, ZONE_MAP, ZONE_NO_REF_IDS, ZONE_SECTION_OF } from './calculation.consts'
import { computeOneEntry, DEFAULT_CONDITION_PROFILE } from './compute'
import { detectImportConflicts } from './buff-import-utils'
import { getAllBuffSets, importBuffSetsWithDecisions } from './calculation.store.svelte'
import type { DamageEntry } from './calculation.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { CharSlot } from '$lib/types/project'
import type { ConfigState, EchoSlotConfig } from './config.types'

const CHAR = '测试角色'
const ENTRY_ID = 'e1'

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
    damageElement: '冷凝',
    sourceTimelineBlockId: 'b1',
    hits: 1
}

const damageWith = (buffs: Parameters<typeof computeOneEntry>[3]): number =>
    computeOneEntry(
        entry,
        0,
        [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()],
        buffs,
        buffs.length > 0 ? { [ENTRY_ID]: buffs.map((b) => b.id) } : {},
        {},
        configState,
        team,
        charInfoMap,
        weaponInfoMap,
        DEFAULT_CONDITION_PROFILE
    ).totalDamage

describe('层数类乘区：新增/可引用', () => {
    it('三个自定义层数已注册，且归入「自定义层数」栏目', () => {
        for (const id of ['customLayer1', 'customLayer2', 'customLayer3']) {
            const def = ZONE_MAP.get(id)
            assert.ok(def, `${id} 应存在于 ZONE_DEFS`)
            assert.equal(def.unit, 'flat', '层数按固定值填')
            assert.equal(ZONE_SECTION_OF.get(id), '自定义层数')
        }
        assert.equal(ZONE_MAP.get('customLayer2')?.label, '自定义层数(2)')
    })

    it('集谐干涉层数 / 同奏增益层数 / 自定义层数都不在「不可引用」名单里', () => {
        for (const id of ['tuneStrainLayer', 'unisonBoonLayer', 'customLayer1', 'customLayer2', 'customLayer3']) {
            assert.equal(ZONE_NO_REF_IDS.has(id), false, `${id} 应可配引用/转模`)
        }
        assert.equal(ZONE_NO_REF_IDS.size, 0, '当前没有任何乘区被禁止引用')
    })

    it('ZONE_DEFS 里没有重复 id', () => {
        const ids = ZONE_DEFS.map((z) => z.id)
        assert.equal(new Set(ids).size, ids.length)
    })
})

describe('层数类乘区的引用必须能落库（导入时不被剥掉）', () => {
    it('tuneStrainLayer / unisonBoonLayer / customLayer1 的 ref 都会被保留', () => {
        const layers = ['tuneStrainLayer', 'unisonBoonLayer', 'customLayer1']
        const items = layers.map((zoneId, i) => ({
            name: `层数引用-${i}`,
            scope: 'self' as const,
            ownerIdx: 0,
            zones: [{ zoneId, value: 0, ref: { targetZoneId: 'totalAtk', pct: 50 } }]
        }))
        const { deduped } = detectImportConflicts(items, [])
        importBuffSetsWithDecisions(deduped, {}, -1, 3)

        for (const [i, zoneId] of layers.entries()) {
            const stored = getAllBuffSets().find((s) => s.name === `层数引用-${i}`)
            assert.ok(stored, `${zoneId} 的 buff 应已写入`)
            const zone = stored.zones.find((z) => z.zoneId === zoneId)
            assert.ok(zone, `${zoneId} 乘区条目应在`)
            assert.ok(zone.ref, `${zoneId} 的引用不该被剥掉`)
            // 落库后是引擎内部的 ZoneRef：来源属性字段名是 zoneId（导入侧的 targetZoneId）
            assert.equal(zone.ref?.zoneId, 'totalAtk')
            assert.equal(zone.ref?.pct, 50)
        }
    })
})

describe('自定义层数：纯计数器，不参与伤害结算', () => {
    const buffWith = (zoneId: string, value: number) =>
        [{ id: 'b1', name: '测试', scope: 'all', zones: [{ zoneId, value }] }] as unknown as Parameters<
            typeof computeOneEntry
        >[3]

    it('填自定义层数不会改变伤害', () => {
        const baseline = damageWith([])
        assert.equal(damageWith(buffWith('customLayer1', 5)), baseline, '自定义层数只是记录，不该增伤')
        assert.equal(damageWith(buffWith('customLayer3', 99)), baseline)
    })

    it('对照：同奏增益层数（每层 +3%）确实会改变伤害', () => {
        assert.ok(damageWith(buffWith('unisonBoonLayer', 5)) > damageWith([]), '同奏层数应参与结算')
        assert.ok(damageWith(buffWith('specialFinal1', 20)) > damageWith([]), '特殊终伤应参与结算')
    })
})
