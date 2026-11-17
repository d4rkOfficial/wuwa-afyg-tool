// ── 编译 + 内核 与 引擎 的数值对账 ────────────────────────────────────────
// 目的：证明「工具箱 → GeneralTable → CoconutCore」这条链算出来的数字与引擎逐条目结算
// 完全一致（条件、转模、覆盖、段数都在编译期处理完）。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { CoconutCore } from '$coconut-core'
import { buildCoconutCoreConfig } from '$lib/calc/core-config'
import { computeAll } from '$lib/calc/compute'
import type { BuffInstance, DamageEntry } from '$lib/calc/calculation.types'
import type { ConfigState, EchoSlotConfig } from '$lib/calc/config.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { CharSlot } from '$lib/types/project'
import { compileGeneralTable } from '$lib/calc/compile'
import { computeAllViaCore } from '$lib/calc/compute-facade'

const CHAR = '甲'
const WEAPON = '武器W'

const charInfoMap: Record<string, CharacterInfo> = {
    [CHAR]: {
        rarity: 5,
        element: '冷凝',
        weaponType: '长刃',
        tags: [],
        lv90BaseStats: { hp: 12000, atk: 1100, def: 600, tuneBreakBoost: 40 },
        skills: [],
        statNodes: [],
        chains: []
    }
}

