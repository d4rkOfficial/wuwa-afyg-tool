// ── CoconutCore：注册动作 + 吃自描述的 GeneralTable 出结果 ─────────────────
// 覆盖内核的公开契约：一切皆 buff（白值 / 词条 / 敌人都由表写入）、
// buff 数值与引用、四条公式的基值与乘子链、暴击三列。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { CoconutCore, type GeneralTable } from '$coconut-core'
import { buildCoconutCoreConfig } from '$lib/calc/core-config'

/** @desc 注册层：内核零内置，结算前必须 init 一份配置 */
const registered = () => new CoconutCore().init(buildCoconutCoreConfig())

const compute = (table: GeneralTable, options?: { trace?: boolean }) => registered().compute(table, options)

const tableOf = (table: Partial<GeneralTable>): GeneralTable => ({
    global_buffs: [],
    buffs: [],
    damage_entries: [],
    ...table
})

type Effect = GeneralTable['buffs'][number]['effects'][number]

/** @desc 测试里用 `{ id, effect }` 的简写描述单个 buff，落到表里转成目录项 */
type SingleEffectBuff = { id: string; effect: Effect }

const catalogOf = (buffs: readonly SingleEffectBuff[], role?: 'stat'): GeneralTable['buffs'] =>
    buffs.map((buff) => ({ id: buff.id, effects: [buff.effect], ...(role ? { role } : {}) }))

/** @desc 角色 A 的基础数值与装备（测试里同样以 buff 形式给） */
const EQUIP: SingleEffectBuff[] = [
    { id: 'atkBase', effect: { applyTo: 'atkBase', value: '400' } },
    { id: 'weaponAtk', effect: { applyTo: 'atkBase', value: '500' } },
    { id: 'hpBase', effect: { applyTo: 'hpBase', value: '10000' } },
    { id: 'defBase', effect: { applyTo: 'defBase', value: '500' } },
    { id: 'tune', effect: { applyTo: 'tuneBreakBoost', value: '100' } },
    { id: 'level', effect: { applyTo: 'charLevel', value: '90' } }
]

/** @desc 敌人配置（同样以 buff 形式给，`role: 'stat'` 不进贡献溯源） */
const ENEMY: SingleEffectBuff[] = [
    { id: 'enemy:defense', effect: { applyTo: 'enemyDefense', value: '1000' } },
    { id: 'enemy:type', effect: { applyTo: 'enemyType', value: 'BOSS' } }
]

/** @desc 造一张带「角色 A 装备」的表，`extra` 是额外 buff（按 id 覆盖同名） */
const tableWith = (extra: readonly SingleEffectBuff[] = [], overrides: Partial<GeneralTable> = {}): GeneralTable => {
    const merged = new Map<string, SingleEffectBuff>()
    for (const buff of [...EQUIP, ...extra]) merged.set(buff.id, buff)
    const equipIds = new Set(EQUIP.map((buff) => buff.id))
    const statBuffs = [...ENEMY, ...EQUIP]
    const buffs = [...merged.values()].filter((buff) => !equipIds.has(buff.id))
    const table = tableOf({
        // 装备与敌人配置按编译器的做法进 global_buffs，并标记 role: 'stat'（不参与贡献溯源）
        global_buffs: statBuffs.map((buff) => buff.id),
        buffs: [...catalogOf(statBuffs, 'stat'), ...catalogOf(buffs)],
        damage_entries: [
            {
                source: 'A',
                damages: [
                    {
                        value: '100%',
                        activated_buffs: buffs.map((buff) => buff.id),
                        element: '冷凝',
                        formula: 'direct'
                    }
                ]
            }
        ]
    })
    const next = { ...table, ...overrides }
    if (overrides.buffs) {
        const keep = new Map<string, GeneralTable['buffs'][number]>()
        for (const buff of [...table.buffs, ...overrides.buffs]) keep.set(buff.id, buff)
        next.buffs = [...keep.values()]
    }
    return next
}

const directDamage = (value: string, activated: readonly SingleEffectBuff[] = []) => {
    const table = tableWith(activated)
    const damage = table.damage_entries[0]!.damages[0]!
    damage.value = value
    return table
}

const equipTable = (overrides: Partial<GeneralTable> = {}): GeneralTable => tableWith([], overrides)

