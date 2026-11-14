// 平铺拉表表头列宽口径：文字按「最多 N 行」摊开后需要多宽，列就多宽（而不是固定 108px 里无限折行 + 省略号）。
// 这里只锁纯函数（`headTextWidthPx` / `headColumnWidthPx`），DOM 测量不参与。
// 重点回归：字距 `tracking-[0.1em]` 必须计入宽度，否则算少一截 → 长文案正好折出第 4 行（实测踩过）。

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
    HEAD_BAND_LINES,
    HEAD_CELL_PAD_PX,
    HEAD_COL_MAX_PX,
    HEAD_COL_MIN_PX,
    HEAD_NAME_LINES,
    HEAD_WIDTH_SLACK_PX,
    headColumnWidthPx,
    headTextWidthPx,
    buildSegmentMarkers,
    buildSegmentSpecs,
    buildCategorizedTable,
    buildSegmentedTables,
    buildSourceTabs,
    groupEntriesBySource,
    entrySourceKeyOf,
    resolveActiveSource,
    sourceKeyOf,
    type CellState,
    type SegmentMarker
} from '$lib/components/page/home/calculation/spread-table.utils'
import type { BuffConf, DamageEntry } from '$lib/calc/calculation.types'
import type { CharSlot } from '$lib/types/project'

describe('headTextWidthPx', () => {
    it('CJK 按 10px/字、ASCII 按 5.5px/字符估算', () => {
        assert.equal(headTextWidthPx(''), 0)
        assert.equal(headTextWidthPx('仇远'), 20)
        assert.equal(headTextWidthPx('abcd'), 22)
        assert.equal(headTextWidthPx('仇远ab'), 31)
    })

    it('全角标点（，。％）算作 CJK 宽度', () => {
        assert.equal(headTextWidthPx('，。'), 20)
    })

    it('字距按每字叠加（文件夹横条的 tracking-[0.1em]）', () => {
        assert.equal(headTextWidthPx('仇远', 1), 22)
        assert.equal(headTextWidthPx('abcd', 1), 26)
    })
})

describe('headColumnWidthPx', () => {
    /** @desc 与实现同口径：单行文字宽 → 2% 折行损失补偿 → 内边距 + 余量 */
    const expected = (perLine: number) => Math.ceil(perLine * 1.02) + HEAD_CELL_PAD_PX + HEAD_WIDTH_SLACK_PX

    it('短标签落到下限：不比 108px 更窄', () => {
        assert.equal(headColumnWidthPx('攻击', HEAD_NAME_LINES), HEAD_COL_MIN_PX)
        assert.equal(headColumnWidthPx('', HEAD_BAND_LINES), HEAD_COL_MIN_PX)
    })

    it('字多就变宽：单行文字宽 ÷ 行数（再补折行损失与内边距）', () => {
        // 30 个 CJK = 300px；2 行 → 150 → 153 + 22
        const label = '敌'.repeat(30)
        assert.equal(headColumnWidthPx(label, 2), expected(150))
    })

    it('算上字距后更宽（横条口径），否则会多折一行', () => {
        const label = '敌'.repeat(30)
        // 带 1px 字距：330 / 3 行 = 110；不算字距只有 300/3 = 100
        assert.equal(headColumnWidthPx(label, HEAD_BAND_LINES, 1, 1), expected(110))
        assert.ok(headColumnWidthPx(label, HEAD_BAND_LINES, 1, 1) > headColumnWidthPx(label, HEAD_BAND_LINES))
    })

    it('行数上限越多，列越窄（同一段文字）', () => {
        const label = '敌'.repeat(30)
        assert.ok(headColumnWidthPx(label, HEAD_BAND_LINES) < headColumnWidthPx(label, HEAD_NAME_LINES))
    })

    it('超长文本封顶在 HEAD_COL_MAX_PX', () => {
        const label = '敌'.repeat(300)
        assert.equal(headColumnWidthPx(label, 2), HEAD_COL_MAX_PX)
    })

    it('按 colspan 分摊：跨 2 列的横条每列只要一半', () => {
        const label = '敌'.repeat(30)
        assert.equal(headColumnWidthPx(label, 2, 2), Math.ceil(expected(150) / 2))
    })

    it('span 非法时按 1 列处理', () => {
        const label = '敌'.repeat(30)
        assert.equal(headColumnWidthPx(label, 2, 0), headColumnWidthPx(label, 2, 1))
    })

    it('内边距与余量参与计算：宽度恒 ≥ 文字宽 ÷ 行数 + 22', () => {
        const label = '敌'.repeat(10)
        assert.ok(headColumnWidthPx(label, 2) >= Math.ceil(100 / 2) + HEAD_CELL_PAD_PX + HEAD_WIDTH_SLACK_PX)
    })

    it('实测回归：31~32 字的中文横条算出的宽度 ≥ 浏览器里 3 行放得下的最小宽度', () => {
        // 最小宽度来自无头 Edge 实测（.tmp/hdr-probe/fit.mjs）：122 / 134 / 130 px
        const cases: [string, number][] = [
            ['【挑灯问剑】达到400点时获得竹照，附近队伍中队友获得伤害加成', 122],
            ['下一个登场角色声骸技能伤害加深，持续14秒，若切换角色则效果消失', 134],
            ['仇远暴击高于50%时，每多出1%暴击，施放该技能获得额外一次伤害', 130]
        ]
        for (const [label, minPx] of cases) {
            const width = headColumnWidthPx(label, HEAD_BAND_LINES, 1, 1)
            assert.ok(width >= minPx, `「${label}」算出 ${width}px，实测至少要 ${minPx}px 才能 3 行放下`)
        }
    })
})

