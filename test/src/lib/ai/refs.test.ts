// 「序号寻址」回归：AI 工具对外只用序号，不暴露内部 id。
//
// 三条约定（见 refs.ts）：
// 1. 顺序即序号：操作块/参考线/伤害条目按时间先后编号，工程 Buff 配置按工程配置顺序；
// 2. 入参兼容原始 id（旧消息里的 id 不会失效），但摘要只输出序号；
// 3. 定位失败报错要精准：给出总数与可选清单，模型能自我纠正。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
    asIndex,
    damageEntriesInOrder,
    opBlocksInOrder,
    resolveBuffConf,
    resolveDamageEntry,
    resolveOpBlock,
    resolveRefLine
} from '$lib/ai/refs'
import { init as initTimeline } from '$lib/calc/timeline.store.svelte'
import { createProjectData, __seedProjectsForTest } from '$lib/data/project.svelte'
import { init as initCalculation, getAllBuffSets, createBuffSet } from '$lib/calc/calculation.store.svelte'
import type { CharSlot } from '$lib/types/project'
import type { TimelineData } from '$lib/calc/timeline.types'

const SIDE_PAD = 40
const PPS = 80
const posOfSeconds = (s: number): number => SIDE_PAD + s * PPS

const TEAM = [
    { character: '甲', weapon: null },
    { character: '乙', weapon: null },
    { character: '丙', weapon: null }
] as unknown as [CharSlot, CharSlot, CharSlot]

/** @desc 搭一份「乱序存入、时间上分明」的时间线：3 个操作块 + 2 条参考线 */
const TIMELINE: TimelineData = {
    refLines: [
        { id: 'rl-late', time: '2m', pos: posOfSeconds(2) },
        { id: 'rl-early', time: '1m', pos: posOfSeconds(1) }
    ],
    opBlocks: [
        { id: 'op-3', trackIndex: 2, pos: posOfSeconds(3), key: '共鸣解放', desc: '', intro: false, switchback: false },
        { id: 'op-1', trackIndex: 0, pos: posOfSeconds(0), key: '普攻', desc: '', intro: false, switchback: false },
        {
            id: 'op-2',
            trackIndex: 1,
            pos: posOfSeconds(0.5),
            key: '共鸣技能',
            desc: '',
            intro: false,
            switchback: false
        }
    ],
    damageBlocks: [
        {
            id: 'db-1',
            trackIndex: 0,
            sourceType: 'op',
            sourceId: 'op-1',
            skillHits: [
                { character: '甲', skillType: '共鸣技能', hitName: '共鸣技能伤害', ratio: '100%', element: '冷凝' }
            ],
            nonDirectEntries: []
        }
    ]
}

const setup = () => {
    const project = createProjectData('序号测试')
    project.team = TEAM
    __seedProjectsForTest([project], project.id)
    initTimeline(TIMELINE, () => {}, TEAM, false)
    initCalculation(TEAM, TIMELINE, null, false, () => {})
}

describe('序号解析：顺序即序号', () => {
    it('操作块按时间先后编号（与存储顺序无关）', () => {
        setup()
        assert.deepEqual(
            opBlocksInOrder().map((b) => b.id),
            ['op-1', 'op-2', 'op-3']
        )
        assert.equal(resolveOpBlock(1).id, 'op-1')
        assert.equal(resolveOpBlock(2).id, 'op-2')
        assert.equal(resolveOpBlock(3).id, 'op-3')
        assert.equal(resolveOpBlock('2').id, 'op-2', '数字字符串同样按序号')
    })

    it('参考线按时间先后编号', () => {
        setup()
        assert.equal(resolveRefLine(1).id, 'rl-early')
        assert.equal(resolveRefLine(2).id, 'rl-late')
    })

    it('仍兼容原始 id（旧消息里的 id 不会失效）', () => {
        setup()
        assert.equal(resolveOpBlock('op-2').id, 'op-2')
        assert.equal(resolveRefLine('rl-late').id, 'rl-late')
        assert.equal(asIndex('op-2'), null, '非纯数字按 id 处理')
        assert.equal(asIndex(3), 3)
        assert.equal(asIndex('03'), 3)
        assert.equal(asIndex(0), null, '序号从 1 起')
    })

    it('工程 Buff 配置序号 = 工程配置顺序', () => {
        setup()
        createBuffSet('甲套装')
        createBuffSet('乙武器')
        const names = getAllBuffSets().map((b) => b.name)
        assert.deepEqual(names, ['甲套装', '乙武器'])
        assert.equal(resolveBuffConf(1).name, '甲套装')
        assert.equal(resolveBuffConf(2).name, '乙武器')
    })

    it('伤害条目按时间轴先后编号', () => {
        setup()
        const ids = damageEntriesInOrder().map((e) => e.id)
        assert.ok(ids.length > 0, '时间线上应能派生出伤害条目')
        assert.equal(resolveDamageEntry(1).id, ids[0])
    })
})

describe('序号解析：报错要精准', () => {
    it('序号超出范围时给出总数与可选清单', () => {
        setup()
        assert.throws(
            () => resolveOpBlock(9),
            (e: Error) => {
                assert.match(e.message, /操作块序号超出范围：9/)
                assert.match(e.message, /共 3 个，序号 1-3/)
                assert.match(e.message, /1=轨1 甲·普攻/, '清单里给出序号与标签')
                return true
            }
        )
    })

    it('按 id 找不到时提示改用序号', () => {
        setup()
        assert.throws(() => resolveRefLine('rl-nope'), /未找到参考线「rl-nope」。请用序号定位（序号 1-2）/)
    })

    it('空参数给出用法提示', () => {
        setup()
        assert.throws(() => resolveOpBlock(undefined), /缺少操作块序号（先用 get_timeline_summary 查看时间线）/)
        assert.throws(() => resolveBuffConf(''), /缺少工程 Buff 配置序号（先用 get_buff_confs 查看清单）/)
    })
})
