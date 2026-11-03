// fast-calc 纯逻辑回归：工程文件解析、空配置初始化、编辑结果回写。
// 这些是页面与父窗口协议之间的全部「计算」，不允许再依赖计算引擎的运行时行为。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
    applyEdits,
    chainsOf,
    initialConfig,
    mainStatOptions,
    readProjectFile,
    refinementsOf
} from '$src/routes/fast-calc/utils'

const project = () => ({
    version: 5,
    name: '测试工程',
    team: [
        {
            character: '今汐',
            weapon: '时和岁稔',
            triggerSets: [],
            echoes: [
                { name: 'a', cost: 4 },
                { name: 'b', cost: 3 },
                { name: 'c', cost: 3 },
                { name: 'd', cost: 1 },
                { name: 'e', cost: 1 }
            ]
        },
        {
            character: '折枝',
            weapon: null,
            triggerSets: [],
            echoes: [
                { name: null, cost: 1 },
                { name: null, cost: 1 },
                { name: null, cost: 1 },
                { name: null, cost: 1 },
                { name: null, cost: 1 }
            ]
        },
        {
            character: null,
            weapon: null,
            triggerSets: [],
            echoes: [
                { name: null, cost: 1 },
                { name: null, cost: 1 },
                { name: null, cost: 1 },
                { name: null, cost: 1 },
                { name: null, cost: 1 }
            ]
        }
    ]
})

describe('readProjectFile', () => {
    it('兼容导出信封与直接工程对象', () => {
        const wrapped = readProjectFile(JSON.stringify({ version: 5, exportedAt: 1, project: project() }))
        assert.equal(wrapped.project.name, '测试工程')
        assert.equal((wrapped.root as { project?: unknown }).project, wrapped.project)

        const direct = readProjectFile(JSON.stringify(project()))
        assert.equal(direct.project.name, '测试工程')
        assert.equal(direct.root, direct.project)
    })

    it('非法 JSON / 缺 team 时抛错', () => {
        assert.throws(() => readProjectFile('not json'))
        assert.throws(() => readProjectFile('{"name":"x"}'))
    })
})

describe('链阶与空配置', () => {
    it('链阶优先取 team，其次取 conditionProfile', () => {
        const file = readProjectFile(
            JSON.stringify({
                project: {
                    ...project(),
                    conditionProfile: { chains: [2, 3, 4], refinements: [1, 2, 3] }
                }
            })
        )
        assert.deepEqual(chainsOf(file.project), [2, 3, 4])
        assert.deepEqual(refinementsOf(file.project), [1, 2, 3])
    })

    it('没有配置时按队伍声骸 cost 建空槽', () => {
        const file = readProjectFile(JSON.stringify(project()))
        const config = initialConfig(file.project)
        assert.equal(config.characters.length, 3)
        assert.deepEqual(
            config.characters[0].echoes.map((echo) => echo.cost),
            [4, 3, 3, 1, 1]
        )
        assert.deepEqual(
            config.characters[0].echoes.map((echo) => echo.secondMainStat?.type),
            ['攻击', '攻击', '攻击', '生命', '生命']
        )
        assert.equal(config.characters[0].echoes[0].mainStat, null)
        assert.equal(mainStatOptions(4).length > 0, true)
    })
})

describe('applyEdits', () => {
    it('回写 team 链阶、conditionProfile 与 phases.config', () => {
        const file = readProjectFile(JSON.stringify({ project: { ...project(), phases: {} } }))
        const config = initialConfig(file.project)
        config.characters[0].echoes[0].mainStat = { type: '暴击率', value: 22, unit: '%' }
        const root = applyEdits(file, config, [6, 0, 1], [5, 1, 0]) as {
            project: {
                team: { chain: number; refinement: number }[]
                conditionProfile: { chains: number[]; refinements: number[] }
                phases: { config: { data: { characters: { echoes: { mainStat: { type: string } }[] }[] } } }
            }
        }
        assert.equal(root.project.team[0].chain, 6)
        assert.equal(root.project.team[2].refinement, 0)
        assert.deepEqual(root.project.conditionProfile.chains, [6, 0, 1])
        assert.equal(root.project.phases.config.data.characters[0].echoes[0].mainStat.type, '暴击率')
    })

    it('回写参考线记点到 analysis.timings', () => {
        const file = readProjectFile(JSON.stringify({ project: { ...project(), phases: {} } }))
        const config = initialConfig(file.project)
        const root = applyEdits(
            file,
            config,
            [0, 0, 0],
            [1, 1, 1],
            [{ refLineId: 'end', label: '结束', seconds: 12.5 }]
        ) as { project: { analysis: { timings: { refLineId: string; seconds: number | null }[] } } }
        assert.deepEqual(root.project.analysis.timings, [{ refLineId: 'end', seconds: 12.5 }])
    })
})
