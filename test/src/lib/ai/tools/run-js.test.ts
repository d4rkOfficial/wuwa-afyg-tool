// run_js 工具单测：**两条路径的权限差别**是安全边界，必须钉住
// （沙箱路径注入工具并桥回 executeTool；真 window 路径不注入任何工具）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defineTool, executeTool } from '$lib/ai/tools/registry'
import type { RunScriptFn, RunScriptRequest } from '$lib/ai/sandbox/protocol'
// 副作用 import：完成 run_js 注册
import '$lib/ai/tools/run-js'

/** @desc 探针工具：用来验证沙箱里的工具名清单与「工具调用真的落到 executeTool 上」 */
defineTool('__runjs_probe', {
    description: '探针',
    parameters: { type: 'object', properties: {} },
    handler: (args) => ({ echoed: args.value ?? null })
})

interface Output {
    ok: boolean
    data?: unknown
    error?: string
}

const parse = (raw: string): Output => JSON.parse(raw) as Output

test('run_js：沙箱路径注入工具名（排除 run_js 自身）并把调用桥回真正的 executeTool', async () => {
    // 用数组承载而不是 `let seen = null`：TS 不对「闭包内赋值」做流分析，
    // `assert.ok(seen)` 会把类型收窄成 `never`（实测 7 处报错都来自这个写法）
    const seen: RunScriptRequest[] = []
    const sandboxRun: RunScriptFn = async (request) => {
        seen.push(request)
        // 用注入的桥调一个真工具：这条断言就是「脚本里的工具调用不会被绕过」的证据
        const raw = await request.invoke?.('__runjs_probe', { value: 42 })
        assert.equal(raw, JSON.stringify({ ok: true, data: { echoed: 42 } }))
        return { ok: true, value: '结果', logs: ['一行日志'] }
    }

    const out = parse(await executeTool({ sandboxRun }, 'run_js', { code: 'return 1' }))
    assert.equal(out.ok, true)
    assert.deepEqual(out.data, { value: '结果', logs: ['一行日志'] })

    assert.equal(seen.length, 1, '沙箱运行器应被调用一次')
    const captured = seen[0]
    assert.equal(captured.source, 'return 1')
    assert.equal(captured.toolNames?.includes('__runjs_probe'), true)
    assert.equal(captured.toolNames?.includes('run_js'), false, 'run_js 自身不能注入，否则脚本可递归开新沙箱')
    assert.equal(typeof captured.invoke, 'function')
})

test('run_js：真 window 路径只给脚本文本，**不注入工具、不给调用桥**', async () => {
    const seen: RunScriptRequest[] = []
    const windowRun: RunScriptFn = async (request) => {
        seen.push(request)
        return { ok: true, value: 'window 结果', logs: [] }
    }

    const out = parse(await executeTool({ windowRun }, 'run_js', { code: 'return window.location.href' }))
    assert.equal(out.ok, true)
    assert.equal(seen.length, 1)
    const captured = seen[0]
    assert.equal(captured.source, 'return window.location.href')
    assert.equal(captured.toolNames, undefined, '真 window 路径不注入工具')
    assert.equal(captured.invoke, undefined, '真 window 路径不给工具调用桥')
})

test('run_js：两种运行器同时存在时优先走沙箱（更严的那条）', async () => {
    const used: string[] = []
    const out = parse(
        await executeTool(
            {
                sandboxRun: async () => {
                    used.push('sandbox')
                    return { ok: true, value: 1, logs: [] }
                },
                windowRun: async () => {
                    used.push('window')
                    return { ok: true, value: 2, logs: [] }
                }
            },
            'run_js',
            { code: 'return 1' }
        )
    )
    assert.equal(out.ok, true)
    assert.deepEqual(used, ['sandbox'])
})

test('run_js：两条运行器都没有时明确报错（不静默成功、不降级到真 window）', async () => {
    const out = parse(await executeTool({}, 'run_js', { code: 'return 1' }))
    assert.equal(out.ok, false)
    assert.equal(out.error?.includes('不支持 run_js'), true)
})

test('run_js：缺少 code 时报错', async () => {
    const out = parse(await executeTool({ windowRun: async () => ({ ok: true, value: null, logs: [] }) }, 'run_js', {}))
    assert.equal(out.ok, false)
})

test('run_js：脚本失败时 ok:false，并把脚本日志一并带出（排障要用）', async () => {
    const sandboxRun: RunScriptFn = async () => ({
        ok: false,
        error: 'TypeError: x is not a function',
        logs: ['先输出了这一行']
    })
    const out = parse(await executeTool({ sandboxRun }, 'run_js', { code: 'x()' }))
    assert.equal(out.ok, false)
    assert.equal(out.error?.includes('TypeError'), true)
    assert.equal(out.error?.includes('先输出了这一行'), true, '失败时日志不能丢')
})
