// 复制工程（cloneProject）四阶段拷贝回归：历史上「除了队伍配置全是空白」的 bug 就出在这里。
//
// 复现要点：
// - encounter.<phase>.data 只在**锁定该环节**时落盘；未锁定的环节在工程里仍是旧值 / null。
// - 复制应把「当前打开工程」的内存态并回快照后再拷；非活动工程只能读快照。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { cloneProject, createProjectData, __seedProjectsForTest } from '../data/project.svelte.ts'
import type { Project } from '../types/project.ts'
import type { TimelineData } from '../calc/timeline.types.ts'
import type { ConfigState } from '../calc/config.types.ts'
import { init as initTimeline, getTimelineState } from '../calc/timeline.store.svelte.ts'
import { init as initCalculation, getCalcState } from '../calc/calculation.store.svelte.ts'
import { init as initConfig, getConfig } from '../calc/config.store.svelte.ts'

const TEAM = [
    { character: '甲', weapon: '武器A', triggerSets: [], echoes: [] },
    { character: '乙', weapon: '武器B', triggerSets: [], echoes: [] },
    { character: '丙', weapon: '武器C', triggerSets: [], echoes: [] }
] as unknown as Project['team']

/** 最小但**结构完整**的时间线（timeline.store 的 init 会读 refLines.length 等字段） */
const timelineWith = (blockId: string): TimelineData => ({
    refLines: [],
    opBlocks: [],
    damageBlocks: [
        {
            id: blockId,
            trackIndex: 0,
            sourceType: 'op',
            sourceId: `op-${blockId}`,
            skillHits: [],
            nonDirectEntries: []
        }
    ]
})

const configWith = (defense: number): ConfigState =>
    ({
        characters: [],
        enemy: { type: 'BOSS', level: 90, defense, resistances: {}, dmgReduction: 0 }
    }) as unknown as ConfigState

/** 造一份「工程快照里 timeline/config 为 null、但内存 store 里有数据」的活跃工程 */
function makeProjectWithBlankSnapshot(id: string, name: string): Project {
    const p = createProjectData(name)
    p.id = id
    p.team = JSON.parse(JSON.stringify(TEAM)) as Project['team']
    // 刻意留空：模拟"改完还没锁定"
    p.encounter.timeline.data = null
    p.encounter.config.data = null
    p.encounter.calculation.data = null
    p.phases.timeline = { locked: false, data: null }
    p.phases.config = { locked: false, data: null }
    p.phases.calculation = { locked: false, data: null }
    return p
}

const ALL_PHASES = ['team', 'timeline', 'calculation', 'config'] as const

describe('cloneProject：四阶段拷贝', () => {
    it('活动工程的未锁定环节：从内存 store 取活状态，不读空快照', async () => {
        const source = makeProjectWithBlankSnapshot('src-active', '源工程')
        __seedProjectsForTest([source], 'src-active')

        // 内存态：排轴有一个伤害块、词条配置有敌人数据、拉表有状态
        initTimeline(timelineWith('live-block'), () => {}, source.team, false)
        initConfig(configWith(1234), false)
        initCalculation(source.team, getTimelineState(), null, false, () => {})

        const live = getTimelineState()
        assert.ok(live, '存活状态应可读')
        assert.ok(getConfig(), '活配置应可读')
        assert.ok(getCalcState(), '活拉表态应可读')

        const cloned = await cloneProject('src-active', '副本', [...ALL_PHASES])
        assert.ok(cloned, '克隆应返回新工程')
        assert.ok(cloned!.encounter.timeline.data, '副本的排轴数据不能为空')
        assert.ok(cloned!.encounter.config.data, '副本的词条配置不能为空')
        assert.ok(cloned!.encounter.calculation.data, '副本的拉表数据不能为空')
        // 视图层读的是 phases，必须一起被写出来
        assert.ok(cloned!.phases.timeline.data, '副本的 phases.timeline 不能为空')
        assert.ok(cloned!.phases.config.data, '副本的 phases.config 不能为空')
        assert.ok(cloned!.phases.calculation.data, '副本的 phases.calculation 不能为空')
        assert.deepEqual(cloned!.team, source.team, '队伍配置应被复制')
    })

    it('非活动工程：只读快照，内存态不串味', async () => {
        const active = makeProjectWithBlankSnapshot('p-active', '当前工程')
        const other = makeProjectWithBlankSnapshot('p-other', '另一个工程')
        // 另一个工程快照里本来就有排轴数据
        other.encounter.timeline.data = timelineWith('from-other')
        other.phases.timeline = { locked: false, data: other.encounter.timeline.data }
        __seedProjectsForTest([active, other], 'p-active')

        // 内存态属于 active 工程
        initTimeline(timelineWith('from-active'), () => {}, active.team, false)
        initConfig(configWith(999), false)
        initCalculation(active.team, getTimelineState(), null, false, () => {})

        const cloned = await cloneProject('p-other', '另一个副本', [...ALL_PHASES])
        assert.ok(cloned!.encounter.timeline.data, '应复制它自己快照里的排轴数据')
        const blocks = (cloned!.encounter.timeline.data as { damageBlocks: { id: string }[] }).damageBlocks
        assert.equal(blocks[0]?.id, 'from-other', '不能把活动工程的内存态串进来')
        assert.equal(cloned!.encounter.config.data, null, '它自己没有配置快照，仍应为空')
    })

    it('未勾选的阶段不复制', async () => {
        const source = makeProjectWithBlankSnapshot('p2', '源')
        source.encounter.timeline.data = timelineWith('x')
        __seedProjectsForTest([source], '')
        const cloned = await cloneProject('p2', '只复制队伍', ['team'])
        assert.equal(cloned!.encounter.timeline.data, null, '未勾选排轴 → 不应复制')
        assert.ok(cloned!.phases.timeline, 'phases 视图仍存在')
    })
})