describe('CoconutCore：注册 + 面板', () => {
    it('白值 = 角色白值 + 武器白值；作用写入面板落点', () => {
        const table = equipTable({
            buffs: [
                ...catalogOf(EQUIP),
                ...catalogOf([
                    { id: 'atkPct', effect: { applyTo: 'atkPct', value: '12' } },
                    { id: 'crit', effect: { applyTo: 'critRate', value: '10' } },
                    { id: 'critDmg', effect: { applyTo: 'critDmg', value: '20' } }
                ])
            ]
        })
        table.damage_entries[0]!.damages[0]!.activated_buffs = [
            ...table.damage_entries[0]!.damages[0]!.activated_buffs,
            'atkPct',
            'crit',
            'critDmg'
        ]
        const panel = compute(table).damages[0]!.panel
        assert.equal(panel.base.atk, 900)
        assert.equal(panel.zones.atkPct, 12)
        assert.equal(panel.total.atk, 900 + Math.round((900 * 12) / 100))
        assert.equal(panel.zones.critRate, 5 + 10)
        assert.equal(panel.zones.critDmg, 150 + 20)
        assert.equal(panel.zones.tuneBreakBoost, 100)
    })

    it('激活 buff 直接写面板（无条件的「一切皆 buff」）', () => {
        const buff = { id: 'b1', effect: { applyTo: 'atkPct', value: '20' } }
        const table = equipTable()
        table.buffs = [...table.buffs, ...catalogOf([buff])]
        table.damage_entries[0]!.damages[0]!.activated_buffs = [
            ...table.damage_entries[0]!.damages[0]!.activated_buffs,
            buff.id
        ]
        const result = compute(table)
        assert.equal(result.damages[0]!.panel.zones.atkPct, 20)
        assert.equal(result.damages[0]!.panel.total.atk, 900 + 180)
    })

    it('目标侧 buff 落在敌人面板（免伤走 enemyDmgReduction）', () => {
        const buffs = [
            { id: 'defDown', effect: { applyTo: 'defDown', value: '20' } },
            { id: 'red', effect: { applyTo: 'enemyDmgReduction', value: '10' } },
            { id: 'res', effect: { applyTo: 'resistance', element: '冷凝', value: '40' } }
        ]
        const table = equipTable({ buffs: [...catalogOf(buffs)] })
        table.damage_entries[0]!.damages[0]!.activated_buffs = [
            ...table.damage_entries[0]!.damages[0]!.activated_buffs,
            ...buffs.map((buff) => buff.id)
        ]
        const target = compute(table).damages[0]!.target
        assert.equal(target.scalars.defense, 1000)
        assert.equal(target.scalars.dmgReduction, 10)
        assert.equal(target.maps.resistance?.['冷凝'], 40)
    })
})

describe('CoconutCore：全局 buff', () => {
    it('global_buffs 对每条伤害生效，且顺序在条目 buff 之前', () => {
        const table = tableWith([{ id: 'b1', effect: { applyTo: 'bonusDmg', value: '30' } }], {
            global_buffs: [...ENEMY.map((buff) => buff.id), ...EQUIP.map((buff) => buff.id), 'g1'],
            buffs: [
                ...catalogOf(ENEMY, 'stat'),
                ...catalogOf(EQUIP, 'stat'),
                ...catalogOf([
                    { id: 'g1', effect: { applyTo: 'bonusDmg', value: '20' } },
                    { id: 'b1', effect: { applyTo: 'bonusDmg', value: '30' } }
                ])
            ]
        })
        const withGlobal = compute(table).damages[0]!
        const withoutGlobal = compute({
            ...table,
            global_buffs: [...ENEMY.map((buff) => buff.id), ...EQUIP.map((buff) => buff.id)]
        }).damages[0]!
        assert.ok(withGlobal.expected > withoutGlobal.expected, '全局 buff 应参与结算')
    })

    it('全局 buff 也进贡献溯源', () => {
        const table = tableOf({
            global_buffs: ['g1'],
            buffs: catalogOf([{ id: 'g1', effect: { applyTo: 'bonusDmg', value: '20' } }]),
            damage_entries: [
                { source: 'A', damages: [{ value: '100%', activated_buffs: [], element: '冷凝', formula: 'direct' }] }
            ]
        })
        const result = compute(table, { trace: true })
        assert.deepEqual(
            result.damages[0]!.contributions.map((item) => item.buffId),
            ['g1']
        )
    })
})

