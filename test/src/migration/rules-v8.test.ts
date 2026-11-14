// 工程迁移 v7 → v8：「伤害名等于」并入「伤害名正则」。
//
// 口径：最终模型只保留 `damageNameRegex`；v7 的 `damageNameEquals` 的值转义正则元字符后写成 `^…$`，
// 保持全等语义；空白值仍为空草稿。encounter 与 phases 两种承载都要洗，迁移必须幂等。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { migrateProject } from '$lib/../migration'
import { PROJECT_VERSION } from '$lib/types/project'

const v7Project = (rules: unknown[], carry: 'encounter' | 'phases' = 'encounter') => {
    const calculation = {
        locked: false,
        data: {
            buffSets: [
                {
                    id: 'b1',
                    name: '测试',
                    zones: [{ zoneId: 'atkPct', value: 10 }],
                    scope: 'all',
                    rules
                }
            ],
            damageEntryBuffSetIds: {},
            damageEntryDamageTypes: {}
        }
    }
    const base = {
        version: 7,
        id: 'p1',
        name: 'v7 工程',
        createdAt: 1,
        team: [{ character: '甲' }, { character: '乙' }, { character: '丙' }]
    }
    if (carry === 'phases') {
        return {
            ...base,
            phases: {
                team: { locked: false, data: null },
                timeline: { locked: false, data: null },
                calculation,
                config: { locked: false, data: null }
            }
        }
    }
    return {
        ...base,
        encounter: {
            teamLocked: false,
            timeline: { locked: false, data: null },
            calculation,
            config: { locked: false, data: null }
        }
    }
}

const buffRulesOf = (project: ReturnType<typeof migrateProject>) => project.buffs[0]?.rules

describe('v7 → v8：伤害名等于并入正则', () => {
    it('转义元字符并加锚点，其它规则与顺序原样保留', () => {
        const project = migrateProject(
            v7Project([
                { kind: 'enemyType', types: ['BOSS'] },
                { kind: 'damageNameEquals', value: '终曲(重).*' },
                { kind: 'chain', charIdx: 1, min: 2 }
            ])
        )
        assert.equal(project.version, PROJECT_VERSION)
        assert.deepEqual(buffRulesOf(project), [
            { kind: 'enemyType', types: ['BOSS'] },
            { kind: 'damageNameRegex', pattern: '^终曲\\(重\\)\\.\\*$' },
            { kind: 'chain', charIdx: 1, min: 2 }
        ])
    })

    it('已有的 damageNameRegex 不受影响', () => {
        const project = migrateProject(v7Project([{ kind: 'damageNameRegex', pattern: '共鸣解放' }]))
        assert.deepEqual(buffRulesOf(project), [{ kind: 'damageNameRegex', pattern: '共鸣解放' }])
    })

    it('空白值转成空正则草稿（而不是匹配空串的 ^$）', () => {
        const project = migrateProject(v7Project([{ kind: 'damageNameEquals', value: '   ' }]))
        assert.deepEqual(buffRulesOf(project), [{ kind: 'damageNameRegex', pattern: '' }])
    })

    it('导出文件形态（数据只在兼容视图 phases 里）同样转换', () => {
        const project = migrateProject(v7Project([{ kind: 'damageNameEquals', value: '测试伤害' }], 'phases'))
        assert.deepEqual(buffRulesOf(project), [{ kind: 'damageNameRegex', pattern: '^测试伤害$' }])
        const viewCalc = project.phases.calculation.data as { buffSets: { rules?: unknown }[] }
        assert.deepEqual(viewCalc.buffSets[0].rules, [{ kind: 'damageNameRegex', pattern: '^测试伤害$' }])
    })

    it('幂等：迁移两次结果一致', () => {
        const once = migrateProject(v7Project([{ kind: 'damageNameEquals', value: 'X' }]))
        const twice = migrateProject(JSON.parse(JSON.stringify(once)))
        assert.deepEqual(twice.buffs, once.buffs)
        assert.deepEqual(twice.phases.calculation.data, once.phases.calculation.data)
    })
})
