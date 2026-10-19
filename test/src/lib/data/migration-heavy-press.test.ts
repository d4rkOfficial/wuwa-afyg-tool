// v4 → v5：旧版靠备注区分重击的「普攻块」升级为独立的重击图标块。
//
// 旧约定（本次迁移的输入）：
//   - 快速排轴录入的重击块 = key MouseLeft + 备注「重击」（当时重击与普攻共用图标，只能靠文字区分）；
//   - 历史数据里还存在用 z / Z 开头的备注（z、Z、z1、Z12，数字可空、其后可跟任意内容），是用户手写的补充信息。
// 新约定（本次迁移的输出）：
//   - 备注恰好是「重击」→ 换成重击图标 MouseLeftHold，备注清空（图标已能区分）；
//   - 备注以 z / Z 开头（可紧跟数字）→ 只换图标，备注原样保留（备注里带着用户写的段数/说明）。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { migrateProject, VERSIONLESS_ASSUME_CURRENT_AFTER } from '$lib/data/migration'
import { PROJECT_VERSION } from '$lib/types/project'
import type { OpBlock, TimelineData } from '$lib/calc/timeline.types'

const block = (id: string, key: string, desc: string, extra: Partial<OpBlock> = {}): OpBlock => ({
    id,
    trackIndex: 0,
    pos: 100,
    key,
    desc,
    intro: false,
    switchback: false,
    ...extra
})

const timelineOf = (opBlocks: OpBlock[]): TimelineData => ({ refLines: [], opBlocks, damageBlocks: [] })

/**
 * @desc 造一份 v4（迁移前）工程。
 * `encounter` = IndexedDB 里的真源形态；`phases` = 本地导出 / 工坊文件的兼容视图形态。
 */
const v4Project = (opBlocks: OpBlock[], shape: 'encounter' | 'phases' = 'encounter'): Record<string, unknown> => {
    const timeline = timelineOf(opBlocks)
    const phases = {
        team: { locked: false, data: null },
        timeline: { locked: false, data: timeline },
        calculation: { locked: false, data: null },
        config: { locked: false, data: null }
    }
    return {
        version: 4,
        id: 'p-heavy-press',
        name: '重击块迁移',
        createdAt: 1,
        customSkillHits: {},
        ...(shape === 'encounter'
            ? {
                  encounter: {
                      teamLocked: false,
                      timeline: { locked: false, data: timeline },
                      calculation: { locked: false, data: null },
                      config: { locked: false, data: null }
                  }
              }
            : { phases })
    }
}

const migratedBlocks = (raw: Record<string, unknown>): OpBlock[] =>
    migrateProject(raw).encounter.timeline.data!.opBlocks

