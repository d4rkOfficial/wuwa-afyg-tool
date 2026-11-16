// 计算核的**无头可用性**回归（阶段 4 / 导出库）。
//
// 断言三件事：
//   ① `src/coconut-core/engine/core` 能在 Node 里直接 import（不拖 Svelte / 浏览器 / 上游 API）；
//   ② `computeProject(request)` 与位置参数版 `computeAll(...)` 逐字段等价（门面只是收参，不改口径）；
//   ③ 库表面暴露的注册表是自洽的（作用 / 乘子 / 公式 / 引用来源）。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
    BUFF_ACTIONS,
    FORMULAS,
    MULTIPLIERS,
    MULTIPLIER_ORDER,
    REF_SOURCES,
    actionAllowsCondition,
    computeProject,
    buildDamageSegments,
    type ComputeRequest
} from '$coconut/engine/core'
import { computeAll, DEFAULT_CONDITION_PROFILE } from '$coconut/engine/compute'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { CharSlot } from '$lib/types/project'
import type { ConfigState, EchoSlotConfig } from '$coconut/engine/config.types'

const CHAR = '甲'

const charInfo: CharacterInfo = {
    rarity: 5,
    element: '冷凝',
    weaponType: '长刃',
    tags: [],
    lv90BaseStats: { hp: 10000, atk: 1000, def: 500, tuneBreakBoost: 20 },
    skills: [],
    statNodes: [],
    chains: []
}

const emptyEcho = (): EchoSlotConfig => ({ cost: 1, mainStat: null, secondMainStat: null, substats: [] })

const config: ConfigState = {
    characters: [
        { echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] },
        { echoes: [] as unknown as ConfigState['characters'][1]['echoes'] },
        { echoes: [] as unknown as ConfigState['characters'][2]['echoes'] }
    ],
    enemy: { type: 'BOSS', level: 90, defense: 1000, resistances: { 冷凝: 10 }, dmgReduction: 0 }
}

const team = [{ character: CHAR, weapon: null }] as unknown as CharSlot[]
const weaponInfo: Record<string, WeaponInfo> = {}

const request: ComputeRequest = {
    entries: [
        {
            id: 'e1',
            character: CHAR,
            skillType: '常态攻击',
            hitName: '测试伤害',
            displayName: '测试伤害(常态攻击)',
            formula: 'direct',
            ratioValue: 200,
            ratioUnit: '%',
            damageBaseType: '攻击',
            damageElement: '冷凝',
            sourceTimelineBlockId: 'blk',
            hits: 1
        }
    ],
    buffs: [
        { id: 'b1', name: '加成', zones: [{ zoneId: 'bonusDmg', value: 40 }], scope: 'all' },
        { id: 'b2', name: '易伤', zones: [{ zoneId: 'dmgTakenInc', value: 12 }], scope: 'all' }
    ],
    bindings: { e1: ['b1', 'b2'] },
    damageTypes: { e1: ['普攻伤害'] },
    config,
    team,
    charInfo: { [CHAR]: charInfo },
    weaponInfo
}

describe('计算核：无头可用（Node 直接 import）', () => {
    it('computeProject 与位置参数版 computeAll 逐字段等价', () => {
        const viaCore = computeProject(request)
        const viaRaw = computeAll(
            [...request.entries],
            [...request.buffs],
            { e1: ['b1', 'b2'] },
            { e1: ['普攻伤害'] },
            config,
            team,
            { [CHAR]: charInfo },
            weaponInfo,
            DEFAULT_CONDITION_PROFILE,
            {}
        )
        assert.deepEqual(viaCore, viaRaw)
    })

    it('结果带结构化真源：formula / panel / 乘子链', () => {
        const [entry] = computeProject(request)
        assert.equal(entry!.formula, 'direct')
        assert.equal(entry!.panel.total.atk, 1000, '白值直接进面板')
        assert.deepEqual(
            entry!.multiplierZones.map((zone) => zone.id),
            FORMULAS.direct.chain.map((handle) => handle.id)
        )
        assert.ok(entry!.expectedPerHit > 0)
    })

    it('不带 echoSkillText 也能算（规则2 不参与，其余推导照常）', () => {
        const [entry] = computeProject(request)
        assert.deepEqual(entry!.damageTypes, ['普攻伤害'], '显式类型优先，不依赖文案索引')
    })

    it('溯源可在无头环境构造', () => {
        const [entry] = computeProject(request)
        const segs = buildDamageSegments(entry!, {
            buffSets: [...request.buffs],
            damageEntryBuffSetIds: { e1: ['b1', 'b2'] },
            damageEntryDamageTypes: { e1: ['普攻伤害'] },
            configState: config,
            team,
            charInfoMap: { [CHAR]: charInfo },
            weaponInfoMap: weaponInfo,
            conditionProfile: DEFAULT_CONDITION_PROFILE
        })
        assert.ok(segs.segments.length > 0)
        assert.ok(segs.segments.some((s) => s.id === 'bonus'))
    })
})

describe('计算核：库表面的注册表自洽', () => {
    it('作用 / 乘子 / 引用来源都能从库入口读到', () => {
        assert.ok(BUFF_ACTIONS.length >= 25, '作用注册表不应为空')
        assert.equal(MULTIPLIER_ORDER.length, Object.keys(MULTIPLIERS).length)
        assert.equal(REF_SOURCES.length, new Set(REF_SOURCES.map((s) => s.id)).size, '引用来源 id 不能重复')
    })

    it('能力位可查询：热熔加成可挂条件、热熔共鸣效率不可', () => {
        assert.equal(actionAllowsCondition('bonusDmg'), true)
        assert.equal(actionAllowsCondition('critRate'), true)
        assert.equal(actionAllowsCondition('recharge'), false)
        assert.equal(actionAllowsCondition('tuneStrainLayer'), false)
        assert.equal(actionAllowsCondition('unisonBoonLayer'), false)
    })

    it('公式图可枚举（调用方可自描述地知道每条公式读什么）', () => {
        for (const id of ['direct', 'tune', 'effect', 'fixed'] as const) {
            assert.ok(FORMULAS[id].chain.length >= 0)
            assert.equal(typeof FORMULAS[id].canCrit, 'function')
        }
    })
})
