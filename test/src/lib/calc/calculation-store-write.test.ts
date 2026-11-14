// 拉表写路径的两条**性能契约**（都直接影响点击手感，退化了要立刻发现）：
//
// 1. store 自己发出的回写必须是「自证回写」（`_updateInFlight`）：宿主把状态传回 `init()` 时
//    跳过全量重载 —— 否则一次勾选就会重建条目 / 列序 / 整表结构（实测 C 档一次点击 ~23ms 里
//    这一项占三分之一以上）。外部变化（不是 store 写的）**必须**仍然走全量重载。
// 2. 撤销基线带 JSON 指纹缓存：连续 markTableDirty 不再整份 stringify 基线，但撤销语义不变
//    （无实际变更不压栈、有变更能回退）。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import type { CharSlot } from '$lib/types/project'
import type { TimelineData } from '$lib/calc/timeline.types'
import {
    canUndoTable,
    getAllDamageEntries,
    getCalcState,
    init,
    markTableDirty,
    setBuffSetIdsForEntries,
    toggleBuffSetForEntry,
    undoTable
} from '$lib/calc/calculation.store.svelte'

const teamOf = (names: string[]): [CharSlot, CharSlot, CharSlot] =>
    names.map((character) => ({ character, weapon: null })) as unknown as [CharSlot, CharSlot, CharSlot]

/** @desc 一条伤害块（一个条目）——测试只需要「有条目」这件事成立 */
const timelineOf = (): TimelineData => ({
    refLines: [{ id: 'r1', name: '开始', pos: 0 }],
    opBlocks: [{ id: 'o0', trackIndex: 0, pos: 0, key: 'skill', desc: '', intro: false, switchback: false }],
    damageBlocks: [
        {
            id: 'd0',
            trackIndex: 0,
            sourceType: 'op',
            sourceId: 'o0',
            skillHits: [
                { hitName: '段1', skillType: '共鸣解放', ratio: '100%', element: '冷凝', character: '甲', hits: 1 }
            ],
            nonDirectEntries: []
        }
    ]
})

const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('拉表写操作：自证回写跳过全量重载', () => {
    it('store 写入后自己通知宿主，传回 init 时不再重建条目', () => {
        const team = teamOf(['甲', '乙', '丙'])
        let updates = 0
        init(team, timelineOf(), null, false, () => {
            updates++
        })
        const before = getAllDamageEntries()
        assert.ok(before.length > 0, '前置：必须有伤害条目')

        // 拉表点击一格 → store 自己回写宿主
        toggleBuffSetForEntry(before[0].id, 'buff-x')
        assert.equal(updates, 1, '写操作必须通知一次宿主（否则改动不落盘）')

        // 宿主把新状态作为 savedState 传回 → 命中自证回写分支，条目引用不变
        init(team, timelineOf(), getCalcState(), false, () => {})
        assert.equal(getAllDamageEntries(), before, '自证回写不得重建条目（否则整表结构与缓存全部作废）')
        assert.deepEqual(getCalcState().damageEntryBuffSetIds[before[0].id], ['buff-x'], '绑定必须保留')
    })

    it('批量覆写同样走自证回写', () => {
        const team = teamOf(['丁', '戊', '己'])
        let updates = 0
        init(team, timelineOf(), null, false, () => {
            updates++
        })
        const before = getAllDamageEntries()
        setBuffSetIdsForEntries({ [before[0].id]: ['b1', 'b2'] })
        assert.equal(updates, 1)
        init(team, timelineOf(), getCalcState(), false, () => {})
        assert.equal(getAllDamageEntries(), before)
        assert.deepEqual(getCalcState().damageEntryBuffSetIds[before[0].id], ['b1', 'b2'])
    })

    it('外部改动（非 store 写入）仍然全量重载，不被自证标记误伤', () => {
        const team = teamOf(['庚', '辛', '壬'])
        init(team, timelineOf(), null, false, () => {})
        const before = getAllDamageEntries()
        const entryId = before[0].id

        // 模拟别人改过的工程文件：绑定与当前不同，且没有走过 store 的写路径
        const external = { ...getCalcState(), damageEntryBuffSetIds: { [entryId]: ['from-file'] } }
        init(team, timelineOf(), external, false, () => {})
        assert.notEqual(getAllDamageEntries(), before, '外部变化必须重建条目')
        assert.deepEqual(getCalcState().damageEntryBuffSetIds[entryId], ['from-file'])
    })
})

describe('撤销基线：指纹缓存不改变撤销语义', () => {
    it('无实际变更的连续标记不压栈', async () => {
        init(teamOf(['子', '丑', '寅']), timelineOf(), null, false, () => {})
        const baseline = canUndoTable()
        markTableDirty()
        await flushMicrotasks()
        markTableDirty()
        await flushMicrotasks()
        assert.equal(canUndoTable(), baseline, '没有真实变更就不该产生新的撤销项')
    })

    it('真实变更压栈且能撤销回原状态', async () => {
        init(teamOf(['卯', '辰', '巳']), timelineOf(), null, false, () => {})
        const entryId = getAllDamageEntries()[0].id
        toggleBuffSetForEntry(entryId, 'buff-undo')
        await flushMicrotasks()
        assert.equal(canUndoTable(), true)
        assert.deepEqual(getCalcState().damageEntryBuffSetIds[entryId], ['buff-undo'])

        assert.equal(undoTable(), true)
        await flushMicrotasks()
        assert.equal(getCalcState().damageEntryBuffSetIds[entryId], undefined, '撤销应回到未绑定状态')
    })
})
