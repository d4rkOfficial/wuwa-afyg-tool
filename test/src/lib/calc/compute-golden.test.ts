// 计算引擎的**数值基线快照**（决议 J2）。
//
// 用途：本次引擎重构（节点 DAG + 乘子表 + 公式表 + Buff 作用注册表）每一步都必须证明
// 「零行为变化」。这里用一份覆盖全部四条公式族 + 条件 + 转模 + 覆盖 + 跨角色引用的
// 工程 fixture，把 `computeAll` 与 `buildDamageSegments` 的**全部数值字段**钉成快照：
//
// - 数值字段出现任何漂移 → 断言失败并逐条打印差异；
// - 结构字段（`zones` / `traceSegments` 的 id 序列）同时被钉住 —— 这就是阶段 1 的
//   「compute 与 trace 同口径」闸门（`check-trace-parity`）的落地形态。
//
// 更新方式：`$env:UPDATE_GOLDEN=1; pnpm test:one compute-golden`
// 会把新快照写到 `.tmp/golden-snapshot.json`（**先看 diff 再贴回下面的 GOLDEN**）。
//
// 注意：阶段 2 引入「处决」伤害类型（决议 D25）后，本快照的 `damageTypes` 字段需要一次性更新，
// 但所有数值字段必须保持逐位相同 —— 这正是那次改动「只改分类、不改算术」的凭据。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'

import { computeAll } from '$lib/calc/compute'
import { buildDamageSegments, type DamageTraceCtx } from '$lib/calc/damage-trace'
import type { BuffInstance, DamageEntry } from '$lib/calc/calculation.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { CharSlot } from '$lib/types/project'
import type { ConfigState, EchoSlotConfig } from '$lib/calc/config.types'

// ────────────────────────────── fixture ──────────────────────────────

const CHAR_A = '甲'
const CHAR_B = '乙'
const WEAPON_W = '武器W'

const charInfoMap: Record<string, CharacterInfo> = {
    [CHAR_A]: {
        rarity: 5,
        element: '冷凝',
        weaponType: '长刃',
        tags: [],
        lv90BaseStats: { hp: 12000, atk: 1100, def: 600, tuneBreakBoost: 40 },
        skills: [],
        statNodes: [],
        chains: []
    },
    [CHAR_B]: {
        rarity: 4,
        element: '热熔',
        weaponType: '迅刀',
        tags: [],
        lv90BaseStats: { hp: 9000, atk: 900, def: 500, tuneBreakBoost: 20 },
        skills: [],
        statNodes: [],
        chains: []
    }
}

/** @desc 武器副词条走「攻击 → 攻击%」+ 小数转百分比这条真实链路（`WEAPON_SUBSTAT_NAME_MAP` + `SUBSTAT_DECIMAL_TO_PCT`） */
const weaponInfoMap: Record<string, WeaponInfo> = {
    [WEAPON_W]: {
        rarity: 5,
        type: '长刃',
        lv90BaseAtk: 600,
        substat: { name: '攻击', value: '0.3' },
        effect: { name: '', desc: '' }
    }
}

const slot = (character: string | null, weapon: string | null, chain = 0): CharSlot => ({
    character,
    weapon,
    triggerSets: [],
    echoes: [
        { name: null, cost: 1 },
        { name: null, cost: 1 },
        { name: null, cost: 1 },
        { name: null, cost: 1 },
        { name: null, cost: 1 }
    ],
    chain
})

const team = [slot(CHAR_A, WEAPON_W, 2), slot(CHAR_B, null, 0), slot(null, null, 0)] as unknown as CharSlot[]

const emptyEcho = (cost = 1): EchoSlotConfig => ({ cost, mainStat: null, secondMainStat: null, substats: [] })

