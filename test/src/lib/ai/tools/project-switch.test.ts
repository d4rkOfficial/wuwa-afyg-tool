import { test } from 'node:test'
import assert from 'node:assert/strict'
import { executeTool } from '$lib/ai/tools/registry'
import '$lib/ai/tools/project'
import { createProjectData, __seedProjectsForTest } from '$lib/data/project.svelte'
import { reloadActiveProjectStores } from '$lib/data/project-reload'
import { getOpBlocks } from '$lib/calc/timeline.store.svelte'
import type { Project } from '$lib/types/project'

const withOp = (name: string, key: string): Project => {
    const project = createProjectData(name)
    const timeline = {
        opBlocks: [{ id: `op-${key}`, trackIndex: 0, pos: 0, key, desc: '', intro: false, switchback: false }],
        refLines: [],
        damageBlocks: []
    }
    project.encounter.timeline.data = timeline
    project.phases.timeline.data = timeline
    return project
}

test('set_active_project 切换后立即重载排轴 store，不残留上一个工程', async () => {
    const first = withOp('切换测试 A', '普攻')
    const second = withOp('切换测试 B', '共鸣解放')
    __seedProjectsForTest([first, second], first.id)
    reloadActiveProjectStores()
    assert.equal(getOpBlocks()[0]?.key, '普攻')

    const result = JSON.parse(
        await executeTool({ onConfirm: async () => true }, 'set_active_project', { id: second.id })
    )
    assert.equal(result.ok, true)
    assert.equal(getOpBlocks()[0]?.key, '共鸣解放')
})
