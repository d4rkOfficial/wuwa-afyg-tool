// 内核的 id 一律支持 symbol：作用 / 引用来源 / 乘子 / 公式都用 symbol 时也要算出同样的数。
//
// 面板键是普通对象（`Record<PropertyKey, number>`），symbol 作键原生可用；
// 这里同时钉住「结果里的乘子 id 原样返回」与「转模能按 symbol 找到引用来源」。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { CoconutCore, type CharacterPanel, type GeneralTable } from '$coconut-core'
import { defineFormula } from '$coconut-core/formulas'

const ATK = Symbol('atk')
const ATK_FLAT = Symbol('atkFlat')
const ATK_PCT = Symbol('atkPct')
const RATE = Symbol('rate')
const RATE_PLUS_ONE = Symbol('ratePlusOne')
const FORMULA = Symbol('formula')

const ratePlusOne = defineFormula(
    { id: RATE_PLUS_ONE, inputs: [RATE] as const },
    (resolved) => 1 + resolved[RATE] / 100
)

const config = {
    actions: [
        {
            id: ATK,
            side: 'character' as const,
            combine: 'sum' as const,
            panel: { base: 'atk' },
            overridable: true,
            init: 0
        },
        {
            id: ATK_FLAT,
            side: 'character' as const,
            combine: 'sum' as const,
            panel: { flat: 'atk' },
            overridable: true,
            init: 0
        },
        {
            id: ATK_PCT,
            side: 'character' as const,
            combine: 'sum' as const,
            panel: { pct: 'atk' },
            overridable: true,
            init: 0
        },
        { id: RATE, side: 'character' as const, combine: 'sum' as const, overridable: true, init: 0 }
    ],
    refSources: [
        { id: ATK, get: (panel: CharacterPanel) => panel.total.atk },
        { id: RATE, get: (panel: CharacterPanel) => panel.zones[RATE] ?? 0 }
    ],
    multipliers: [ratePlusOne],
    formulas: [
        {
            id: FORMULA,
            base: { kind: 'panelStat' as const },
            chain: [ratePlusOne],
            critBase: 'panel'
        }
    ]
}

const tableOf = (effects: GeneralTable['buffs'][number]['effects']): GeneralTable => ({
    global_buffs: [],
    buffs: [{ id: 'gear', effects }],
    damage_entries: [
        { source: 'A', damages: [{ value: '100%', activated_buffs: ['gear'], element: '冷凝', formula: FORMULA }] }
    ]
})

const core = () => new CoconutCore().init(config)

describe('symbol id：作用 / 乘子 / 公式', () => {
    it('symbol 作 id 也能结算，乘子 id 原样返回', () => {
        const [damage] = core().compute(
            tableOf([
                { applyTo: ATK, value: '1000' },
                { applyTo: ATK_FLAT, value: '100' },
                { applyTo: ATK_PCT, value: '50' },
                { applyTo: RATE, value: '50' }
            ])
        ).damages

        assert.equal(damage!.panel.total.atk, 1600, '1000 + round(100 + 1000×50%)')
        assert.equal(damage!.panel.zones[RATE], 50, '面板 zones 用 symbol 键写入')
        assert.equal(damage!.baseValue, 1600)
        assert.equal(damage!.multipliers.length, 1)
        assert.equal(damage!.multipliers[0]!.id, RATE_PLUS_ONE, '乘子 id 不被字符串化')
        assert.equal(damage!.expected, 2400, '1600 × 1.5')
    })

    it('转模可以按 symbol 引用来源读数', () => {
        const [damage] = core().compute(
            tableOf([
                { applyTo: ATK, value: '1000' },
                { applyTo: RATE, value: '30' },
                {
                    applyTo: RATE,
                    value: {
                        refStat: ATK,
                        baseLine: 0,
                        sourceUnit: 'flat',
                        targetUnit: 'flat',
                        lowerLimit: 0,
                        Upperlimit: 5000
                    }
                }
            ])
        ).damages

        assert.equal(damage!.panel.zones[RATE], 1030, '追加 30 + 引用攻击 1000')
        assert.equal(damage!.expected, 1000 + 1000 * 10.3)
    })
})
