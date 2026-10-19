// 锁定环节的写工具必须在执行前返回明确错误，不能把 store 的静默 no-op 报成 ok:true
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { executeTool } from '$lib/ai/tools/registry'
import { createProjectData, __seedProjectsForTest } from '$lib/data/project.svelte'
import '$lib/ai/tools/calculation'

test('环节锁定时写工具返回可读错误（不会静默成功）', async () => {
    const project = createProjectData('锁定测试工程')
    project.encounter.calculation.locked = true
    __seedProjectsForTest([project], project.id)
    try {
        const out = JSON.parse(await executeTool({}, 'create_buff_conf', { name: '锁定测试' })) as {
            ok: boolean
            error?: string
        }
        assert.equal(out.ok, false)
        assert.match(out.error ?? '', /锁定/)
        assert.match(out.error ?? '', /拉表/)
    } finally {
        __seedProjectsForTest([], '')
    }
})

test('解锁后同一写工具不再被锁定守卫拦截', async () => {
    const project = createProjectData('解锁测试工程')
    project.encounter.calculation.locked = false
    __seedProjectsForTest([project], project.id)
    try {
        const out = JSON.parse(await executeTool({}, 'create_buff_conf', { name: '解锁测试' })) as {
            ok: boolean
            error?: string
        }
        assert.doesNotMatch(out.error ?? '', /环节已锁定/)
    } finally {
        __seedProjectsForTest([], '')
    }
})
