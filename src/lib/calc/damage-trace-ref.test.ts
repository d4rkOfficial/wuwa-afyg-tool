// 溯源「引用（转模）」口径回归。
//
// 口径：溯源**只给结果** —— 引用乘区解算出多少就显示多少（与引擎写进乘区的数值逐值相同），
// 不再显示规则过程（「攻击白值 超出2000 每100→5 ≤30」这类文案已整体移除，`TracePart` 也不再带 `note`）。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeOneEntry, DEFAULT_CONDITION_PROFILE } from './compute'
import { buildDamageSegments, type DamageTraceCtx } from './damage-trace'
import type { BuffInstance, BuffZoneValue, DamageEntry, ZoneRef } from './calculation.types'
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

const config: ConfigState = {
    characters: [
        { echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] },
        { echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] },
        { echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] }
    ],
    enemy: { type: 'BOSS', level: 90, defense: 1000, resistances: {}, dmgReduction: 0 }
}

const entry: DamageEntry = {
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

const refZone = (zoneId: BuffZoneValue['zoneId'], ref: ZoneRef): BuffZoneValue => ({ zoneId, value: 0, ref })

/** @desc 直接复用引擎的入参链路：computeOneEntry 与 buildDamageSegments 必须看到同一份绑定/条件 */
const run = (buffs: BuffInstance[]) => {
    const boundIds = { [entry.id]: buffs.map((b) => b.id) }
    const typeMap = { [entry.id]: ['普攻伤害'] }
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
    const partsOf = (id: string) => segs.segments.find((s) => s.id === id)?.parts ?? []
    return { result, segs, partsOf }
}

describe('引用（转模）溯源：直接给计算结果', () => {
    // 暴击伤害 += 当前攻击 超出 500 的部分每 100 点 +5%，上限 30% → 攻击 1000 ⇒ (1000-500)/100×5 = 25%
    const critRef = refZone('critDmg', {
        characterIdx: 0,
        zoneId: 'totalAtk',
        threshold: 500,
        pct: 0,
        discrete: true,
        divisor: 100,
        multiplier: 5,
        upper: 30
    })

    it('引用条目的 value 就是解算结果，且不带任何规则文案', () => {
        const { result, partsOf } = run([{ id: 'b1', name: '暴伤转模', zones: [critRef], scope: 'all' }])
        const critParts = partsOf('crit')
        const refPart = critParts.find((p) => p.label.includes('(引用)'))
        assert.ok(refPart, '引用乘区必须列为来源（只到角色基础双暴就说明引用没被解算）')
        assert.equal(refPart.label, '暴击伤害(引用)')
        assert.equal(refPart.value, 25, '溯源数值 = 转模解算结果')
        assert.equal(refPart.value, result.critDmg * 100 - 150, '溯源数值必须与引擎写进乘区的数值一致')
        assert.ok(
            critParts.every((p) => !('note' in p)),
            '引用不得再携带转模规则文案（note 字段已整体移除）'
        )
    })

    it('解算为 0 时同样显示 0（结果就是 0，不回落成规则文案）', () => {
        const zeroRef = { ...critRef, ref: { ...critRef.ref!, threshold: 2000 } }
        const { result, partsOf } = run([{ id: 'b1', name: '暴伤转模', zones: [zeroRef], scope: 'all' }])
        const refPart = partsOf('crit').find((p) => p.label.includes('(引用)'))
        assert.ok(refPart)
        assert.equal(refPart.value, 0)
        assert.equal(result.critDmg, 1.5, '阈值未达成 ⇒ 引擎只按面板基础 150% 计')
    })
})

describe('引用（转模）溯源：面板 chip 也按结果逐条列出', () => {
    // 攻击% += 当前攻击 超出 900 的部分 ×10% → (1000-900)×10% = 10% ⇒ 面板攻击 1000 → 1100
    const atkRef = refZone('atkPct', { characterIdx: 0, zoneId: 'totalAtk', threshold: 900, pct: 10 })

    it('面板来源里出现的是解算后的攻击%，残差占位不再兜住引用', () => {
        const { result, segs } = run([{ id: 'b1', name: '攻击转模', zones: [atkRef], scope: 'all' }])
        assert.equal(result.totalAtk, 1100, '引用命中后面板攻击 = 1000 + 10%×1000')
        const labels = segs.baseParts.map((p) => `${p.source}·${p.label}`)
        assert.deepEqual(labels, ['角色·攻击白值', '攻击转模·攻击%'], '引用应作为独立来源列出')
        assert.equal(segs.baseParts[1].value, 10)
        assert.equal(segs.baseParts[1].contribution, 100)
        assert.ok(
            !labels.some((l) => l.includes('覆盖等')),
            '引用逐条列出后不应再出现「其它·覆盖等」残差（它只兜无法逐条列出的覆盖写入）'
        )
    })
})
