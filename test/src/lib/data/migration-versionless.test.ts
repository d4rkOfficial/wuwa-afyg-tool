// 无版本号工程的版本判定回归：**「上传工坊再下载被补勾影响源 Buff」**的守卫。
//
// 事故链（实测复现）：
//   1. 工坊（分享中转站）历史上用逐字段白名单重建工程对象，把 `project.version` 抹掉了；
//   2. 工具 `readVersion` 对无版本号一律返回 0，于是对下载件重跑整条迁移链；
//   3. `migrateV2toV3` 的 `bindPaneEffectSources` 会把「影响源」Buff 补勾到引用该面板的伤害段上，
//      而这个补勾**只加不减**、无法区分「用户主动取消勾选」与「从未勾选」；
//   4. 症状：本来没勾的「同奏1层/2层」被挂到守岸人全部倍率 + 处决倍率上，且导入即持久化。
//
// 判定口径：缺版本号时看产出时间（工具导出写 Date.now()、工坊落库写上传时刻），
// 晚于 `VERSIONLESS_ASSUME_CURRENT_AFTER` 的断言为当前最新版；更早的仍按 0 走完整迁移链。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { parseProjectFile, importProjects, getProjects, __seedProjectsForTest } from '$lib/data/project.svelte'
import { readVersion, VERSIONLESS_ASSUME_CURRENT_AFTER, migrateProject } from '$lib/data/migration'
import { PROJECT_VERSION } from '$lib/types/project'
import type { CharSlot } from '$lib/types/project'
import type { CalcState } from '$lib/calc/calculation.types'
import type { TimelineData } from '$lib/calc/timeline.types'

const OWNER = '甲'
const TARGET = '乙'

/** @desc 影响源：归甲、改写甲的共鸣效率，且甲自己的某个伤害段勾着它（`wasBoundToChar` 的前提） */
const SOURCE_BUFF = {
    id: 'buff-source',
    name: '影响源·甲的共鸣效率',
    scope: [0],
    zones: [{ zoneId: 'recharge', value: 10 }]
}
/** @desc 引用方：作用于乙，引用「甲的面板 · 共鸣效率」→ 让甲的影响源成为乙这段的影响源 */
const REF_BUFF = {
    id: 'buff-ref',
    name: '引用·甲面板共鸣效率',
    scope: 'all',
    zones: [{ zoneId: 'atkPct', value: 0, ref: { characterIdx: 0, zoneId: 'recharge', pct: 100 } }]
}

/** @desc 甲的一段伤害（把影响源勾在「被引用角色自己的条目」上） */
const OWNER_ENTRY = 'b1-常态攻击|甲的伤害#攻击'
/** @desc 乙的一段伤害（引用甲的面板 → 迁移会给它补勾影响源） */
const TARGET_ENTRY = 'b2-常态攻击|乙的伤害#攻击'

const timeline: TimelineData = {
    refLines: [],
    opBlocks: [],
    damageBlocks: [
        {
            id: 'b1',
            sourceType: 'op',
            sourceId: 'op-1',
            skillHits: [{ character: OWNER, skillType: '常态攻击', hitName: '甲的伤害', ratio: '100%' }]
        },
        {
            id: 'b2',
            sourceType: 'op',
            sourceId: 'op-2',
            skillHits: [{ character: TARGET, skillType: '常态攻击', hitName: '乙的伤害', ratio: '100%' }]
        }
    ]
} as unknown as TimelineData

const calcState = {
    buffSets: [SOURCE_BUFF, REF_BUFF],
    damageEntryBuffSetIds: { [OWNER_ENTRY]: [SOURCE_BUFF.id], [TARGET_ENTRY]: [REF_BUFF.id] },
    damageEntryDamageTypes: {}
} as unknown as CalcState

const team = [
    { character: OWNER, weapon: null, triggerSets: [], echoes: [] },
    { character: TARGET, weapon: null, triggerSets: [], echoes: [] },
    { character: null, weapon: null, triggerSets: [], echoes: [] }
] as unknown as [CharSlot, CharSlot, CharSlot]

/** @desc 造一份「工坊落库」形态的工程：只有兼容期视图 phases，且**没有** `project.version` */
const workshopProject = (exportedAt: number | undefined): Record<string, unknown> => ({
    id: 'proj-shared',
    name: '分享工程',
    createdAt: 1,
    team,
    customSkillHits: {},
    ...(exportedAt === undefined ? {} : { exportedAt }),
    phases: {
        team: { locked: true, data: null },
        timeline: { locked: true, data: timeline },
        calculation: { locked: true, data: calcState },
        config: { locked: true, data: null }
    }
})

const workshopFile = (exportedAt: number | undefined): string =>
    JSON.stringify({
        version: 1,
        ...(exportedAt === undefined ? {} : { exportedAt }),
        project: workshopProject(exportedAt)
    })

/** @desc 走真实导入链（parseProjectFile → normalizeProject → importProjects），返回落库后的绑定表 */
const importBindings = (text: string): Record<string, string[]> => {
    __seedProjectsForTest([], '')
    const parsed = parseProjectFile(text)
    assert.equal(parsed.length, 1, '应解析出一个工程')
    importProjects(parsed)
    const imported = getProjects().at(-1)
    assert.ok(imported, '导入后应能在工程列表里找到新工程')
    return imported.encounter.calculation.data!.damageEntryBuffSetIds
}

