// 沙箱纯逻辑单测：可注入名判定、宿主能力遮蔽名单、脚本包装、返回值降级
// （Worker 本身在 node 里跑不起来，而这些恰恰是最容易写错的部分）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    RESERVED_SANDBOX_NAMES,
    SHADOWED_HOST_NAMES,
    buildScriptBody,
    formatLogLine,
    isInjectableToolName,
    safeStringify,
    toSerializable,
    truncateText
} from '$lib/ai/sandbox/format'

test('宿主能力遮蔽名单必须覆盖「能伸到 realm 外面去」的全部入口', () => {
    for (const name of [
        'fetch',
        'XMLHttpRequest',
        'WebSocket',
        'importScripts',
        'indexedDB',
        'caches',
        'postMessage',
        'addEventListener'
    ]) {
        assert.equal(SHADOWED_HOST_NAMES.includes(name), true, `${name} 必须被遮蔽`)
    }
    // indexedDB 是最要紧的一条：同源 IndexedDB 里存着 AI 配置，不遮就能读出来
    assert.equal(SHADOWED_HOST_NAMES.includes('indexedDB'), true)
})

test('isInjectableToolName：合法标识符且不在两个保留名单里才可注入', () => {
    assert.equal(isInjectableToolName('get_team'), true)
    assert.equal(isInjectableToolName('$weird'), true)
    for (const name of RESERVED_SANDBOX_NAMES) {
        assert.equal(isInjectableToolName(name), false, `${name} 是沙箱设施名，不得被工具占用`)
    }
    for (const name of SHADOWED_HOST_NAMES) {
        assert.equal(isInjectableToolName(name), false, `${name} 是宿主能力名，不得被工具占用`)
    }
    for (const bad of ['a-b', '1abc', 'has space', '', '中文名']) {
        assert.equal(isInjectableToolName(bad), false, `${bad} 不是合法标识符，只能走 tools 命名空间`)
    }
})

test('web_fetch 按工具名原样注入（合法标识符，不占用沙箱设施名）', () => {
    assert.equal(isInjectableToolName('web_fetch'), true)
    assert.equal(RESERVED_SANDBOX_NAMES.includes('web_fetch'), false)
})

test('buildScriptBody：严格模式 + async IIFE，脚本内可用顶层 await 与 return', () => {
    const body = buildScriptBody('return await get_team({})')
    assert.equal(
        body.startsWith('"use strict";'),
        true,
        '严格模式下 (function(){return this})() 得到 undefined 而非真全局'
    )
    assert.equal(body.includes('async () =>'), true)
    assert.equal(body.includes('return await get_team({})'), true)
})

test('toSerializable：函数 / 符号 / BigInt / Error 降级为可读占位', () => {
    assert.equal(
        toSerializable(() => 1),
        '[Function anonymous]'
    )
    assert.equal(typeof toSerializable(Symbol('s')), 'string')
    assert.equal(toSerializable(10n), '10n')
    assert.deepEqual(toSerializable(new TypeError('boom')), { name: 'TypeError', message: 'boom' })
    assert.equal(toSerializable(NaN), 'NaN', 'NaN 不能序列化成 null 而不留痕迹')
})

test('toSerializable：环引用有界，但超深嵌套完整保留（不按深度截断）', () => {
    const cyclic: Record<string, unknown> = { name: 'root' }
    cyclic.self = cyclic
    assert.equal((toSerializable(cyclic) as Record<string, unknown>).self, '[循环引用]')

    let deep: unknown = 'leaf'
    for (let i = 0; i < 30; i++) deep = { next: deep }
    const json = safeStringify(toSerializable(deep))
    assert.equal(json.includes('"[嵌套过深]"'), false, '不应再按深度丢弃原始数据')
    assert.equal(json.includes('"leaf"'), true, '深层叶子必须完整保留')
})

test('toSerializable：Map / Set 转成带标记的普通结构', () => {
    assert.deepEqual(toSerializable(new Map([['a', 1]])), { '[Map]': [['a', 1]] })
    assert.deepEqual(toSerializable(new Set([1, 2])), { '[Set]': [1, 2] })
})

test('toSerializable：null / undefined 都归一成 null', () => {
    assert.equal(toSerializable(null), null)
    assert.equal(toSerializable(undefined), null)
})

test('truncateText：超长才截断，并说明截掉多少', () => {
    assert.deepEqual(truncateText('abc', 5), { text: 'abc', truncated: false })
    const out = truncateText('abcdefgh', 3)
    assert.equal(out.truncated, true)
    assert.equal(out.text.startsWith('abc'), true)
    assert.equal(out.text.includes('已截断 5 字符'), true)
})

test('formatLogLine：非字符串先 JSON 化，单行不预截断（总长度交给日志预算）', () => {
    assert.equal(formatLogLine('纯文本'), '纯文本')
    assert.equal(formatLogLine({ a: 1 }), '{"a":1}')
    assert.equal(formatLogLine('x'.repeat(600)).length, 600)
})

test('safeStringify：BigInt 与环引用都不抛错', () => {
    // JSON.stringify(BigInt) 是**抛错**的，故这里走兜底 String()
    assert.equal(safeStringify(1n), '1')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    assert.equal(typeof safeStringify(cyclic), 'string')
})
