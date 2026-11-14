// 直伤贡献分析的两条**执行路径**与「复用外部基线」的回归测试。
//
// 钉住三件事：
// 1. `baselineEntries`（结果页已算好的引擎结果）与内部重算 `computeAll` 逐字段等价 ——
//    复用只是为了省掉重复劳动，绝不能改变数值口径；
// 2. Worker 与主线程共用 `runContributionSteps`，分片顺序（角色 → 副词条 / Buff）与进度回包一致；
// 3. 执行器在「环境没有 Worker」时回退主线程，结果同样一致（node:test 里就是这条路径）。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeAll, computeOneEntry, DEFAULT_CONDITION_PROFILE } from '$lib/calc/compute'
import type { BuffConf, DamageEntry } from '$lib/calc/calculation.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { CharSlot } from '$lib/types/project'
import type { ConfigState, EchoSlotConfig } from '$lib/calc/config.types'
import {
    prepareContributionAnalysis,
    runContributionAnalysis,
    runContributionSteps,
    type ContributionAnalysisRequest,
    type ContributionAnalysisResult
} from '$lib/calc/substat-algorithms/analysis'
import { runContributionAnalysisAsync } from '$lib/calc/substat-algorithms/analysis-runner'
import { createContributionAnalysisRunner } from '$lib/calc/substat-algorithms/analysis-runner.svelte'

const CHAR_A = '甲'
const CHAR_B = '乙'

const mkInfo = (atk: number): CharacterInfo => ({
    rarity: 5,
    element: '冷凝',
    weaponType: '长刃',
    tags: [],
    lv90BaseStats: { hp: 10000, atk, def: 500, tuneBreakBoost: 0 },
    skills: [],
    statNodes: [],
    chains: []
})

const charInfoMap: Record<string, CharacterInfo> = { [CHAR_A]: mkInfo(1000), [CHAR_B]: mkInfo(900) }
const weaponInfoMap: Record<string, WeaponInfo> = {}

const echoWith = (substats: EchoSlotConfig['substats']): EchoSlotConfig => ({
    cost: 1,
    mainStat: null,
    secondMainStat: null,
    substats
})

const emptyEcho = (): EchoSlotConfig => echoWith([])

const echoes = (substats: EchoSlotConfig['substats']): ConfigState['characters'][number]['echoes'] => [
    echoWith(substats),
    emptyEcho(),
    emptyEcho(),
    emptyEcho(),
    emptyEcho()
]

const configState: ConfigState = {
    characters: [
        { echoes: echoes([{ type: '攻击%', value: 30, unit: '%' }]) },
        { echoes: echoes([{ type: '暴击率', value: 20, unit: '%' }]) },
        { echoes: echoes([]) }
    ],
    enemy: { type: 'BOSS', level: 90, defense: 1000, resistances: {}, dmgReduction: 0 }
}

const team = [
    { character: CHAR_A, weapon: null },
    { character: CHAR_B, weapon: null },
    { character: '', weapon: null }
] as unknown as CharSlot[]

const makeEntry = (id: string, character: string, ratioValue: number): DamageEntry => ({
    id,
    character,
    hitName: '测试伤害',
    displayName: '测试伤害',
    isEffect: false,
    isTuneBreak: false,
    isTuneResponse: false,
    ratioValue,
    ratioUnit: '%',
    damageBaseType: '攻击',
    damageElement: '冷凝',
    sourceTimelineBlockId: `b-${id}`,
    hits: 1
})

const damageEntries = [makeEntry('a1', CHAR_A, 100), makeEntry('a2', CHAR_A, 220), makeEntry('b1', CHAR_B, 160)]

const buffSets: BuffConf[] = [
    { id: 'buff-atk', name: '套装甲\\攻击', zones: [{ zoneId: 'atkPct', value: 25 }], scope: 'all' },
    {
        id: 'buff-multi',
        name: '套装甲\\双乘区',
        zones: [
            { zoneId: 'bonusDmg', value: 20 },
            { zoneId: 'critDmg', value: 15 }
        ],
        scope: 'all'
    },
    { id: 'buff-root', name: '根增益', zones: [{ zoneId: 'deepenDmg', value: 8 }], scope: 'all' }
]

