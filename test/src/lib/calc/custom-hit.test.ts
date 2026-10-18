// 自定义倍率串的单一格式化口径（界面与 AI 工具共用）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { customHitRatio } from '$lib/calc/custom-hit'

const hit = (patch: Partial<Parameters<typeof customHitRatio>[0]> = {}) => ({
    flatValue: 0,
    pctValue: 0,
    pctUnit: '攻击%',
    hits: 1,
    ...patch
})

test('customHitRatio：固定值 / 百分比逐项拼接', () => {
    assert.equal(customHitRatio(hit({ flatValue: 100 })), '100')
    assert.equal(customHitRatio(hit({ pctValue: 12.5 })), '12.5%')
    assert.equal(customHitRatio(hit({ flatValue: 100, pctValue: 20 })), '100+20%')
})

test('customHitRatio：百分比单位与段数后缀', () => {
    assert.equal(customHitRatio(hit({ pctValue: 10, pctUnit: '生命%' })), '10%生命')
    assert.equal(customHitRatio(hit({ pctValue: 10, pctUnit: '防御%' })), '10%防御')
    assert.equal(customHitRatio(hit({ pctValue: 10, pctUnit: '偏谐系数' })), '10%偏谐系数')
    assert.equal(customHitRatio(hit({ flatValue: 50, hits: 3 })), '50*3')
    assert.equal(customHitRatio(hit({ pctValue: 10, hits: 2 })), '10%*2')
})

test('customHitRatio：空值 / 0 / 负数不产生条目（没有可用值时为「」）', () => {
    assert.equal(customHitRatio(hit()), '')
    assert.equal(customHitRatio(hit({ flatValue: -1, pctValue: 0 })), '')
})