// ────────────────────────── 分段平铺（时间记点切段） ──────────────────────────

const refLines = [
    { id: 'left', name: '', pos: 0 },
    { id: 'c1', name: '起手 1m', pos: 100 },
    { id: 'c2', name: '爆发 15s', pos: 300 },
    { id: 'right', name: '结束', pos: 900 }
]
const timings = [
    { refLineId: 'c1', seconds: 10 },
    { refLineId: 'c2', seconds: null },
    { refLineId: 'right', seconds: 20 }
]

describe('buildSegmentMarkers：只认「有记点」的参考线', () => {
    it('seconds 为 null 的记点不算分割线；按时间轴位置升序；名字空则回退', () => {
        const markers = buildSegmentMarkers([...timings, { refLineId: 'left', seconds: 3 }], refLines)
        assert.deepEqual(
            markers.map((m) => [m.refLineId, m.pos, m.seconds, m.name]),
            [
                ['left', 0, 3, '未命名参考线'],
                ['c1', 100, 10, '起手 1m'],
                ['right', 900, 20, '结束']
            ]
        )
    })

    it('一条记点都没有 → 空数组（分段平铺退化为单表）', () => {
        assert.deepEqual(buildSegmentMarkers([], refLines), [])
        assert.deepEqual(buildSegmentMarkers([{ refLineId: 'c1', seconds: null }], refLines), [])
    })
})

describe('buildSegmentSpecs：每个标记开启一段，首段叫「开场」', () => {
    const markers: SegmentMarker[] = [
        { refLineId: 'c1', name: '起手', pos: 100, seconds: 10 },
        { refLineId: 'right', name: '结束', pos: 900, seconds: 20 }
    ]

    it('无记点 → 单张表（全部伤害）', () => {
        const specs = buildSegmentSpecs([])
        assert.equal(specs.length, 1)
        assert.equal(specs[0].title, '全部伤害')
        assert.equal(specs[0].to, null)
    })

    it('有记点 → 开场 + 每标记一段；表名是参考线名、副标题是时间范围', () => {
        const specs = buildSegmentSpecs(markers)
        assert.deepEqual(
            specs.map((s) => [s.key, s.title, s.rangeText]),
            [
                ['seg:pre', '开场', '0s ~ 10s'],
                ['seg:c1', '起手', '10s ~ 20s'],
                ['seg:right', '结束', '20s ~ 结束']
            ]
        )
        assert.deepEqual(
            specs.map((s) => [s.from, s.to]),
            [
                [-Infinity, 100],
                [100, 900],
                [900, null]
            ]
        )
    })

    it('第一条记点就在 0 位置时不产生「开场」段', () => {
        const specs = buildSegmentSpecs([{ refLineId: 'x', name: '开局', pos: 0, seconds: 0 }])
        assert.deepEqual(
            specs.map((s) => s.title),
            ['开局']
        )
    })
})

