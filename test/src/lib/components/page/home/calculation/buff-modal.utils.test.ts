// 生效成员四态 + 作用域徽标 + 空文件夹清理：纯逻辑口径的回归。
//
// 状态机来自 `.tmp/buff-modal-redesign/requirements.md` 的「已对齐的决定」：
//   `'all'`（三角色 + 效应） / `[0,1,2]`（仅角色全选） / `[]`（仅效应） / 子集
//   勾效应 = 全队；全队取消效应 = 仅角色全选；仅效应取消效应 = 禁止；
//   全队取消一个角色 = 取消效应保留剩余；取消最后一个角色 = 仅效应；禁止空成员。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { classifyBuffScope } from '$lib/calc/calculation.consts'
import { pruneEmptyFolders } from '$lib/calc/buff-tree-state'
import type { BuffConf, BuffTreeState } from '$lib/calc/calculation.types'
import type { CharSlot } from '$lib/types/project'
import {
    checkedCharsIn,
    effectCheckedIn,
    nextScopeAfterCharToggle,
    nextScopeAfterEffectToggle,
    scopeBadgesOf
} from '$lib/components/page/home/calculation/buff-modal.utils'

const TEAM = [{ character: '甲' }, { character: '乙' }, { character: '丙' }] as unknown as [
    CharSlot,
    CharSlot,
    CharSlot
]

describe('classifyBuffScope：四态', () => {
    it("'all' = 全队；[0,1,2] = 仅角色全选（不是全队）", () => {
        assert.equal(classifyBuffScope('all').kind, 'all')
        assert.equal(classifyBuffScope([0, 1, 2]).kind, 'charsAll', '三角色不含效应，必须与全队区分')
        assert.equal(classifyBuffScope([]).kind, 'effect')
        assert.deepEqual(classifyBuffScope([2, 0]), { kind: 'chars', idxs: [0, 2] })
    })

    it('去重与越界槽位被忽略', () => {
        assert.deepEqual(classifyBuffScope([0, 0, 1, 9]), { kind: 'chars', idxs: [0, 1] })
    })
})

describe('生效成员状态机', () => {
    it('勾效应 = 全队；从全队取消效应 = 仅角色全选', () => {
        assert.equal(nextScopeAfterEffectToggle([0, 1]), 'all')
        assert.deepEqual(nextScopeAfterEffectToggle('all'), [0, 1, 2])
    })

    it('仅效应取消效应 → 禁止（null）', () => {
        assert.equal(nextScopeAfterEffectToggle([]), null)
    })

    it('勾着效应时再勾角色 → 全队', () => {
        assert.equal(nextScopeAfterCharToggle([], 0), 'all')
        assert.deepEqual(nextScopeAfterCharToggle('all', 0), [1, 2], '全队里「点已勾选的角色」= 取消该角色 + 取消效应')
    })

    it('全队取消一个角色 = 取消效应 + 保留剩余角色', () => {
        assert.deepEqual(nextScopeAfterCharToggle('all', 0), [1, 2])
        assert.deepEqual(nextScopeAfterCharToggle('all', 1), [0, 2])
    })

    it('部分角色勾满三个 = 仅角色全选（[0,1,2]），不是全队', () => {
        assert.deepEqual(nextScopeAfterCharToggle([0, 1], 2), [0, 1, 2])
    })

    it('取消最后一个角色 = 仅效应（永不出现空成员）', () => {
        assert.deepEqual(nextScopeAfterCharToggle([2], 2), [])
        assert.deepEqual(nextScopeAfterCharToggle('all', 0), [1, 2], '还有角色时不会变成仅效应')
    })

    it('读态：checkedCharsIn / effectCheckedIn 与四态一致', () => {
        assert.deepEqual(checkedCharsIn('all'), [0, 1, 2])
        assert.deepEqual(checkedCharsIn([1]), [1])
        assert.deepEqual(checkedCharsIn([]), [])
        assert.equal(effectCheckedIn('all'), true)
        assert.equal(effectCheckedIn([]), true)
        assert.equal(effectCheckedIn([0, 1, 2]), false)
        assert.equal(effectCheckedIn([0]), false)
    })
})

describe('scopeBadgesOf：行首徽标', () => {
    const elementColor = () => '#123456'
    const badges = (scope: 'all' | number[]) =>
        scopeBadgesOf({ id: 'b', name: 'b', zones: [], scope } as BuffConf, TEAM, elementColor)

    it('四态各自的徽标', () => {
        assert.deepEqual(
            badges('all').map((b) => b.label),
            ['全队']
        )
        assert.deepEqual(
            badges([0, 1, 2]).map((b) => b.label),
            ['三角色']
        )
        assert.deepEqual(
            badges([]).map((b) => b.label),
            ['效应专属']
        )
        assert.deepEqual(
            badges([0, 2]).map((b) => b.label),
            ['甲', '丙']
        )
    })
})

describe('空文件夹清理：全局与非全局两棵树都清、根受保护', () => {
    const tree: BuffTreeState = {
        global: [
            { kind: 'folder', id: 'g-empty', name: '全局空', children: [] },
            { kind: 'folder', id: 'g-kept', name: '全局有', children: [{ kind: 'buff', id: 'b1', buffId: 'b1' }] }
        ],
        nonGlobal: [
            {
                kind: 'folder',
                id: 'n-parent',
                name: '父',
                children: [{ kind: 'folder', id: 'n-child', name: '子', children: [] }]
            },
            { kind: 'buff', id: 'b2', buffId: 'b2' }
        ]
    }

    it('清空空文件夹并记录 id（嵌套清空后父也变空）', () => {
        const { tree: next, removedIds } = pruneEmptyFolders(tree)
        assert.deepEqual(removedIds.sort(), ['g-empty', 'n-child', 'n-parent'])
        assert.deepEqual(
            next.global.map((node) => node.id),
            ['g-kept']
        )
        assert.deepEqual(
            next.nonGlobal.map((node) => node.id),
            ['b2']
        )
    })

    it('根节点永远不会被删（两个根恒存在）', () => {
        const { tree: next } = pruneEmptyFolders({ global: [], nonGlobal: [] })
        assert.deepEqual(next, { global: [], nonGlobal: [] })
    })

    it('入参不被改写', () => {
        const snapshot = JSON.stringify(tree)
        pruneEmptyFolders(tree)
        assert.equal(JSON.stringify(tree), snapshot)
    })
})
