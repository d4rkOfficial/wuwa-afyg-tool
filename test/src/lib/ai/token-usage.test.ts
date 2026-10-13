// 吞吐与回合汇总文案单测：本轮新增的 `throughputTps` / `formatThroughput`，以及 `summarizeTurn` 的拼接口径
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    contextUsageRatio,
    emptySessionUsageTotals,
    emptyUsageTotals,
    formatThroughput,
    summarizeTurn,
    throughputTps,
    type TurnSummary,
    type UsageTotals
} from '$lib/ai/token-usage'

const usageWith = (patch: Partial<UsageTotals>): UsageTotals => ({ ...emptyUsageTotals(), requests: 1, ...patch })

test('throughputTps：completion ÷ 耗时换算成每秒', () => {
    // 400 token / 2000ms = 200 tok/s
    assert.equal(throughputTps({ completionTokens: 400 }, 2000), 200)
})

test('throughputTps：算不出时返回 null（不臆造）', () => {
    assert.equal(throughputTps({ completionTokens: 400 }, 0), null, '耗时为 0 不应产生 Infinity')
    assert.equal(throughputTps({ completionTokens: 400 }, -1), null, '负耗时不应产生负吞吐')
    assert.equal(throughputTps({ completionTokens: 0 }, 2000), null, '没有输出 token 不算吞吐')
})

test('formatThroughput：四舍五入到整数，null 显示「—」', () => {
    assert.equal(formatThroughput(200), '200 tok/s')
    assert.equal(formatThroughput(181.4), '181 tok/s')
    assert.equal(formatThroughput(0.6), '1 tok/s')
    assert.equal(formatThroughput(null), '—')
})

test('summarizeTurn：能算出吞吐时把它插在 completion 与缓存之间', () => {
    const summary: TurnSummary = {
        elapsedMs: 2000,
        toolCalls: 0,
        failedTools: 0,
        usage: usageWith({ promptTokens: 1000, completionTokens: 400, totalTokens: 1400 })
    }
    const text = summarizeTurn(summary)
    assert.equal(text.includes('200 tok/s'), true, `吞吐应出现在汇总里：${text}`)
    assert.equal(text.indexOf('completion') < text.indexOf('200 tok/s'), true, '吞吐应排在 completion 之后')
    assert.equal(text.indexOf('200 tok/s') < text.indexOf('缓存命中'), true, '吞吐应排在缓存命中之前')
})

test('summarizeTurn：没有请求时只有耗时（不出现 token / 吞吐 / 缓存）', () => {
    const text = summarizeTurn({ elapsedMs: 500, toolCalls: 0, failedTools: 0, usage: emptyUsageTotals() })
    assert.equal(text, '本轮：0.5s')
})

test('summarizeTurn：completion 为 0 时不显示吞吐', () => {
    const summary: TurnSummary = {
        elapsedMs: 1000,
        toolCalls: 1,
        failedTools: 0,
        usage: usageWith({ promptTokens: 500, completionTokens: 0, totalTokens: 500 })
    }
    const text = summarizeTurn(summary)
    assert.equal(text.includes('tok/s'), false, `不应出现吞吐：${text}`)
    assert.equal(text.includes('1 次工具调用'), true)
})

test('emptySessionUsageTotals：会话累计含轮次与步数，且都从 0 起', () => {
    const totals = emptySessionUsageTotals()
    assert.equal(totals.turns, 0)
    assert.equal(totals.steps, 0)
    assert.equal(totals.requests, 0)
})

test('contextUsageRatio：最近一次 prompt ÷ 上下文窗口', () => {
    assert.equal(contextUsageRatio(64_000, 128_000), 0.5)
    assert.equal(contextUsageRatio(0, 128_000), 0)
})

test('contextUsageRatio：分子缺失或窗口非正数时返回 null（不臆造分母）', () => {
    assert.equal(contextUsageRatio(undefined, 128_000), null)
    assert.equal(contextUsageRatio(100, 0), null, '窗口为 0 会让占用比变成 Infinity')
    assert.equal(contextUsageRatio(100, -1), null)
})

test('contextUsageRatio：超过窗口时钳到 1（圈不该画出界）', () => {
    assert.equal(contextUsageRatio(200_000, 128_000), 1)
    assert.equal(contextUsageRatio(128_001, 128_000), 1)
})

test('contextUsageRatio：恰好占满算 1', () => {
    assert.equal(contextUsageRatio(128_000, 128_000), 1)
})
