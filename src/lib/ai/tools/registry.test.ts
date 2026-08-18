// 工具注册表幂等性单测：HMR 重跑/多入口重复导入同一工具时不得产生同名重复定义
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defineTool, buildTools, executeTool } from './registry'

test('defineTool 重复注册同名工具时去重，且以后一次定义为准', async () => {
    defineTool('__dup_test', {
        description: '第一版',
        parameters: { type: 'object', properties: { a: { type: 'string' } } },
        handler: () => 'v1'
    })
    defineTool('__dup_test', {
        description: '第二版',
        parameters: { type: 'object', properties: { b: { type: 'string' } } },
        handler: () => 'v2'
    })

    const names = buildTools().map((t) => t.function.name)
    assert.equal(names.filter((n) => n === '__dup_test').length, 1)

    const def = buildTools().find((t) => t.function.name === '__dup_test')
    assert.equal(def?.function.description, '第二版')

    const result = await executeTool({}, '__dup_test', { b: 'x' })
    assert.deepEqual(JSON.parse(result), { ok: true, data: 'v2' })
})
