// ── 解析记忆化（`createResolveMemo`）与结果级去重（`entryResultKeyOf`）─────────
//
// 记忆化的键只覆盖「真正影响解析结果」的输入：角色 / 公式 / 属性 / 推导出的伤害类型 /
// 勾选的 Buff 集合，且伤害名只在候选 Buff 带 `damageNameRegex` 规则时才进键。
// 必须钉住：
// 1. 命中缓存后返回的结果与逐条解析逐字段相等（面板是克隆，不能被公式求值污染的共享对象）；
// 2. 值共享范围限于只读字段（`target` / `writes`），面板一定是新对象；
// 3. 键的边界正确：伤害名不同、但没有任何「伤害名规则」时共用一份；有该规则时必须分开；
// 4. 内容完全一致的条目（拉表里同一条伤害绑定多次）结果级复用：数值一致、身份字段各自保留。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
    computeAll,
    createResolveMemo,
    DEFAULT_CONDITION_PROFILE,
    entryResultKeyOf,
    resolveEntry
} from '$lib/calc/compute'
import { computeAllViaCore } from '$lib/calc/compute-facade'
import type { BuffInstance, DamageEntry } from '$lib/calc/calculation.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { CharSlot } from '$lib/types/project'
import type { ConfigState, EchoSlotConfig } from '$lib/calc/config.types'

const CHAR = '甲'

const charInfoMap: Record<string, CharacterInfo> = {
    [CHAR]: {
        rarity: 5,
        element: '冷凝',
        weaponType: '长刃',
        tags: [],
        lv90BaseStats: { hp: 10000, atk: 1000, def: 500, tuneBreakBoost: 0 },
        skills: [],
        statNodes: [],
        chains: []
    }
}
const weaponInfoMap: Record<string, WeaponInfo> = {}
const team = [{ character: CHAR, weapon: null }] as unknown as CharSlot[]
const emptyEcho = (): EchoSlotConfig => ({ cost: 1, mainStat: null, secondMainStat: null, substats: [] })
const config: ConfigState = {
    characters: [
        { echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] },
        { echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] },
        { echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] }
    ],
    enemy: { type: '精英怪', level: 90, defense: 1000, resistances: {}, dmgReduction: 0 }
}

const entryOf = (id: string, overrides: Partial<DamageEntry> = {}): DamageEntry =>
    ({
        id,
        character: CHAR,
        skillType: '常态攻击',
        hitName: '常态攻击第1段伤害',
        displayName: '常态攻击第1段(常态攻击)',
        formula: 'direct',
        ratioValue: 100,
        ratioUnit: '%',
        damageBaseType: '攻击',
        damageElement: '冷凝',
        sourceTimelineBlockId: 'op1',
        hits: 1,
        ...overrides
    }) as DamageEntry

/** 一条普通增伤 Buff（无规则）+ 一条「伤害名」规则 Buff */
const bonus: BuffInstance = { id: 'b1', name: '增伤', zones: [{ zoneId: 'bonusDmg', value: 20 }], scope: 'all' }
const nameRule: BuffInstance = {
    id: 'b2',
    name: '只对共鸣解放',
    zones: [{ zoneId: 'bonusDmg', value: 50 }],
    scope: 'all',
    rules: [{ kind: 'damageNameRegex', pattern: '共鸣解放' }]
}

const ctxOf = (buffs: BuffInstance[], entries: readonly DamageEntry[]) => ({
    buffSets: buffs,
    damageEntryBuffSetIds: Object.fromEntries(entries.map((e) => [e.id, buffs.map((b) => b.id)])),
    damageEntryDamageTypes: Object.fromEntries(entries.map((e) => [e.id, [] as string[]])),
    configState: config,
    team,
    charInfoMap,
    weaponInfoMap,
    conditionProfile: DEFAULT_CONDITION_PROFILE,
    echoSkillText: {}
})

const comparable = (r: ReturnType<typeof resolveEntry>) => ({
    damageTypes: r.damageTypes,
    critBase: r.critBase,
    panel: r.panel,
    target: r.target,
    writes: r.writes,
    targetWrites: r.targetWrites,
    stub: r.stub
})