describe('v4 → v5：旧「备注即重击」的普攻块升级为独立重击块', () => {
    it('备注「重击」→ 换成 MouseLeftHold 并清空备注', () => {
        const [only] = migratedBlocks(v4Project([block('b1', 'MouseLeft', '重击')]))
        assert.equal(only.key, 'MouseLeftHold')
        assert.equal(only.desc, '')
    })

    it('备注为 z / Z / z1 / Z12 的普攻块：换成重击图标，备注保留', () => {
        const blocks = migratedBlocks(
            v4Project([
                block('b1', 'MouseLeft', 'z'),
                block('b2', 'MouseLeft', 'Z'),
                block('b3', 'MouseLeft', 'z1'),
                block('b4', 'MouseLeft', 'Z12')
            ])
        )
        assert.deepEqual(
            blocks.map((b) => b.key),
            ['MouseLeftHold', 'MouseLeftHold', 'MouseLeftHold', 'MouseLeftHold']
        )
        assert.deepEqual(
            blocks.map((b) => b.desc),
            ['z', 'Z', 'z1', 'Z12']
        )
    })

    it('z/Z + 数字（数字可空）+ 任意后缀都算重击块，后缀原样保留', () => {
        const blocks = migratedBlocks(
            v4Project([
                block('b1', 'MouseLeft', 'z3后摇'),
                block('b2', 'MouseLeft', 'Zabc'),
                block('b3', 'MouseLeft', 'z 1'),
                block('b4', 'MouseLeft', 'z12 接闪避')
            ])
        )
        assert.deepEqual(
            blocks.map((b) => [b.key, b.desc]),
            [
                ['MouseLeftHold', 'z3后摇'],
                ['MouseLeftHold', 'Zabc'],
                ['MouseLeftHold', 'z 1'],
                ['MouseLeftHold', 'z12 接闪避']
            ]
        )
    })

    it('不命中旧约定的块原样保留（只认「重击」或 z/Z 开头）', () => {
        const blocks = migratedBlocks(
            v4Project([
                block('b1', 'MouseLeft', '重击后摇'),
                block('b2', 'MouseLeft', 'v1'),
                block('b3', 'MouseLeft', ''),
                block('b4', 'MouseLeft', 'az1'),
                block('b5', 'MouseLeft', '1z')
            ])
        )
        assert.deepEqual(
            blocks.map((b) => [b.key, b.desc]),
            [
                ['MouseLeft', '重击后摇'],
                ['MouseLeft', 'v1'],
                ['MouseLeft', ''],
                ['MouseLeft', 'az1'],
                ['MouseLeft', '1z']
            ]
        )
    })

    it('非普攻块不参与映射（避免把 Q/E 等技能块的备注 z1 误当成重击）', () => {
        const blocks = migratedBlocks(v4Project([block('b1', 'Q', '重击'), block('b2', 'E', 'z1')]))
        assert.deepEqual(
            blocks.map((b) => [b.key, b.desc]),
            [
                ['Q', '重击'],
                ['E', 'z1']
            ]
        )
    })

    it('只换图标，位置/轨道/变奏标记/伤害绑定和 z 备注都保留', () => {
        const raw = v4Project([block('b1', 'MouseLeft', 'z2', { trackIndex: 2, pos: 321, intro: true })])
        const data = migrateProject(raw).encounter.timeline.data!
        assert.deepEqual(data.opBlocks[0], {
            id: 'b1',
            trackIndex: 2,
            pos: 321,
            key: 'MouseLeftHold',
            desc: 'z2',
            intro: true,
            switchback: false
        })
        assert.deepEqual(data.damageBlocks, [])
    })

    it('导出文件形态（四阶段数据只在兼容视图 phases 里）同样迁移', () => {
        const project = migrateProject(v4Project([block('b1', 'MouseLeft', '重击')], 'phases'))
        assert.equal(project.encounter.timeline.data!.opBlocks[0].key, 'MouseLeftHold')
        const viewTimeline = project.phases.timeline.data as TimelineData
        assert.equal(viewTimeline.opBlocks[0].desc, '')
    })

    it('版本号提升到当前版本（5）', () => {
        const project = migrateProject(v4Project([block('b1', 'MouseLeft', '重击')]))
        assert.equal(PROJECT_VERSION, 5)
        assert.equal(project.version, PROJECT_VERSION)
    })

    it('幂等：同一份数据迁移两次结果不变', () => {
        const raw = v4Project([
            block('b1', 'MouseLeft', '重击'),
            block('b2', 'MouseLeft', 'z3'),
            block('b3', 'MouseLeft', '普通备注'),
            block('b4', 'MouseRight', '重击')
        ])
        const once = migrateProject(raw)
        const twice = migrateProject(once)
        assert.deepEqual(twice, once)
    })
})

describe('无版本号的工坊下载件同样兜底升级', () => {
    it('版本号被吃掉（迁移链不跑）时，旧备注块仍然换成重击块', () => {
        const raw = {
            ...v4Project([block('b1', 'MouseLeft', '重击')]),
            version: undefined,
            exportedAt: VERSIONLESS_ASSUME_CURRENT_AFTER + 86400000
        }
        const project = migrateProject(raw)
        assert.equal(project.encounter.timeline.data!.opBlocks[0].key, 'MouseLeftHold')
        assert.equal(project.encounter.timeline.data!.opBlocks[0].desc, '')
    })
})
