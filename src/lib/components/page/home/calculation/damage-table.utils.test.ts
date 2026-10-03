// 拉表可用性门槛回归，两块：
//
// ① 「追加型双暴 buff 不允许勾到处决/响应/效应条目」——
//    引擎口径（`COEFF_OVERRIDE_ONLY_ZONE_IDS`）：系数基类条目不参与面板式双暴累加，双暴只有「覆盖」写入生效。
//    拉表的可用性判定（`buffUsableByEntry`，铺开表与下拉表共用）必须同步挡住，否则是「勾得上、数值毫无变化」的假可勾。
//
// ② 「非直伤条目的乘区条件必须带条目上下文」——
//    曾经对非直伤条目传空上下文（`{}`），于是一律触发 `evaluateCondition` 的「需要条目上下文的子句视为不满足」，
//    把带属性/类型条件的乘区全判成不匹配。实测症状：效应条目上带「导电/效应」条件的加深 buff 挂不上，
//    但引擎其实吃它。此处钉住「拉表条件过滤 == 引擎贡献判定」这条不变式。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
    buildDamageTypesByEntry,
    buffMatchesEntry,
    buffRelevantForNonDirect,
    buffUsableByEntry,
    zoneUsableByNonDirect
} from './damage-table.utils'
import { buffContributesToEntry, DEFAULT_CONDITION_PROFILE } from '$lib/calc/compute'
import type { BuffCondition, BuffInstance, BuffZoneValue, DamageEntry } from '$lib/calc/calculation.types'

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
    skillType: '常态攻击',
    hitName: '常态攻击第1段伤害',
    isEffect: false,
    damageBaseType: '攻击',
    damageElement: '冷凝'
}

const zone = (zoneId: BuffZoneValue['zoneId'], value: number, override = false): BuffZoneValue => ({
    zoneId,
    value,
    ...(override ? { override: true } : {})
})

/** @desc 带乘区级条件的乘区（用户实际场景：加深 + 条件「导电/效应」） */
const condZone = (zoneId: BuffZoneValue['zoneId'], value: number, condition: BuffCondition): BuffZoneValue => ({
    zoneId,
    value,
    condition
})

const buff = (zones: BuffZoneValue[]): BuffInstance => ({ id: 'b1', name: '测试buff', zones, scope: 'all' })

/** @desc 引擎的乘区条件上下文（`computeAll` 的 `zoneCtx` 就是这两项）+ 拉表的条件过滤，两侧一起比 */
const conditionAgrees = (bs: BuffInstance, entry: DamageEntry): { ui: boolean; engine: boolean } => {
    const damageTypes = buildDamageTypesByEntry([entry], {}, {}, {}).get(entry.id)
    return {
        ui: buffMatchesEntry(bs, entry, {
            hideConditionMismatch: true,
            conditionProfile: DEFAULT_CONDITION_PROFILE,
            damageTypes,
            charIdx: -1
        }),
        engine: buffContributesToEntry(
            bs,
            { element: entry.damageElement, damageTypes: damageTypes ?? [] },
            DEFAULT_CONDITION_PROFILE,
            -1
        )
    }
}

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

describe('非直伤条目也要带条目上下文判乘区条件（含属性/类型条件的 buff 不再被误藏）', () => {
    /** @desc 用户实例：武器 1 阶 + 乘区「加深(条件 导电/效应)」的 buff 挂不上电磁效应 */
    const weaponGate: BuffCondition = { refinements: [{ charIdx: 0, min: 1 }] }
    const conductiveEffectEntry: DamageEntry = {
        ...effectEntry,
        id: 'dianci',
        hitName: '电磁效应',
        damageElement: '导电'
    }

    it('效应条目 + 加深(条件 导电/效应伤害)：可见性判定与引擎一致，均可吃', () => {
        const bs: BuffInstance = {
            ...buff([condZone('deepenDmg', 15, { elements: ['导电'], damageTypes: ['效应伤害'] })]),
            condition: weaponGate
        }
        assert.deepEqual(conditionAgrees(bs, conductiveEffectEntry), { ui: true, engine: true })
        assert.equal(buffUsableByEntry(bs, conductiveEffectEntry), true)
    })

    it('属性/类型对不上时两侧同样都判否（不是把过滤关掉）', () => {
        const wrongElement: BuffInstance = buff([condZone('deepenDmg', 15, { elements: ['热熔'] })])
        assert.deepEqual(conditionAgrees(wrongElement, conductiveEffectEntry), { ui: false, engine: false })
        const wrongType: BuffInstance = buff([condZone('deepenDmg', 15, { damageTypes: ['普攻伤害'] })])
        assert.deepEqual(conditionAgrees(wrongType, conductiveEffectEntry), { ui: false, engine: false })
    })

    it('处决/响应条目：按推断出的伤害类型判（谐度破坏 → 其它类型伤害）', () => {
        const otherType: BuffInstance = buff([condZone('finalDmg', 8, { damageTypes: ['其它类型伤害'] })])
        assert.deepEqual(conditionAgrees(otherType, tuneEntry), { ui: true, engine: true })
        const normalAttack: BuffInstance = buff([condZone('finalDmg', 8, { damageTypes: ['普攻伤害'] })])
        assert.deepEqual(conditionAgrees(normalAttack, tuneEntry), { ui: false, engine: false })
    })

    it('`buildDamageTypesByEntry` 必须覆盖非直伤条目（否则条件判定没有上下文）', () => {
        const map = buildDamageTypesByEntry([effectEntry, tuneEntry, directEntry], {}, {}, {})
        assert.deepEqual(map.get('eff'), ['效应伤害'], '效应结算 → 效应伤害')
        assert.deepEqual(map.get('tune'), ['其它类型伤害'], '处决 → 推断类型')
        assert.deepEqual(map.get('direct'), ['普攻伤害'], '直伤按技能类型兜底')
    })
})
