// ── 易伤 / 免伤：同一个乘区、加算 ──────────────────────────────────────────
//
// 实测口径：对敌易伤（`dmgTakenInc`）、免伤无视（`dmgRedPen`）、敌人免伤（`enemyDmgReduction`）
// 是**同一个乘区**，加算：乘子 = 1 + (易伤 − 穿免 − 免伤)/100。
// 净值可以是负的（免伤高于易伤 ⇒ 乘子 < 1，照常相乘），只有净值 ≤ -100% 时乘子封底为 0
// （负伤害没有意义，等价于给怪物加血）。
//
// 本文件钉住四件事：
// 1. 三者加算而不是相乘（旧模型 1.30 × 0.70 = 0.91，正确值是 1.00）；
// 2. 乘子只有一个（`vuln`），溯源里没有独立的免伤区；
// 3. `ResultEntry.vulnerability` 恒等于「乘子 − 1」，负净值与封底都对齐；
// 4. 封底为 0 时该段伤害归零。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeOneEntry, DEFAULT_CONDITION_PROFILE } from '$lib/calc/compute'
import { buildDamageSegments, type DamageTraceCtx } from '$lib/calc/damage-trace'
import type { BuffInstance, DamageEntry } from '$lib/calc/calculation.types'
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

const configOf = (dmgReduction: number): ConfigState => ({
    characters: [
        { echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] },
        { echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] },
        { echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] }
    ],
    enemy: { type: 'BOSS', level: 90, defense: 1000, resistances: {}, dmgReduction }
})

const entry: DamageEntry = {
    id: 'e1',
    character: CHAR,
    skillType: '常态攻击',
    hitName: '常态攻击第1段伤害',
    displayName: '常态攻击第1段(常态攻击)',
    formula: 'direct',
    ratioValue: 100,
    ratioUnit: '%',
    damageBaseType: '攻击',
    damageElement: '冷凝',
    sourceTimelineBlockId: 'b1',
    hits: 1
}

const buffOf = (id: string, zoneId: 'dmgTakenInc' | 'dmgRedPen', value: number): BuffInstance => ({
    id,
    name: id,
    zones: [{ zoneId, value }],
    scope: 'all'
})

/** 跑一条直伤：`vuln` 相关输入全给在这里，敌人免伤走 config */
const run = (buffs: BuffInstance[], enemyDmgReduction = 0) => {
    const config = configOf(enemyDmgReduction)
    const boundIds = { [entry.id]: buffs.map((buff) => buff.id) }
    const damageTypes = { [entry.id]: [] as string[] }
    const result = computeOneEntry(
        entry,
        0,
        config.characters[0]!.echoes,
        buffs,
        boundIds,
        damageTypes,
        config,
        team,
        charInfoMap,
        weaponInfoMap,
        DEFAULT_CONDITION_PROFILE
    )
    const ctx: DamageTraceCtx = {
        buffSets: buffs,
        damageEntryBuffSetIds: boundIds,
        damageEntryDamageTypes: damageTypes,
        configState: config,
        team,
        charInfoMap,
        weaponInfoMap,
        conditionProfile: DEFAULT_CONDITION_PROFILE
    }
    const segs = buildDamageSegments(result, ctx)
    const zone = (id: string) => result.multiplierZones.find((z) => z.id === id)
    const segment = (id: string) => segs.segments.find((s) => s.id === id)
    return { result, segs, zone, segment }
}

const near = (actual: number, expected: number, message?: string) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ''} 期望 ${expected}，实际 ${actual}`)

describe('易伤/免伤：三个来源加算成一个乘区', () => {
    it('易伤 30% + 穿免 10% + 敌人免伤 20% ⇒ 乘子 1.00（旧模型会乘成 0.91）', () => {
        const { zone, result } = run([buffOf('b1', 'dmgTakenInc', 30), buffOf('b2', 'dmgRedPen', 10)], 20)
        near(zone('vuln')!.value, 1.0, '加算后净值 0 ⇒ 乘子 1')
        near(result.vulnerability, 0, 'vulnerability = 乘子 − 1')
        // 加法而非乘法：净值 0 时应与「完全没有易伤/免伤」的条目逐位等价
        assert.equal(result.expectedPerHit, run([], 0).result.expectedPerHit)
    })

    it('只有易伤 20% ⇒ 乘子 1.2；只有免伤 20% ⇒ 乘子 0.8', () => {
        near(run([buffOf('b1', 'dmgTakenInc', 20)])!.zone('vuln')!.value, 1.2)
        near(run([], 20).zone('vuln')!.value, 0.8)
    })

    it('净值 ≤ −100% 时乘子封底 0（不再算出负伤害），该段伤害归零', () => {
        const { result, zone } = run([], 150)
        assert.equal(zone('vuln')!.value, 0, '封底 0')
        assert.equal(result.vulnerability, -1, 'vulnerability 与乘子对齐')
        assert.equal(result.expectedPerHit, 0, '伤害归零而不是负数')
        assert.equal(result.totalDamage, 0)
    })

    it('乘区明细里只有一个乘子，溯源里没有独立的免伤区', () => {
        const { zone, segment, segs } = run([buffOf('b1', 'dmgTakenInc', 30), buffOf('b2', 'dmgRedPen', 10)], 20)
        assert.ok(zone('vuln'))
        assert.equal(zone('dmgRed'), undefined, '旧免伤乘子已并入')
        assert.equal(segment('dmgRed'), undefined, '溯源不应再有免伤区段')
        assert.equal(segment('vuln')!.label, '易伤/免伤区')
        assert.ok(!segs.segments.some((s) => s.id === 'dmgRed'))
    })

    it('溯源来源条把三类输入一起列出（易伤 / 穿免 / 敌人免伤）', () => {
        const { segment } = run([buffOf('b1', 'dmgTakenInc', 30), buffOf('b2', 'dmgRedPen', 10)], 20)
        const labels = segment('vuln')!.parts.map((part) => part.label)
        assert.ok(labels.includes('易伤'), `缺易伤来源（实际 ${labels.join('/')}）`)
        assert.ok(labels.includes('穿免'), `缺穿免来源（实际 ${labels.join('/')}）`)
        assert.ok(labels.includes('敌人免伤'), `缺敌人免伤来源（实际 ${labels.join('/')}）`)
    })
})
