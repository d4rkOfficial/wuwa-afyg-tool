// 层数类乘区：可引用 / 可作为引用来源。
//
// 1. 只有集谐干涉层数禁止配引用；同奏增益层数可以配引用（转模）；
// 2. 同奏增益层数**按角色独立**，且可以作为**引用来源**被其它乘区按角色读取；
// 3. 集谐·干涉层数挂在目标身上、全队一份（见文件末尾的目标侧用例）。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
    ZONE_DEFS,
    ZONE_MAP,
    ZONE_NO_REF_IDS,
    ZONE_REF_DEFS,
    ZONE_REF_MAP,
    ZONE_SECTION_OF
} from './calculation.consts'
import { computeOneEntry, DEFAULT_CONDITION_PROFILE } from './compute'
import { paneEffectSourcesOf } from './pane-effects'
import { detectImportConflicts } from './buff-import-utils'
import { getAllBuffSets, importBuffSetsWithDecisions } from './calculation.store.svelte'
import type { BuffInstance, DamageEntry } from './calculation.types'
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

describe('层数类乘区：清单与可引用性', () => {
    it('自定义层数(1)(2)(3) 已从两端移除（乘区清单与引用来源都不该再有）', () => {
        for (const id of ['customLayer1', 'customLayer2', 'customLayer3']) {
            assert.equal(ZONE_MAP.has(id), false, `${id} 不应再存在于 ZONE_DEFS`)
            assert.equal(ZONE_REF_MAP.has(id), false, `${id} 不应再是可引用来源`)
        }
        assert.equal(
            ZONE_DEFS.some((z) => z.label.includes('自定义层数')),
            false
        )
        assert.equal([...ZONE_SECTION_OF.values()].includes('自定义层数'), false, '「自定义层数」栏目应一并移除')
    })

    it('只有集谐干涉层数被禁止引用；同奏增益层数可以引用', () => {
        assert.equal(ZONE_NO_REF_IDS.has('unisonBoonLayer'), false, '同奏增益层数应可配引用/转模')
        assert.equal(ZONE_NO_REF_IDS.has('tuneStrainLayer'), true, '集谐干涉层数只允许填固定层数')
        assert.deepEqual([...ZONE_NO_REF_IDS], ['tuneStrainLayer'], '禁引用名单里只应有集谐干涉层数')
    })

    it('ZONE_DEFS 里没有重复 id', () => {
        const ids = ZONE_DEFS.map((z) => z.id)
        assert.equal(new Set(ids).size, ids.length)
    })
})

describe('层数类乘区的引用落库口径', () => {
    /** @desc 造一条带引用的层数条目并走完整导入链路，返回落库后的乘区条目 */
    const importRefOn = (zoneId: string, name: string) => {
        const items = [
            {
                name,
                scope: 'self' as const,
                ownerIdx: 0,
                zones: [{ zoneId, value: 0, ref: { targetZoneId: 'totalAtk', pct: 50 } }]
            }
        ]
        const { deduped } = detectImportConflicts(items, [])
        importBuffSetsWithDecisions(deduped, {}, -1, 3)
        const stored = getAllBuffSets().find((s) => s.name === name)
        assert.ok(stored, `${zoneId} 的 buff 应已写入`)
        return stored.zones.find((z) => z.zoneId === zoneId)
    }

    it('同奏增益层数的引用会被保留', () => {
        const zone = importRefOn('unisonBoonLayer', '层数引用-同奏')
        assert.ok(zone?.ref, '同奏层数应可引用')
        // 落库后是引擎内部的 ZoneRef：来源属性字段名是 zoneId（导入侧的 targetZoneId）
        assert.equal(zone.ref?.zoneId, 'totalAtk')
        assert.equal(zone.ref?.pct, 50)
    })

    it('集谐干涉层数的引用会被剥掉（只允许填固定层数）', () => {
        const zone = importRefOn('tuneStrainLayer', '层数引用-集谐')
        assert.ok(zone, '乘区条目本身要保留')
        assert.equal(zone.ref, undefined, '集谐干涉层数不允许引用/转模')
    })
})

describe('层数类乘区的结算口径', () => {
    const buffWith = (zoneId: string, value: number) =>
        [{ id: 'b1', name: '测试', scope: 'all', zones: [{ zoneId, value }] }] as unknown as Parameters<
            typeof computeOneEntry
        >[3]

    it('同奏增益层数（每层 +3%）与特殊终伤确实参与结算', () => {
        assert.ok(damageWith(buffWith('unisonBoonLayer', 5)) > damageWith([]), '同奏层数应参与结算')
        assert.ok(damageWith(buffWith('specialFinal1', 20)) > damageWith([]), '特殊终伤应参与结算')
    })
})

