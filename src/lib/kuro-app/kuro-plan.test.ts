// ── 库街区声骸 → 词条方案映射单测（node:test） ─────────────────────────────
// 覆盖：主词条别名（含「治疗效果加成」）、声骸不齐时补空槽、只有完全没声骸才跳过、
// 漂泊者等同名多形态角色的候选列表。不依赖网络与上游。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
    buildKuroPlans,
    canonicalMainStat,
    canonicalSubstat,
    matchCharacterName,
    padSlots,
    type KuroPlanDraft
} from '$lib/kuro-app/kuro-plan'
import type { EchoSlotConfig } from '$lib/calc/config.types'
import type { KuroCharacterEchoes, KuroEcho } from '$lib/kuro-app/kuro.svelte'

const echo = (cost: number, mainStatName: string): KuroEcho => ({
    cost,
    mainStatName,
    mainStatValue: 0,
    substats: [
        { name: '暴击率', value: 6.3 },
        { name: '攻击%', value: 6.4 }
    ]
})

const character = (name: string, echoes: KuroEcho[], error?: string): KuroCharacterEchoes => ({
    id: name,
    name,
    echoes,
    ...(error ? { error } : {})
})

const ROVER = ['漂泊者·导电', '漂泊者·气动', '漂泊者·衍射', '漂泊者·湮灭', '今汐', '散华']

describe('canonicalMainStat', () => {
    it('上游「治疗效果加成」归一到 4cost 池子的「治疗加成」', () => {
        assert.equal(canonicalMainStat('治疗效果加成', 4), '治疗加成')
        assert.equal(canonicalMainStat('治疗加成', 4), '治疗加成')
    })
    it('简写与元素伤害加成照旧', () => {
        assert.equal(canonicalMainStat('暴击', 4), '暴击率')
        assert.equal(canonicalMainStat('暴伤', 4), '暴击伤害')
        assert.equal(canonicalMainStat('热熔伤害加成', 3), '热熔伤害加成')
        assert.equal(canonicalMainStat('冷凝属性伤害加成', 3), '冷凝伤害加成')
    })
    it('池子里没有的返回 null', () => {
        assert.equal(canonicalMainStat('治疗效果加成', 1), null)
        assert.equal(canonicalMainStat('不存在的词条', 4), null)
    })
})

describe('canonicalSubstat', () => {
    it('固定值 / 百分比按上游是否带 % 区分', () => {
        assert.equal(canonicalSubstat('攻击'), '攻击')
        assert.equal(canonicalSubstat('攻击%'), '攻击%')
        assert.equal(canonicalSubstat('共鸣效率'), '共鸣效率')
    })
})

describe('padSlots', () => {
    it('4 个声骸补 1 个空槽，总 cost 不超过 12', () => {
        const slots = [4, 3, 3, 1].map((cost) => ({ cost }) as EchoSlotConfig)
        const padded = padSlots(slots)
        assert.ok(padded)
        assert.equal(padded.length, 5)
        assert.equal(padded[4].cost, 1)
        assert.equal(padded[4].mainStat, null)
        assert.equal(padded[4].substats.length, 0)
        assert.ok(padded.reduce((n, s) => n + s.cost, 0) <= 12)
    })
    it('补不满 5 槽（cost 组合超限）返回 null', () => {
        assert.equal(padSlots([4, 4, 4].map((cost) => ({ cost }) as EchoSlotConfig)), null)
    })
    it('已满 5 槽原样返回', () => {
        const slots = [4, 3, 3, 1, 1].map((cost) => ({ cost }) as EchoSlotConfig)
        assert.equal(padSlots(slots)?.length, 5)
    })
})

describe('buildKuroPlans', () => {
    it('声骸不齐照样导入：补空槽、echoCount 记真实数量', () => {
        const ch = character('今汐', [echo(4, '暴击'), echo(3, '热熔伤害加成'), echo(1, '攻击%')])
        const { plans, skipped } = buildKuroPlans([ch], ROVER)
        assert.equal(skipped.length, 0)
        assert.equal(plans.length, 1)
        const plan = plans[0] as KuroPlanDraft
        assert.equal(plan.character, '今汐')
        assert.equal(plan.matched, true)
        assert.equal(plan.echoCount, 3)
        assert.equal(plan.slots.length, 5)
        // 前 3 槽有主词条，后 2 槽是空槽（badge 不显示）
        assert.deepEqual(
            plan.slots.map((s) => s.mainStat?.type ?? null),
            ['暴击率', '热熔伤害加成', '攻击%', null, null]
        )
    })

    it('完全没声骸才跳过；详情拉取失败带原因', () => {
        const { plans, skipped } = buildKuroPlans(
            [character('散华', []), character('今汐', [], '上游超时'), character('安可', [echo(4, '暴击')])],
            ROVER
        )
        assert.equal(plans.length, 1)
        assert.deepEqual(skipped, [
            { character: '散华', reason: '没有装配声骸' },
            { character: '今汐', reason: '拉取失败：上游超时' }
        ])
    })

    it('漂泊者没有形态时给出各属性候选，不硬塞名字', () => {
        const { plans } = buildKuroPlans([character('漂泊者', [echo(4, '暴击'), echo(1, '攻击%')])], ROVER)
        const plan = plans[0] as KuroPlanDraft
        assert.deepEqual(plan.options, ['漂泊者·导电', '漂泊者·气动', '漂泊者·衍射', '漂泊者·湮灭'])
        assert.equal(plan.character, '')
        assert.equal(plan.matched, false)
    })

    it('上游名能精确命中时不给候选', () => {
        const { plans } = buildKuroPlans([character('漂泊者·衍射', [echo(4, '暴击')])], ROVER)
        const plan = plans[0] as KuroPlanDraft
        assert.equal(plan.character, '漂泊者·衍射')
        assert.equal(plan.matched, true)
        assert.equal(plan.options, undefined)
    })

    it('治疗声骸能整只角色导入（不再因为治疗效果加成被跳过）', () => {
        const ch = character('维里奈', [
            echo(4, '治疗效果加成'),
            echo(3, '共鸣效率'),
            echo(3, '攻击%'),
            echo(1, '攻击%'),
            echo(1, '攻击%')
        ])
        const { plans, skipped, unmatchedNames } = buildKuroPlans([ch], ROVER)
        assert.deepEqual(skipped, [])
        assert.deepEqual(unmatchedNames, [])
        assert.equal(plans[0]?.slots[0].mainStat?.type, '治疗加成')
    })
})

describe('matchCharacterName', () => {
    it('精确 / 宽松命中', () => {
        assert.deepEqual(matchCharacterName('今汐', ROVER), { name: '今汐', matched: true, options: [] })
        assert.deepEqual(matchCharacterName('漂泊者·衍射', ROVER).name, '漂泊者·衍射')
    })
    it('名录里没有的名字按上游名写入', () => {
        assert.deepEqual(matchCharacterName('新角色', ROVER), { name: '新角色', matched: false, options: [] })
    })
})
