// 思考强度档位纯逻辑单测：档位收窄、`off` 的「省略参数」语义、文案完整性
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    THINKING_LABELS,
    THINKING_LEVELS,
    coerceThinkingLevel,
    isThinkingLevel,
    thinkingLabel,
    toReasoningEffort
} from '$lib/ai/thinking'

test('THINKING_LEVELS：档位齐全且顺序由弱到强', () => {
    assert.deepEqual([...THINKING_LEVELS], ['off', 'low', 'medium', 'high'])
})

test('isThinkingLevel：只认四个合法档位', () => {
    for (const level of THINKING_LEVELS) assert.equal(isThinkingLevel(level), true)
    // pi-ai 有 xhigh/max/minimal，本应用刻意不引入（服务商支持面不确定），必须判定为非法
    for (const bad of ['xhigh', 'max', 'minimal', '', 'OFF', null, undefined, 3, {}, []]) {
        assert.equal(isThinkingLevel(bad), false, `${String(bad)} 不应被判为合法档位`)
    }
})

test('coerceThinkingLevel：合法值原样返回', () => {
    for (const level of THINKING_LEVELS) assert.equal(coerceThinkingLevel(level), level)
})

test('coerceThinkingLevel：非法/缺失一律回落 medium（老数据兼容的读盘口径）', () => {
    // `medium` 是新增 `off` 档之前 `config.svelte.ts` 的既有容错目标，不能改变
    for (const bad of [undefined, null, '', 'xhigh', 'LOW', 0, 42, {}, [], true]) {
        assert.equal(coerceThinkingLevel(bad), 'medium', `${String(bad)} 应回落 medium`)
    }
})

test('toReasoningEffort：off 表示省略参数，其余原样透传', () => {
    assert.equal(toReasoningEffort('off'), undefined)
    assert.equal(toReasoningEffort('low'), 'low')
    assert.equal(toReasoningEffort('medium'), 'medium')
    assert.equal(toReasoningEffort('high'), 'high')
})

test('toReasoningEffort：只有 off 会产生 undefined（协议层据此省略字段）', () => {
    const undefinedLevels = THINKING_LEVELS.filter((level) => toReasoningEffort(level) === undefined)
    assert.deepEqual([...undefinedLevels], ['off'])
})

test('每个档位都有文案，且不重复', () => {
    const labels = THINKING_LEVELS.map((level) => thinkingLabel(level))
    assert.equal(
        labels.every((label) => label.length > 0),
        true
    )
    assert.equal(new Set(labels).size, labels.length, '档位文案不应重复，否则用户分不清')
    for (const level of THINKING_LEVELS) assert.equal(thinkingLabel(level), THINKING_LABELS[level])
})
