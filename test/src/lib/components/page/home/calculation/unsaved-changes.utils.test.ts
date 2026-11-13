// 「未保存修改」变更清单的纯逻辑：只列真变了的对象，没变就是空数组（= 不弹确认）。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
    diffBuffConfig,
    diffDamageTypes,
    scopeTextOf,
    type DamageTypeEntrySnapshot
} from '$lib/components/page/home/calculation/unsaved-changes.utils'
import type { BuffInstance, BuffTreeState, CalcState } from '$lib/calc/calculation.types'

const buff = (id: string, name: string, extra: Partial<BuffInstance> = {}): BuffInstance =>
    ({
        id,
        name,
        scope: 'all',
        zones: [],
        ...extra
    }) as BuffInstance

const calc = (buffs: BuffInstance[], tree?: BuffTreeState): CalcState => ({
    buffSets: buffs,
    damageEntryBuffSetIds: {},
    damageEntryDamageTypes: {},
    ...(tree ? { buffTree: tree } : {})
})

const treeOf = (children: BuffTreeState['global']): BuffTreeState => ({ global: children, nonGlobal: [] })

describe('diffBuffConfig：没改动就不弹确认', () => {
    it('同一份数据 → 空清单', () => {
        const state = calc([buff('b1', '甲'), buff('b2', '乙')])
        assert.deepEqual(diffBuffConfig(state, structuredClone(state)), [])
    })
})

describe('diffBuffConfig：Buff 自身改动', () => {
    it('新建 / 删除各一条', () => {
        const before = calc([buff('b1', '老')])
        const after = calc([buff('b2', '新')])
        const items = diffBuffConfig(before, after)
        assert.deepEqual(
            items.map((i) => [i.subtitle, i.title, i.tone]),
            [
                ['新建 BUFF', '新', 'create'],
                ['删除 BUFF', '老', 'remove']
            ]
        )
    })

    it('改名写成 旧 → 新（只取短名，不显示文件夹路径）', () => {
        const before = calc([buff('b1', '文件夹\\旧名')])
        const after = calc([buff('b1', '文件夹\\新名')])
        const items = diffBuffConfig(before, after)
        assert.equal(items.length, 1)
        assert.equal(items[0].subtitle, '修改 BUFF')
        assert.deepEqual(items[0].lines, ['名称：旧名 → 新名'])
    })

    it('乘区数值变化写成「标签：旧 → 新」，新增/移除乘区各一行', () => {
        const before = calc([buff('b1', '甲', { zones: [{ zoneId: 'atkPct', value: 10 }] })])
        const after = calc([
            buff('b1', '甲', {
                zones: [
                    { zoneId: 'atkPct', value: 12 },
                    { zoneId: 'critRate', value: 5 }
                ]
            })
        ])
        const lines = diffBuffConfig(before, after)[0].lines
        assert.deepEqual(lines, ['攻击百分比：10% → 12%', '新增乘区：暴击率 5%'])
    })

    it('作用范围 / 门槛条件 / 全局状态各自成行（四态叫法：通用 / 全队 / 仅效应）', () => {
        const before = calc([buff('b1', '甲', { scope: 'all' })])
        const after = calc([
            buff('b1', '甲', {
                scope: [0, 1, 2],
                global: true,
                rules: [{ kind: 'chain', charIdx: 0, min: 3 }]
            })
        ])
        const lines = diffBuffConfig(before, after)[0].lines
        assert.deepEqual(lines, ['作用范围：通用 → 全队', '门槛条件：无 → 1 条', '已并入全局'])
    })
})

describe('diffBuffConfig：文件夹树改动', () => {
    it('文件夹新建 / 改名 / 位置变化', () => {
        const before = calc([], treeOf([{ kind: 'folder', id: 'f1', name: '旧目录', children: [] }]))
        const after = calc(
            [],
            treeOf([
                { kind: 'folder', id: 'f1', name: '新目录', children: [] },
                { kind: 'folder', id: 'f2', name: '子目录', children: [] }
            ])
        )
        const items = diffBuffConfig(before, after)
        assert.deepEqual(
            items.map((i) => [i.subtitle, i.title, i.tone]),
            [
                ['修改文件夹', '新目录', 'update'],
                ['新建文件夹', '子目录', 'create']
            ]
        )
        assert.deepEqual(items[0].lines, ['名称：旧目录 → 新目录'])
    })

    it('Buff 换文件夹 → 一条「调整位置」', () => {
        const before = calc(
            [buff('b1', '甲')],
            treeOf([{ kind: 'folder', id: 'f1', name: 'A', children: [{ kind: 'buff', id: 'n1', buffId: 'b1' }] }])
        )
        const after = calc(
            [buff('b1', '甲')],
            treeOf([
                { kind: 'folder', id: 'f1', name: 'A', children: [] },
                { kind: 'folder', id: 'f2', name: 'B', children: [{ kind: 'buff', id: 'n2', buffId: 'b1' }] }
            ])
        )
        const move = diffBuffConfig(before, after).find((i) => i.subtitle === '调整位置')
        assert.ok(move, '应有一条位置变更')
        assert.deepEqual(move.lines, ['位置：A → B'])
    })
})

describe('scopeTextOf：四态叫法', () => {
    it("'all'=通用 / [0,1,2]=全队 / []=仅效应 / 子集=角色名", () => {
        assert.equal(scopeTextOf('all'), '通用')
        assert.equal(scopeTextOf([0, 1, 2]), '全队')
        assert.equal(scopeTextOf([]), '仅效应')
        assert.equal(scopeTextOf([1]), '角色2')
    })
})

describe('diffDamageTypes：伤害类型改动', () => {
    const entry = (id: string, name: string, types: string[]): DamageTypeEntrySnapshot => ({
        id,
        name,
        character: '甲',
        types
    })

    it('没改 → 空清单；改了 → 一条「旧 → 新」', () => {
        const before = [entry('e1', '共鸣解放', ['共鸣解放伤害']), entry('e2', '普攻', [])]
        assert.deepEqual(diffDamageTypes(before, structuredClone(before)), [])
        const after = [entry('e1', '共鸣解放', ['共鸣解放伤害', '效应伤害']), entry('e2', '普攻', ['普攻伤害'])]
        const items = diffDamageTypes(before, after)
        assert.deepEqual(
            items.map((i) => [i.title, i.subtitle, i.lines]),
            [
                ['共鸣解放', '甲', ['伤害类型：共鸣解放伤害 → 共鸣解放伤害 / 效应伤害']],
                ['普攻', '甲', ['伤害类型：自动推导 → 普攻伤害']]
            ]
        )
    })
})
