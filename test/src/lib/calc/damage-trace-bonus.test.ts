// 溯源弹窗「增伤区」来源回归：**只列真正计入本条伤害**的元素/类型加成来源。
//
// 症状（用户报告）：带普攻伤害类型的条目，溯源弹窗的增伤区里出现「声骸副词条 · 共鸣技能加成」。
// 引擎其实没算它（computeResultEntry 只对 `entry.damageTypes` 与 `entry.damageElement` 求和），
// 是 damage-trace 的 collectBonusParts 只按 label 正则判断「像不像加成词条」造成的错误来源。
//
// 本用例同时钉住两侧：引擎数值（typeBonus / elBonus）与溯源来源列表必须一致。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeOneEntry, DEFAULT_CONDITION_PROFILE } from '$lib/calc/compute'
import { buildDamageSegments, type DamageTraceCtx } from '$lib/calc/damage-trace'
import type { DamageEntry } from '$lib/calc/calculation.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { CharSlot } from '$lib/types/project'
import type { ConfigState, EchoSlotConfig } from '$lib/calc/config.types'

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

const echoWith = (substats: string[], mainStat?: string): EchoSlotConfig => ({
    cost: 1,
    mainStat: mainStat ? { type: mainStat, value: 30, unit: '%' } : null,
    secondMainStat: null,
    substats: substats.map((type) => ({ type, value: 10, unit: '%' }))
})

const emptyEcho = (): EchoSlotConfig => ({ cost: 1, mainStat: null, secondMainStat: null, substats: [] })

/** @desc 只有 1 号位带声骸，其余留空 —— 溯源里的来源应当只出现「声骸1」 */
const configWith = (echo: EchoSlotConfig): ConfigState => ({
    characters: [
        { echoes: [echo, emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] },
        { echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] },
        { echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] }
    ],
    enemy: { type: 'BOSS', level: 90, defense: 1000, resistances: {}, dmgReduction: 0 }
})

const team = [{ character: CHAR, weapon: null }] as unknown as CharSlot[]
const charInfoMap: Record<string, CharacterInfo> = { [CHAR]: charInfo }
const weaponInfoMap: Record<string, WeaponInfo> = {}

const makeEntry = (element: string): DamageEntry => ({
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
    damageElement: element,
    sourceTimelineBlockId: 'b1',
    hits: 1
})

/** @desc 跑引擎 + 溯源，返回 `[引擎结果, 增伤区来源]`，两侧一起断言才能证明「来源 == 实际计入」 */
const run = (element: string, damageTypes: string[], configState: ConfigState) => {
    const entry = makeEntry(element)
    const result = computeOneEntry(
        entry,
        0,
        configState.characters[0].echoes,
        [],
        {},
        { [ENTRY_ID]: damageTypes },
        configState,
        team,
        charInfoMap,
        weaponInfoMap,
        DEFAULT_CONDITION_PROFILE
    )
    const ctx: DamageTraceCtx = {
        buffSets: [],
        damageEntryBuffSetIds: {},
        damageEntryDamageTypes: { [ENTRY_ID]: damageTypes },
        configState,
        team,
        charInfoMap,
        weaponInfoMap,
        conditionProfile: DEFAULT_CONDITION_PROFILE
    }
    const bonus = buildDamageSegments(result, ctx).segments.find((s) => s.id === 'bonus')
    assert.ok(bonus, '增伤区段必须存在')
    return { result, labels: bonus.parts.map((p) => `${p.source}·${p.label}`), partValues: bonus.parts }
}

describe('溯源增伤区：类型加成只列本条伤害类型匹配的来源', () => {
    // 声骸1 同时带「共鸣技能伤害加成」与「普攻伤害加成」——两条都在，才能看出是否被误列
    const config = configWith(echoWith(['共鸣技能伤害加成', '普攻伤害加成']))

    it('普攻条目：引擎只算普攻加成，溯源也只列普攻加成', () => {
        const { result, labels } = run('冷凝', ['普攻伤害'], config)
        assert.equal(result.typeBonus, 10, '引擎只应计入「普攻伤害加成」10%（不该把共技的也算进来）')
        assert.deepEqual(labels, ['声骸1·普攻加成'], '溯源不得出现「共鸣技能加成」')
    })

    it('共技条目：引擎只算共技加成，溯源也只列共技加成', () => {
        const { result, labels } = run('冷凝', ['共鸣技能伤害'], config)
        assert.equal(result.typeBonus, 10, '引擎只应计入「共鸣技能伤害加成」10%')
        assert.deepEqual(labels, ['声骸1·共鸣技能加成'], '溯源不得出现「普攻加成」')
    })

    it('两条伤害类型都命中时，两条来源都列出（引擎会把两者相加）', () => {
        const { result, labels } = run('冷凝', ['普攻伤害', '共鸣技能伤害'], config)
        assert.equal(result.typeBonus, 20, '两种类型都命中 → 20%')
        assert.deepEqual(labels, ['声骸1·共鸣技能加成', '声骸1·普攻加成'])
    })

    it('引擎不认的词条（不在元素/类型加成表里）不得出现在溯源里', () => {
        const { result, labels } = run('冷凝', ['普攻伤害'], configWith(echoWith(['治疗加成'])))
        assert.equal(result.typeBonus, 0)
        assert.deepEqual(labels, [], '治疗加成对增伤区无贡献，不该被列为来源')
    })
})

describe('溯源增伤区：元素加成只列与该条目属性一致的来源', () => {
    it('冷凝条目 + 声骸主词条热熔伤害加成 → 不计入，也不出现在溯源里', () => {
        const { result, labels } = run('冷凝', ['普攻伤害'], configWith(echoWith([], '热熔伤害加成')))
        assert.equal(result.elBonus, 0, '属性不符的元素加成引擎不计入')
        assert.deepEqual(labels, [])
    })

    it('冷凝条目 + 声骸主词条冷凝伤害加成 → 计入且出现在溯源里', () => {
        const { result, labels } = run('冷凝', ['普攻伤害'], configWith(echoWith([], '冷凝伤害加成')))
        assert.equal(result.elBonus, 30)
        assert.deepEqual(labels, ['声骸1·冷凝加成'])
    })

    it('每条来源的数值之和等于引擎口径（elBonus + typeBonus）', () => {
        const config = configWith(echoWith(['普攻伤害加成', '共鸣技能伤害加成'], '冷凝伤害加成'))
        const { result, partValues } = run('冷凝', ['普攻伤害'], config)
        const sum = partValues.reduce((s, p) => s + p.value, 0)
        assert.equal(sum, (result.elBonus ?? 0) + (result.typeBonus ?? 0), '溯源来源之和必须等于引擎实际计入的增伤')
    })
})
