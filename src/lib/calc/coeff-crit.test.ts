// 系数基类条目（处决 / 响应 / 效应 / 偏谐系数直伤）的**双暴口径**回归。
//
// 口径（见 docs/buff-engine.md「系数基类条目（处决 / 响应 / 效应）的双暴」）：
// - 基准 0% / 100%（等价「额外暴击伤害 +0%」）：面板双暴（基础 5%/150%、声骸/武器副词条、转模引用）都不计入；
// - 只有**绑定到该条目**的双暴 buff 参与暴击区 = 1 + 暴击率 × (暴击伤害 - 1)；
// - 暴击率为 0 ⇒ canCrit=false：结果页「暴击 / 不暴击」两列显示占位符、溯源不出「暴击区」段，期望 = 不暴击；
// - 直伤（面板基类）口径不变，仍以 5%/150% + 装备双暴为基准。
//
// 两侧一起断言才能证明「数值口径」与「溯源来源列表」一致：引擎结果 + buildDamageSegments 的暴击区来源。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeAll, DEFAULT_CONDITION_PROFILE } from './compute'
import { buildDamageSegments, type DamageTraceCtx } from './damage-trace'
import type { BuffInstance, DamageEntry } from './calculation.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { CharSlot } from '$lib/types/project'
import type { ConfigState, EchoSlotConfig } from './config.types'

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

/** @desc 1 号位声骸带双暴副词条：用来证明「装备双暴不计入系数基类条目、但仍计入直伤」 */
const echoWithCrit: EchoSlotConfig = {
    cost: 1,
    mainStat: null,
    secondMainStat: null,
    substats: [
        { type: '暴击率', value: 10, unit: '%' },
        { type: '暴击伤害', value: 20, unit: '%' }
    ]
}

const config: ConfigState = {
    characters: [
        { echoes: [echoWithCrit, emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] },
        { echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] },
        { echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] }
    ],
    enemy: { type: 'BOSS', level: 90, defense: 1000, resistances: {}, dmgReduction: 0 }
}

const effectEntry: DamageEntry = {
    id: 'eff',
    hitName: '光噪效应',
    displayName: '光噪效应3层',
    isEffect: true,
    isTuneBreak: false,
    isTuneResponse: false,
    ratioValue: 3,
    ratioUnit: '%',
    damageBaseType: '效应系数',
    damageElement: '衍射',
    sourceTimelineBlockId: 'b1',
    hits: 1
}