const damageEntryBuffSetIds: Record<string, string[]> = {
    a1: ['buff-atk', 'buff-multi', 'buff-root'],
    a2: ['buff-atk', 'buff-root'],
    b1: ['buff-multi', 'buff-root']
}

const request = (): ContributionAnalysisRequest => ({
    damageEntries,
    buffSets,
    damageEntryBuffSetIds,
    damageEntryDamageTypes: {},
    configState,
    team,
    charInfoMap,
    weaponInfoMap,
    rigCritEntryIds: [],
    noCritEntryIds: [],
    missEntryIds: [],
    conditionProfile: DEFAULT_CONDITION_PROFILE,
    echoSkillText: {}
})

/** @desc 结果页那一份基线：同一份 computeAll、同一批入参 */
const baselineOf = (req: ContributionAnalysisRequest) =>
    computeAll(
        req.damageEntries,
        req.buffSets,
        req.damageEntryBuffSetIds,
        req.damageEntryDamageTypes,
        req.configState,
        req.team,
        req.charInfoMap,
        req.weaponInfoMap,
        DEFAULT_CONDITION_PROFILE
    )

describe('复用外部基线：数值必须与内部重算逐字段一致', () => {
    const req = request()
    const baselineEntries = baselineOf(req)
    const withBaseline = prepareContributionAnalysis({ ...req, baselineEntries })
    const withoutBaseline = prepareContributionAnalysis(req)

    it('基线与内部 computeAll 一致（同参数同配置）', () => {
        assert.equal(withBaseline.characters.length, withoutBaseline.characters.length)
        for (const [i, ctx] of withBaseline.characters.entries()) {
            const bare = withoutBaseline.characters[i]
            assert.equal(ctx.character, bare.character)
            assert.equal(ctx.damageEntries.length, bare.damageEntries.length)
            assert.deepEqual(ctx.baseline, bare.baseline, ctx.character + ' 的基线必须逐字段相等')
        }
    })

    it('给了基线就不再内部重算：整份分析结果与不给时相同', () => {
        const reuse = runContributionAnalysis({ ...req, baselineEntries }, ['single-loss'])
        const internal = runContributionAnalysis(req, ['single-loss'])
        assert.deepEqual(reuse.substat['single-loss'], internal.substat['single-loss'])
        assert.deepEqual(reuse.buff, internal.buff)
    })

    it('基线用的是外部条目本身（改动它就直接反映到分析结果）', () => {
        // 把甲的条目全归零：若仍然内部重算，分析里就会有伤害
        const zeroed = baselineEntries.map((e) =>
            e.character === CHAR_A ? { ...e, totalDamageRaw: 0, expectedPerHit: 0 } : e
        )
        const session = prepareContributionAnalysis({ ...req, baselineEntries: zeroed })
        const ctx = session.characters.find((c) => c.character === CHAR_A)
        assert.ok(ctx)
        assert.equal(ctx.baseline.norm, 0)
        assert.equal(ctx.baseline.actual, 0)
        const other = session.characters.find((c) => c.character === CHAR_B)
        assert.ok(other && other.baseline.norm > 0, '乙的条目没被改动，基线照常')
    })
})

