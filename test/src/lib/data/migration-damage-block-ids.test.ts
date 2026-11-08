// 伤害块 id 去重（幂等兜底）：`addDamageBlock` 早期用 `d${Date.now()}` 取 id，同毫秒连建多块就撞车，
// 而伤害条目 id 由块 id 派生 ⇒ 拉表 `{#each … (entry.id)}` 抛 each_key_duplicate 整表白屏。
// 这里锁住两件事：
//   ① `dedupeDamageBlockIds()` 把「首个保留、后续追加 -2/-3」，且无重复时不动数据；
//   ② `migrateProject()` 每次载入（含无版本号下载件）都会跑这条兜底；
//   ③ `buildDamageEntriesFromTimeline()` 自身也保证条目 id 唯一（同块内重复命中行同样会撞车）。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { dedupeDamageBlockIds, migrateProject } from '$lib/data/migration'
import { buildDamageEntriesFromTimeline } from '$lib/calc/calculation.store.svelte'
import type { DamageBlock, TimelineData } from '$lib/calc/timeline.types'
import type { CharSlot } from '$lib/types/project'

const HIT = {
    character: '今汐',
    skillType: '延奏技能',
    hitName: '延奏技能伤害',
    ratio: '100%',
    hits: 1,
    element: '衍射'
}

const damageBlock = (id: string, hits = [HIT] as DamageBlock['skillHits']): DamageBlock => ({
    id,
    trackIndex: 0,
    sourceType: 'op',
    sourceId: `op-${id}`,
    skillHits: hits,
    nonDirectEntries: []
})

const timelineOf = (damageBlocks: DamageBlock[]): TimelineData => ({ refLines: [], opBlocks: [], damageBlocks })

const projectOf = (damageBlocks: DamageBlock[]): Record<string, unknown> => {
    const timeline = timelineOf(damageBlocks)
    return {
        version: 5,
        id: 'p-dupe-damage-blocks',
        name: '伤害块 id 去重',
        createdAt: 1,
        customSkillHits: {},
        encounter: {
            teamLocked: false,
            timeline: { locked: false, data: timeline },
            calculation: { locked: false, data: null },
            config: { locked: false, data: null }
        }
    }
}

const team: [CharSlot, CharSlot, CharSlot] = ['今汐', null, null].map(() => ({}) as CharSlot) as [
    CharSlot,
    CharSlot,
    CharSlot
]

describe('dedupeDamageBlockIds', () => {
    it('无重复时原样返回（引用不变，保证幂等）', () => {
        const tl = timelineOf([damageBlock('d1'), damageBlock('d2')])
        assert.equal(dedupeDamageBlockIds(tl), tl)
    })

    it('重复 id：首个保留，其后追加 -2 / -3', () => {
        const tl = timelineOf([damageBlock('dX'), damageBlock('dX'), damageBlock('dX')])
        const out = dedupeDamageBlockIds(tl) as TimelineData
        assert.deepEqual(
            out.damageBlocks.map((b) => b.id),
            ['dX', 'dX-2', 'dX-3']
        )
    })

    it('已经存在 -2 时跳过，不与既有 id 二次撞车', () => {
        const tl = timelineOf([damageBlock('dX'), damageBlock('dX-2'), damageBlock('dX')])
        const out = dedupeDamageBlockIds(tl) as TimelineData
        assert.deepEqual(
            out.damageBlocks.map((b) => b.id),
            ['dX', 'dX-2', 'dX-3']
        )
    })

    it('只改 id，其余字段（命中列表/轨道/来源）原样保留', () => {
        const tl = timelineOf([damageBlock('dX'), damageBlock('dX')])
        const out = dedupeDamageBlockIds(tl) as TimelineData
        assert.equal(out.damageBlocks[1].sourceId, 'op-dX')
        assert.equal(out.damageBlocks[1].trackIndex, 0)
        assert.deepEqual(out.damageBlocks[1].skillHits, [HIT])
    })

    it('非时间线 / 没有伤害块时安全返回', () => {
        assert.equal(dedupeDamageBlockIds(null), null)
        assert.deepEqual(dedupeDamageBlockIds({ refLines: [], opBlocks: [] }), {
            refLines: [],
            opBlocks: []
        })
    })

    it('迁移链路上生效：载入即修好重复 id', () => {
        const project = migrateProject(projectOf([damageBlock('dX'), damageBlock('dX')]))
        const ids = project.encounter.timeline.data!.damageBlocks.map((b) => b.id)
        assert.deepEqual(ids, ['dX', 'dX-2'])
    })

    it('迁移幂等：再跑一次不再变化', () => {
        const once = migrateProject(projectOf([damageBlock('dX'), damageBlock('dX')]))
        const twice = migrateProject(once)
        assert.deepEqual(twice, once)
    })
})

describe('buildDamageEntriesFromTimeline 生成的条目 id 恒唯一', () => {
    it('两个伤害块共用同一 id（历史数据）时，条目 id 不撞车', () => {
        const entries = buildDamageEntriesFromTimeline(timelineOf([damageBlock('dX'), damageBlock('dX')]), team)
        const ids = entries.map((e) => e.id)
        assert.equal(ids.length, 2)
        assert.equal(new Set(ids).size, 2)
    })

    it('同一块内两条完全相同的命中行也不撞车', () => {
        const entries = buildDamageEntriesFromTimeline(timelineOf([damageBlock('dX', [HIT, HIT])]), team)
        const ids = entries.map((e) => e.id)
        assert.equal(new Set(ids).size, ids.length)
    })

    it('不冲突时条目 id 形态不变（与 pane-effects 的 id 口径保持一致）', () => {
        const entries = buildDamageEntriesFromTimeline(timelineOf([damageBlock('dX')]), team)
        assert.equal(entries[0].id, 'dX-延奏技能|延奏技能伤害#攻击')
    })
})