// ── 层数作为「引用来源」：按角色读该角色累计的层数 ──

const CHAR_B = '测试角色乙'
const CHAR_C = '测试角色丙'
const TEAM3 = [
    { character: CHAR, weapon: null },
    { character: CHAR_B, weapon: null },
    { character: CHAR_C, weapon: null }
] as unknown as CharSlot[]
const charInfoMap3: Record<string, CharacterInfo> = { [CHAR]: charInfo, [CHAR_B]: charInfo, [CHAR_C]: charInfo }

/** @desc 以某角色为条目主人算伤害，传入的 buff 全部绑定到该条目（模拟「勾上这一段」） */
const damageOf = (character: string, buffs: BuffInstance[]): number => {
    const e: DamageEntry = { ...entry, id: `e-${character}`, character }
    return computeOneEntry(
        e,
        TEAM3.findIndex((s) => s.character === character),
        [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()],
        buffs,
        buffs.length > 0 ? { [e.id]: buffs.map((b) => b.id) } : {},
        {},
        configState,
        TEAM3,
        charInfoMap3,
        weaponInfoMap,
        DEFAULT_CONDITION_PROFILE
    ).totalDamage
}

/** @desc 产层数的 buff：把 value 层 <zoneId> 加给 scope 指定的角色 */
const layerBuff = (id: string, zoneId: string, value: number, slots: number[]): BuffInstance =>
    ({ id, name: `层数源-${id}`, scope: slots, zones: [{ zoneId, value }] }) as unknown as BuffInstance

/** @desc 消费层数的 buff：读「characterIdx 号位」的 <sourceZoneId>，按 pct% 折算写进 specialFinal1 */
const refBuff = (id: string, sourceZoneId: string, characterIdx: number, pct: number, slots: number[]): BuffInstance =>
    ({
        id,
        name: `引用-${id}`,
        scope: slots,
        zones: [{ zoneId: 'specialFinal1', value: 0, ref: { characterIdx, zoneId: sourceZoneId, threshold: 0, pct } }]
    }) as unknown as BuffInstance

/** @desc 对照组：直接把同一个折算结果填成固定值 */
const fixedBuff = (id: string, value: number, slots: number[]): BuffInstance =>
    ({ id, name: `定值-${id}`, scope: slots, zones: [{ zoneId: 'specialFinal1', value }] }) as unknown as BuffInstance

describe('层数作为引用来源：按角色读取、互不串味', () => {
    it('引用来源清单里有同奏增益层数，没有集谐干涉层数、也没有已移除的自定义层数', () => {
        assert.ok(ZONE_REF_MAP.has('unisonBoonLayer'), '同奏增益层数应可作为引用来源')
        assert.equal(ZONE_REF_MAP.has('tuneStrainLayer'), false, '集谐干涉层数不属于角色，不作为引用来源')
        for (const id of ['customLayer1', 'customLayer2', 'customLayer3']) {
            assert.equal(ZONE_REF_MAP.has(id), false, `${id} 已移除，不应再是引用来源`)
        }
        assert.equal(ZONE_REF_DEFS.length, new Set(ZONE_REF_DEFS.map((d) => d.id)).size, '引用来源 id 不能重复')
    })

    it('同角色：引用自己的同奏层数（4 层 × 50% = 2%）等价于直接填 2%', () => {
        const source = layerBuff('s1', 'unisonBoonLayer', 4, [0])
        const viaRef = damageOf(CHAR, [source, refBuff('r1', 'unisonBoonLayer', 0, 50, [0])])
        const viaFixed = damageOf(CHAR, [source, fixedBuff('f1', 2, [0])])
        assert.equal(viaRef, viaFixed, '4 层 ×50% 应折算成 2，与直接填 2 完全一致')
    })

    it('跨角色：读「1 号位（乙）」的同奏层数，与乙自己的层数一致', () => {
        const source = layerBuff('s2', 'unisonBoonLayer', 4, [1])
        const viaRef = damageOf(CHAR, [source, refBuff('r2', 'unisonBoonLayer', 1, 50, [0])])
        assert.equal(viaRef, damageOf(CHAR, [fixedBuff('f2', 2, [0])]), '应读到乙的 4 层并折算 2%')
    })

    it('按角色独立：层数加给丙（2 号位）时，引用乙（1 号位）读到 0，不生效', () => {
        const source = layerBuff('s3', 'unisonBoonLayer', 4, [2])
        const viaRef = damageOf(CHAR, [source, refBuff('r3', 'unisonBoonLayer', 1, 50, [0])])
        assert.equal(viaRef, damageOf(CHAR, []), '读错角色 → 层数 0 → 不产生任何加成')
    })

    it('层数引用会被识别成「影响源」（PANEL_TO_ZONES 映射到层数乘区自身）', () => {
        const consumer = refBuff('r6', 'unisonBoonLayer', 1, 50, [0])
        const producer = layerBuff('s7', 'unisonBoonLayer', 3, [1])
        const src = paneEffectSourcesOf(0, false, [consumer.id], [consumer, producer])
        assert.deepEqual(
            src[producer.id],
            { charIdx: 1, zoneIds: ['unisonBoonLayer'] },
            '改乙的层数的 buff 应是本段影响源'
        )
    })
})