describe('分片执行器：进度顺序与最终结果', () => {
    const req = request()

    it('按「角色 → 副词条 / Buff」逐片回调进度', async () => {
        const partials: ContributionAnalysisResult[] = []
        const session = prepareContributionAnalysis(req)
        const result = await runContributionSteps(session, { algorithm: 'single-loss' }, (partial) =>
            partials.push(partial)
        )

        // 2 个角色 × （副词条 + Buff）= 4 次回调
        assert.equal(partials.length, 4)
        assert.deepEqual(
            partials.map((p) => [p.substat.length, p.buff.length]),
            [
                [1, 0],
                [1, 1],
                [2, 1],
                [2, 2]
            ]
        )
        assert.deepEqual(result.substat, partials[3].substat)
        assert.deepEqual(result.buff, partials[3].buff)
    })

    it('只算一半时不碰另一半', async () => {
        const session = prepareContributionAnalysis(req)
        const onlySubstat = await runContributionSteps(session, { algorithm: 'single-loss', parts: ['substat'] })
        assert.equal(onlySubstat.substat.length, 2)
        assert.deepEqual(onlySubstat.buff, [])
    })

    it('分片结果与同步整份分析的同一算法结果一致', async () => {
        const session = prepareContributionAnalysis(req)
        const stepped = await runContributionSteps(session, { algorithm: 'single-loss' })
        const sync = runContributionAnalysis(req, ['single-loss'])
        assert.deepEqual(stepped.substat, sync.substat['single-loss'])
        assert.deepEqual(stepped.buff, sync.buff)
    })
})

describe('执行器：Worker 不可用时回退主线程', () => {
    it('node 环境没有 Worker → 首次派发后模式降为 main，结果与同步实现一致', async () => {
        const runner = createContributionAnalysisRunner()
        // 尚未尝试创建 Worker 时按「将要使用 Worker」上报，与旧执行器同口径
        assert.equal(runner.getMode(), 'worker')
        const req = request()
        const partials: ContributionAnalysisResult[] = []
        const res = await runner.run(req, { algorithm: 'single-loss' }, (partial) => partials.push(partial))
        assert.equal(typeof Worker, 'undefined', 'node 里没有 Worker 全局，这条用例走的正是回退路径')
        assert.equal(runner.getMode(), 'main')
        const sync = runContributionAnalysis(req, ['single-loss'])
        assert.deepEqual(res.substat, sync.substat['single-loss'])
        assert.deepEqual(res.buff, sync.buff)
        assert.equal(partials.length, 4, '回退路径同样逐片回进度')
        runner.dispose()
        runner.dispose()
    })

    it('回退实现与运行器结果相同（同一条主线程路径）', async () => {
        const runner = createContributionAnalysisRunner()
        const req = request()
        const viaRunner = await runner.run(req, { algorithm: 'shapley' })
        const viaFallback = await runContributionAnalysisAsync(req, { algorithm: 'shapley' })
        assert.deepEqual(viaRunner.substat, viaFallback.substat)
        assert.deepEqual(viaRunner.buff, viaFallback.buff)
        runner.dispose()
    })
})

describe('Buff 贡献仍与引擎重算同源', () => {
    it('「buff-atk」的贡献 = 把它从甲的条目绑定里去掉后的伤害损失', () => {
        const req = request()
        const res = runContributionAnalysis(req, ['single-loss'])
        const target = res.buff.find((b) => b.character === CHAR_A)
        assert.ok(target)
        const entry = target.buffs.find((b) => b.id === 'buff-atk')
        assert.ok(entry, '甲必须有 buff-atk 的贡献行')

        const totalWith = (bindings: Record<string, string[]>): number =>
            ['a1', 'a2']
                .map(
                    (id) =>
                        computeOneEntry(
                            damageEntries.find((e) => e.id === id)!,
                            0,
                            configState.characters[0].echoes,
                            buffSets,
                            bindings,
                            {},
                            configState,
                            team,
                            charInfoMap,
                            weaponInfoMap,
                            DEFAULT_CONDITION_PROFILE
                        ).totalDamageRaw
                )
                .reduce((sum, v) => sum + v, 0)

        const withoutIt = {
            ...damageEntryBuffSetIds,
            a1: ['buff-multi', 'buff-root'],
            a2: ['buff-root']
        }
        const expected = totalWith(damageEntryBuffSetIds) - totalWith(withoutIt)
        assert.ok(expected > 0)
        assert.ok(Math.abs(entry.contribution - expected) < 1e-6, '贡献 = 移除该 Buff 的伤害损失')
    })
})
