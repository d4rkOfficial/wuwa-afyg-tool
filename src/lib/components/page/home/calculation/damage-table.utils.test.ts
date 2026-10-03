// 拉表可用性硬门槛回归：**处决/响应/效应条目不允许添加「追加」型双暴 buff**。
//
// 引擎口径（`COEFF_OVERRIDE_ONLY_ZONE_IDS`）：系数基类条目不参与面板式双暴累加，双暴只有「覆盖」写入生效。
// 因此拉表的可用性判定（`buffUsableByEntry`，铺开表与下拉表共用）必须同步挡住追加型双暴 buff ——
// 否则会出现「勾得上、格子亮着、数值毫无变化」的假可勾。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { buffRelevantForNonDirect, buffUsableByEntry, zoneUsableByNonDirect } from './damage-table.utils'
import type { BuffInstance, BuffZoneValue, DamageEntry } from '$lib/calc/calculation.types'

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
    ...effectEntry,
    id: 'tune',
    isEffect: false,
    isTuneBreak: true,
    damageBaseType: '偏谐系数'
}

const directEntry: DamageEntry = {
    ...effectEntry,
    id: 'direct',
    character: '测试角色',
    isEffect: false,
    damageBaseType: '攻击',
    damageElement: '冷凝'
}

const zone = (zoneId: BuffZoneValue['zoneId'], value: number, override = false): BuffZoneValue => ({
    zoneId,
    value,
    ...(override ? { override: true } : {})
})

const buff = (zones: BuffZoneValue[]): BuffInstance => ({ id: 'b1', name: '测试buff', zones, scope: 'all' })

describe('非直伤条目的可用性门槛：追加型双暴 buff 不允许勾', () => {
    it('效应条目：追加型暴击率/暴击伤害 → 不可用；覆盖型 → 可用', () => {
        assert.equal(buffUsableByEntry(buff([zone('critRate', 20)]), effectEntry), false, '追加暴击率不生效')
        assert.equal(buffUsableByEntry(buff([zone('critDmg', 30)]), effectEntry), false, '追加暴击伤害不生效')
        assert.equal(buffUsableByEntry(buff([zone('critRate', 100, true)]), effectEntry), true, '覆盖型暴击率生效')
        assert.equal(buffUsableByEntry(buff([zone('critDmg', 200, true)]), effectEntry), true, '覆盖型暴击伤害生效')
    })

    it('处决/响应条目同一口径', () => {
        assert.equal(buffUsableByEntry(buff([zone('critRate', 20)]), tuneEntry), false)
        assert.equal(buffUsableByEntry(buff([zone('critDmg', 20, true)]), tuneEntry), true)
    })

    it('同一 buff 里另有可吃乘区时仍可用（只是双暴那部分不参与）', () => {
        const mixed = buff([zone('critRate', 20), zone('deepenDmg', 15)])
        assert.equal(buffUsableByEntry(mixed, effectEntry), true, '加深是可吃乘区 ⇒ 这个 buff 仍可勾')
    })

    it('覆盖型带引用 ⇒ 按引用处理，仍不可用', () => {
        const refOverride: BuffZoneValue = {
            zoneId: 'critDmg',
            value: 0,
            override: true,
            ref: { characterIdx: 0, zoneId: 'totalAtk', threshold: 2000, pct: 10 }
        }
        assert.equal(zoneUsableByNonDirect(refOverride, effectEntry), false)
    })
})

describe('非直伤条目的可用性门槛：其余乘区口径不变', () => {
    it('白名单外的乘区（增伤等）依旧不可用', () => {
        assert.equal(buffUsableByEntry(buff([zone('bonusDmg', 20)]), effectEntry), false, '效应不吃增伤区')
        assert.equal(buffUsableByEntry(buff([zone('deepenDmg', 15)]), effectEntry), true, '效应吃加深')
        assert.equal(buffUsableByEntry(buff([zone('tuneBreakBoost', 10)]), tuneEntry), true, '处决吃谐度增幅')
        assert.equal(buffUsableByEntry(buff([zone('deepenDmg', 15)]), tuneEntry), false, '处决不吃加深')
    })

    it('直伤条目：任何乘区都可用（新规则只针对系数基类条目）', () => {
        assert.equal(buffUsableByEntry(buff([zone('critRate', 20)]), directEntry), true)
        assert.equal(buffUsableByEntry(buff([zone('bonusDmg', 20)]), directEntry), true)
    })

    it('`buffRelevantForNonDirect` 与 `buffUsableByEntry` 在非直伤上同口径', () => {
        for (const entry of [effectEntry, tuneEntry]) {
            for (const zones of [
                [zone('critRate', 20)],
                [zone('critRate', 20, true)],
                [zone('deepenDmg', 15)],
                [zone('bonusDmg', 20)]
            ]) {
                const bs = buff(zones)
                assert.equal(buffUsableByEntry(bs, entry), buffRelevantForNonDirect(bs, entry))
            }
        }
    })
})
