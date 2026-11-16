// ── CoconutCore：注册基础属性 + 吃 GeneralTable 出结果 ─────────────────────
// 覆盖内核的公开契约：词条落点、buff 数值/引用、四条公式的基值与乘子链、暴击三列。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { CoconutCore, type GeneralTable } from '$coconut'
import { buildCoconutCoreConfig } from '$lib/calc/core-config'

/** @desc 注册层：内核零内置，结算前必须 init 一份配置 */
const registered = () => new CoconutCore().init(buildCoconutCoreConfig())

/** @desc 基础数值：全部调用时传入（角色 / 武器 / 敌人） */
const BASES = {
    characters: {
        A: { atk: 400, hp: 10000, def: 500, element: '冷凝', tuneBreakBoost: 100 }
    },
    weapons: { W: { atk: 500 } },
    enemy: {
        type: 'BOSS',
        level: 90,
        defense: 1000,
        dmgReduction: 0,
        resistances: { 物理: 10, 冷凝: 40, 热熔: 10, 导电: 10, 气动: 10, 衍射: 10, 湮灭: 10 },
        coefficient: 10027
    }
} as const

const compute = (table: GeneralTable, options?: { trace?: boolean }) =>
    registered().compute(table, BASES as unknown as Parameters<CoconutCore['compute']>[1], options)

const tableOf = (table: Partial<GeneralTable>): GeneralTable => ({
    characters: ['A'],
    weapons: ['W'],
    main_stats: [],
    sub_stats: [],
    buffs: [],
    damage_entries: [],
    ...table
})

const directDamage = (value: string, activated_buffs: GeneralTable['buffs'] = []) =>
    tableOf({
        damage_entries: [
            {
                source: 'A',
                damages: [{ value, activated_buffs: [...activated_buffs], element: '冷凝', formula: 'direct' }]
            }
        ]
    })

describe('CoconutCore：注册 + 面板', () => {
    it('白值 = 角色白值 + 武器白值；词条写进面板落点', () => {
        const result = compute(
            tableOf({
                main_stats: [[{ key: 'atkPct', value: '12' }]],
                sub_stats: [
                    [
                        { key: 'critRate', value: '10' },
                        { key: 'critDmg', value: '20' }
                    ]
                ],
                damage_entries: [
                    {
                        source: 'A',
                        damages: [{ value: '100%', activated_buffs: [], element: '冷凝', formula: 'direct' }]
                    }
                ]
            })
        )
        const panel = result.damages[0]!.panel
        assert.equal(panel.base.atk, 900)
        assert.equal(panel.zones.atkPct, 12)
        assert.equal(panel.total.atk, 900 + Math.round((900 * 12) / 100))
        assert.equal(panel.zones.critRate, 5 + 10)
        assert.equal(panel.zones.critDmg, 150 + 20)
        assert.equal(panel.zones.tuneBreakBoost, 100)
    })

    it('激活 buff 直接写面板（无条件的「一切皆 buff」）', () => {
        const buff = { id: 'b1', effect: { applyTo: 'atkPct', value: '20' } }
        const result = compute(directDamage('100%', [buff]))
        assert.equal(result.damages[0]!.panel.zones.atkPct, 20)
        assert.equal(result.damages[0]!.panel.total.atk, 900 + 180)
    })

    it('目标侧 buff 落在敌人面板（免伤走 enemyDmgReduction）', () => {
        const buffs = [
            { id: 'defDown', effect: { applyTo: 'defDown', value: '20' } },
            { id: 'red', effect: { applyTo: 'enemyDmgReduction', value: '10' } }
        ]
        const result = compute(directDamage('100%', buffs))
        const target = result.damages[0]!.target
        assert.equal(target.defense, 1000)
        assert.equal(target.dmgReduction, 10)
        assert.equal(target.resistances['冷凝'], 40)
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
        const result = compute(directDamage('100%', [buff]))
        assert.equal(result.damages[0]!.panel.zones.atkFlat, 1000)

        const withBaseLine = {
            ...buff,
            effect: { ...buff.effect, value: { ...buff.effect.value, baseLine: 8000 } }
        }
        assert.equal(compute(directDamage('100%', [withBaseLine])).damages[0]!.panel.zones.atkFlat, 1000)

        const lower = {
            ...buff,
            effect: { ...buff.effect, value: { ...buff.effect.value, baseLine: 9500 } }
        }
        assert.equal(compute(directDamage('100%', [lower])).damages[0]!.panel.zones.atkFlat, 500)
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
        const table = tableOf({
            main_stats: [[{ key: 'recharge', value: '150' }]],
            damage_entries: [
                {
                    source: 'A',
                    damages: [{ value: '100%', activated_buffs: [buff], element: '冷凝', formula: 'direct' }]
                }
            ]
        })
        // 共鸣效率初值 100 + 词条 150 = 250（%）→ 归一成 2.5 → 目标单位 '' 保持 2.5
        assert.equal(compute(table).damages[0]!.panel.zones.atkFlat, 2.5)
    })
})

describe('CoconutCore：公式与暴击三列', () => {
    it('直伤：基值 = 面板三维 × 倍率，乘子链顺序固定', () => {
        const table = directDamage('200%')
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
        assert.equal(damage.nonCrit, 5000)
        assert.equal(damage.crit, 5000)
        assert.equal(damage.expected, 5000)
        assert.deepEqual(damage.multipliers, [])
    })

    it('处决：基值 = 敌人类型系数 × 倍率', () => {
        const result = compute(
            tableOf({
                damage_entries: [
                    { source: 'A', damages: [{ value: '10', activated_buffs: [], element: '物理', formula: 'tune' }] }
                ]
            })
        )
        assert.equal(result.damages[0]!.baseValue, 10027 * 10)
    })

    it('效应：基值 = 虚角色面板的「效应系数」× 该段层数倍率', () => {
        // 虚角色：效应基础值挂在「效应系数」这一维度上，不混进攻击
        const result = registered().compute(
            tableOf({
                characters: ['A', '效应·电磁效应'],
                weapons: ['', ''],
                main_stats: [[], []],
                sub_stats: [[], []],
                damage_entries: [
                    {
                        source: '效应·电磁效应',
                        damages: [{ value: '1.5', activated_buffs: [], element: '导电', formula: 'effect' }]
                    }
                ]
            }),
            {
                ...BASES,
                characters: {
                    ...BASES.characters,
                    '效应·电磁效应': { atk: 0, hp: 0, def: 0, element: '导电', coefficient: 3674 }
                }
            } as unknown as Parameters<CoconutCore['compute']>[1]
        )
        const damage = result.damages[0]!
        assert.equal(damage.panel.zones.effectCoeff, 3674, '效应系数来自虚角色注册')
        assert.equal(damage.panel.total.atk, 0, '虚角色没有攻击面板')
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
            result.total.expected,
            result.damages.reduce((sum, d) => sum + d.expected, 0)
        )
    })
})

describe('CoconutCore：倍率串', () => {
    it('倍率串只认数字与 %，基准维度由字段给出', () => {
        const buff = { id: 'b', effect: { applyTo: 'atkPct', value: '0' } }
        const cases: [string, 'atk' | 'hp' | 'def' | undefined, number][] = [
            ['100%', undefined, 900],
            ['1', undefined, 900],
            ['2', undefined, 1800],
            ['100%', 'hp', 10000],
            ['0.5', 'def', 250]
        ]
        for (const [value, base, expected] of cases) {
            const table = directDamage(value, [buff])
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
