import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBuffSetDataSource, createProjectDataSource, executeGenerateTool } from '$lib/ai/generate/tools'

const character = {
    element: '热熔',
    weaponType: '长刃',
    skills: [{ name: '共鸣技能', desc: '施放后获得【灼羽】，提高攻击力。' }],
    statNodes: [{ name: '固有技能', desc: '【灼羽】持续期间提高伤害。' }],
    chains: [{ name: '共鸣链一', desc: '【离火】叠加上限提高。' }]
}

for (const createSource of [createBuffSetDataSource, createProjectDataSource]) {
    const target = createSource().target
    const context = () => ({
        entityType: 'character' as const,
        entityName: '甲 / 乙',
        namingRule: '',
        slangDict: '',
        data: createSource()
    })

    test(`${target} 生成器实体详情和术语查询共用 v1 纯文本角色信息`, async (t) => {
        const requests: string[] = []
        t.mock.method(globalThis, 'fetch', async (input: string) => {
            requests.push(input)
            return Response.json(character)
        })
        const info = JSON.parse(
            await executeGenerateTool(context(), 'get_entity_info', {
                entityType: 'character',
                entityName: '甲 / 乙'
            })
        )
        assert.deepEqual(info, character)
        const terms = JSON.parse(await executeGenerateTool(context(), 'get_character_terms', { entityName: '甲 / 乙' }))
        assert.deepEqual(terms.effects, ['灼羽', '离火'])
        assert.deepEqual(terms.entries, [
            { name: '共鸣技能', text: character.skills[0].desc },
            { name: '固有技能', text: character.statNodes[0].desc },
            { name: '共鸣链一', text: character.chains[0].desc }
        ])
        assert.deepEqual(requests, Array(2).fill(`/api/v1/info/character/${encodeURIComponent('甲 / 乙')}`))
    })

    test(`${target} 生成器角色不存在时详情和术语返回可识别的错误`, async (t) => {
        t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Character not found' }, { status: 404 }))
        const info = JSON.parse(
            await executeGenerateTool(context(), 'get_entity_info', { entityType: 'character', entityName: '不存在' })
        )
        assert.equal(info.error, '未找到「不存在」的信息')
        const terms = JSON.parse(await executeGenerateTool(context(), 'get_character_terms', { entityName: '不存在' }))
        assert.equal(terms.error, '未找到角色「不存在」')
    })

    test(`${target} 生成器保留 v1 HTTP 错误和接口错误，不把它们解析成角色术语`, async (t) => {
        const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({}, { status: 503 }))
        const unavailable = JSON.parse(
            await executeGenerateTool(context(), 'get_character_terms', { entityName: '甲' })
        )
        assert.equal(unavailable.error, 'v1 接口失败（HTTP 503）')
        fetch.mock.mockImplementation(async () => Response.json({ error: '角色数据不可用' }))
        const invalid = JSON.parse(await executeGenerateTool(context(), 'get_character_terms', { entityName: '甲' }))
        assert.deepEqual(invalid, { error: '角色数据不可用' })
        assert.equal(await createSource().getEntityInfo('character', '甲'), null)
    })
}
