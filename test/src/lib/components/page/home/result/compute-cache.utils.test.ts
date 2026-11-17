// ── 结果页的条目结果缓存（`compute-cache.utils`）─────────────────────────────
//
// 契约：
// 1. 输入签名覆盖「条目之外」的一切：表格版本 / 链阶 / 手动刷新 / 队伍 / 配置 / 角色与武器数据 /
//    声骸文案；声骸文案与角色数据按**内容**比（映射每轮都换对象），队伍与配置按内容现算（它们是
//    会原地修改的代理）；
// 2. 签名一致时缓存才有效；签名变了整份作废（Buff 数值改过，所有条目都得重算）；
// 3. 同内容条目只算一次：`computePlanOf` 每种内容只留首次出现的那条，其余由
//    `assembleEntryResults` 同步数值、各自保留身份字段。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
    assembleEntryResults,
    computeInputsSignatureOf,
    computePlanOf,
    emptyEntryResultCache,
    nextEntryResultCache,
    type ComputeInputs
} from '$lib/components/page/home/result/compute-cache.utils'
import { makeStubEntry } from '$lib/calc/compute'
import type { DamageEntry } from '$lib/calc/calculation.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { CharSlot } from '$lib/types/project'
import type { ConfigState, EchoSlotConfig } from '$lib/calc/config.types'
import type { ResultEntry } from '$lib/calc/result.types'

const charInfo = (atk: number): CharacterInfo =>
    ({
        rarity: 5,
        element: '冷凝',
        weaponType: '长刃',
        tags: [],
        lv90BaseStats: { hp: 10000, atk, def: 500, tuneBreakBoost: 0 },
        skills: [],
        statNodes: [],
        chains: []
    }) as CharacterInfo

const weaponInfo = (atk: number): WeaponInfo => ({ rarity: 5, type: '长刃', lv90BaseAtk: atk }) as WeaponInfo

const emptyEcho = (): EchoSlotConfig => ({ cost: 1, mainStat: null, secondMainStat: null, substats: [] })
const configOf = (defense: number): ConfigState => ({
    characters: [0, 1, 2].map(() => ({
        echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()]
    })) as ConfigState['characters'],
    enemy: { type: 'BOSS', level: 90, defense, resistances: {}, dmgReduction: 0 }
})

const inputsOf = (overrides: Partial<ComputeInputs> = {}): ComputeInputs => ({
    table: 1,
    refresh: 0,
    profile: '0,0,0|1,1,1',
    team: [{ character: '甲', weapon: '武器W' }] as unknown as readonly CharSlot[],
    config: configOf(1000),
    charInfo: { 甲: charInfo(1000) },
    weaponInfo: { 武器W: weaponInfo(500) },
    echoSkillText: { 声骸A: '文案' },
    ...overrides
})