/** @desc 甲：4cost 暴击率主词条 + 3cost 冷凝伤害加成 + 攻击% / 暴伤 / 攻击 / 充能副词条 */
const echoesA: [EchoSlotConfig, EchoSlotConfig, EchoSlotConfig, EchoSlotConfig, EchoSlotConfig] = [
    {
        cost: 4,
        mainStat: { type: '暴击率', value: 22, unit: '%' },
        secondMainStat: { type: '攻击', value: 150, unit: '' },
        substats: [
            { type: '攻击%', value: 8.6, unit: '%' },
            { type: '暴击伤害', value: 15, unit: '%' },
            { type: '攻击', value: 40, unit: '' }
        ]
    },
    {
        cost: 3,
        mainStat: { type: '冷凝伤害加成', value: 30, unit: '%' },
        secondMainStat: { type: '攻击', value: 100, unit: '' },
        substats: [{ type: '共鸣效率', value: 10, unit: '%' }]
    },
    emptyEcho(),
    emptyEcho(),
    emptyEcho()
]

const configState: ConfigState = {
    characters: [
        { echoes: echoesA },
        { echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] },
        { echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] }
    ],
    enemy: {
        type: 'BOSS',
        level: 90,
        defense: 1000,
        resistances: { 冷凝: 10, 热熔: 0, 物理: 10, 衍射: 10 },
        dmgReduction: 5
    }
}

// ────────────────────────────── Buff 集 ──────────────────────────────

/**
 * @desc 一份覆盖全部乘区与条件形态的 Buff 集：
 * 无条件 / 属性条件 / 类型条件 / 覆盖 / 引用转模 / 链门槛（满足与不满足）/
 * `buffActive` 依赖 / 敌人类型门槛 / 面板数值门槛 / 集谐层数（目标侧）/ 跨角色引用。
 */
const buffs: BuffInstance[] = [
    { id: 'b1', name: '加成', zones: [{ zoneId: 'bonusDmg', value: 40 }], scope: 'all' },
    {
        id: 'b2',
        name: '冷凝加成',
        zones: [{ zoneId: 'bonusDmg', value: 20, condition: { elements: ['冷凝'] } }],
        scope: 'all'
    },
    {
        id: 'b3',
        name: '普攻加成',
        zones: [{ zoneId: 'bonusDmg', value: 15, condition: { damageTypes: ['普攻伤害'] } }],
        scope: 'all'
    },
    { id: 'b4', name: '加深', zones: [{ zoneId: 'deepenDmg', value: 25 }], scope: 'all' },
    { id: 'b5', name: '易伤', zones: [{ zoneId: 'dmgTakenInc', value: 12 }], scope: 'all' },
    { id: 'b6', name: '终伤', zones: [{ zoneId: 'finalDmg', value: 8 }], scope: 'all' },
    { id: 'b7', name: '特殊1', zones: [{ zoneId: 'specialFinal1', value: 10 }], scope: 'all' },
    { id: 'b8', name: '特殊2', zones: [{ zoneId: 'specialFinal2', value: 20 }], scope: 'all' },
    {
        id: 'b9',
        name: '穿透',
        zones: [
            { zoneId: 'defPen', value: 20 },
            { zoneId: 'resPen', value: 10 },
            { zoneId: 'dmgRedPen', value: 5 }
        ],
        scope: 'all'
    },
    {
        id: 'b10',
        name: '减防减抗',
        zones: [
            { zoneId: 'defDown', value: 15 },
            { zoneId: 'resDown', value: 8 }
        ],
        scope: 'all'
    },
    {
        id: 'b11',
        name: '双暴',
        zones: [
            { zoneId: 'critRate', value: 20 },
            { zoneId: 'critDmg', value: 40 }
        ],
        scope: 'all'
    },
    {
        id: 'b12',
        name: '双暴覆盖',
        zones: [
            { zoneId: 'critRate', value: 50, override: true },
            { zoneId: 'critDmg', value: 200, override: true }
        ],
        scope: 'all'
    },
    { id: 'b13', name: '集谐', zones: [{ zoneId: 'tuneStrainLayer', value: 3 }], scope: [0] },
    { id: 'b14', name: '同奏', zones: [{ zoneId: 'unisonBoonLayer', value: 2 }], scope: 'all' },
    { id: 'b15', name: '额外倍率', zones: [{ zoneId: 'extraRatio', value: 100 }], scope: 'all' },
    {
        id: 'b16',
        name: '链门槛不满足',
        zones: [{ zoneId: 'atkPct', value: 30 }],
        scope: 'all',
        rules: [{ kind: 'chain', charIdx: 0, min: 5 }]
    },
    {
        id: 'b17',
        name: '链门槛满足',
        zones: [{ zoneId: 'atkPct', value: 10 }],
        scope: 'all',
        rules: [{ kind: 'chain', charIdx: 0, min: 2 }]
    },
    {
        id: 'b18',
        name: '引用转模',
        zones: [
            {
                zoneId: 'atkPct',
                value: 0,
                ref: { characterIdx: 0, zoneId: 'totalAtk', threshold: 2000, pct: 10, lower: 5, upper: 40 }
            }
        ],
        scope: 'all'
    },
    { id: 'b19', name: '终伤覆盖', zones: [{ zoneId: 'finalDmg', value: 50, override: true }], scope: 'all' },
    {
        id: 'b20',
        name: '依赖加成',
        zones: [{ zoneId: 'bonusDmg', value: 5 }],
        scope: 'all',
        rules: [{ kind: 'buffActive', mode: 'all', buffIds: ['b1'] }]
    },
    {
        id: 'b21',
        name: '敌人类型门槛',
        zones: [{ zoneId: 'deepenDmg', value: 10 }],
        scope: 'all',
        rules: [{ kind: 'enemyType', types: ['精英怪'] }]
    },
    {
        id: 'b22',
        name: '面板门槛',
        zones: [{ zoneId: 'critRate', value: 5 }],
        scope: 'all',
        rules: [{ kind: 'zoneCompare', charIdx: -1, zone: 'atk', op: 'ge', value: 2500 }]
    },
    {
        id: 'b23',
        name: '跨角色引用',
        zones: [{ zoneId: 'atkPct', value: 0, ref: { characterIdx: 1, zoneId: 'totalAtk', threshold: 800, pct: 20 } }],
        scope: 'all'
    },
    {
        id: 'b24',
        name: '第二条转模',
        zones: [{ zoneId: 'critDmg', value: 0, ref: { characterIdx: 0, zoneId: 'totalAtk', threshold: 3000, pct: 5 } }],
        scope: 'all'
    }
]