const weaponInfoMap: Record<string, WeaponInfo> = {
    [WEAPON]: {
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

const team = [slot(CHAR, WEAPON, 2), slot(null, null), slot(null, null)] as unknown as CharSlot[]

const echo = (
    cost: number,
    mainStat: EchoSlotConfig['mainStat'],
    substats: EchoSlotConfig['substats'] = []
): EchoSlotConfig => ({
    cost,
    mainStat,
    secondMainStat: null,
    substats
})

const echoes: EchoSlotConfig[] = [
    echo(4, { type: '暴击率', value: 22, unit: '%' }, [
        { type: '攻击%', value: 8.6, unit: '%' },
        { type: '暴击伤害', value: 15, unit: '%' },
        { type: '攻击', value: 40, unit: '' }
    ]),
    echo(3, { type: '冷凝伤害加成', value: 30, unit: '%' }),
    echo(1, { type: '攻击%', value: 18, unit: '%' }, [{ type: '共鸣效率', value: 10, unit: '%' }]),
    echo(1, null),
    echo(1, null)
]

const echoesOf = (list: EchoSlotConfig[]): ConfigState['characters'][number]['echoes'] =>
    list as unknown as ConfigState['characters'][number]['echoes']

const config: ConfigState = {
    characters: [
        { echoes: echoesOf(echoes) },
        { echoes: echoesOf([echo(1, null), echo(1, null), echo(1, null), echo(1, null), echo(1, null)]) },
        { echoes: echoesOf([echo(1, null), echo(1, null), echo(1, null), echo(1, null), echo(1, null)]) }
    ],
    enemy: {
        type: 'BOSS',
        level: 90,
        defense: 1000,
        resistances: { 物理: 10, 冷凝: 40, 热熔: 10, 导电: 10, 气动: 10, 衍射: 10, 湮灭: 10 },
        dmgReduction: 5
    }
}

const buffs: BuffInstance[] = [
    { id: 'b1', name: '攻击', zones: [{ zoneId: 'atkPct', value: 20 }], scope: 'all' },
    {
        id: 'b2',
        name: '转模',
        zones: [{ zoneId: 'atkFlat', value: 0, ref: { characterIdx: 0, zoneId: 'totalHp', threshold: 0, pct: 3 } }],
        scope: 'all'
    },
    {
        id: 'b3',
        name: '链不满足',
        zones: [{ zoneId: 'bonusDmg', value: 30 }],
        scope: 'all',
        rules: [{ kind: 'chain', charIdx: 0, min: 5 }]
    },
    {
        id: 'b4',
        name: '链满足',
        zones: [{ zoneId: 'bonusDmg', value: 10 }],
        scope: 'all',
        rules: [{ kind: 'chain', charIdx: 0, min: 2 }]
    },
    {
        id: 'b5',
        name: '属性条件',
        zones: [{ zoneId: 'bonusDmg', value: 50, condition: { elements: ['热熔'] } }],
        scope: 'all'
    },
    { id: 'b6', name: '减防', zones: [{ zoneId: 'defDown', value: 15 }], scope: 'all' }
]

const entries: DamageEntry[] = [
    {
        id: 'e1',
        character: CHAR,
        displayName: '共鸣解放',
        damageElement: '冷凝',
        hitName: '共鸣解放',
        skillType: '共鸣解放',
        formula: 'direct',
        ratioValue: 200,
        ratioUnit: '%',
        ratioParts: [{ ratioValue: 200, ratioUnit: '%' }],
        damageBaseType: '生命',
        hits: 3,
        sourceTimelineBlockId: 'op1'
    } as unknown as DamageEntry,
    {
        id: 'e2',
        character: CHAR,
        displayName: '固定',
        damageElement: '冷凝',
        hitName: '固定',
        skillType: '其它',
        formula: 'direct',
        ratioValue: 5000,
        ratioUnit: 'fixed',
        ratioParts: [],
        damageBaseType: '攻击',
        hits: 1,
        sourceTimelineBlockId: 'op1'
    } as unknown as DamageEntry,
    {
        // 处决：基值读**敌人面板**的偏谐系数（BOSS 10027.001）
        id: 'e3',
        character: CHAR,
        displayName: '谐度破坏',
        damageElement: '物理',
        hitName: '谐度破坏',
        skillType: '谐度破坏',
        formula: 'tune',
        ratioValue: 1600,
        ratioUnit: '%',
        ratioParts: [{ ratioValue: 1600, ratioUnit: '%' }],
        damageBaseType: '偏谐系数',
        hits: 1,
        sourceTimelineBlockId: 'op1'
    } as unknown as DamageEntry,
    {
        // 效应：无源角色，编译成「虚角色·效应系数」，倍率 = 层数倍率
        id: 'e4',
        character: '',
        displayName: '光噪效应10层',
        damageElement: '衍射',
        hitName: '光噪效应',
        skillType: '效应结算',
        formula: 'effect',
        ratioValue: 10,
        ratioUnit: '%',
        ratioParts: [],
        damageBaseType: '效应系数',
        hits: 1,
        sourceTimelineBlockId: 'op1'
    } as unknown as DamageEntry
]

const bindings: Record<string, string[]> = { e1: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'], e2: ['b1'], e3: ['b1'], e4: [] }
const damageTypes: Record<string, string[]> = { e1: ['共鸣解放伤害'], e2: [], e3: [], e4: [] }

const PROFILE = { chains: [2, 0, 0], refinements: [1, 1, 1] }

const request = {
    entries,
    buffs,
    bindings,
    damageTypes,
    config,
    team,
    charInfo: charInfoMap,
    weaponInfo: weaponInfoMap,
    profile: PROFILE
}

describe('编译 → 内核 与引擎数值对账', () => {
    const engineResult = computeAll(
        [...entries],
        [...buffs],
        { ...bindings },
        { ...damageTypes },
        config,
        [...team],
        { ...charInfoMap },
        { ...weaponInfoMap },
        PROFILE
    )
    const table = compileGeneralTable(request)
    const coreResult = new CoconutCore().init(buildCoconutCoreConfig()).compute(table)

    it('结构：表里只有 buff 目录 + 伤害条目，段数走 hits 字段', () => {
        assert.deepEqual(Object.keys(table).sort(), ['buffs', 'damage_entries', 'global_buffs'])
        assert.ok(table.global_buffs.length > 0, '敌人配置等全条目一致的写入提升为全局 buff')
        assert.equal(table.damage_entries.length, 4)
        assert.equal(table.damage_entries[0]!.damages.length, 1, '一条伤害是一段结果，段数走 hits 字段')
        assert.equal(table.damage_entries[0]!.damages[0]!.hits, 3, 'hits 独立传给内核')
        assert.equal(table.damage_entries[1]!.damages.length, 1)
        assert.equal(table.damage_entries[0]!.damages[0]!.value, '200%', '倍率串是纯倍数/百分比')
        assert.equal(table.damage_entries[0]!.damages[0]!.base, 'hp', '基准维度走独立字段')
    })

    it('条件与转模：链门槛不满足的 buff 不进表，转模折算成字面值', () => {
        const activated = table.damage_entries[0]!.damages[0]!.activated_buffs
        assert.ok(activated.includes('b1'))
        assert.ok(activated.includes('b4'), '链 2 满足 → 生效')
        assert.equal(activated.includes('b3'), false, '链 5 不满足 → 不生效')
        const ref = table.buffs.find((buff) => buff.id === 'b2')
        assert.ok(ref, '转模作用应被折算后保留')
        assert.ok(Number(ref!.effects[0]!.value) > 0, '转模折算结果应是正数')
    })

    it('装备与词条都在 buff 里：白值、武器副属性、声骸主/副词条按引擎顺序排列', () => {
        const equip = table.buffs.find((buff) => buff.id === 'equip:0')
        assert.ok(equip, '每角色一条装备 buff')
        const ids = equip!.effects.map((effect) => effect.applyTo)
        assert.deepEqual(ids.slice(0, 4), ['atkBase', 'hpBase', 'defBase', 'atkBase'], '角色白值 + 武器白值在最前')
        assert.ok(ids.includes('atkPct'), '声骸/武器词条也在同一条 buff 里')
        assert.ok(ids.filter((id) => id === 'atkBase').length === 2, '武器白值与角色白值各写一次（内核累加后再取整）')
        assert.equal(
            table.buffs.every((buff) => buff.effects.length > 0),
            true,
            '不存在空 buff 目录项'
        )
        assert.equal(table.buffs.length, new Set(table.buffs.map((buff) => buff.id)).size, '目录 id 唯一')
    })

    it('数值：逐条目与引擎完全一致', () => {
        for (const [index, expected] of engineResult.entries()) {
            const segments = coreResult.damages.filter((damage) => damage.entryIndex === index)
            assert.equal(segments.length, 1, `${expected.displayName} 应产出一段结果`)
            const segment = segments[0]!
            // 内核的 `baseValue` 不取整（偏谐系数是小数，如 10027.001 × 16 = 160432.016），
            // 引擎的 `ResultEntry.baseValue` 是取整后的展示值；两层的对齐在门面（`compute-facade`）完成，
            // 见下面「门面：ResultEntry 与引擎 computeAll 逐字段相等」。
            assert.equal(Math.round(segment.baseValue), expected.baseValue, `${expected.displayName} 基值不一致`)
            // 「暴击 / 不暴击」两列是门面派生（内核只给期望），在门面层对账
            assert.equal(segment.expected, expected.expectedPerHit, `${expected.displayName} 期望不一致`)
            const engineZones = new Map((expected.multiplierZones ?? []).map((zone) => [zone.id, zone.value] as const))
            const coreZones = new Map(segment.multipliers.map((zone) => [zone.id, zone.value] as const))
            for (const id of new Set([...engineZones.keys(), ...coreZones.keys()])) {
                assert.equal(
                    coreZones.get(id),
                    engineZones.get(String(id)),
                    `${expected.displayName} 乘区 ${String(id)} 不一致`
                )
            }
        }
    })

    it('门面：ResultEntry 与引擎 computeAll 逐字段相等', () => {
        const facadeResult = computeAllViaCore(request)
        assert.equal(facadeResult.length, engineResult.length)
        const numericKeys = [
            'baseValue',
            'totalMultiplier',
            'expectedPerHit',
            'nonCritPerHit',
            'critPerHit',
            'totalDamage',
            'rawPerHit',
            'critRate',
            'critDmg',
            'dmgBonus',
            'defMulti',
            'resMulti',
            'dmgRedMulti',
            'finalDmg',
            'extraRatio',
            'vulnerability'
        ] as const
        for (const [index, expected] of engineResult.entries()) {
            const actual = facadeResult[index]!
            for (const key of numericKeys) {
                assert.equal(actual[key], expected[key], `${expected.displayName} 字段 ${key} 不一致`)
            }
            assert.equal(actual.id, expected.id)
            assert.equal(actual.hits, expected.hits)
            assert.deepEqual(
                (actual.multiplierZones ?? []).map((zone) => [zone.id, zone.value]),
                (expected.multiplierZones ?? []).map((zone) => [zone.id, zone.value])
            )
        }
    })
})
