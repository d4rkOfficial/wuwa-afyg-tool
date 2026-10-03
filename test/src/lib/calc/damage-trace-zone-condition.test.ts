// 溯源「乘区条件」口径回归。
//
// 需求：buff 的某个乘区带条件（伤害类型 / 伤害属性）时，溯源里的来源标签要带上条件，读成
// 「冷凝加成」「声骸加成」「共技·冷凝加成」，且**不止增伤区** —— 穿防/终伤/特殊/双暴/面板词条同样处理。
//
// 同时钉住不变式：**条件不满足的乘区不得出现在来源里**（引擎 `zoneConditionMet` 没算它），
// 否则「来源数值之和 = 该乘区数值」会被破坏（这类幻影来源是本仓库修过的老毛病）。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeOneEntry, DEFAULT_CONDITION_PROFILE } from '$lib/calc/compute'
import { buildDamageSegments, type DamageTraceCtx } from '$lib/calc/damage-trace'
import type { BuffCondition, BuffInstance, BuffZoneValue, DamageEntry } from '$lib/calc/calculation.types'
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

const zone = (zoneId: BuffZoneValue['zoneId'], value: number, condition?: BuffCondition): BuffZoneValue => ({
    zoneId,
    value,
    ...(condition ? { condition } : {})
})

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
    const labelsOf = (id: string) =>
        (segs.segments.find((s) => s.id === id)?.parts ?? []).map((p) => `${p.source}·${p.label}`)
    return { result, segs, labelsOf }
}

describe('溯源标签带乘区条件前缀（增伤区）', () => {
    it('属性条件 →「冷凝加成」，类型条件 →「声骸加成」，两类都有 →「共技·冷凝加成」', () => {
        const buffs = [
            buff('b1', '冷凝之赐', [zone('bonusDmg', 20, { elements: ['冷凝'] })]),
            buff('b2', '声骸之赐', [zone('bonusDmg', 10, { damageTypes: ['声骸技能伤害'] })])
        ]
        const { labelsOf } = run(directEntry, buffs, ['声骸技能伤害'])
        assert.deepEqual(labelsOf('bonus'), ['冷凝之赐·冷凝加成', '声骸之赐·声骸加成'])

        const both = [
            buff('b3', '共技之赐', [zone('bonusDmg', 30, { elements: ['冷凝'], damageTypes: ['共鸣技能伤害'] })])
        ]
        assert.deepEqual(run(directEntry, both, ['共鸣技能伤害']).labelsOf('bonus'), ['共技之赐·共技·冷凝加成'])
    })

    it('无条件乘区保持原标签（不加前缀）', () => {
        const { labelsOf } = run(directEntry, [buff('b4', '无条件之赐', [zone('bonusDmg', 5)])], ['普攻伤害'])
        assert.deepEqual(labelsOf('bonus'), ['无条件之赐·加成'])
    })

    it('条件不满足的乘区不列为来源，且来源之和 = 引擎的增伤乘区', () => {
        const buffs = [
            buff('b1', '热熔之赐', [zone('bonusDmg', 20, { elements: ['热熔'] })]),
            buff('b2', '冷凝共技之赐', [zone('bonusDmg', 30, { elements: ['冷凝'], damageTypes: ['共鸣技能伤害'] })]),
            buff('b3', '声骸之赐', [zone('bonusDmg', 10, { damageTypes: ['声骸技能伤害'] })])
        ]
        // 条目：冷凝 +（普攻 或 共技）→ 只有 b2 命中；b1（热熔）与 b3（声骸）都必须消失
        const { result, segs, labelsOf } = run(directEntry, buffs, ['普攻伤害', '共鸣技能伤害'])
        assert.deepEqual(labelsOf('bonus'), ['冷凝共技之赐·共技·冷凝加成'])
        const partSum = segs.segments.find((s) => s.id === 'bonus')!.parts.reduce((sum, p) => sum + p.value, 0)
        assert.equal(partSum, result.dmgBonus * 100, '来源之和必须等于引擎实际计入的增伤（幻影来源会破坏这条不变式）')
        assert.equal(result.dmgBonus * 100, 30)
    })
})

describe('不止增伤区：穿透 / 终伤 / 特殊 / 双暴 / 面板词条同样带条件前缀', () => {
    const buffs = [
        buff('b1', '冷凝穿透', [zone('defPen', 15, { elements: ['冷凝'] })]),
        buff('b2', '热熔穿透(不该列)', [zone('defPen', 25, { elements: ['热熔'] })]),
        buff('b3', '冷凝终伤', [zone('finalDmg', 8, { damageTypes: ['普攻伤害'] })]),
        buff('b4', '冷凝特殊', [zone('specialFinal1', 12, { elements: ['冷凝'] })]),
        buff('b5', '冷凝双暴', [zone('critRate', 10, { elements: ['冷凝'] })]),
        buff('b6', '普攻攻击', [zone('atkPct', 20, { damageTypes: ['普攻伤害'] })])
    ]

    it('各区标签各自带条件，条件不匹配的穿透不出现', () => {
        const { labelsOf } = run(directEntry, buffs, ['普攻伤害'])
        assert.deepEqual(labelsOf('def'), ['敌人面板(BOSS)·敌人防御', '冷凝穿透·冷凝穿防'])
        assert.deepEqual(labelsOf('finalDmg'), ['冷凝终伤·普攻终伤'])
        assert.deepEqual(labelsOf('custom'), ['冷凝特殊·冷凝特殊终伤(1)'])
        assert.deepEqual(labelsOf('crit'), ['角色·暴击率基础', '角色·暴击伤害基础', '冷凝双暴·冷凝暴击率'])
    })

    it('面板 chip 的基础值来源也带条件前缀（攻击% → 普攻攻击%）', () => {
        const { result, segs } = run(directEntry, buffs, ['普攻伤害'])
        assert.deepEqual(
            segs.baseParts.map((p) => `${p.source}·${p.label}`),
            ['角色·攻击白值', '普攻攻击·普攻攻击%']
        )
        assert.equal(result.totalAtk, 1200, '条件命中的攻击%要计入面板（5 号 buff 20%）')
    })
})

describe('系数基类条目（处决/响应）按**解析后**的伤害类型判条件', () => {
    // ResultEntry.damageTypes 对处决/响应恒为空数组，若溯源直接用它判条件，条件乘区会全部被误判为不匹配
    it('条件 =「其它类型伤害」的乘区命中（与引擎同口径），条件 =「普攻伤害」的被剔除', () => {
        const buffs = [
            buff('b1', '其它终伤', [zone('finalDmg', 8, { damageTypes: ['其它类型伤害'] })]),
            buff('b2', '普攻终伤(不该列)', [zone('finalDmg', 20, { damageTypes: ['普攻伤害'] })])
        ]
        const { result, labelsOf } = run(tuneEntry, buffs, [])
        assert.equal(result.finalDmg, 0.08, '引擎按解析出的「其它类型伤害」计入了 8%')
        assert.deepEqual(labelsOf('finalDmg'), ['其它终伤·其它终伤'])
    })
})