// ────────────────────────── 伤害源页签（7 个维度，空表不显示） ──────────────────────────

const TEAM = [{ character: '甲' }, { character: '乙' }, { character: null }] as unknown as CharSlot[]
const buff = (id: string, name: string): BuffConf => ({ id, name, scope: 'all', zones: [] }) as BuffConf
const entry = (id: string, character: string | undefined, extra: Partial<DamageEntry> = {}): DamageEntry =>
    ({
        id,
        character,
        hitName: id,
        displayName: id,
        isEffect: false,
        isTuneBreak: false,
        isTuneResponse: false,
        ratioValue: 100,
        ratioUnit: '%',
        damageBaseType: '攻击',
        damageElement: '冷凝',
        sourceTimelineBlockId: 'b1',
        hits: 1,
        ...extra
    }) as DamageEntry

const charToIdx = { 甲: 0, 乙: 1 }
const alwaysOk = (): CellState => ({ blocked: false, hardOk: true })

const groupsOf = (entries: DamageEntry[]) => groupEntriesBySource(entries, charToIdx)

describe('buildSourceTabs：角色×(直伤/非直伤) + 其它，空表页签不显示', () => {
    it('有直伤与效应时只出现这两类页签；「其它」只在有无角色伤害时出现', () => {
        const groups = groupsOf([
            entry('e1', '甲'),
            entry('e2', undefined, { isEffect: true, damageBaseType: '效应系数' })
        ])
        const tabs = buildSourceTabs({ team: TEAM, groups, elementColorOf: () => '#fff' })
        assert.deepEqual(
            tabs.map((t) => [t.key, t.label, t.kind]),
            [
                ['slot-0:direct', '甲·直伤', 'direct'],
                ['\u0000none', '其它', 'other']
            ]
        )
    })

    it('同角色的直伤/非直伤各占一个页签', () => {
        const groups = groupsOf([
            entry('e1', '甲'),
            entry('e2', '甲', { isTuneBreak: true, damageBaseType: '偏谐系数' })
        ])
        const tabs = buildSourceTabs({ team: TEAM, groups, elementColorOf: () => '#fff' })
        assert.deepEqual(
            tabs.map((t) => t.key),
            ['slot-0:direct', 'slot-0:nondirect']
        )
        assert.equal(resolveActiveSource(null, tabs), 'slot-0:direct')
        assert.equal(resolveActiveSource('gone', tabs), 'slot-0:direct', '失效页签回落到第一个')
    })

    it('entrySourceKeyOf 与 sourceKeyOf 同口径', () => {
        assert.equal(entrySourceKeyOf(charToIdx, entry('x', '乙')), sourceKeyOf(charToIdx, '乙', 'direct'))
        assert.equal(
            entrySourceKeyOf(charToIdx, entry('y', undefined, { isEffect: true })),
            sourceKeyOf(charToIdx, '', 'direct'),
            '无角色伤害归「其它」'
        )
    })
})

// ────────────────────────── 分段平铺整表构建 ──────────────────────────