// ── 集谐·干涉层数：目标侧一份（挂怪物身上，全队共用，不存在「某角色的」） ──

describe('集谐·干涉层数：目标侧一份', () => {
    /** @desc 谐度破坏增幅是角色属性，必须给该角色才能让集谐区 > 1（集谐区 = 1 + 0.12% × 增幅 × 层数） */
    const boostFor = (id: string, slot: number) => layerBuff(id, 'tuneBreakBoost', 500, [slot])
    const layers = (id: string, value: number, slots: number[]) => layerBuff(id, 'tuneStrainLayer', value, slots)

    it('作用域指向哪个角色都不影响：层数是全队共用的那一份', () => {
        const boost = boostFor('tb1', 0)
        const onOther = layers('L1', 3, [1]) // 挂在别的角色身上
        const onSelf = layers('L2', 3, [0])
        assert.ok(damageOf(CHAR, [boost, onOther]) > damageOf(CHAR, [boost]), '层数应抬高集谐区')
        assert.equal(damageOf(CHAR, [boost, onOther]), damageOf(CHAR, [boost, onSelf]), '作用域不参与目标侧聚合')
    })

    it('两个角色读到同一个层数：谐度增幅相同 → 集谐区一致、伤害相等', () => {
        const shared = layers('L3', 3, [0])
        assert.equal(
            damageOf(CHAR, [boostFor('tbA', 0), shared]),
            damageOf(CHAR_B, [boostFor('tbB', 1), shared]),
            '同一份目标侧层数 → 两个角色的集谐区相同'
        )
    })

    it('不按角色累加：作用域=全队也只有一份，不会算三遍', () => {
        const boost = boostFor('tb2', 0)
        assert.equal(
            damageOf(CHAR, [boost, layers('L4', 3, [0, 1, 2])]),
            damageOf(CHAR, [boost, layers('L5', 3, [0])]),
            '全队作用域与单角色作用域的层数完全等价'
        )
    })

    it('多来源相加、覆盖取覆盖值（覆盖同样不分角色）', () => {
        const boost = boostFor('tb3', 0)
        const a = layers('L6', 2, [1])
        const b = layers('L7', 3, [0])
        assert.equal(
            damageOf(CHAR, [boost, a, b]),
            damageOf(CHAR, [boost, layers('L8', 5, [0])]),
            '2 + 3 应等于直接填 5'
        )
        const override = {
            ...layers('L9', 7, [1]),
            zones: [{ zoneId: 'tuneStrainLayer', value: 7, override: true }]
        } as BuffInstance
        assert.equal(
            damageOf(CHAR, [boost, a, b, override]),
            damageOf(CHAR, [boost, layers('L10', 7, [0])]),
            '覆盖条目取覆盖值，与累加值无关'
        )
    })

    it('集谐层数不会写进角色面板（CharacterComputed 里没有这个字段）', () => {
        const boost = boostFor('tb4', 0)
        // 只有层数、没有谐度增幅 → 集谐区恒为 1，伤害与不带该 buff 完全相同
        assert.equal(damageOf(CHAR, [layers('L11', 3, [1])]), damageOf(CHAR, []), '层数本身不产生增伤')
        assert.notEqual(damageOf(CHAR, [boost, layers('L12', 3, [1])]), damageOf(CHAR, [boost]), '配上增幅才生效')
    })
})