const buffsById = Object.fromEntries(buffs.map((b) => [b.id, b]))

/**
 * @desc 链/阶档位取「甲 2 链」——让 `b16`（min 5，应不生效）与 `b17`（min 2，应生效）
 * 各走一边，链条件规则的两个方向都被 fixture 覆盖。
 */
const conditionProfile = { chains: [2, 0, 0], refinements: [1, 1, 1] }

// ────────────────────────────── 伤害条目 ──────────────────────────────

const entry = (patch: Partial<DamageEntry> & Pick<DamageEntry, 'id'>): DamageEntry => ({
    character: CHAR_A,
    skillType: '常态攻击',
    hitName: '测试伤害',
    displayName: '测试伤害(常态攻击)',
    formula: 'direct',
    ratioValue: 200,
    ratioUnit: '%',
    damageBaseType: '攻击',
    damageElement: '冷凝',
    sourceTimelineBlockId: 'blk',
    hits: 1,
    ...patch
})

const direct = entry({ id: 'e1' })

const entries: DamageEntry[] = [
    // e1：直伤 + 全乘区（无覆盖）
    direct,
    // e2：直伤 + 终伤覆盖（覆盖优先于一切）
    entry({ id: 'e2' }),
    // e3：直伤 + 引用转模（本角色）
    entry({ id: 'e3' }),
    // e4：处决（系数基类 · 谐度区）
    entry({
        id: 'e4',
        skillType: '谐度破坏',
        hitName: '谐度破坏',
        displayName: '谐度破坏',
        formula: 'tune',
        ratioValue: 1600,
        damageBaseType: '偏谐系数',
        damageElement: '物理'
    }),
    // e5：偏谐响应（系数基类 · 同一条公式）
    entry({
        id: 'e5',
        skillType: '偏谐响应',
        hitName: '震谐响应',
        displayName: '震谐响应',
        formula: 'tune',
        ratioValue: 400,
        damageBaseType: '偏谐系数',
        damageElement: '冷凝'
    }),
    // e6：效应伤害（查表倍率 + 独立基础值）
    entry({
        id: 'e6',
        character: undefined,
        skillType: '效应结算',
        hitName: '光噪效应',
        displayName: '光噪效应10层',
        formula: 'effect',
        ratioValue: 10,
        damageBaseType: '效应系数',
        damageElement: '衍射'
    }),
    // e7：固定值条目（旁路全部乘区）
    entry({ id: 'e7', ratioValue: 5000, ratioUnit: 'fixed', damageBaseType: '固定' }),
    // e8：乙出伤 + 跨角色引用（引用甲的面板）
    entry({ id: 'e8', character: CHAR_B, damageBaseType: '攻击', damageElement: '热熔' }),
    // e9：条件不匹配（冷凝加成 / 普攻加成都不该生效）
    entry({ id: 'e9', damageElement: '衍射', damageBaseType: '攻击' }),
    // e10 / e11：链条件门槛的反方向（e10 只挂 min 5 不满足，e11 只挂 min 2 满足）
    entry({ id: 'e10' }),
    entry({ id: 'e11' }),
    /**
     * @desc e12：**同一轮结算里有两条引用**。
     * 第二条转模必须读到「回写前」的面板 —— 若面板被浅拷贝（`{...panel}`）导致
     * 第一条引用的回写泄漏进来，这条的数值就会变。
     */
    entry({ id: 'e12' })
]

