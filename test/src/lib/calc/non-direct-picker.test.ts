// 非直伤弹窗的**状态模型**回归（`applyNonDirectEntries`）：
//
// 1. 处决/响应没有独立开关 —— 「谁触发」就是启用状态。因此：
//    · 没指定触发者的响应**不写入**（写进去拉表侧也建不出条目，属静默无效）；
//    · 打开弹窗**不得**用操作块来源角色给出处决触发者，否则点一下确认就凭空多出一条处决伤害。
// 2. 效应按「层数 > 0 才算启用」写入，且层数归 0 时段数复位（不留「0 层 ×3 段」脏值）。
// 3. 产出顺序固定：处决 → 响应 → 效应（按 NON_DIRECT_CONFIGS 顺序）→ 电磁爆发。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
    init,
    openNonDirectPicker,
    applyNonDirectEntries,
    updateNonDirectPickerEffect,
    setNonDirectPickerBurstLayers,
    setNonDirectPickerResponders,
    setNonDirectPickerTuneTrigger,
    getTimelineState
} from '$lib/calc/timeline.store.svelte'
import type { CharSlot } from '$lib/types/project'
import type { TimelineData } from '$lib/calc/timeline.types'

const TEAM = [
    { character: '甲', weapon: '武器A' },
    { character: '乙', weapon: '武器B' },
    { character: '丙', weapon: '武器C' }
] as unknown as [CharSlot, CharSlot, CharSlot]

/**
 * @desc 造一份「干净」的时间线。**每个用例的 id 必须不同**：`init` 对「数据指纹一致」会幂等短路，
 * 复用同一份数据会让上一个用例留下的伤害块继续存活。
 */
const makeTimeline = (tag: string): TimelineData => ({
    refLines: [],
    opBlocks: [
        { id: `nd-op-${tag}`, trackIndex: 0, pos: 120, key: '共鸣解放', desc: '', intro: false, switchback: false }
    ],
    damageBlocks: [
        {
            id: `nd-db-${tag}`,
            trackIndex: 3,
            sourceType: 'op',
            sourceId: `nd-op-${tag}`,
            skillHits: [],
            nonDirectEntries: []
        }
    ]
})

/** @desc 开一个只属于本用例的弹窗（操作块来源角色是「甲」） */
const openPicker = (tag: string) => {
    init(makeTimeline(tag), () => {}, TEAM, false)
    openNonDirectPicker('op', `nd-op-${tag}`)
}

const entriesOf = (tag: string) =>
    getTimelineState().damageBlocks.find((d) => d.sourceId === `nd-op-${tag}`)?.nonDirectEntries ?? []

describe('非直伤弹窗：触发者即开关', () => {
    it('没指定触发者的响应不写入（避免静默无效配置）', () => {
        openPicker('a')
        setNonDirectPickerResponders({ 震谐响应: [], 骇破响应: [] })
        applyNonDirectEntries()
        assert.deepEqual(entriesOf('a'), [])
    })

    it('打开弹窗不预设处决触发者：不点任何头像就确认，不会凭空多出处决伤害', () => {
        openPicker('b')
        applyNonDirectEntries()
        assert.deepEqual(entriesOf('b'), [], '未选择处决时不应写入处决条目')
    })

    it('点了触发者才算启用：处决单选、响应可多选，顺序固定为 处决 → 响应 → 效应', () => {
        openPicker('c')
        setNonDirectPickerTuneTrigger('乙')
        setNonDirectPickerResponders({ 震谐响应: ['甲', '丙'] })
        updateNonDirectPickerEffect('光噪效应', { layers: 3, hits: 2 })
        updateNonDirectPickerEffect('电磁效应', { layers: 5 })
        setNonDirectPickerBurstLayers({ burst: 2 })
        applyNonDirectEntries()

        assert.deepEqual(entriesOf('c'), [
            { name: '谐度破坏', category: '处决', layers: 0, responders: ['乙'] },
            { name: '震谐响应', category: '响应', layers: 0, responders: ['甲', '丙'] },
            { name: '光噪效应', category: '效应', layers: 3, hits: 2 },
            { name: '电磁效应', category: '效应', layers: 5, hits: 1 },
            { name: '电磁爆发', category: '效应', layers: 2 }
        ])
    })

    it('效应层数归 0 时段数一并复位，且不再写入', () => {
        openPicker('d')
        updateNonDirectPickerEffect('风蚀效应', { layers: 4, hits: 3 })
        updateNonDirectPickerEffect('风蚀效应', { layers: 0 })
        applyNonDirectEntries()
        assert.deepEqual(entriesOf('d'), [], '层数为 0 的效应不写入')
    })

    it('电磁爆发只在电磁效应也启用时才跟着写入', () => {
        openPicker('e')
        setNonDirectPickerBurstLayers({ burst: 3 })
        applyNonDirectEntries()
        assert.deepEqual(entriesOf('e'), [], '没有电磁效应时爆发无处挂靠')
    })
})