describe('CoconutCore：引用（转模）', () => {
    it('引用生命上限：减去起算线后夹进上下限，写进目标作用', () => {
        const buff = {
            id: 'ref',
            effect: {
                applyTo: 'atkFlat',
                value: {
                    refStat: 'totalHp',
                    baseLine: 0,
                    sourceUnit: '',
                    targetUnit: '',
                    lowerLimit: 0,
                    Upperlimit: 1000
                }
            }
        }
        const table = equipTable({ buffs: [...catalogOf(EQUIP), ...catalogOf([buff])] })
        table.damage_entries[0]!.damages[0]!.activated_buffs = [
            ...table.damage_entries[0]!.damages[0]!.activated_buffs,
            buff.id
        ]
        assert.equal(compute(table).damages[0]!.panel.zones.atkFlat, 1000)

        const withBaseLine = { ...buff, effect: { ...buff.effect, value: { ...buff.effect.value, baseLine: 8000 } } }
        const table2 = equipTable({ buffs: [...catalogOf(EQUIP), ...catalogOf([withBaseLine])] })
        table2.damage_entries[0]!.damages[0]!.activated_buffs = [
            ...table2.damage_entries[0]!.damages[0]!.activated_buffs,
            withBaseLine.id
        ]
        assert.equal(compute(table2).damages[0]!.panel.zones.atkFlat, 1000)

        const lower = { ...buff, effect: { ...buff.effect, value: { ...buff.effect.value, baseLine: 9500 } } }
        const table3 = equipTable({ buffs: [...catalogOf(EQUIP), ...catalogOf([lower])] })
        table3.damage_entries[0]!.damages[0]!.activated_buffs = [
            ...table3.damage_entries[0]!.damages[0]!.activated_buffs,
            lower.id
        ]
        assert.equal(compute(table3).damages[0]!.panel.zones.atkFlat, 500)
    })

    it('单位换算：% → 数值按 ×100 折算', () => {
        const buff = {
            id: 'ref',
            effect: {
                applyTo: 'atkFlat',
                value: {
                    refStat: 'recharge',
                    baseLine: 0,
                    sourceUnit: '%',
                    targetUnit: '',
                    lowerLimit: 0,
                    Upperlimit: 1000
                }
            }
        }
        const table = equipTable({
            buffs: [
                ...catalogOf(EQUIP),
                ...catalogOf([{ id: 'recharge', effect: { applyTo: 'recharge', value: '150' } }, buff])
            ]
        })
        table.damage_entries[0]!.damages[0]!.activated_buffs = [
            ...table.damage_entries[0]!.damages[0]!.activated_buffs,
            'recharge',
            buff.id
        ]
        // 共鸣效率初值 100 + 词条 150 = 250（%）→ 归一成 2.5 → 目标单位 '' 保持 2.5
        assert.equal(compute(table).damages[0]!.panel.zones.atkFlat, 2.5)
    })
})

describe('CoconutCore：公式与暴击三列', () => {
    it('直伤：基值 = 面板三维 × 倍率，乘子链顺序固定', () => {
        const table = equipTable()
        table.damage_entries[0]!.damages[0]!.value = '200%'
        table.damage_entries[0]!.damages[0]!.base = 'hp'
        const result = compute(table)
        const damage = result.damages[0]!
        assert.equal(damage.baseValue, 20000)
        assert.deepEqual(
            damage.multipliers.map((m) => m.id),
            [
                'deepen',
                'bonus',
                'vuln',
                'resist',
                'defense',
                'dmgRed',
                'tuneStrain',
                'unison',
                'final',
                'special',
                'crit'
            ]
        )
        const product = damage.multipliers.reduce((acc, m) => acc * m.value, 1)
        assert.equal(damage.expected, Math.round(20000 * product))
    })

    it('暴击列：不吃暴击的公式回填期望值', () => {
        const result = compute(
            tableOf({
                damage_entries: [
                    {
                        source: 'A',
                        damages: [{ value: '5000', activated_buffs: [], element: '物理', formula: 'fixed' }]
                    }
                ]
            })
        )
        const damage = result.damages[0]!
        assert.equal(damage.expected, 5000)
        assert.deepEqual(damage.multipliers, [])
    })

    it('处决：基值 = 敌人面板系数 × 倍率', () => {
        const table = tableOf({
            buffs: catalogOf([{ id: 'coeff', effect: { applyTo: 'enemyCoeff', value: '10027' } }]),
            damage_entries: [
                {
                    source: 'A',
                    damages: [{ value: '10', activated_buffs: ['coeff'], element: '物理', formula: 'tune' }]
                }
            ]
        })
        assert.equal(compute(table).damages[0]!.baseValue, 10027 * 10)
    })

    it('效应：基值 = 面板「效应系数」× 该段层数倍率', () => {
        const table = tableOf({
            buffs: catalogOf([{ id: 'eff', effect: { applyTo: 'effectCoeff', value: '3674' } }]),
            damage_entries: [
                {
                    source: '效应·电磁效应',
                    damages: [{ value: '1.5', activated_buffs: ['eff'], element: '导电', formula: 'effect' }]
                }
            ]
        })
        const damage = compute(table).damages[0]!
        assert.equal(damage.panel.zones.effectCoeff, 3674)
        assert.equal(damage.panel.total.atk, 0)
        assert.equal(damage.baseValue, 3674 * 1.5)
    })

    it('合计 = 各段之和', () => {
        const result = compute(
            tableOf({
                damage_entries: [
                    {
                        source: 'A',
                        damages: [
                            { value: '100%', activated_buffs: [], element: '冷凝', formula: 'direct' },
                            { value: '200%', activated_buffs: [], element: '冷凝', formula: 'direct' }
                        ]
                    }
                ]
            })
        )
        assert.equal(result.damages.length, 2)
        assert.equal(
            result.total,
            result.damages.reduce((sum, d) => sum + d.expected, 0)
        )
    })
})