const bindings: Record<string, string[]> = {
    e1: [
        'b1',
        'b2',
        'b3',
        'b4',
        'b5',
        'b6',
        'b7',
        'b8',
        'b9',
        'b10',
        'b11',
        'b13',
        'b14',
        'b15',
        'b17',
        'b20',
        'b21',
        'b22'
    ],
    e2: ['b6', 'b19'],
    e3: ['b1', 'b18'],
    e4: ['b1', 'b4', 'b5', 'b6', 'b9', 'b10', 'b11', 'b12', 'b14', 'b17'],
    e5: ['b1', 'b5', 'b6', 'b9', 'b10', 'b12', 'b14'],
    e6: ['b1', 'b4', 'b5', 'b6', 'b9', 'b14'],
    e7: ['b1', 'b4', 'b6', 'b9'],
    e8: ['b1', 'b4', 'b6', 'b23'],
    e9: ['b2', 'b3', 'b4'],
    e10: ['b16'],
    e11: ['b17'],
    e12: ['b1', 'b18', 'b24']
}

/** @desc 绑定里出现的 id 必须都在 `buffs` 里（fixture 自检用） */
const allBoundIds = [...new Set(Object.values(bindings).flat())]
const missingBuffs = allBoundIds.filter((id) => !buffsById[id])

const traceCtx: DamageTraceCtx = {
    buffSets: buffs,
    damageEntryBuffSetIds: bindings,
    damageEntryDamageTypes: {},
    configState,
    team,
    charInfoMap,
    weaponInfoMap,
    conditionProfile
}

// ────────────────────────────── 投影 ──────────────────────────────

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6

interface GoldenEntry {
    id: string
    baseUnit: string
    ratioNum: number
    baseValue: number
    totalMultiplier: number
    expectedPerHit: number
    nonCritPerHit: number
    critPerHit: number
    totalDamage: number
    canCrit: boolean
    damageTypes: string[]
    elBonus: number
    typeBonus: number
    /** @desc 结果页乘区明细（有序 —— 顺序也是快照的一部分） */
    zones: [string, number][]
    /** @desc 溯源段 id 序列与数值（compute 与 trace 同口径的凭据） */
    traces: [string, number][]
}

/** @desc 原始一对：引擎结果 + 同一条目的溯源（乘区明细与溯源段必须同源） */
const rawRows = () => {
    const results = computeAll(
        entries,
        buffs,
        bindings,
        {},
        configState,
        team,
        charInfoMap,
        weaponInfoMap,
        conditionProfile
    )
    return results.map((result) => ({ result, segments: buildDamageSegments(result, traceCtx) }))
}