describe('解析记忆化：与逐条解析逐字段相等', () => {
    const entries = [
        entryOf('e1'),
        entryOf('e2'),
        entryOf('e3', { hitName: '常态攻击第2段伤害', displayName: '常态攻击第2段(常态攻击)' }),
        entryOf('e4', { damageElement: '热熔' }),
        entryOf('e5', { formula: 'tune', damageBaseType: '偏谐系数', damageElement: '物理' }),
        entryOf('e6', { character: '', formula: 'effect', skillType: '效应结算', hitName: '光噪效应' })
    ]
    const ctx = ctxOf([bonus], entries)
    const memo = createResolveMemo(ctx).resolve

    it('每条条目命中与否都和 resolveEntry 完全一致', () => {
        for (const entry of entries) {
            const memoized = memo(entry)
            const plain = resolveEntry(entry, ctx)
            assert.deepEqual(comparable(memoized), comparable(plain), `${entry.id} 解析结果不一致`)
        }
    })

    it('重复解析同一份输入时，只读字段共享、面板是新对象（公式求值会写面板）', () => {
        const a = memo(entryOf('same-a'))
        const b = memo(entryOf('same-b'))
        assert.notEqual(a.panel, b.panel, '面板必须克隆：computeFormulaEntry 会往 bonusDmg 里累加')
        assert.deepEqual(a.panel, b.panel)
        assert.equal(a.target, b.target, '目标侧只读，可共享')
        assert.equal(a.writes, b.writes, '落值只读，可共享')
    })

    it('属性 / 伤害类型不同 → 不能共用', () => {
        const cold = memo(entryOf('el-cold', { damageElement: '冷凝' }))
        const fire = memo(entryOf('el-fire', { damageElement: '热熔' }))
        assert.notEqual(cold.panel, fire.panel)
    })

    it('调用方写脏返回的面板后，缓存不被污染', () => {
        const first = memo(entryOf('dirty-a'))
        // 模拟 computeFormulaEntry 的 `formulaCtxOf`：把元素/类型加成折进面板
        const before = first.panel.zones.bonusDmg ?? 0
        first.panel.zones.bonusDmg = before + 50
        const second = memo(entryOf('dirty-b'))
        assert.equal(second.panel.zones.bonusDmg ?? 0, before, '命中缓存的面板必须是解析时的干净值')
        assert.deepEqual(comparable(second), comparable(resolveEntry(entryOf('dirty-b'), ctx)))
    })
})

describe('解析记忆化：伤害名只在该规则存在时进键', () => {
    it('候选里没有「伤害名」规则 → 名字不同的两条共用一份解析结果', () => {
        const entries = [entryOf('a'), entryOf('b', { displayName: '常态攻击第9段(常态攻击)' })]
        const ctx = ctxOf([bonus], entries)
        const memo = createResolveMemo(ctx).resolve
        const a = memo(entries[0]!)
        const b = memo(entries[1]!)
        assert.equal(a.target, b.target, '应当命中缓存')
        assert.deepEqual(a.panel, b.panel)
    })

    it('候选里有「伤害名」规则 → 名字不同必须各自解析', () => {
        const hit = entryOf('hit', { displayName: '共鸣解放伤害(共鸣解放)' })
        const miss = entryOf('miss', { displayName: '常态攻击第1段(常态攻击)' })
        const entries = [hit, miss]
        const ctx = ctxOf([bonus, nameRule], entries)
        const memo = createResolveMemo(ctx).resolve
        const a = memo(hit)
        const b = memo(miss)
        assert.notEqual(a.target, b.target, '有伤害名规则时不能共用')
        assert.notDeepEqual(comparable(a), comparable(b), '两条的生效 Buff 不同')
        assert.deepEqual(comparable(a), comparable(resolveEntry(hit, ctx)))
        assert.deepEqual(comparable(b), comparable(resolveEntry(miss, ctx)))
    })
})

