// 交换格式编解码：字符串值（带 `%` 即百分比）只出现在导出边界。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { decodeBuff, decodeEffect, decodeValue, encodeBuff, encodeEffect, encodeValue } from '$lib/calc/core/codec'
import type { BuffInstance } from '$lib/calc/calculation.types'

describe('交换格式：数值字符串 ↔ 数值 + 单位', () => {
    it('带 % 即百分比，不带即固定值', () => {
        assert.deepEqual(decodeValue('25%'), { value: 25, unit: '%' })
        assert.deepEqual(decodeValue('25'), { value: 25, unit: 'flat' })
        assert.deepEqual(decodeValue(' 1.5% '), { value: 1.5, unit: '%' })
    })

    it('无法解析的数值按 0（不把 NaN 漏进引擎）', () => {
        assert.equal(decodeValue('abc').value, 0)
        assert.equal(decodeValue('%').value, 0)
    })

    it('encode 按单位补 %（往返一致）', () => {
        assert.equal(encodeValue(25, '%'), '25%')
        assert.equal(encodeValue(25, 'flat'), '25')
        assert.deepEqual(decodeValue(encodeValue(12.5, '%')), { value: 12.5, unit: '%' })
    })
})

describe('交换格式：作用条目往返', () => {
    it('百分比作用带 %、固定值作用不带', () => {
        assert.equal(encodeEffect({ zoneId: 'atkPct', value: 30 }).value, '30%')
        assert.equal(encodeEffect({ zoneId: 'tuneBreakBoost', value: 40 }).value, '40')
    })

    it('引用（转模）原样保留；引用目标不在注册表则整条丢弃', () => {
        const ref = { characterIdx: 0, zoneId: 'totalAtk', threshold: 2000, pct: 10 }
        const encoded = encodeEffect({ zoneId: 'atkPct', value: 0, ref })
        assert.deepEqual(encoded.value, { ref })
        assert.deepEqual(decodeEffect(encoded)?.ref, ref)

        const bogus = { key: 'atkPct', value: { ref: { ...ref, zoneId: '不存在的来源' } } }
        assert.equal(decodeEffect(bogus), null, '未知引用来源必须丢弃')
    })

    it('未知作用 id 丢弃（脏数据不进引擎）', () => {
        assert.equal(decodeEffect({ key: '不存在的乘区', value: '10%' }), null)
    })

    it('覆盖与条件往返保留', () => {
        const zone = { zoneId: 'critRate' as const, value: 50, override: true, condition: { elements: ['冷凝'] } }
        assert.deepEqual(decodeEffect(encodeEffect(zone)), zone)
    })
})

describe('交换格式：Buff 往返', () => {
    it('多作用列表逐项等价', () => {
        const buff: BuffInstance = {
            id: 'b1',
            name: '文件夹\\加成',
            zones: [
                { zoneId: 'bonusDmg', value: 40 },
                { zoneId: 'tuneStrainLayer', value: 3 },
                { zoneId: 'critRate', value: 20, condition: { damageTypes: ['普攻伤害'] } }
            ],
            scope: [0, 1]
        }
        const roundTripped = decodeBuff(encodeBuff(buff))
        assert.deepEqual(roundTripped.zones, buff.zones)
        assert.equal(roundTripped.name, buff.name)
        assert.deepEqual(roundTripped.scope, [0, 1])
    })
})
