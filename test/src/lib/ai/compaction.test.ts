// 上下文压缩单测：切分点的**配对安全**、拒绝压缩的条件、摘要消息形态与 token 统计
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    COMPACTION_KEEP_RECENT,
    COMPACTION_MIN_OLDER,
    SUMMARY_PREFIX,
    applyCompaction,
    buildSummaryMessage,
    planCompaction
} from '$lib/ai/compaction'
import type { ChatMessage } from '$lib/ai/client'

const m = (role: ChatMessage['role'], content: string): ChatMessage => ({ role, content })

/** @desc 一轮完整往返：用户 → 助手（带工具调用）→ 工具结果 */
const turn = (n: number): ChatMessage[] => [
    m('user', `用户第 ${n} 轮`),
    {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: `c${n}`, type: 'function', function: { name: 't', arguments: '{}' } }]
    },
    m('tool', `工具结果 ${n}`)
]

test('planCompaction：历史太短时拒绝（不足 MIN_OLDER 条不值得压）', () => {
    assert.equal(planCompaction([m('user', 'a'), m('assistant', 'b')]), null)
})

test('planCompaction：空历史返回 null', () => {
    assert.equal(planCompaction([]), null)
})

test('planCompaction：切点落在用户消息上，保留段不少于 keepRecent', () => {
    const messages = [
        m('user', 'u1'),
        m('assistant', 'a1'),
        m('user', 'u2'),
        m('assistant', 'a2'),
        m('user', 'u3'),
        m('assistant', 'a3')
    ]
    const plan = planCompaction(messages, 2)
    assert.ok(plan)
    assert.equal(plan.recent[0].role, 'user', '保留段必须从用户消息开始')
    assert.equal(plan.recent.length >= 2, true)
    assert.equal(plan.older.length + plan.recent.length, messages.length, '切分不能丢消息')
})

test('planCompaction：只要给出计划，保留段就一定从用户消息开始（配对安全的不变量）', () => {
    /*
     * 这是本模块最重要的安全性不变量：user 消息绝不会插在 assistant(tool_calls) 与它的 tool 结果之间，
     * 所以「保留段从 user 开始」等价于「没有拆散任何一次工具往返」。
     * 逐个 keepRecent 遍历，是因为不同取值会让目标切点落在不同角色上。
     */
    const messages = [...turn(1), ...turn(2), ...turn(3), ...turn(4)]
    let planned = 0
    for (let keep = 1; keep <= 10; keep++) {
        const plan = planCompaction(messages, keep)
        if (!plan) continue
        planned++
        assert.equal(plan.recent[0].role, 'user', `keepRecent=${keep} 时保留段应从用户消息开始`)
        const lastOlder = plan.older[plan.older.length - 1]
        assert.equal(
            !(lastOlder.role === 'assistant' && lastOlder.tool_calls),
            true,
            `keepRecent=${keep} 时 older 结尾不能是带 tool_calls 的 assistant（它的结果必须同在 older 里）`
        )
        assert.equal(plan.older.length + plan.recent.length, messages.length, `keepRecent=${keep} 时切分不能丢消息`)
    }
    assert.equal(planned > 0, true, '至少应有一个 keepRecent 能压（否则这条测试没验证到任何东西）')
})

test('planCompaction：切点之后没有用户消息时拒绝（无安全边界）', () => {
    // 全是工具往返，没有任何 user 可作为边界
    const messages = [...turn(1).slice(1), ...turn(2).slice(1), ...turn(3).slice(1)]
    assert.equal(planCompaction(messages, 2), null)
})

test('planCompaction：默认保留条数为 COMPACTION_KEEP_RECENT', () => {
    const messages: ChatMessage[] = []
    for (let i = 1; i <= 6; i++) messages.push(...turn(i))
    const plan = planCompaction(messages)
    assert.ok(plan)
    assert.equal(plan.recent.length >= COMPACTION_KEEP_RECENT, true)
    assert.equal(plan.older.length >= COMPACTION_MIN_OLDER, true)
})

test('buildSummaryMessage：产出 system 消息并带上摘要前缀', () => {
    const message = buildSummaryMessage('  摘要正文  ')
    assert.equal(message.role, 'system', '用 system 角色，避免被误认成用户或助手说过的话')
    assert.equal(message.content.startsWith(SUMMARY_PREFIX), true)
    assert.equal(message.content.includes('摘要正文'), true)
    assert.equal(message.content.includes('  '), false, '摘要首尾空白应被去掉')
})

test('applyCompaction：新历史 = 摘要消息 + 原样保留的最近消息', () => {
    const messages = [...turn(1), ...turn(2), ...turn(3)]
    const plan = planCompaction(messages, 3)
    assert.ok(plan)
    const applied = applyCompaction(messages, plan, '这是一段比原文短得多的摘要')
    assert.equal(applied.history.length, 1 + plan.recent.length)
    assert.equal(applied.history[0].role, 'system')
    assert.deepEqual(applied.history.slice(1), plan.recent, '保留段必须原样带过去')
    assert.equal(applied.summarizedCount, plan.older.length)
})

test('applyCompaction：真实规模的历史下确实变小', () => {
    // 真实历史里助手消息与工具返回都远长于摘要，用大段正文才不会让摘要前缀的固定开销盖过收益
    const big = (n: number) =>
        `第 ${n} 轮正文：${'这是一段足够长的工具返回内容，用来模拟真实历史上的规模。'.repeat(12)}`
    const messages: ChatMessage[] = []
    for (let i = 1; i <= 6; i++) messages.push(m('user', big(i)), m('assistant', big(i)), m('tool', big(i)))
    const plan = planCompaction(messages, 3)
    assert.ok(plan)
    const applied = applyCompaction(messages, plan, '短摘要')
    assert.equal(applied.tokensBefore > 0, true)
    assert.equal(
        applied.tokensAfter < applied.tokensBefore,
        true,
        `压缩后应更小：${applied.tokensAfter} < ${applied.tokensBefore}`
    )
})

test('applyCompaction：历史极短时压缩反而更大（摘要前缀是固定开销，这正是 MIN_OLDER 门槛的理由）', () => {
    // 绕过 planCompaction 的门槛直接构造：验证「门槛不是多余的」
    const messages = [...turn(1), ...turn(2)]
    const plan = { older: messages.slice(0, 3), recent: messages.slice(3) }
    const applied = applyCompaction(messages, plan, '短摘要')
    assert.equal(
        applied.tokensAfter > applied.tokensBefore,
        true,
        `极短历史下摘要前缀会盖过收益：${applied.tokensAfter} > ${applied.tokensBefore}`
    )
})