const AFTER_CUTOFF = VERSIONLESS_ASSUME_CURRENT_AFTER + 4 * 86400000
const BEFORE_CUTOFF = VERSIONLESS_ASSUME_CURRENT_AFTER - 4 * 86400000

describe('readVersion：缺版本号时按产出时间兜底', () => {
    it('有显式版本号时以版本号为准，与产出时间无关', () => {
        assert.equal(readVersion({ version: PROJECT_VERSION, exportedAt: 1 }), PROJECT_VERSION)
        assert.equal(readVersion({ version: 2, exportedAt: AFTER_CUTOFF }), 2)
    })

    it('无版本号但产出时间晚于门槛 → 断言为当前最新版', () => {
        assert.equal(readVersion({ exportedAt: AFTER_CUTOFF }), PROJECT_VERSION)
    })

    it('门槛之前的无版本号仍是 0（工具早年确实有无版本号的导出，不能一刀切）', () => {
        assert.equal(readVersion({ exportedAt: BEFORE_CUTOFF }), 0)
        assert.equal(readVersion({}), 0)
        assert.equal(readVersion({ exportedAt: Number.NaN }), 0)
        assert.equal(readVersion({ exportedAt: '1791191730054' }), 0)
    })
})

describe('工坊下载件（版本号被中转站吃掉）不得被补勾影响源 Buff', () => {
    it('缺版本号 + 晚于门槛：导入后原绑定原样保留，不补勾影响源', () => {
        const bindings = importBindings(workshopFile(AFTER_CUTOFF))

        assert.deepEqual(
            bindings[TARGET_ENTRY],
            [REF_BUFF.id],
            '引用方条目不得被补勾影响源（这正是「没勾的同奏被挂上去」的形状）'
        )
        assert.deepEqual(bindings[OWNER_ENTRY], [SOURCE_BUFF.id], '被引用角色自己的条目不受影响')
    })

    it('带正确版本号（修复后的工坊）同样不补勾', () => {
        const file = JSON.parse(workshopFile(AFTER_CUTOFF))
        file.project.version = PROJECT_VERSION
        const bindings = importBindings(JSON.stringify(file))
        assert.deepEqual(bindings[TARGET_ENTRY], [REF_BUFF.id])
    })

    it('project 内部自带产出时间（无信封 exportedAt）时同样兜住', () => {
        const file = JSON.stringify({ version: 1, project: workshopProject(AFTER_CUTOFF) })
        const bindings = importBindings(file)
        assert.deepEqual(bindings[TARGET_ENTRY], [REF_BUFF.id])
    })

    it('project 内部与信封产出时间冲突时以 project 自己的为准', () => {
        // 信封晚于门槛、project 内部早于门槛 → 视为老工程，迁移照跑（各自的戳各自算）
        const file = JSON.stringify({ version: 1, exportedAt: AFTER_CUTOFF, project: workshopProject(BEFORE_CUTOFF) })
        const bindings = importBindings(file)
        assert.deepEqual(bindings[TARGET_ENTRY], [REF_BUFF.id, SOURCE_BUFF.id])
    })
})

describe('门槛之前的无版本号工程：迁移链照跑（哨兵）', () => {
    it('仍会补勾影响源，证明上一条守的是「时间兜底」而不是把迁移整个关掉', () => {
        const bindings = importBindings(workshopFile(BEFORE_CUTOFF))
        assert.deepEqual(
            bindings[TARGET_ENTRY],
            [REF_BUFF.id, SOURCE_BUFF.id],
            '老工程必须继续享受 v2→v3 的跨角色影响源补偿，否则旧工程的加成会静默变少'
        )
        assert.deepEqual(bindings[OWNER_ENTRY], [SOURCE_BUFF.id], '只加不减：被引用角色自己的条目不动')
    })

    it('完全没有产出时间的无版本号工程同样走完整迁移链', () => {
        const bindings = importBindings(workshopFile(undefined))
        assert.deepEqual(bindings[TARGET_ENTRY], [REF_BUFF.id, SOURCE_BUFF.id])
    })

    it('直接调 migrateProject：信封时间需要显式落在工程对象上才生效', () => {
        const withoutStamp = migrateProject(workshopProject(undefined) as never)
        assert.deepEqual(
            withoutStamp.encounter.calculation.data!.damageEntryBuffSetIds[TARGET_ENTRY],
            [REF_BUFF.id, SOURCE_BUFF.id],
            '无产出时间 = 老工程 = 照跑迁移'
        )
        const withStamp = migrateProject(workshopProject(AFTER_CUTOFF) as never)
        assert.deepEqual(
            withStamp.encounter.calculation.data!.damageEntryBuffSetIds[TARGET_ENTRY],
            [REF_BUFF.id],
            '产出时间晚于门槛 = 被吃掉版本号的新工程 = 不重跑迁移'
        )
    })
})

describe('导入后工程列表状态', () => {
    it('工坊下载件导入后落在工程列表里（链路可用）', () => {
        importBindings(workshopFile(AFTER_CUTOFF))
        assert.equal(getProjects().length, 1)
        assert.equal(getProjects()[0].name, '分享工程')
    })
})
