// 长任务模式纯逻辑单测：自动继续的判定与续写提示词是无限循环风险的源头，必须钉住
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LONG_TASK_TOOL_NAME, buildLongTaskContinuation, canAutoContinue } from '$lib/ai/long-task'

test('canAutoContinue：必须同时满足「开着 / 未中止 / 还有轮次预算」', () => {
    assert.equal(canAutoContinue({ active: true, aborted: false, nextRound: 1, maxRounds: 3 }), true)
    assert.equal(canAutoContinue({ active: false, aborted: false, nextRound: 1, maxRounds: 3 }), false)
    assert.equal(canAutoContinue({ active: true, aborted: true, nextRound: 1, maxRounds: 3 }), false)
    // nextRound 等于上限 = 预算已用尽（不能用 <=，否则会多请求一轮）
    assert.equal(canAutoContinue({ active: true, aborted: false, nextRound: 3, maxRounds: 3 }), false)
})

test('buildLongTaskContinuation：点名关闭工具、带续写次数与目标，并要求不重复已完成工作', () => {
    const text = buildLongTaskContinuation(2, '给椿配装')
    assert.match(text, /第 2 次/)
    assert.match(text, new RegExp(LONG_TASK_TOOL_NAME))
    assert.match(text, /给椿配装/)
    assert.match(text, /不要重复已完成/)
    assert.match(text, /enabled=false/)
})

test('buildLongTaskContinuation：没有目标时不留空行占位', () => {
    const text = buildLongTaskContinuation(1, '   ')
    assert.equal(text.includes('当前任务目标'), false)
    assert.equal(text.includes('\n\n\n'), false)
})
