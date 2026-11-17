// `crit` 乘子的**等效暴击率**口径：面板原值一律保留（允许负值与 >100），
// 只有「算成暴击时的暴击率」被钳到 0–100 —— 低于 0 等价必不暴，高于 100 等价必暴。
//
// 面板留原值是「暴击超过 100 的部分转成暴击伤害」这类引用生效的前提：转模读的是 `zones.critRate`，
// 一旦在写入或重算处裁剪，这类 buff 的上限就再也读不到。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createCoconutCore, effectiveCritRate } from '$lib/calc/core-config'
import type { BuffEffect, GeneralTable } from '$coconut-core'

const core = createCoconutCore()

const tableOf = (effects: BuffEffect[]): GeneralTable => ({
    global_buffs: [],
    buffs: [{ id: 'gear', role: 'stat', effects }],
    damage_entries: [
        {
            source: '测试伤害',
            damages: [{ value: '100%', activated_buffs: ['gear'], element: '冷凝', formula: 'direct' }]
        }
    ]
})

/** @desc 暴击率按覆盖写入（面板基类条目上可覆盖），暴伤覆盖成 300% ⇒ 必暴时乘子为 3 倍暴伤比值 */
const effectsOf = (critRate: number, critDmg = 300): BuffEffect[] => [
    { applyTo: 'atkBase', value: '1000' },
    { applyTo: 'critRate', value: String(critRate), write: 'override' },
    { applyTo: 'critDmg', value: String(critDmg), write: 'override' }
]

const computeOf = (effects: BuffEffect[]) => {
    const [damage] = core.compute(tableOf(effects)).damages
    const crit = damage!.multipliers.find((zone) => zone.id === 'crit')!
    return { damage: damage!, critRate: damage!.panel.zones.critRate!, crit: crit.value }
}

const near = (actual: number, expected: number) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `期望 ${expected}，实际 ${actual}`)

describe('effectiveCritRate：等效暴击率钳在 0–100', () => {
    it('负值归 0、超过 100 归 100、区间内原样', () => {
        assert.equal(effectiveCritRate(-50), 0)
        assert.equal(effectiveCritRate(-0.5), 0)
        assert.equal(effectiveCritRate(0), 0)
        assert.equal(effectiveCritRate(37.5), 37.5)
        assert.equal(effectiveCritRate(100), 100)
        assert.equal(effectiveCritRate(150), 100)
    })
})

describe('暴击乘子：暴击率 < 0 按必不暴算', () => {
    it('暴击率 -50% ⇒ 乘子 1，期望等于不暴击', () => {
        const { damage, critRate, crit } = computeOf(effectsOf(-50))
        assert.equal(critRate, -50, '面板保留负值')
        assert.equal(crit, 1)
        assert.equal(damage.expected, damage.baseValue)
    })
})

describe('暴击乘子：暴击率 > 100 按必暴算', () => {
    it('暴击率 150% 与 100% 结果相同（暴伤 300% ⇒ 3 倍暴伤比值）', () => {
        const at150 = computeOf(effectsOf(150))
        const at100 = computeOf(effectsOf(100))
        assert.equal(at150.critRate, 150, '面板保留 >100 的原值')
        assert.equal(at150.crit, 3)
        assert.equal(at150.crit, at100.crit)
        assert.equal(at150.damage.expected, at100.damage.expected)
    })

    it('区间内按 1 + 暴击率 × (暴伤比值 - 1) 线性插值', () => {
        const { crit } = computeOf(effectsOf(40))
        near(crit, 1 + 0.4 * (3 - 1))
    })
})

describe('转模可读到 >100 的暴击率原值', () => {
    it('超过 100 的部分按引用加进暴伤，暴击区按加完后的暴伤算', () => {
        const { damage, critRate, crit } = computeOf([
            { applyTo: 'atkBase', value: '1000' },
            { applyTo: 'critRate', value: '145' },
            {
                applyTo: 'critDmg',
                value: {
                    refStat: 'critRate',
                    baseLine: 100,
                    sourceUnit: '%',
                    targetUnit: '%',
                    lowerLimit: 0,
                    Upperlimit: 1000
                }
            }
        ])
        assert.equal(critRate, 150, '基础 5% + 追加 145%')
        assert.equal(damage.panel.zones.critDmg, 200, '暴伤基准 150% + 超出的 50%')
        assert.equal(crit, 2, '暴伤 200% 的必暴乘子')
        assert.equal(damage.expected, damage.baseValue * 2)
    })
})