describe('buildSegmentedTables', () => {
    const specs = buildSegmentSpecs([
        { refLineId: 'c1', name: '起手', pos: 100, seconds: 10 },
        { refLineId: 'c2', name: '爆发', pos: 300, seconds: 15 }
    ])
    const positions: Record<string, number> = { e1: 50, e2: 150, e3: 350 }
    const entries = [entry('e1', '甲'), entry('e2', '乙'), entry('e3', '甲')]
    const posOf = (e: DamageEntry) => positions[e.id] ?? 0

    const build = (activeSource: string | null) =>
        buildSegmentedTables({
            specs,
            damageEntries: entries,
            posOf,
            charToIdx,
            activeSource,
            columns: [buff('b1', 'Buff1'), buff('b2', 'Buff2')],
            folderGroupOf: new Map(),
            stateFor: (_bs, e) => ({ blocked: e.id === 'e2', hardOk: e.id !== 'e2' })
        })

    it('行按时间轴顺序切进各段；非选中来源的行不可编辑且右侧无单元格（绝对留白）', () => {
        const tables = build('slot-0:direct')
        assert.deepEqual(
            tables.map((t) => [t.title, t.rows.map((r) => r.entry.id)]),
            [
                ['开场', ['e1']],
                ['起手', ['e2']],
                ['爆发', ['e3']]
            ]
        )
        const e2Row = tables[1].rows[0]
        assert.equal(e2Row.editable, false)
        assert.deepEqual(e2Row.cells, [], '非选中来源：格子连状态都不算')
        assert.equal(tables[0].rows[0].editable, true)
        assert.equal(tables[0].rows[0].cells.length, 2)
    })

    it('列 = 选中来源能吃到的 Buff 并集（其它来源吃得到也不算）', () => {
        const tables = build('slot-0:direct')
        // 甲能被 scoped 到：e1/e3 都 hardOk → 两列都在
        assert.deepEqual(tables[0].visibleColIdx, [0, 1])
        // 乙（e2）hardOk=false：若选中乙的来源，则没有任何可用列
        const forB = build('slot-1:direct')
        assert.deepEqual(forB[0].visibleColIdx, [])
    })

    it('表名 = 参考线名，副标题 = 时间范围', () => {
        const tables = build('slot-0:direct')
        assert.deepEqual(
            tables.map((t) => [t.title, t.subtitle]),
            [
                ['开场', '0s ~ 10s'],
                ['起手', '10s ~ 15s'],
                ['爆发', '15s ~ 结束']
            ]
        )
    })

    it('选中来源的连续行段：段首 runStart / 段尾 runEnd，中间夹别来源就断开', () => {
        const entries4 = [entry('r1', '甲'), entry('r2', '甲'), entry('r3', '乙'), entry('r4', '甲')]
        const pos4: Record<string, number> = { r1: 20, r2: 60, r3: 80, r4: 120 }
        const tables = buildSegmentedTables({
            specs: buildSegmentSpecs([]),
            damageEntries: entries4,
            posOf: (e: DamageEntry) => pos4[e.id] ?? 0,
            charToIdx,
            activeSource: 'slot-0:direct',
            columns: [buff('b1', 'Buff1')],
            folderGroupOf: new Map(),
            stateFor: () => ({ blocked: false, hardOk: true })
        })
        assert.deepEqual(
            tables[0].rows.map((r) => [r.entry.id, r.runStart, r.runEnd]),
            [
                ['r1', true, false],
                ['r2', false, true],
                ['r3', false, false],
                ['r4', true, true]
            ]
        )
    })

    it('该时段一条伤害都没有 → 整张表不建（只剩表头的表是噪音）', () => {
        const tables = buildSegmentedTables({
            specs,
            damageEntries: [entry('e1', '甲'), entry('e2', '乙')],
            posOf,
            charToIdx,
            activeSource: 'slot-0:direct',
            columns: [buff('b1', 'Buff1'), buff('b2', 'Buff2')],
            folderGroupOf: new Map(),
            stateFor: () => ({ blocked: false, hardOk: true })
        })
        assert.deepEqual(
            tables.map((t) => [t.title, t.rows.map((r) => r.entry.id)]),
            [
                ['开场', ['e1']],
                ['起手', ['e2']]
            ],
            '「爆发」段没有任何条目（e3 的位置 350 只在原 fixture 里）→ 不出现'
        )
    })
})

// ────────────────────────── 分类平铺：只建选中来源那一张 + 「隐藏不达门槛列」 ──────────────────────────

