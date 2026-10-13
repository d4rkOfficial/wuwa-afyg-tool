// 上下文窗口归一化单测：数据来源是用户手填（服务商不下发窗口大小），故容错必须严格
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CONTEXT_WINDOW, coerceContextWindow } from '$lib/ai/config.svelte'

test('coerceContextWindow：区间内的数值取整保留', () => {
    assert.equal(coerceContextWindow(128_000), 128_000)
    assert.equal(coerceContextWindow(200_000), 200_000)
    assert.equal(coerceContextWindow(1_000), 1_000, '下限应被接受')
    assert.equal(coerceContextWindow(10_000_000), 10_000_000, '上限应被接受')
    // 小数取整（输入框是文本，用户可能贴进带小数的值）
    assert.equal(coerceContextWindow(128_000.6), 128_001)
})

test('coerceContextWindow：缺失 / 非数一律回落默认', () => {
    for (const bad of [undefined, null, NaN, Infinity, -Infinity, '128000', {}, [], true]) {
        assert.equal(coerceContextWindow(bad), DEFAULT_CONTEXT_WINDOW, `${String(bad)} 应回落默认`)
    }
})

test('coerceContextWindow：越界回落默认（0 会让用量圈分母为 0）', () => {
    assert.equal(coerceContextWindow(0), DEFAULT_CONTEXT_WINDOW)
    assert.equal(coerceContextWindow(-1), DEFAULT_CONTEXT_WINDOW)
    assert.equal(coerceContextWindow(999), DEFAULT_CONTEXT_WINDOW, '低于 1k 视为误填')
    assert.equal(coerceContextWindow(10_000_001), DEFAULT_CONTEXT_WINDOW, '高于 10M 视为误填')
})

test('DEFAULT_CONTEXT_WINDOW 自身必须是合法值（否则默认值兜底会自相矛盾）', () => {
    assert.equal(coerceContextWindow(DEFAULT_CONTEXT_WINDOW), DEFAULT_CONTEXT_WINDOW)
})
