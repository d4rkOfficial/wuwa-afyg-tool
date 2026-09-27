// 标准14词条生成单测（纯函数，不联网）
// 运行：node --import ./scripts/test/preload.mjs src/lib/calc/standard-substats.test.ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildStandardSlots, planSubstatTotal, type StandardPlanInput } from './standard-substats'
import type { EchoSlotConfig } from './config.types'

const allSubstats = (slots: EchoSlotConfig[]) => slots.flatMap((s) => s.substats)
const substatTypes = (slots: EchoSlotConfig[]) => allSubstats(slots).map((s) => s.type)
const valuesOf = (slots: EchoSlotConfig[], type: string) =>
    allSubstats(slots)
        .filter((s) => s.type === type)
        .map((s) => `${s.value}${s.unit}`)

describe('buildStandardSlots', () => {
    it('无标签：仍是 5 暴击 + 5 暴伤 + 2 百分比 + 2 固定值，主词条按固有属性取', () => {
        const slots = buildStandardSlots({ element: '导电' })
        assert.equal(planSubstatTotal(slots), 14)
        assert.equal(slots[0].mainStat?.type, '暴击伤害') // 固有属性不含暴击率
        assert.equal(slots[1].mainStat?.type, '导电伤害加成')
        assert.equal(valuesOf(slots, '攻击').length, 2)
        assert.deepEqual(valuesOf(slots, '攻击'), ['40', '40']) // 中位档
        assert.deepEqual(valuesOf(slots, '暴击率'), ['8.1%', '8.1%', '8.1%', '8.1%', '8.1%'])
    })

    it('带「普攻伤害」标签：两条固定值换成 8.6% 普攻伤害加成，总数仍 14', () => {
        const slots = buildStandardSlots({ element: '导电', tags: [{ name: '普攻伤害' }] })
        assert.equal(planSubstatTotal(slots), 14)
        assert.deepEqual(valuesOf(slots, '普攻伤害加成'), ['8.6%', '8.6%'])
        assert.equal(substatTypes(slots).includes('攻击'), false)
    })

    it('带两个伤害标签：各占一条固定值位，顺序按普攻→重击→共鸣技能→共鸣解放', () => {
        const slots = buildStandardSlots({
            element: '导电',
            tags: [{ name: '共鸣解放伤害' }, { name: '重击伤害' }]
        })
        assert.equal(planSubstatTotal(slots), 14)
        const bonus = allSubstats(slots)
            .filter((s) => s.type.endsWith('伤害加成'))
            .map((s) => s.type)
        assert.deepEqual(bonus, ['重击伤害加成', '共鸣解放伤害加成'])
    })

    it('生命族角色带伤害标签：大生命保留，两条固定值换成伤害加成', () => {
        const slots = buildStandardSlots({
            element: '湮灭',
            statNodes: [{ name: '生命提升', desc: '生命提升' }],
            tags: [{ name: '共鸣技能伤害' }]
        })
        assert.equal(planSubstatTotal(slots), 14)
        assert.equal(valuesOf(slots, '生命%').length, 2)
        assert.equal(substatTypes(slots).includes('生命'), false)
        assert.deepEqual(valuesOf(slots, '共鸣技能伤害加成'), ['8.6%', '8.6%'])
    })

    it('无关标签（生存治疗/快速协奏）不触发替换', () => {
        const input: StandardPlanInput = {
            element: '衍射',
            tags: [{ name: '生存治疗' }, { name: '快速协奏' }, { name: '牵引' }]
        }
        const slots = buildStandardSlots(input)
        assert.deepEqual(valuesOf(slots, '攻击'), ['40', '40'])
    })
})