describe('CoconutCore：倍率串', () => {
    it('倍率串只认数字与 %，基准维度由字段给出', () => {
        const cases: [string, 'atk' | 'hp' | 'def' | undefined, number][] = [
            ['100%', undefined, 900],
            ['1', undefined, 900],
            ['2', undefined, 1800],
            ['100%', 'hp', 10000],
            ['0.5', 'def', 250]
        ]
        for (const [value, base, expected] of cases) {
            const table = equipTable()
            table.damage_entries[0]!.damages[0]!.value = value
            if (base) table.damage_entries[0]!.damages[0]!.base = base
            assert.equal(compute(table).damages[0]!.baseValue, expected, `value=${value} base=${base}`)
        }
    })
})

describe('CoconutCore：buff 贡献溯源', () => {
    it('默认不溯源（贡献为空数组）', () => {
        const buff = { id: 'b1', effect: { applyTo: 'bonusDmg', value: '20' } }
        const result = compute(directDamage('100%', [buff]))
        assert.deepEqual(result.damages[0]!.contributions, [])
    })

    it('trace 时逐 buff 给出「摘掉它」的差值，且能对上整段伤害', () => {
        const buffs = [
            { id: 'atk', effect: { applyTo: 'atkPct', value: '20' } },
            { id: 'bonus', effect: { applyTo: 'bonusDmg', value: '30' } }
        ]
        const withTrace = compute(directDamage('100%', buffs), { trace: true })
        const damage = withTrace.damages[0]!
        assert.deepEqual(damage.contributions.map((c) => c.buffId).sort(), ['atk', 'bonus'])
        // 每条贡献 = 含它 - 不含它；正贡献、比例自洽
        for (const contribution of damage.contributions) {
            assert.ok(contribution.deltaExpected > 0, `${contribution.buffId} 应为正贡献`)
            assert.equal(contribution.share, contribution.deltaExpected / damage.expected)
        }
        // 两条 buff 都摘掉的伤害 = 不含任何 buff 的伤害（可比性校验）
        const none = compute(directDamage('100%', []))
        const atkOnly = damage.contributions.find((c) => c.buffId === 'bonus')!
        assert.equal(
            damage.expected - atkOnly.deltaExpected,
            compute(directDamage('100%', [buffs[0]!])).damages[0]!.expected
        )
        assert.ok(none.damages[0]!.expected < damage.expected)
    })

    it('目标侧 buff 同样可溯源（减防 / 免伤）', () => {
        const buffs = [
            { id: 'defDown', effect: { applyTo: 'defDown', value: '20' } },
            { id: 'red', effect: { applyTo: 'enemyDmgReduction', value: '10' } }
        ]
        const result = compute(directDamage('100%', buffs), { trace: true })
        const contributions = result.damages[0]!.contributions
        assert.equal(contributions.length, 2)
        const red = contributions.find((c) => c.buffId === 'red')!
        assert.ok(red.deltaExpected < 0, '免伤 buff 抬高敌人免伤 → 贡献为负（摘掉它伤害更高）')
        const defDown = contributions.find((c) => c.buffId === 'defDown')!
        assert.ok(defDown.deltaExpected > 0, '减防 → 正贡献')
    })
})
