// v9 → v10：**作用的条件能力位生效**（决议 D6 / D8）。
//
// 只有 `damageMatchable` 的作用才能挂「伤害匹配」条件（伤害属性 / 伤害类型）：
// 热熔加成 / 热熔暴击率成立，热熔共鸣效率 / 热熔集谐层数 / 热熔同奏层数不成立。
// 清理由幂等的 `normalizeZones` 在每次载入时完成，因此这里直接断言归一化结果。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeZones } from '$src/migration'
import type { BuffInstance } from '$coconut/engine/calculation.types'

const zonesOf = (zones: unknown[]) => normalizeZones({ id: 'b1', name: '测试', zones } as Partial<BuffInstance>)

describe('v10：作用的条件能力位', () => {
    it('可挂条件的作用保留条件（加成 / 暴击率）', () => {
        const out = zonesOf([
            { zoneId: 'bonusDmg', value: 20, condition: { elements: ['热熔'] } },
            { zoneId: 'critRate', value: 10, condition: { damageTypes: ['普攻伤害'] } }
        ])
        assert.deepEqual(out[0]!.condition, { elements: ['热熔'] })
        assert.deepEqual(out[1]!.condition, { damageTypes: ['普攻伤害'] })
    })

    it('不可挂条件的作用丢弃条件（共鸣效率 / 集谐层数 / 同奏层数 / 攻击%）', () => {
        const out = zonesOf([
            { zoneId: 'recharge', value: 10, condition: { elements: ['热熔'] } },
            { zoneId: 'tuneStrainLayer', value: 3, condition: { elements: ['热熔'] } },
            { zoneId: 'unisonBoonLayer', value: 2, condition: { damageTypes: ['普攻伤害'] } },
            { zoneId: 'atkPct', value: 20, condition: { elements: ['热熔'] } }
        ])
        for (const zone of out) assert.equal(zone.condition, undefined, `${zone.zoneId} 不该带条件`)
        assert.equal(out.length, 4, '数值本身必须保留')
    })

    it('Buff 级条件下放到不可挂条件的乘区时同样被丢弃', () => {
        const out = normalizeZones({
            id: 'b2',
            name: '测试',
            condition: { elements: ['热熔'] },
            zones: [{ zoneId: 'recharge', value: 10 }]
        } as Partial<BuffInstance>)
        assert.equal(out[0]!.condition, undefined)
    })
})
