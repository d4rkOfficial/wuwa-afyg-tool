// 排轴「短索引寻址」回归：AI 工具对外只用短索引（拉表/配装仍用位置序号），摘要不暴露内部 id。
//
// 四条约定（见 refs.ts）：
// 1. 排轴的短索引是内部 id 的纯函数投影 —— 移动 / 删除 / 重排都**不会**让它指向别的条目；
// 2. 入参仍兼容内部 id（WS / 脚本要精确寻址，旧消息里的 id 也不会失效）；
// 3. 位置序号在排轴域**已废弃**：传数字不再被当作「第几个」，避免静默指错块；
// 4. 定位失败报错要精准：给出可用短索引清单，模型能自我纠正；短索引碰撞必须报错而非取第一个。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
    asIndex,
    damageEntriesInOrder,
    opBlockKey,
    opBlocksInOrder,
    refLineKey,
    resolveBuffConf,
    resolveDamageEntry,
    resolveOpBlock,
    resolveRefLine
} from '$lib/ai/refs'
import { shortKeyOf } from '$lib/ai/short-key'
import { init as initTimeline, setOpBlockPos } from '$lib/calc/timeline.store.svelte'
import { createProjectData, __seedProjectsForTest } from '$lib/data/project.svelte'
import { init as initCalculation, getAllBuffConfs, createBuffSet } from '$lib/calc/calculation.store.svelte'
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

const op = (id: string, trackIndex: number, pos: number, key: string): TimelineData['opBlocks'][number] => ({
    id,
    trackIndex,
    pos,
    key,
    desc: '',
    intro: false,
    switchback: false
})

/** @desc 搭一份「乱序存入、时间上分明」的时间线：3 个操作块 + 2 条参考线 */
const TIMELINE: TimelineData = {
    refLines: [
        { id: 'rl-late', name: '2m', pos: posOfSeconds(2) },
        { id: 'rl-early', name: '1m', pos: posOfSeconds(1) }
    ],
    opBlocks: [
        op('op-3', 2, posOfSeconds(3), '共鸣解放'),
        op('op-1', 0, posOfSeconds(0), '普攻'),
        op('op-2', 1, posOfSeconds(0.5), '共鸣技能')
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

const setup = (timeline: TimelineData = TIMELINE) => {
    const project = createProjectData('短索引测试')
    project.team = TEAM
    __seedProjectsForTest([project], project.id)
    // 先以 null 重置一次：store 的 init 有「数据指纹未变则短路」的优化，
    // 同一份 TIMELINE 反复 init 不会真正重建（上一个用例可能已移动过块）。
    initTimeline(null, () => {}, TEAM, false)
    initTimeline(timeline, () => {}, TEAM, false)
    initCalculation(TEAM, timeline, null, false, () => {})
}

describe('短索引解析：排轴按 id 派生，不随位置漂移', () => {
    it('操作块按短索引定位（与存储顺序、展示顺序都无关）', () => {
        setup()
        assert.deepEqual(
            opBlocksInOrder().map((b) => b.id),
            ['op-1', 'op-2', 'op-3'],
            '展示顺序仍按 pos'
        )
        assert.equal(resolveOpBlock(shortKeyOf('op-1')).id, 'op-1')
        assert.equal(resolveOpBlock(shortKeyOf('op-2')).id, 'op-2')
        assert.equal(resolveOpBlock(shortKeyOf('op-3')).id, 'op-3')
        assert.equal(
            opBlockKey(op('op-2', 1, posOfSeconds(0.5), '共鸣技能')),
            shortKeyOf('op-2'),
            '短索引是 id 的纯函数'
        )
    })

    it('参考线同样用短索引', () => {
        setup()
        assert.equal(resolveRefLine(shortKeyOf('rl-early')).id, 'rl-early')
        assert.equal(resolveRefLine(shortKeyOf('rl-late')).id, 'rl-late')
        assert.equal(refLineKey({ id: 'rl-late', name: '2m', pos: posOfSeconds(2) }), shortKeyOf('rl-late'))
    })

    it('把块移到最前面后，短索引仍指向同一个块（位置序号会指错，这正是废弃它的原因）', () => {
        setup()
        const key = shortKeyOf('op-3')
        assert.equal(resolveOpBlock(key).id, 'op-3')
        // op-3 原本排最后，移到最前（pos=0）
        setOpBlockPos('op-3', 0)
        assert.equal(opBlocksInOrder()[0].id, 'op-3', '展示顺序已改变')
        assert.equal(resolveOpBlock(key).id, 'op-3', '短索引不受影响')
        assert.notEqual(opBlocksInOrder()[0].id, 'op-1')
        // 若此刻用「第 1 个」去寻址，会落到 op-3 上 —— 与操作前的第 1 个不同
        assert.throws(() => resolveOpBlock(1), /未找到操作块「1」/, '位置序号已废弃，直接报错而不是静默指错')
    })

    it('仍兼容内部 id（WS / 脚本精确寻址，旧消息不失效）', () => {
        setup()
        assert.equal(resolveOpBlock('op-2').id, 'op-2')
        assert.equal(resolveRefLine('rl-late').id, 'rl-late')
        assert.equal(asIndex(3), 3, 'asIndex 仍供拉表/配装用')
        assert.equal(asIndex('op-2'), null, '非纯数字按 id 处理')
    })

    it('工程 Buff 配置序号 = 工程配置顺序（拉表/配装仍是位置序号）', () => {
        setup()
        createBuffSet('甲套装')
        createBuffSet('乙武器')
        const names = getAllBuffConfs().map((b) => b.name)
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

describe('短索引解析：报错要精准', () => {
    it('找不到时给出可用短索引清单（含短索引=标签）', () => {
        setup()
        assert.throws(
            () => resolveOpBlock('zzzzz'),
            (e: Error) => {
                assert.match(e.message, /未找到操作块「zzzzz」/)
                assert.match(e.message, new RegExp(`${shortKeyOf('op-1')}=轨1 甲·普攻`), '清单里给出短索引与标签')
                return true
            }
        )
    })

    it('数字参数不再被当作位置序号', () => {
        setup()
        assert.throws(() => resolveOpBlock(9), /未找到操作块「9」/)
        assert.throws(() => resolveRefLine(1), /未找到参考线「1」/)
    })

    it('空参数给出用法提示', () => {
        setup()
        assert.throws(() => resolveOpBlock(undefined), /缺少操作块短索引（先用 get_timeline_summary 查看时间线）/)
        assert.throws(() => resolveBuffConf(''), /缺少工程 Buff 配置序号（先用 get_buff_confs 查看清单）/)
    })

    it('短索引碰撞（内部 id 碰撞）必须报错，不能静默取第一个', () => {
        // op-7447 与 op-59200 的 FNV-1a 取模结果相同（实测碰撞对），用它验证碰撞检测
        const collided: TimelineData = {
            refLines: [],
            opBlocks: [op('op-7447', 0, 0, '普攻'), op('op-59200', 1, 100, '共鸣技能')],
            damageBlocks: []
        }
        setup(collided)
        assert.equal(shortKeyOf('op-7447'), shortKeyOf('op-59200'), '前提：两个 id 派生同一短索引')
        assert.throws(() => resolveOpBlock(shortKeyOf('op-7447')), /短索引冲突：.+ 命中 2 个操作块/)
    })
})
