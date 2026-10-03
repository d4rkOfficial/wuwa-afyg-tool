// 导出 → 导入 往返回归：历史上「导入工程后除了队伍配置全是空白」的 bug 出在这里。
//
// 复现要点：
// - `buildExportFile` 写的是**兼容期视图** `phases`（以及顶层 buffs / team），**不写真源 `encounter`**。
// - `migrateProject` 只从 `data.encounter` 取四阶段数据，于是导出的文件一进迁移器
//   就被读成「四阶段全空」。`syncLegacyIntoNew` 随后又从（已空的）phases 回填 encounter，
//   两个方向互相确认空值 → 排轴 / 拉表 / 词条配置 / buff 列表全部丢失，只剩 team。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { buildExportFile, getPhaseOrder, getProjects, importProjects, parseProjectFile } from '$lib/data/project.svelte'
import { createProjectData, __seedProjectsForTest } from '$lib/data/project.svelte'
import type { Project } from '$lib/types/project'
import type { TimelineData } from '$lib/calc/timeline.types'
import type { CalcState } from '$lib/calc/calculation.types'
import type { ConfigState } from '$lib/calc/config.types'
import { init as initTimeline, getTimelineState } from '$lib/calc/timeline.store.svelte'
import { init as initCalculation } from '$lib/calc/calculation.store.svelte'
import { init as initConfig } from '$lib/calc/config.store.svelte'

const TEAM = [
    { character: '甲', weapon: '武器A', triggerSets: [], echoes: [] },
    { character: '乙', weapon: '武器B', triggerSets: [], echoes: [] },
    { character: '丙', weapon: '武器C', triggerSets: [], echoes: [] }
] as unknown as Project['team']

const timelineWith = (blockId: string): TimelineData =>
    ({
        refLines: [],
        opBlocks: [],
        damageBlocks: [{ id: blockId, trackIndex: 0, sourceType: 'op', sourceId: `op-${blockId}` }]
    }) as unknown as TimelineData

const calcStateWith = (buffId: string, buffName: string): CalcState =>
    ({
        buffSets: [{ id: buffId, name: buffName, scope: 'all', zones: [{ zoneId: 'atkPct', value: 12 }] }],
        damageEntryBuffSetIds: { e1: [buffId] },
        damageEntryDamageTypes: { e1: ['普攻伤害'] }
    }) as unknown as CalcState

const configWith = (defense: number): ConfigState =>
    ({
        characters: [],
        enemy: { type: 'BOSS', level: 90, defense, resistances: {}, dmgReduction: 0 }
    }) as unknown as ConfigState

/** @desc 造一份四阶段都有数据、处于锁定态的工程（模拟用户正常导出前的工程） */
const makeFullProject = (id: string, name: string): Project => {
    const p = createProjectData(name)
    p.id = id
    p.team = JSON.parse(JSON.stringify(TEAM)) as Project['team']
    p.encounter.timeline = { locked: true, data: timelineWith('block-1') }
    p.encounter.calculation = { locked: true, data: calcStateWith('buff-1', '攻击加成') }
    p.encounter.config = { locked: true, data: configWith(4321) }
    p.encounter.teamLocked = true
    p.buffs = calcStateWith('buff-1', '攻击加成').buffSets
    return p
}

/** @desc 走完整导入链路：导出文件 → JSON → parseProjectFile → importProjects */
const roundTrip = (source: Project): Project => {
    const file = buildExportFile(source, getPhaseOrder(), true)
    __seedProjectsForTest([], '')
    importProjects(parseProjectFile(JSON.stringify(file)))
    const imported = getProjects().at(-1)
    assert.ok(imported, '导入后应能在工程列表里找到新工程')
    return imported
}

