// 通用技能卡 CRUD 工具回归：AI 自创 / 修改 / 删除自定义技能；内置技能只读约束由数据层保证
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { executeTool } from '$lib/ai/tools/registry'
import '$lib/ai/tools/skills'

interface ToolResult<T = unknown> {
    ok: boolean
    data?: T
    error?: string
}

const call = async <T = unknown>(name: string, args: Record<string, unknown>): Promise<ToolResult<T>> =>
    JSON.parse(await executeTool({}, name, args)) as ToolResult<T>

test('create_skill / get_skill / update_skill / delete_skill：完整的自定义技能生命周期', async () => {
    const created = await call<{ created: boolean; skill: { name: string; body: string; mode: string } }>(
        'create_skill',
        { name: '__skill_test__', description: '初始描述', body: '初始正文', mode: 'active' }
    )
    assert.equal(created.ok, true)
    assert.equal(created.data?.skill.name, '__skill_test__')
    assert.equal(created.data?.skill.body, '初始正文')

    const got = await call<{ ok: boolean; skill: { body: string; mode: string } }>('get_skill', {
        name: '__skill_test__'
    })
    assert.equal(got.data?.skill.body, '初始正文')

    const updated = await call<{ updated: boolean; skill: { body: string; mode: string; enabled: boolean } }>(
        'update_skill',
        { name: '__skill_test__', body: '新正文', mode: 'passive', enabled: false }
    )
    assert.equal(updated.data?.updated, true)
    assert.equal(updated.data?.skill.body, '新正文')
    assert.equal(updated.data?.skill.mode, 'passive')
    assert.equal(updated.data?.skill.enabled, false)

    const deleted = await call<{ deleted: boolean }>('delete_skill', { name: '__skill_test__' })
    assert.equal(deleted.data?.deleted, true)
    const missing = await call<{ ok: boolean }>('get_skill', { name: '__skill_test__' })
    assert.equal(missing.ok, true, 'handler 返回的业务失败仍会被 executeTool 包成 ok:true')
    assert.equal(missing.data?.ok, false)
})

test('create_skill：重名 / 缺正文被拒，不会创建半成品', async () => {
    await call('create_skill', { name: '__skill_dup__', body: 'x' })
    const dup = await call('create_skill', { name: '__skill_dup__', body: 'y' })
    assert.equal(dup.ok, false)
    const noBody = await call('create_skill', { name: '__skill_no_body__', body: '   ' })
    assert.equal(noBody.ok, false)
    await call('delete_skill', { name: '__skill_dup__' })
})

test('update_skill：未知技能 / 非法 mode 报可读错误', async () => {
    const missing = await call('update_skill', { name: '__not_exists__', body: 'x' })
    assert.equal(missing.ok, false)
    assert.match(missing.error ?? '', /未找到技能/)

    await call('create_skill', { name: '__skill_mode__', body: 'x' })
    const bad = await call('update_skill', { name: '__skill_mode__', mode: 'weird' })
    assert.equal(bad.ok, false)
    assert.match(bad.error ?? '', /active 或 passive/)
    await call('delete_skill', { name: '__skill_mode__' })
})

test('旧的命名规则专用工具已从源码删除（不是仅未 import）', () => {
    const source = readFileSync('src/lib/ai/tools/buff-generate.ts', 'utf8')
    assert.equal(source.includes("defineTool('set_naming_rule'"), false)
    assert.equal(source.includes("defineTool('get_naming_rule'"), false)
})

test('旧的命名规则专用工具不再注册', async () => {
    const legacySet = await call('set_naming_rule', { rule: 'x' })
    const legacyGet = await call('get_naming_rule', {})
    assert.equal(legacySet.ok, false)
    assert.equal(legacyGet.ok, false)
    assert.match(legacySet.error ?? '', /未知工具/)
    assert.match(legacyGet.error ?? '', /未知工具/)
})