describe('结果级去重：内容完全一致的条目只算一次', () => {
    const bindings = { a: ['b1'], b: ['b1'], c: ['b1'], d: ['b1'], e: ['b1'], f: ['b2'] }
    const types = { a: [], b: [], c: [], d: [], e: [], f: [] } as Record<string, string[]>
    const run = (entries: DamageEntry[]) =>
        computeAll(entries, [bonus, nameRule], bindings, types, config, team, charInfoMap, weaponInfoMap)

    const base = entryOf('a')
    // 只换 id 与时间轴块：内容完全一致 → 应复用
    const dupA = { ...base, id: 'b', sourceTimelineBlockId: 'op2' } as DamageEntry
    // 只换 id：时间轴块也一致
    const dupB = { ...base, id: 'c' } as DamageEntry
    // 倍率不同：内容不同 → 必须重算
    const other = { ...base, id: 'd', ratioValue: 200 } as DamageEntry
    // 勾选的 Buff 不同 → 必须重算
    const otherBuffs = { ...base, id: 'f' } as DamageEntry
    // 段数不同：数值口径不变，但 `hits` / `ratioNum` / `ratioFactors` 是逐条目的输出字段 → 也要重算
    const otherHits = { ...base, id: 'e', hits: 2 } as DamageEntry

    it('键：只换 id / 时间轴块时相同，内容或勾选变化时不同', () => {
        assert.equal(entryResultKeyOf(base, bindings, types), entryResultKeyOf(dupA, bindings, types))
        assert.equal(entryResultKeyOf(base, bindings, types), entryResultKeyOf(dupB, bindings, types))
        assert.notEqual(entryResultKeyOf(base, bindings, types), entryResultKeyOf(other, bindings, types))
        assert.notEqual(entryResultKeyOf(base, bindings, types), entryResultKeyOf(otherBuffs, bindings, types))
        assert.notEqual(entryResultKeyOf(base, bindings, types), entryResultKeyOf(otherHits, bindings, types))
    })

    it('computeAll：重复条目的数值完全一致，身份字段各自保留', () => {
        const [a, b, c] = run([base, dupA, dupB])
        for (const field of ['expectedPerHit', 'baseValue', 'totalDamage', 'critPerHit', 'nonCritPerHit'] as const) {
            assert.equal(b![field], a![field], `${field} 应复用同一份结果`)
            assert.equal(c![field], a![field], `${field} 应复用同一份结果`)
        }
        assert.equal(a!.id, 'a')
        assert.equal(b!.id, 'b')
        assert.equal(b!.sourceTimelineBlockId, 'op2', '时间轴块属于身份，必须按条目回填')
        assert.equal(b!.displayName, a!.displayName)
    })

    it('computeAll：内容不同的条目不会被误判为重复', () => {
        const [a, , , d] = run([base, dupA, dupB, other])
        assert.equal(d!.ratioNum, a!.ratioNum * 2, '倍率翻倍 → 必须单独算')
        assert.equal(d!.baseValue, a!.baseValue * 2, '基值随倍率翻倍')
    })

    it('computeAllViaCore：门面路径同样复用（重复条目不进表）', () => {
        const request = {
            entries: [base, dupA, dupB],
            buffs: [bonus],
            bindings: { a: ['b1'], b: ['b1'], c: ['b1'] },
            damageTypes: {},
            config,
            team,
            charInfo: charInfoMap,
            weaponInfo: weaponInfoMap,
            profile: DEFAULT_CONDITION_PROFILE
        }
        const viaCore = computeAllViaCore(request)
        assert.deepEqual(
            viaCore.map((e) => e.id),
            ['a', 'b', 'c']
        )
        assert.equal(viaCore[1]!.expectedPerHit, viaCore[0]!.expectedPerHit)
        assert.equal(viaCore[2]!.expectedPerHit, viaCore[0]!.expectedPerHit)
        assert.equal(viaCore[1]!.sourceTimelineBlockId, 'op2')
        // 与「逐条各算一次」的结果一致
        const each = run([base])
        assert.equal(viaCore[0]!.expectedPerHit, each[0]!.expectedPerHit)
    })
})
