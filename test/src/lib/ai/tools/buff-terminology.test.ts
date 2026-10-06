import { test } from 'node:test'
import assert from 'node:assert/strict'
import { availableTools, buildTools, executeTool } from '$lib/ai/tools/registry'
import '$lib/ai/tools/project'
import '$lib/ai/tools/calculation'
import '$lib/ai/tools/buff-set'
import '$lib/ai/tools/buff-generate'
import '$lib/ai/tools/panels'
import '$lib/ai/tools/ask-user'
import { registerPanel, unregisterPanel } from '$lib/ai/panels.svelte'
import { createProjectData, __seedProjectsForTest, getActiveProject } from '$lib/data/project.svelte'
import { init, getAllBuffConfs } from '$lib/calc/calculation.store.svelte'
import { updateEntityBuffs, getBuffEntities } from '$lib/data/buff-library.svelte'
import {
    createBuffSetDataSource,
    createProjectDataSource,
    executeGenerateTool,
    GENERATE_TOOLS
} from '$lib/ai/generate/tools'

const setup = () => {
    const project = createProjectData('Buff 术语回归')
    __seedProjectsForTest([project], project.id)
    init(project.team, null, null, false, () => {})
    return project
}
const run = async (name: string, args: Record<string, unknown> = {}) =>
    JSON.parse(await executeTool({ onConfirm: async () => true }, name, args))

test('AI 与 WS 共用新 Buff 工具名称，工程参数使用 buffConf', () => {
    const all = buildTools()
    assert.equal(
        all.some((t) => /buff_library|^(get_buff_sets|create_buff_set|delete_buff_set)$/.test(t.function.name)),
        false
    )
    for (const name of [
        'get_buff_confs',
        'create_buff_conf',
        'delete_buff_conf',
        'get_buff_conf_detail',
        'bind_buff_conf_to_entry',
        'list_buff_set_entities',
        'get_buff_set_entity_buffs',
        'sync_buff_set_from_share',
        'get_buff_set_summary',
        'generate_project_buff_confs'
    ]) {
        assert.ok(
            availableTools({}).some((t) => t.function.name === name),
            name
        )
    }
    for (const tool of all) {
        assert.doesNotMatch(JSON.stringify(tool), /Buff\s*库|Buff\s+Library/i)
        assert.equal(Object.hasOwn(tool.function.parameters.properties ?? {}, 'buffSet'), false, tool.function.name)
    }
    for (const name of ['rename_buff_conf', 'delete_buff_conf', 'set_buff_conf_zone', 'set_buff_conf_scope']) {
        const tool = all.find((t) => t.function.name === name)!
        assert.ok(Object.hasOwn(tool.function.parameters.properties as object, 'buffConf'))
        assert.match(tool.function.description, /工程 Buff 配置/)
    }
    assert.ok(GENERATE_TOOLS.some((t) => t.function.name === 'get_existing_buffs'))
    assert.equal(
        GENERATE_TOOLS.some((t) => t.function.name === 'get_buff_sets'),
        false
    )
})

test('工程 Buff 配置增删使用新参数和摘要，不写入主页 Buff 集', async () => {
    setup()
    const before = JSON.stringify(getBuffEntities())
    const created = await run('create_buff_conf', { name: '回归增益' })
    assert.equal(created.ok, true)
    assert.equal(created.data.buffConf, 1)
    assert.ok((await run('get_buff_confs')).data.buffConfs.includes('工程 Buff 配置'))
    assert.equal((await run('set_buff_conf_zone', { buffConf: 1, zoneId: 'atkPct', value: 15 })).ok, true)
    assert.equal((await run('get_buff_conf_detail', { buffConf: 1 })).data.zones[0].value, 15)
    assert.equal((await run('delete_buff_conf', { buffConf: 1 })).ok, true)
    assert.equal(getAllBuffConfs().length, 0)
    assert.equal(JSON.stringify(getBuffEntities()), before)
    assert.equal((await run('get_buff_sets')).ok, false)
})