const entryOf = (id: string, overrides: Partial<DamageEntry> = {}): DamageEntry =>
    ({
        id,
        character: '甲',
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

const resultOf = (entry: DamageEntry, expected: number): ResultEntry => ({
    ...makeStubEntry(entry),
    expectedPerHit: expected,
    totalDamage: expected
})

describe('computeInputsSignatureOf：签名覆盖条目之外的全部输入', () => {
    const base = inputsOf()
    const sig = computeInputsSignatureOf(base)

    it('同样的输入 → 同样的签名', () => {
        assert.equal(computeInputsSignatureOf(inputsOf()), sig)
    })

    it('表格版本 / 刷新计数 / 链阶变化 → 签名变化', () => {
        assert.notEqual(computeInputsSignatureOf(inputsOf({ table: 2 })), sig)
        assert.notEqual(computeInputsSignatureOf(inputsOf({ refresh: 1 })), sig)
        assert.notEqual(computeInputsSignatureOf(inputsOf({ profile: '6,0,0|1,1,1' })), sig)
    })

    it('队伍 / 配置按内容比：原地改数值也能识别', () => {
        const config = configOf(1000)
        const team = [{ character: '甲', weapon: '武器W' }] as unknown as CharSlot[]
        const before = computeInputsSignatureOf({ ...base, config, team })
        config.enemy.defense = 2000
        assert.notEqual(computeInputsSignatureOf({ ...base, config, team }), before, '配置原地修改要能识别')
        ;(team[0] as { weapon: string | null }).weapon = '武器X'
        assert.notEqual(computeInputsSignatureOf({ ...base, config, team }), before, '队伍原地修改要能识别')
    })

    it('角色 / 武器数据按内容比：换一个对象但内容相同 → 签名不变', () => {
        const same = inputsOf({ charInfo: { 甲: charInfo(1000) }, weaponInfo: { 武器W: weaponInfo(500) } })
        assert.equal(computeInputsSignatureOf(same), sig)
        assert.notEqual(computeInputsSignatureOf(inputsOf({ charInfo: { 甲: charInfo(1200) } })), sig)
        assert.notEqual(computeInputsSignatureOf(inputsOf({ weaponInfo: { 武器W: weaponInfo(600) } })), sig)
        assert.notEqual(computeInputsSignatureOf(inputsOf({ echoSkillText: { 声骸A: '别的文案' } })), sig)
    })
})

describe('computePlanOf：同内容条目只算一次', () => {
    const entries = [
        entryOf('a'),
        entryOf('b', { sourceTimelineBlockId: 'op2' }), // 与 a 内容相同，身份不同
        entryOf('c', { ratioValue: 200 }),
        entryOf('d', { ratioValue: 200, sourceTimelineBlockId: 'op3' }) // 与 c 内容相同
    ]
    const keys = ['k-a', 'k-a', 'k-c', 'k-c']

    it('空缓存：每种内容只留首次出现的那条去算', () => {
        const plan = computePlanOf({ previous: emptyEntryResultCache(), signature: 's1', entries, keys })
        assert.deepEqual(
            plan.missing.map((slot) => slot.index),
            [0, 2]
        )
        assert.equal(plan.reusable.size, 0)
    })

    it('签名一致且命中：全部复用，不产生计算项', () => {
        const byKey = new Map([
            ['k-a', resultOf(entries[0]!, 111)],
            ['k-c', resultOf(entries[2]!, 222)]
        ])
        const plan = computePlanOf({ previous: { signature: 's1', byKey }, signature: 's1', entries, keys })
        assert.deepEqual(plan.missing, [])
        assert.equal(plan.reusable.get('k-a')!.expectedPerHit, 111)
    })

    it('签名变化：缓存整份作废（只是同内容的条目仍然只算一次）', () => {
        const byKey = new Map([['k-a', resultOf(entries[0]!, 111)]])
        const plan = computePlanOf({ previous: { signature: 's1', byKey }, signature: 's2', entries, keys })
        assert.deepEqual(
            plan.missing.map((slot) => slot.index),
            [0, 2]
        )
        assert.equal(plan.reusable.size, 0)
    })
})

describe('assembleEntryResults：数值同步、身份各自保留', () => {
    const entries = [entryOf('a'), entryOf('b', { sourceTimelineBlockId: 'op2' }), entryOf('c', { ratioValue: 200 })]
    const keys = ['k-a', 'k-a', 'k-c']

    it('重复条目复用同一份数值，id / 时间轴块按条目回填', () => {
        const computed = [resultOf(entries[0]!, 111), resultOf(entries[2]!, 222)]
        const out = assembleEntryResults({
            entries,
            keys,
            reusable: new Map(),
            missing: [
                { index: 0, entry: entries[0]! },
                { index: 2, entry: entries[2]! }
            ],
            computed
        })
        assert.deepEqual(
            out.map((entry) => entry.id),
            ['a', 'b', 'c']
        )
        assert.equal(out[1]!.expectedPerHit, 111)
        assert.equal(out[1]!.sourceTimelineBlockId, 'op2')
        assert.equal(out[2]!.expectedPerHit, 222)
    })

    it('缓存命中的条目也参与组装', () => {
        const out = assembleEntryResults({
            entries,
            keys,
            reusable: new Map([['k-a', resultOf(entries[0]!, 999)]]),
            missing: [{ index: 2, entry: entries[2]! }],
            computed: [resultOf(entries[2]!, 222)]
        })
        assert.equal(out[0]!.expectedPerHit, 999)
        assert.equal(out[1]!.expectedPerHit, 999)
        assert.equal(out[2]!.expectedPerHit, 222)
    })
})

describe('nextEntryResultCache：按签名保留或重建', () => {
    const entry = entryOf('a')
    const previous = { signature: 's1', byKey: new Map([['k-a', resultOf(entry, 111)]]) }

    it('签名一致 → 合并（旧键保留）', () => {
        const next = nextEntryResultCache({
            previous,
            signature: 's1',
            computed: new Map([['k-c', resultOf(entry, 222)]])
        })
        assert.deepEqual([...next.byKey.keys()].sort(), ['k-a', 'k-c'])
        assert.equal(next.signature, 's1')
    })

    it('签名变化 → 只留本轮算出来的', () => {
        const next = nextEntryResultCache({
            previous,
            signature: 's2',
            computed: new Map([['k-c', resultOf(entry, 222)]])
        })
        assert.deepEqual([...next.byKey.keys()], ['k-c'])
    })
})