const project = (): GoldenEntry[] =>
    rawRows().map(({ result: r, segments: segs }) => ({
        id: r.id,
        baseUnit: r.baseUnit,
        ratioNum: r6(r.ratioNum),
        baseValue: r.baseValue,
        totalMultiplier: r6(r.totalMultiplier),
        expectedPerHit: r.expectedPerHit,
        nonCritPerHit: r.nonCritPerHit,
        critPerHit: r.critPerHit,
        totalDamage: r.totalDamage,
        canCrit: r.canCrit,
        damageTypes: [...r.damageTypes],
        elBonus: r6(r.elBonus ?? 0),
        typeBonus: r6(r.typeBonus ?? 0),
        zones: r.multiplierZones.map((z) => [z.label, r6(z.value)] as [string, number]),
        traces: segs.segments.map((s) => [s.id, r6(s.value)] as [string, number])
    }))

// ────────────────────────────── 断言 ──────────────────────────────

describe('数值基线：工程 fixture 的逐条目快照（重构期间必须逐位不变）', () => {
    it('fixture 自检：绑定引用的 Buff 全部存在', () => {
        assert.deepEqual(missingBuffs, [], '绑定里出现了 fixture 未定义的 Buff id')
    })

    it('fixture 自检：每条都有非零期望伤害（防止快照把「全 0」当成基线）', () => {
        const rows = project()
        for (const row of rows) {
            assert.ok(row.expectedPerHit > 0, `${row.id} 期望伤害为 0，fixture 失效`)
            assert.ok(row.baseValue > 0, `${row.id} 基值为 0，fixture 失效`)
        }
    })

    it('fixture 自检：处决不吃增伤 / 效应不吃易伤（口径抽样）', () => {
        const rows = new Map(project().map((r) => [r.id, r]))
        const labels = (id: string) => rows.get(id)!.zones.map(([label]) => label)
        assert.ok(!labels('e4').includes('增伤区'), '处决（tune）不该有增伤区')
        assert.ok(!labels('e4').includes('集谐区'), '处决（tune）不该有集谐区')
        assert.ok(labels('e4').includes('谐度区'), '处决（tune）必须有谐度区')
        assert.ok(!labels('e6').includes('易伤区'), '效应不该有易伤区')
        assert.ok(labels('e6').includes('加深区'), '效应必须吃加深')
        assert.deepEqual(labels('e7'), [], '固定值条目不应有任何乘区')
    })

    it('fixture 自检：链条件门槛两个方向都真的生效', () => {
        const rows = new Map(project().map((r) => [r.id, r]))
        assert.ok(
            rows.get('e11')!.baseValue > rows.get('e10')!.baseValue,
            '链满足（min 2）的 atkPct 应生效、链不满足（min 5）的不该生效'
        )
    })

    it('乘区明细与溯源段同源：溯源段是乘区明细的有序子序列', () => {
        for (const { result, segments } of rawRows()) {
            const zoneIds = result.multiplierZones.map((zone) => zone.id)
            const traceIds = segments.segments.map((s) => s.id).filter((id) => id !== 'miss')
            let cursor = 0
            for (const id of traceIds) {
                const at = zoneIds.indexOf(id, cursor)
                assert.ok(
                    at >= 0,
                    `${result.id}: 溯源段「${id}」不在乘区明细里，或顺序不一致（明细 ${zoneIds.join('/')}）`
                )
                cursor = at + 1
            }
        }
    })

    it('数值快照与 GOLDEN 完全一致', () => {
        const actual = project()
        if (process.env.UPDATE_GOLDEN === '1') {
            writeFileSync('.tmp/golden-snapshot.json', JSON.stringify(actual, null, 4) + '\n', 'utf8')
            console.log('[golden] 已写出 .tmp/golden-snapshot.json，请核对 diff 后贴回 GOLDEN')
            return
        }
        assert.deepEqual(actual, GOLDEN)
    })
})

/**
 * @desc 数值基线（`pnpm test:one compute-golden`，更新方式见文件头）。
 *
 * 这份数据不是「应该等于多少」的手算结果，而是**重构前的实测值**：它的唯一职责是
 * 让任何一次重构都必须显式承认「数值变了」，从而无法悄悄改坏。
 */
