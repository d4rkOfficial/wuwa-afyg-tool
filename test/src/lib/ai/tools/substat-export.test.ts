import { test } from 'node:test'
import assert from 'node:assert/strict'
import { executeTool } from '$lib/ai/tools/registry'
import '$lib/ai/tools/substat-library'
import { createProjectData, __seedProjectsForTest } from '$lib/data/project.svelte'
import { reloadActiveProjectStores } from '$lib/data/project-reload'
import { getSubstatPlans } from '$lib/data/substat-library.svelte'
import { buildStandardSlots, cloneSlots } from '$lib/calc/standard-substats'
import { defaultConfig } from '$lib/calc/config.consts'
import { init as initConfig } from '$lib/calc/config.store.svelte'
import type { EchoSlotConfig } from '$lib/calc/config.types'

const run = async (name: string, args: Record<string, unknown> = {}) =>
    JSON.parse(await executeTool({ onConfirm: async () => true }, name, args))

test('export_substat_plan 把当前声骸快照成可回滚方案，并避免静默覆盖', async () => {
    const project = createProjectData('词条快照测试')
    __seedProjectsForTest([project], project.id)
    reloadActiveProjectStores()
    // 角色在重载后再写入，避免预热角色数据触发测试环境里的网络请求
    project.team[0].character = '测试甲'

    const slots = buildStandardSlots({ element: '冷凝' })
    const config = defaultConfig()
    config.characters[0].echoes = cloneSlots(slots) as [
        EchoSlotConfig,
        EchoSlotConfig,
        EchoSlotConfig,
        EchoSlotConfig,
        EchoSlotConfig
    ]
    initConfig(config, false)

    const exported = await run('export_substat_plan', { character: '测试甲', name: '回滚快照' })
    assert.equal(exported.ok, true)
    assert.equal(exported.data.name, '回滚快照')
    assert.equal(exported.data.substatTotal, 14)
    assert.ok(getSubstatPlans().some((p) => p.character === '测试甲' && p.name === '回滚快照'))

    const list = await run('list_substat_plans')
    const listed = list.data.characters.find((c: { character: string }) => c.character === '测试甲')
    assert.equal(listed.planCount, 1)
    assert.deepEqual(listed.plans, [{ name: '回滚快照', cost: exported.data.cost, substatTotal: 14 }])

    // 同名不显式覆盖时必须报错，且原方案不被改写
    const again = await run('export_substat_plan', { character: '测试甲', name: '回滚快照' })
    assert.equal(again.ok, false)
    assert.match(again.error, /已存在/)

    assert.equal((await run('delete_substat_plan', { character: '测试甲', name: '回滚快照' })).ok, true)
})