const tuneEntry: DamageEntry = {
    id: 'tune',
    character: CHAR,
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

const directEntry: DamageEntry = {
    id: 'direct',
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

/** @desc 双暴 buff：`scope` 决定它能绑到哪类条目（'all' = 全队/效应，[0] = 角色 1） */
const critBuff = (scope: 'all' | number[], rate: number, dmg: number): BuffInstance => ({
    id: 'crit',
    name: '双暴',
    zones: [
        { zoneId: 'critRate', value: rate },
        { zoneId: 'critDmg', value: dmg }
    ],
    scope
})

const run = (entry: DamageEntry, buffs: BuffInstance[]) => {
    const boundIds = Object.fromEntries(buffs.map((b) => [entry.id, [b.id]]))
    const [result] = computeAll(
        [entry],
        buffs,
        boundIds,
        {},
        config,
        team,
        charInfoMap,
        weaponInfoMap,
        DEFAULT_CONDITION_PROFILE
    )
    const ctx: DamageTraceCtx = {
        buffSets: buffs,
        damageEntryBuffSetIds: boundIds,
        damageEntryDamageTypes: {},
        configState: config,
        team,
        charInfoMap,
        weaponInfoMap,
        conditionProfile: DEFAULT_CONDITION_PROFILE
    }
    const critSegment = buildDamageSegments(result, ctx).segments.find((s) => s.id === 'crit')
    return { result, critSegment }
}

const near = (actual: number, expected: number, tol = 1) =>
    assert.ok(Math.abs(actual - expected) <= tol, `期望约 ${expected}，实际 ${actual}（容差 ${tol}）`)

describe('系数基类（效应）：无 buff 时暴击率为 0，结果页两列走占位符', () => {
    it('canCrit=false、暴击率 0%、暴伤基准 100%，三值相等，溯源不出暴击区', () => {
        const { result, critSegment } = run(effectEntry, [])
        assert.equal(result.canCrit, false, '暴击率 0 时不得标成可暴击（结果页两列显示 —）')
        assert.equal(result.critRate, 0, '效应不吃角色面板双暴，基准必须为 0')
        assert.equal(result.critDmg, 1, '暴伤基准 100%（额外暴伤 +0%）')
        assert.equal(result.nonCritPerHit, result.expectedPerHit)
        assert.equal(result.critPerHit, result.expectedPerHit)
        assert.equal(critSegment, undefined, 'canCrit=false 时溯源不应出现暴击区段')
    })

    it('绑了全队双暴 buff 后暴击区生效：期望 = 不暴击 ×(1 + 暴击率×额外暴伤)', () => {
        const { result, critSegment } = run(effectEntry, [critBuff('all', 50, 50)])
        assert.equal(result.canCrit, true)
        assert.equal(result.critRate, 0.5)
        assert.equal(result.critDmg, 1.5, '50% 额外暴伤 → 总暴伤 150%')
        near(result.critPerHit, result.nonCritPerHit * 1.5)
        near(result.expectedPerHit, result.nonCritPerHit * (1 + 0.5 * 0.5))
        assert.ok(critSegment, '可暴击时溯源必须给出暴击区段')
        assert.deepEqual(
            critSegment.parts.map((p) => `${p.source}·${p.label}`),
            ['系数基类·暴击率基准', '系数基类·暴击伤害基准', '双暴·暴击率', '双暴·暴击伤害'],
            '系数基类的暴击区来源只能是「基准 + 绑定 buff」，不得出现角色面板/声骸/武器双暴'
        )
    })
})

describe('系数基类（处决/响应）：装备双暴不计入，只有绑定 buff 能加', () => {
    it('声骸副词条带双暴也不影响：暴击率仍为 0、canCrit=false', () => {
        const { result } = run(tuneEntry, [])
        assert.equal(result.critRate, 0, '声骸副词条的双暴不得进入系数基类条目')
        assert.equal(result.critDmg, 1)
        assert.equal(result.canCrit, false)
    })

    it('绑同角色作用域的双暴 buff 后参与暴击区', () => {
        const { result, critSegment } = run(tuneEntry, [critBuff([0], 30, 60)])
        assert.equal(result.canCrit, true)
        assert.equal(result.critRate, 0.3)
        assert.equal(result.critDmg, 1.6)
        near(result.expectedPerHit, result.nonCritPerHit * (1 + 0.3 * 0.6))
        near(result.critPerHit, result.nonCritPerHit * 1.6)
        assert.deepEqual(
            critSegment?.parts.map((p) => `${p.source}·${p.label}`),
            ['系数基类·暴击率基准', '系数基类·暴击伤害基准', '双暴·暴击率', '双暴·暴击伤害']
        )
    })
})

describe('直伤口径不受影响（面板基类仍以 5%/150% 为基准）', () => {
    it('直伤条目照常吃角色基础双暴与声骸副词条双暴', () => {
        const { result, critSegment } = run(directEntry, [])
        assert.equal(result.canCrit, true)
        assert.equal(result.critRate, 0.15, '基础 5% + 声骸副词条 10%')
        assert.equal(result.critDmg, 1.7, '基础 150% + 声骸副词条 20%')
        assert.deepEqual(
            critSegment?.parts.map((p) => `${p.source}·${p.label}`),
            ['角色·暴击率基础', '角色·暴击伤害基础', '声骸1·暴击率', '声骸1·暴击伤害']
        )
    })
})
