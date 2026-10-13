// set_work_summary 工具单测：它是 AI 维护悬浮窗大标题摘要的唯一入口
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { executeTool } from '$lib/ai/tools/registry'
import { getWorkSummary } from '$lib/ai/turn-state.svelte'
// 副作用 import：完成工具注册
import '$lib/ai/tools/ai-session'

interface RunOutput {
    ok: boolean
    data?: { summary: string; cleared: boolean }
    error?: string
}

const run = async (args: Record<string, unknown>): Promise<RunOutput> =>
    JSON.parse(await executeTool({}, 'set_work_summary', args)) as RunOutput

test('set_work_summary：写入摘要，并同时落到界面标题所读的会话状态', async () => {
    const out = await run({ summary: '给椿配装，正在对比两把武器' })
    assert.equal(out.ok, true)
    assert.equal(out.data?.summary, '给椿配装，正在对比两把武器')
    assert.equal(out.data?.cleared, false)
    assert.equal(getWorkSummary(), '给椿配装，正在对比两把武器')
})

test('set_work_summary：去掉首尾空白（避免标题里出现多余空格）', async () => {
    const out = await run({ summary: '  排轴：调整第 3 段  ' })
    assert.equal(out.data?.summary, '排轴：调整第 3 段')
    assert.equal(getWorkSummary(), '排轴：调整第 3 段')
})

test('set_work_summary：纯空白视为清空', async () => {
    await run({ summary: '先写上' })
    const out = await run({ summary: '   ' })
    assert.equal(out.ok, true)
    assert.equal(out.data?.cleared, true)
    assert.equal(getWorkSummary(), '')
})

test('set_work_summary：缺参数按清空处理，不抛错（返回 ok 而不是让回合失败）', async () => {
    await run({ summary: '先写上' })
    const out = await run({})
    assert.equal(out.ok, true)
    assert.equal(getWorkSummary(), '')
})