describe('groupEntriesBySource：按伤害源分组（页签计数与建表共用）', () => {
    it('直伤/非直伤/其它各自成组，保持条目顺序', () => {
        const groups = groupsOf([
            entry('e1', '甲'),
            entry('e2', '甲', { isTuneBreak: true, damageBaseType: '偏谐系数' }),
            entry('e3', undefined, { isEffect: true, damageBaseType: '效应系数' }),
            entry('e4', '甲')
        ])
        assert.deepEqual(
            groups.map((g) => [g.key, g.kind, g.entries.map((e) => e.id)]),
            [
                ['slot-0:direct', 'direct', ['e1', 'e4']],
                ['slot-0:nondirect', 'nondirect', ['e2']],
                ['\u0000none', 'other', ['e3']]
            ]
        )
    })
})

describe('buildCategorizedTable：表头/行/列', () => {
    const columns = [buff('b1', 'Buff1'), buff('b2', 'Buff2')]
    const entries = [entry('e1', '甲'), entry('e2', '甲')]

    const build = (
        opts: { rulesMetFor?: (bs: BuffConf, e: DamageEntry) => boolean; hideUnmetColumns?: boolean } = {}
    ) =>
        buildCategorizedTable(
            {
                columns,
                charToIdx,
                team: TEAM,
                folderGroupOf: new Map(),
                stateFor: alwaysOk,
                paneSourcesOf: () => ({}),
                ...opts
            },
            groupsOf(entries)[0]
        )

    it('标题 = 角色名，副标题 = 直伤；行按分组顺序', () => {
        const table = build()
        assert.deepEqual([table.title, table.subtitle, table.rows.map((r) => r.entry.id)], ['甲', '直伤', ['e1', 'e2']])
    })

    it('「隐藏不达门槛列」关闭（默认）：硬可用的列全保留，即便没有任何一行门槛达标', () => {
        const table = build({ rulesMetFor: () => false })
        assert.deepEqual(table.visibleColIdx, [0, 1])
    })

    it('「隐藏不达门槛列」开启：只保留至少一行门槛达标的列', () => {
        // 只有 b2 在 e2 上达标 → 只保留 b2
        const table = build({
            hideUnmetColumns: true,
            rulesMetFor: (bs, e) => bs.id === 'b2' && e.id === 'e2'
        })
        assert.deepEqual(table.visibleColIdx, [1])
    })

    it('软条件不过的格子仍占列（列保留、单格灰禁）', () => {
        const table = buildCategorizedTable(
            {
                columns,
                charToIdx,
                team: TEAM,
                folderGroupOf: new Map(),
                stateFor: () => ({ blocked: true, hardOk: true }),
                paneSourcesOf: () => ({})
            },
            groupsOf(entries)[0]
        )
        assert.deepEqual(table.visibleColIdx, [0, 1], '硬门槛过 → 列保留')
        assert.equal(table.rows[0].cells[0].enabled, false, '但这一格不可勾（灰禁图标）')
    })

    it('不连续分割线：两个同源倍率之间夹了别的来源 → 后一行上方画一条线', () => {
        // 全量序列：甲(0) → 乙(1) → 乙(2) → 甲(3) → 甲(4)
        const fullEntries = [
            entry('e1', '甲'),
            entry('x1', '乙'),
            entry('x2', '乙'),
            entry('e2', '甲'),
            entry('e3', '甲')
        ]
        const order = new Map(fullEntries.map((e, i) => [e.id, i]))
        const table = buildCategorizedTable(
            {
                columns,
                charToIdx,
                team: TEAM,
                folderGroupOf: new Map(),
                stateFor: alwaysOk,
                paneSourcesOf: () => ({}),
                orderIndexOf: (id) => order.get(id) ?? -1
            },
            groupsOf(fullEntries)[0]
        )
        assert.deepEqual(
            table.rows.map((r) => [r.entry.id, r.runStart, r.runEnd]),
            [
                ['e1', false, false], // 表首不加线
                ['e2', true, false], // 与 e1 之间隔着 x1/x2 → 上方起线
                ['e3', false, false] // 与 e2 相邻 → 连续
            ]
        )
    })

    it('连续时不标线：全量序列里同源相邻（未注入下标时也一律按连续处理）', () => {
        const table = build()
        assert.deepEqual(
            table.rows.map((r) => [r.runStart, r.runEnd]),
            [
                [false, false],
                [false, false]
            ]
        )
    })
})
