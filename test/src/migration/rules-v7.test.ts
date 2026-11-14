// 工程迁移 v6 → v7：Buff 级条件改版（rules）与移除星标。
//
// 口径（.tmp/buff-modal-redesign/requirements.md「已对齐的决定」）：
// - v6 实例级 condition 的链/阶 → `chain` / `refinement` 规则；**链与阶可以并存**；
// - v6 里被拆开的双条件 Buff **不回并**（迁移只做字段升级，不动条目数量）；
// - v6 的 elements / damageTypes 属乘区级条件，不转 rules；
// - v6 独有字段（`starred` / `condition` / `conditionRefCharIdx`）全部抹除；
// - encounter 与 phases 两种承载都要洗；迁移必须幂等。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { migrateProject, migrateCalcState } from '$lib/../migration'
import { PROJECT_VERSION } from '$lib/types/project'

/** @desc v6 形态的工程（实例级 condition + starred，par 参数决定四阶段数据放哪一侧） */
const v6Project = (buffSets: unknown[], carry: 'encounter' | 'phases' = 'encounter') => {
    const calculation = { locked: false, data: { buffSets, damageEntryBuffSetIds: {}, damageEntryDamageTypes: {} } }
    const base = {
        version: 6,
        id: 'p1',
        name: 'v6 工程',
        createdAt: 1,
        team: [{ character: '甲' }, { character: '乙' }, { character: '丙' }],
        analysis: undefined,
        comparison: undefined
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

const legacyBuff = (patch: Record<string, unknown>) => ({
    id: 'b1',
    name: '测试',
    zones: [{ zoneId: 'atkPct', value: 10 }],
    scope: 'all',
    ...patch
})

describe('v6 → v7：实例级链/阶条件升级为 rules', () => {
    it('单链 / 单阶 / 链阶并存都升级，且并存保持为一条 Buff', () => {
        const project = migrateProject(
            v6Project([
                legacyBuff({ id: 'c', condition: { chains: [{ charIdx: 1, min: 2 }] }, conditionRefCharIdx: 1 }),
                legacyBuff({ id: 'r', condition: { refinements: [{ charIdx: 0, min: 3 }] }, conditionRefCharIdx: 0 }),
                legacyBuff({ id: 'cr', condition: { chain: 2, refinement: 4 }, conditionRefCharIdx: 2 })
            ])
        )
        assert.equal(project.version, PROJECT_VERSION)
        const buffs = project.buffs
        assert.equal(buffs.length, 3, '链阶并存不合并 / 拆分（v6 里已拆开的也不回并）')
        assert.deepEqual(buffs[0].rules, [{ kind: 'chain', charIdx: 1, min: 2 }])
        assert.deepEqual(buffs[1].rules, [{ kind: 'refinement', charIdx: 0, min: 3 }])
        assert.deepEqual(buffs[2].rules, [
            { kind: 'chain', charIdx: 2, min: 2 },
            { kind: 'refinement', charIdx: 2, min: 4 }
        ])
    })

    it('v6 的 elements / damageTypes 不转 rules，下放到乘区条目', () => {
        const project = migrateProject(
            v6Project([
                legacyBuff({
                    condition: { elements: ['导电'], damageTypes: ['共鸣解放伤害'] },
                    zones: [{ zoneId: 'bonusDmg', value: 15 }]
                })
            ])
        )
        const buff = project.buffs[0]
        assert.equal(buff.rules, undefined)
        assert.deepEqual(buff.zones[0].condition, {
            elements: ['导电'],
            damageTypes: ['共鸣解放伤害']
        })
    })

    it('starred / condition / conditionRefCharIdx 一律抹除', () => {
        const project = migrateProject(
            v6Project([
                legacyBuff({
                    starred: true,
                    condition: { chains: [{ charIdx: 0, min: 1 }] },
                    conditionRefCharIdx: 0
                })
            ])
        )
        const buff = project.buffs[0] as unknown as Record<string, unknown>
        assert.equal('starred' in buff, false)
        assert.equal('condition' in buff, false)
        assert.equal('conditionRefCharIdx' in buff, false)
        assert.ok(Array.isArray(buff.rules))
    })

    it('已是 v7 的数据（rules 已存在）原样保留', () => {
        const project = migrateProject(
            v6Project([
                legacyBuff({
                    rules: [{ kind: 'enemyType', types: ['BOSS'] }],
                    condition: { chains: [{ charIdx: 0, min: 1 }] }
                })
            ])
        )
        assert.deepEqual(project.buffs[0].rules, [{ kind: 'enemyType', types: ['BOSS'] }], 'rules 优先于 v6 condition')
    })

    it('导出文件形态（数据只在兼容视图 phases 里）同样升级', () => {
        const project = migrateProject(
            v6Project([legacyBuff({ starred: true, condition: { chains: [{ charIdx: 0, min: 3 }] } })], 'phases')
        )
        assert.deepEqual(project.buffs[0].rules, [{ kind: 'chain', charIdx: 0, min: 3 }])
        const viewCalc = project.phases.calculation.data as { buffSets: { rules?: unknown }[] }
        assert.ok(Array.isArray(viewCalc.buffSets[0].rules), '兼容视图 phases 也要洗一遍')
    })

    it('幂等：迁移两次结果一致', () => {
        const raw = v6Project([
            legacyBuff({ condition: { chains: [{ charIdx: 0, min: 1 }], refinements: [{ charIdx: 1, min: 2 }] } })
        ])
        const once = migrateProject(raw)
        const twice = migrateProject(JSON.parse(JSON.stringify(once)))
        assert.deepEqual(twice.buffs, once.buffs)
    })
})

describe('migrateCalcState：v6 condition 升级（结构归一化的单一入口）', () => {
    it('直接喂 v6 buff 也能得到 rules', () => {
        const state = migrateCalcState({
            buffSets: [legacyBuff({ condition: { chain: 4 }, conditionRefCharIdx: 2 })],
            damageEntryBuffSetIds: {},
            damageEntryDamageTypes: {}
        })
        assert.deepEqual(state.buffSets[0].rules, [{ kind: 'chain', charIdx: 2, min: 4 }])
    })

    it('空 / 非法的 v6 condition 不产出 rules 字段', () => {
        const state = migrateCalcState({
            buffSets: [legacyBuff({ condition: { chains: [] } })],
            damageEntryBuffSetIds: {},
            damageEntryDamageTypes: {}
        })
        assert.equal(state.buffSets[0].rules, undefined)
    })
})