test('打开主页 Buff 集先返回主页；关闭面板保留当前工程；无效旧面板不改变工程', async () => {
    let open = false
    registerPanel(
        'buff-set',
        'Buff 集',
        () => open,
        (v) => {
            open = v
        }
    )
    try {
        const p = setup()
        assert.equal((await run('open_panel', { panel: 'buff-library' })).ok, false)
        assert.equal(getActiveProject()?.id, p.id)
        assert.equal((await run('open_panel', { panel: 'buff-set', open: false })).ok, true)
        assert.equal(getActiveProject()?.id, p.id)
        assert.equal((await run('open_panel', { panel: 'buff-set' })).ok, true)
        assert.equal(getActiveProject(), null)
        assert.equal(open, true)
    } finally {
        unregisterPanel('buff-set')
    }
})

test('工程 Buff 配置面板校验工程并切换拉表视图', async () => {
    __seedProjectsForTest([])
    assert.equal((await run('open_panel', { panel: 'buff-conf' })).ok, false)
    setup()
    const views: string[] = []
    const out = JSON.parse(
        await executeTool(
            {
                requestView: (v) => {
                    views.push(v)
                }
            },
            'open_panel',
            { panel: 'buff-conf' }
        )
    )
    assert.equal(out.ok, true)
    assert.deepEqual(views, ['calculation'])
    await run('open_panel', { panel: 'buff-conf', open: false })
})

test('返回主页使用空工程 id，未知工程 id 给出错误', async () => {
    const p = setup()
    assert.equal((await run('set_active_project', { id: 'missing' })).ok, false)
    assert.equal(getActiveProject()?.id, p.id)
    assert.equal((await run('set_active_project', { id: '' })).ok, true)
    assert.equal(getActiveProject(), null)
})

test('生成器查询清楚标注主页与工程目标，工程查询不混入主页增益', async () => {
    setup()
    await updateEntityBuffs('weapon', '术语测试武器', [
        { buffName: '仅主页增益', scope: 'self', zones: [{ zoneId: 'atkPct', value: 15 }] }
    ])
    await run('create_buff_conf', { name: '仅工程增益' })
    const context = { entityType: 'weapon' as const, entityName: '术语测试武器', namingRule: '原名', slangDict: '' }
    const catalog = JSON.parse(
        await executeGenerateTool({ ...context, data: createBuffSetDataSource() }, 'get_existing_buffs', {
            entityName: '术语测试武器'
        })
    )
    const project = JSON.parse(
        await executeGenerateTool({ ...context, data: createProjectDataSource() }, 'get_existing_buffs', {})
    )
    assert.equal(catalog.target, 'buff-set')
    assert.equal(project.target, 'project')
    assert.deepEqual(
        catalog.buffs.map((b: { buffName: string }) => b.buffName),
        ['仅主页增益']
    )
    assert.deepEqual(
        project.buffs.map((b: { buffName: string }) => b.buffName),
        ['仅工程增益']
    )
})

test('从主页 Buff 集导入工程的描述与实际落点一致，保留实体归属', async () => {
    const project = setup()
    project.team[0] = { ...project.team[0], character: '甲', weapon: '导入测试武器' }
    init(project.team, null, null, false, () => {})
    await updateEntityBuffs('weapon', '导入测试武器', [
        { buffName: '新武器增益', scope: 'self', zones: [{ zoneId: 'atkPct', value: 20 }] }
    ])
    const before = JSON.stringify(getBuffEntities())
    const tool = buildTools().find((t) => t.function.name === 'import_buff_set_entity_to_project')!
    assert.match(tool.function.description, /主页 Buff 集/)
    assert.match(tool.function.description, /工程 Buff 配置/)
    const out = await run('import_buff_set_entity_to_project', { entityType: 'weapon', entityName: '导入测试武器' })
    assert.equal(out.ok, true)
    assert.equal(out.data.imported, 1)
    assert.deepEqual(getAllBuffConfs()[0].scope, [0])
    assert.equal(getAllBuffConfs()[0].name, '新武器增益')
    assert.equal(JSON.stringify(getBuffEntities()), before)
})

test('旧工程 Buff 参数不会被误当作新参数执行', async () => {
    setup()
    await run('create_buff_conf', { name: '保留名称' })
    const out = await run('rename_buff_conf', { buffSet: 1, name: '不应修改' })
    assert.equal(out.ok, false)
    assert.equal(getAllBuffConfs()[0].name, '保留名称')
})