describe('导出 → 导入 往返：四阶段数据不能丢', () => {
    it('排轴 / 拉表 / 词条配置都完整保留', () => {
        const imported = roundTrip(makeFullProject('src-1', '源工程'))

        assert.ok(imported.encounter.timeline.data, '导入后排轴数据不能为空')
        assert.ok(imported.encounter.calculation.data, '导入后拉表数据不能为空')
        assert.ok(imported.encounter.config.data, '导入后词条配置不能为空')
    })

    it('兼容期视图 phases 也要一并写出来（页面读的是 phases.<phase>.data）', () => {
        const imported = roundTrip(makeFullProject('src-2', '源工程'))

        assert.ok(imported.phases.timeline.data, 'phases.timeline 不能为空')
        assert.ok(imported.phases.calculation.data, 'phases.calculation 不能为空')
        assert.ok(imported.phases.config.data, 'phases.config 不能为空')
    })

    it('内容值级比对：不是「有对象就算过」', () => {
        const source = makeFullProject('src-3', '源工程')
        const imported = roundTrip(source)

        const blocks = (imported.encounter.timeline.data as TimelineData).damageBlocks
        assert.equal(blocks[0]?.id, 'block-1', '排轴伤害块内容应一致')

        const calc = imported.encounter.calculation.data as CalcState
        assert.equal(calc.buffSets[0]?.id, 'buff-1', 'buff 列表应保留')
        assert.equal(calc.buffSets[0]?.zones[0]?.value, 12, 'buff 数值应保留')
        assert.deepEqual(calc.damageEntryBuffSetIds, { e1: ['buff-1'] }, '条目↔buff 绑定应保留')
        assert.deepEqual(calc.damageEntryDamageTypes, { e1: ['普攻伤害'] }, '条目伤害类型应保留')

        assert.equal((imported.encounter.config.data as ConfigState).enemy.defense, 4321, '敌人防御应保留')
        // 队伍槽位会被 normalizeTeam 补全（echoes 补 5 个空槽、chain/refinement 补默认值），只比对实质字段
        assert.deepEqual(
            imported.team.map((s) => [s.character, s.weapon]),
            source.team.map((s) => [s.character, s.weapon]),
            '队伍配置应保留'
        )

        // 顶层 buffs（真源）与拉表态里的 buffSets 必须一致
        assert.equal(imported.buffs[0]?.id, 'buff-1', '顶层 buffs 真源应保留')
    })

    it('导入后锁定态保留', () => {
        const imported = roundTrip(makeFullProject('src-4', '源工程'))
        assert.equal(imported.encounter.teamLocked, true)
        assert.equal(imported.encounter.timeline.locked, true)
        assert.equal(imported.encounter.calculation.locked, true)
        assert.equal(imported.encounter.config.locked, true)
    })
})

describe('导出：活动工程未锁定的环节要取内存实时态', () => {
    /** @desc 快照为空（改完还没锁定）但内存 store 里有数据的活动工程 —— 与复制工程同一个坑 */
    const makeUnlockedProject = (id: string, name: string): Project => {
        const p = createProjectData(name)
        p.id = id
        p.team = JSON.parse(JSON.stringify(TEAM)) as Project['team']
        p.encounter.timeline.data = null
        p.encounter.calculation.data = null
        p.encounter.config.data = null
        return p
    }

    it('导出文件里四阶段数据不为空（否则导入必然是空白工程）', () => {
        const source = makeUnlockedProject('live-1', '未锁定工程')
        __seedProjectsForTest([source], 'live-1')
        initTimeline(timelineWith('live-block'), () => {}, source.team, false)
        initConfig(configWith(777), false)
        initCalculation(source.team, getTimelineState(), calcStateWith('buff-live', '实时buff'), false, () => {})

        const file = buildExportFile(source, getPhaseOrder(), true) as {
            project: { phases: Record<string, { data: unknown }> }
        }
        assert.ok(file.project.phases.timeline.data, '排轴：导出必须带上内存实时态')
        assert.ok(file.project.phases.calculation.data, '拉表：导出必须带上内存实时态')
        assert.ok(file.project.phases.config.data, '词条配置：导出必须带上内存实时态')

        const blocks = (file.project.phases.timeline.data as TimelineData).damageBlocks
        assert.equal(blocks[0]?.id, 'live-block', '必须是内存里那一份，而不是空快照')
        assert.equal((file.project.phases.config.data as ConfigState).enemy.defense, 777)

        // 端到端：导出的文件再导入回来，数据仍要在
        const imported = roundTrip(source)
        assert.equal(
            (imported.encounter.timeline.data as TimelineData).damageBlocks[0]?.id,
            'live-block',
            '未锁定环节经导出→导入往返后不能丢'
        )
    })

    it('非活动工程只读自己的快照，内存态不串味', () => {
        const active = makeUnlockedProject('live-a', '当前工程')
        const other = makeUnlockedProject('live-b', '另一个工程')
        other.encounter.config.data = configWith(555)
        __seedProjectsForTest([active, other], 'live-a')
        initTimeline(timelineWith('from-active'), () => {}, active.team, false)
        initConfig(configWith(111), false)
        initCalculation(active.team, getTimelineState(), null, false, () => {})

        const file = buildExportFile(other, getPhaseOrder(), true) as {
            project: { phases: Record<string, { data: unknown }> }
        }
        assert.equal((file.project.phases.config.data as ConfigState).enemy.defense, 555, '应导出它自己的快照')
        assert.equal(file.project.phases.timeline.data, null, '它自己没有排轴快照 → 不能拿活动工程的顶上')
    })
})