const GOLDEN: GoldenEntry[] = [
    {
        id: 'e1',
        baseUnit: '攻击',
        ratioNum: 2,
        baseValue: 8448,
        totalMultiplier: 15.244192,
        expectedPerHit: 42928,
        nonCritPerHit: 27767,
        critPerHit: 56922,
        totalDamage: 42928,
        canCrit: true,
        damageTypes: ['普攻伤害'],
        elBonus: 30,
        typeBonus: 0,
        zones: [
            ['加深区', 1.25],
            ['增伤区', 2.1],
            ['易伤区', 1.12],
            ['抗性区', 1.04],
            ['防御区', 0.690909],
            ['免伤区', 0.9],
            ['集谐区', 1.144],
            ['同奏区', 1.06],
            ['终伤区', 1.08],
            ['特殊区', 1.32],
            ['暴击区', 1.546]
        ],
        traces: [
            ['deepen', 1.25],
            ['bonus', 2.1],
            ['vuln', 1.12],
            ['resist', 1.04],
            ['defense', 0.690909],
            ['dmgRed', 0.9],
            ['tuneStrain', 1.144],
            ['unison', 1.06],
            ['final', 1.08],
            ['special', 1.32],
            ['crit', 1.546008]
        ]
    },
    {
        id: 'e2',
        baseUnit: '攻击',
        ratioNum: 2,
        baseValue: 5292,
        totalMultiplier: 2.364266,
        expectedPerHit: 6256,
        nonCritPerHit: 5322,
        critPerHit: 8781,
        totalDamage: 6256,
        canCrit: true,
        damageTypes: ['普攻伤害'],
        elBonus: 30,
        typeBonus: 0,
        zones: [
            ['加深区', 1],
            ['增伤区', 1.3],
            ['易伤区', 1],
            ['抗性区', 0.9],
            ['防御区', 0.603175],
            ['免伤区', 0.95],
            ['集谐区', 1],
            ['同奏区', 1],
            ['终伤区', 1.5],
            ['特殊区', 1],
            ['暴击区', 1.1755]
        ],
        traces: [
            ['deepen', 1],
            ['bonus', 1.3],
            ['vuln', 1],
            ['resist', 0.9],
            ['defense', 0.603175],
            ['dmgRed', 0.95],
            ['tuneStrain', 1],
            ['unison', 1],
            ['final', 1.5],
            ['special', 1],
            ['crit', 1.175498]
        ]
    },
    {
        id: 'e3',
        baseUnit: '攻击',
        ratioNum: 2,
        baseValue: 6652,
        totalMultiplier: 2.061155,
        expectedPerHit: 6855,
        nonCritPerHit: 5832,
        critPerHit: 9623,
        totalDamage: 6855,
        canCrit: true,
        damageTypes: ['普攻伤害'],
        elBonus: 30,
        typeBonus: 0,
        zones: [
            ['加深区', 1],
            ['增伤区', 1.7],
            ['易伤区', 1],
            ['抗性区', 0.9],
            ['防御区', 0.603175],
            ['免伤区', 0.95],
            ['集谐区', 1],
            ['同奏区', 1],
            ['终伤区', 1],
            ['特殊区', 1],
            ['暴击区', 1.1755]
        ],
        traces: [
            ['deepen', 1],
            ['bonus', 1.7],
            ['vuln', 1],
            ['resist', 0.9],
            ['defense', 0.603175],
            ['dmgRed', 0.95],
            ['tuneStrain', 1],
            ['unison', 1],
            ['final', 1],
            ['special', 1],
            ['crit', 1.175412]
        ]
    },
    {
        id: 'e4',
        baseUnit: '偏谐系数',
        ratioNum: 16,
        baseValue: 160432,
        totalMultiplier: 27.860165,
        expectedPerHit: 279354,
        nonCritPerHit: 186236,
        critPerHit: 372472,
        totalDamage: 279354,
        canCrit: true,
        damageTypes: ['处决'],
        elBonus: 0,
        typeBonus: 0,
        zones: [
            ['易伤区', 1.12],
            ['抗性区', 1.04],
            ['防御区', 0.690909],
            ['免伤区', 0.9],
            ['谐度区', 1.4],
            ['同奏区', 1.06],
            ['终伤区', 1.08],
            ['特殊区', 1],
            ['暴击区', 1.5]
        ],
        traces: [
            ['vuln', 1.12],
            ['resist', 1.04],
            ['defense', 0.690909],
            ['dmgRed', 0.9],
            ['tuneBreak', 1.4],
            ['unison', 1.06],
            ['final', 1.08],
            ['special', 1],
            ['crit', 1.5]
        ]
    },
    {
        id: 'e5',
        baseUnit: '偏谐系数',
        ratioNum: 4,
        baseValue: 40108,
        totalMultiplier: 6.965041,
        expectedPerHit: 69838,
        nonCritPerHit: 46559,
        critPerHit: 93118,
        totalDamage: 69838,
        canCrit: true,
        damageTypes: ['处决'],
        elBonus: 0,
        typeBonus: 0,
        zones: [
            ['易伤区', 1.12],
            ['抗性区', 1.04],
            ['防御区', 0.690909],
            ['免伤区', 0.9],
            ['谐度区', 1.4],
            ['同奏区', 1.06],
            ['终伤区', 1.08],
            ['特殊区', 1],
            ['暴击区', 1.5]
        ],
        traces: [
            ['vuln', 1.12],
            ['resist', 1.04],
            ['defense', 0.690909],
            ['dmgRed', 0.9],
            ['tuneBreak', 1.4],
            ['unison', 1.06],
            ['final', 1.08],
            ['special', 1],
            ['crit', 1.499989]
        ]
    },
    {
        id: 'e6',
        baseUnit: '效应系数',
        ratioNum: 2.4951,
        baseValue: 9167,
        totalMultiplier: 2.105357,
        expectedPerHit: 7735,
        nonCritPerHit: 7735,
        critPerHit: 7735,
        totalDamage: 7735,
        canCrit: false,
        damageTypes: ['效应伤害'],
        elBonus: 0,
        typeBonus: 0,
        zones: [
            ['加深区', 1.25],
            ['抗性区', 1],
            ['防御区', 0.655172],
            ['免伤区', 0.9],
            ['同奏区', 1.06],
            ['终伤区', 1.08],
            ['特殊区', 1],
            ['暴击区', 1]
        ],
        traces: [
            ['deepen', 1.25],
            ['resist', 1],
            ['defense', 0.655172],
            ['dmgRed', 0.9],
            ['unison', 1.06],
            ['final', 1.08],
            ['special', 1]
        ]
    },
    {
        id: 'e7',
        baseUnit: '固定',
        ratioNum: 1,
        baseValue: 5000,
        totalMultiplier: 1,
        expectedPerHit: 5000,
        nonCritPerHit: 0,
        critPerHit: 0,
        totalDamage: 5000,
        canCrit: false,
        damageTypes: ['普攻伤害'],
        elBonus: 0,
        typeBonus: 0,
        zones: [],
        traces: []
    },
    {
        id: 'e8',
        baseUnit: '攻击',
        ratioNum: 2,
        baseValue: 2160,
        totalMultiplier: 2.22015,
        expectedPerHit: 2398,
        nonCritPerHit: 2339,
        critPerHit: 3509,
        totalDamage: 2398,
        canCrit: true,
        damageTypes: ['普攻伤害'],
        elBonus: 0,
        typeBonus: 0,
        zones: [
            ['加深区', 1.25],
            ['增伤区', 1.4],
            ['易伤区', 1],
            ['抗性区', 1],
            ['防御区', 0.603175],
            ['免伤区', 0.95],
            ['集谐区', 1],
            ['同奏区', 1],
            ['终伤区', 1.08],
            ['特殊区', 1],
            ['暴击区', 1.025]
        ],
        traces: [
            ['deepen', 1.25],
            ['bonus', 1.4],
            ['vuln', 1],
            ['resist', 1],
            ['defense', 0.603175],
            ['dmgRed', 0.95],
            ['tuneStrain', 1],
            ['unison', 1],
            ['final', 1.08],
            ['special', 1],
            ['crit', 1.025224]
        ]
    },
    {
        id: 'e9',
        baseUnit: '攻击',
        ratioNum: 2,
        baseValue: 5292,
        totalMultiplier: 1.742889,
        expectedPerHit: 4612,
        nonCritPerHit: 3923,
        critPerHit: 6473,
        totalDamage: 4612,
        canCrit: true,
        damageTypes: ['普攻伤害'],
        elBonus: 0,
        typeBonus: 0,
        zones: [
            ['加深区', 1.25],
            ['增伤区', 1.15],
            ['易伤区', 1],
            ['抗性区', 0.9],
            ['防御区', 0.603175],
            ['免伤区', 0.95],
            ['集谐区', 1],
            ['同奏区', 1],
            ['终伤区', 1],
            ['特殊区', 1],
            ['暴击区', 1.1755]
        ],
        traces: [
            ['deepen', 1.25],
            ['bonus', 1.15],
            ['vuln', 1],
            ['resist', 0.9],
            ['defense', 0.603175],
            ['dmgRed', 0.95],
            ['tuneStrain', 1],
            ['unison', 1],
            ['final', 1],
            ['special', 1],
            ['crit', 1.175631]
        ]
    },
    {
        id: 'e10',
        baseUnit: '攻击',
        ratioNum: 2,
        baseValue: 5292,
        totalMultiplier: 1.576178,
        expectedPerHit: 4171,
        nonCritPerHit: 3548,
        critPerHit: 5854,
        totalDamage: 4171,
        canCrit: true,
        damageTypes: ['普攻伤害'],
        elBonus: 30,
        typeBonus: 0,
        zones: [
            ['加深区', 1],
            ['增伤区', 1.3],
            ['易伤区', 1],
            ['抗性区', 0.9],
            ['防御区', 0.603175],
            ['免伤区', 0.95],
            ['集谐区', 1],
            ['同奏区', 1],
            ['终伤区', 1],
            ['特殊区', 1],
            ['暴击区', 1.1755]
        ],
        traces: [
            ['deepen', 1],
            ['bonus', 1.3],
            ['vuln', 1],
            ['resist', 0.9],
            ['defense', 0.603175],
            ['dmgRed', 0.95],
            ['tuneStrain', 1],
            ['unison', 1],
            ['final', 1],
            ['special', 1],
            ['crit', 1.175592]
        ]
    },
    {
        id: 'e11',
        baseUnit: '攻击',
        ratioNum: 2,
        baseValue: 5632,
        totalMultiplier: 1.576178,
        expectedPerHit: 4439,
        nonCritPerHit: 3776,
        critPerHit: 6230,
        totalDamage: 4439,
        canCrit: true,
        damageTypes: ['普攻伤害'],
        elBonus: 30,
        typeBonus: 0,
        zones: [
            ['加深区', 1],
            ['增伤区', 1.3],
            ['易伤区', 1],
            ['抗性区', 0.9],
            ['防御区', 0.603175],
            ['免伤区', 0.95],
            ['集谐区', 1],
            ['同奏区', 1],
            ['终伤区', 1],
            ['特殊区', 1],
            ['暴击区', 1.1755]
        ],
        traces: [
            ['deepen', 1],
            ['bonus', 1.3],
            ['vuln', 1],
            ['resist', 0.9],
            ['defense', 0.603175],
            ['dmgRed', 0.95],
            ['tuneStrain', 1],
            ['unison', 1],
            ['final', 1],
            ['special', 1],
            ['crit', 1.175583]
        ]
    },
    {
        id: 'e12',
        baseUnit: '攻击',
        ratioNum: 2,
        baseValue: 6652,
        totalMultiplier: 1.977359,
        expectedPerHit: 6577,
        nonCritPerHit: 5832,
        critPerHit: 8590,
        totalDamage: 6577,
        canCrit: true,
        damageTypes: ['普攻伤害'],
        elBonus: 30,
        typeBonus: 0,
        zones: [
            ['加深区', 1],
            ['增伤区', 1.7],
            ['易伤区', 1],
            ['抗性区', 0.9],
            ['防御区', 0.603175],
            ['免伤区', 0.95],
            ['集谐区', 1],
            ['同奏区', 1],
            ['终伤区', 1],
            ['特殊区', 1],
            ['暴击区', 1.12771]
        ],
        traces: [
            ['deepen', 1],
            ['bonus', 1.7],
            ['vuln', 1],
            ['resist', 0.9],
            ['defense', 0.603175],
            ['dmgRed', 0.95],
            ['tuneStrain', 1],
            ['unison', 1],
            ['final', 1],
            ['special', 1],
            ['crit', 1.127743]
        ]
    }
]
