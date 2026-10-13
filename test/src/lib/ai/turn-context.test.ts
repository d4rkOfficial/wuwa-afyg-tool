// 工作摘要分段单测：该段是「每轮先更新摘要」这条产品要求的载体，**必须无条件注入**
// （空摘要时若跳过整段，模型第一次就永远不知道该写摘要）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTurnSegments, renderWorkSummaryMessage, segmentsToMessages } from '$lib/ai/turn-context'

test('renderWorkSummaryMessage：空摘要时要求「本轮先写一条」且点名工具', () => {
    const text = renderWorkSummaryMessage('')
    assert.equal(text.includes('set_work_summary'), true, '必须点名工具，否则模型不知道用哪个')
    assert.equal(text.includes('目前还没有摘要'), true)
    assert.equal(text.includes('上一轮的摘要'), false)
})

test('renderWorkSummaryMessage：有摘要时带上上一轮内容，供模型修订而非盲目重写', () => {
    const text = renderWorkSummaryMessage('给椿配装，正在对比两把武器')
    assert.equal(text.includes('给椿配装，正在对比两把武器'), true)
    assert.equal(text.includes('目前还没有摘要'), false)
})

test('buildTurnSegments：工作摘要段无条件注入，且空摘要时也带一条 system 消息', () => {
    const segments = buildTurnSegments({ systemPrompt: '人设' })
    const segment = segments.find((s) => s.id === 'workSummary')
    assert.ok(segment, '没有 workSummary 段')
    assert.equal(segment.messages.length, 1, '空摘要也必须产生 system 消息')
    assert.equal(segment.messages[0].role, 'system')
    assert.equal(segment.text.length > 0, true)
})

test('buildTurnSegments：分段顺序固定为 人设 → 当前状态 → 工作摘要 → 变化队列', () => {
    const ids = buildTurnSegments({ systemPrompt: '人设', context: '工程 A' }).map((s) => s.id)
    assert.deepEqual(ids, [
        'persona',
        'passiveSkills',
        'activeSkills',
        'context',
        'workSummary',
        'changes',
        'history',
        'user'
    ])
})

test('segmentsToMessages：工作摘要段可像其它段一样被临时禁用（禁用后不再要求 AI 维护摘要）', () => {
    const segments = buildTurnSegments({ systemPrompt: '人设' })
    const messages = segmentsToMessages(segments, ['workSummary'])
    assert.equal(
        messages.some((m) => typeof m.content === 'string' && m.content.includes('set_work_summary')),
        false
    )
})
