// 直伤贡献分析（副词条 + Buff）与「复合倍率因子」的回归测试。
//
// 钉住三件事：
// 1. 三种副词条算法在**线性词条**上必须给出一致的值（单条损失 / Shapley / 偏导）；
// 2. Buff 贡献的口径是「移除损失」，且逐条损失不可相加（与「移除全部」的总贡献刻意不同）；
// 3. 复合倍率 / 额外倍率 Buff 的因子分摊必须**精确**：各因子 damage 之和 = 条目期望。
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { computeOneEntry, DEFAULT_CONDITION_PROFILE } from '$lib/calc/compute'
import { buildDamageSegments, type DamageTraceCtx } from '$lib/calc/damage-trace'
import type { BuffConf, DamageEntry } from '$lib/calc/calculation.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { CharSlot } from '$lib/types/project'
import type { ConfigState, EchoSlotConfig } from '$lib/calc/config.types'
import { runContributionAnalysis, type ContributionAnalysisRequest } from '$lib/calc/substat-algorithms/analysis'
import { buildStandardSlots } from '$lib/calc/standard-substats'

const CHAR = '测试角色'
const ENTRY_ID = 'e1'

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

const charInfo: CharacterInfo = mkInfo(1000)

const emptyEcho = (): EchoSlotConfig => ({ cost: 1, mainStat: null, secondMainStat: null, substats: [] })

const echoWithSubstats = (substats: EchoSlotConfig['substats']): EchoSlotConfig => ({
    cost: 1,
    mainStat: null,
    secondMainStat: null,
    substats
})

/** @desc 一套显式声骸（不足 5 个用空声骸补齐） */
const configWithEchoes = (echoes: EchoSlotConfig[]): ConfigState => ({
    characters: [
        {
            echoes: Array.from(
                { length: 5 },
                (_, i) => echoes[i] ?? emptyEcho()
            ) as ConfigState['characters'][0]['echoes']
        },
        { echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] },
        { echoes: [emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho(), emptyEcho()] }
    ],
    enemy: { type: 'BOSS', level: 90, defense: 1000, resistances: {}, dmgReduction: 0 }
})

const configWith = (echo: EchoSlotConfig): ConfigState => configWithEchoes([echo])

const team = [{ character: CHAR, weapon: null }] as unknown as CharSlot[]
const charInfoMap: Record<string, CharacterInfo> = { [CHAR]: charInfo }
const weaponInfoMap: Record<string, WeaponInfo> = {}

const makeEntry = (overrides: Partial<DamageEntry> = {}): DamageEntry => ({
    id: ENTRY_ID,
    character: CHAR,
    hitName: '测试伤害',
    displayName: '测试伤害',
    isEffect: false,
    isTuneBreak: false,
    isTuneResponse: false,
    ratioValue: 100,
    ratioUnit: '%',
    damageBaseType: '攻击',
    damageElement: '冷凝',
    sourceTimelineBlockId: 'b1',
    hits: 1,
    ...overrides
})

const buff = (id: string, name: string, zones: BuffConf['zones']): BuffConf => ({ id, name, zones, scope: 'all' })

const makeRequest = (
    entry: DamageEntry,
    buffs: BuffConf[],
    config: ConfigState,
    bindings: Record<string, string[]> = {}
): ContributionAnalysisRequest => ({
    damageEntries: [entry],
    buffSets: buffs,
    damageEntryBuffSetIds: bindings,
    damageEntryDamageTypes: {},
    configState: config,
    team,
    charInfoMap,
    weaponInfoMap,
    rigCritEntryIds: [],
    noCritEntryIds: [],
    missEntryIds: [],
    conditionProfile: DEFAULT_CONDITION_PROFILE,
    echoSkillText: {}
})

const ALGOS = ['single-loss', 'shapley', 'partial-derivative'] as const

describe('副词条贡献：三种算法在线性词条上一致', () => {
    const entry = makeEntry()
    const config = configWith(echoWithSubstats([{ type: '攻击%', value: 30, unit: '%' }]))
    const result = runContributionAnalysis(makeRequest(entry, [], config), [...ALGOS])

    it('单条攻击%：三算法都给出「移除后损失」那一份伤害', () => {
        const base = (atkPct: number) => {
            const cfg = configWith(echoWithSubstats([{ type: '攻击%', value: atkPct, unit: '%' }]))
            return computeOneEntry(
                entry,
                0,
                cfg.characters[0].echoes,
                [],
                {},
                {},
                cfg,
                team,
                charInfoMap,
                weaponInfoMap,
                DEFAULT_CONDITION_PROFILE
            ).totalDamageRaw
        }
        const expected = base(30) - base(0)
        for (const id of ALGOS) {
            const sa = result.substat[id][0]
            assert.ok(sa, id + ' 必须有结果')
            assert.ok(Math.abs(sa.substatTotalNorm - expected) < 1e-6, id + ' 的副词条总贡献应等于「移除该词条的损失」')
            assert.equal(sa.aggregated.length, 1)
            assert.equal(sa.aggregated[0].type, '攻击%')
            assert.ok(Math.abs(sa.aggregated[0].contributionNorm - expected) < 1e-6, id + ' 单条词条贡献')
        }
    })
})

describe('Buff 贡献：移除损失口径', () => {
    const entry = makeEntry()
    const config = configWith(emptyEcho())
    const bAtk = buff('b-atk', '攻击提升', [{ zoneId: 'atkPct', value: 50 }])
    const bBonus = buff('b-bonus', '增伤', [{ zoneId: 'bonusDmg', value: 30 }])
    const bindings = { [ENTRY_ID]: ['b-atk', 'b-bonus'] }
    const req = makeRequest(entry, [bAtk, bBonus], config, bindings)
    const result = runContributionAnalysis(req, ['single-loss'])
    const buffs = result.buff[0]

    it('每条 Buff 的贡献 = 单独移除它后的伤害损失，按贡献降序', () => {
        assert.equal(buffs.buffs.length, 2)
        assert.deepEqual(
            buffs.buffs.map((b) => b.id),
            ['b-atk', 'b-bonus']
        )
        assert.ok(buffs.buffs[0].contributionNorm > 0)
        assert.ok(buffs.buffs[1].contributionNorm > 0)
        assert.ok(buffs.buffs[0].contribPctNorm > 0)
    })

    it('逐条损失之和 > 移除全部的总损失（乘算叠加，不可相加）', () => {
        const sum = buffs.buffs.reduce((s, b) => s + b.contributionNorm, 0)
        assert.ok(
            sum > buffs.buffTotalNorm,
            '逐条损失之和(' + sum + ') 应大于总贡献(' + buffs.buffTotalNorm + ')，这是口径差异而非 bug'
        )
        assert.ok(buffs.buffTotalNorm > 0)
        assert.ok(Math.abs(buffs.totalDamageNorm - buffs.noBuffDamageNorm - buffs.buffTotalNorm) < 1e-6)
    })

    it('单乘区 Buff 的逐乘区贡献 = 该条总贡献', () => {
        const target = buffs.buffs.find((b) => b.id === 'b-atk')!
        assert.equal(target.zones.length, 1)
        assert.equal(target.zones[0].zoneId, 'atkPct')
        assert.ok(Math.abs(target.zones[0].contributionNorm - target.contributionNorm) < 1e-6)
    })

    it('未绑定到该角色的 Buff 不出现在结果里', () => {
        const unbound = buff('b-unbound', '没绑', [{ zoneId: 'bonusDmg', value: 100 }])
        const res = runContributionAnalysis(makeRequest(entry, [unbound], config, {}), ['single-loss'])
        assert.equal(res.buff[0].buffs.length, 0)
        assert.equal(res.buff[0].buffTotalNorm, 0)
    })

    it('作用域指向别的角色、但被转模引用借走面板的 Buff 也计入', () => {
        // 甲（0 号位）的条目上：bRef 引用「乙的当前攻击」折算进增伤区；bOwner 只作用于乙（scope=[1]）
        const team2 = [
            { character: '甲', weapon: null },
            { character: '乙', weapon: null },
            { character: '', weapon: null }
        ] as unknown as CharSlot[]
        const infos: Record<string, CharacterInfo> = {
            甲: mkInfo(1000),
            乙: mkInfo(900)
        }
        const bRef: BuffConf = {
            id: 'b-ref',
            name: '借面板',
            scope: 'all',
            zones: [
                {
                    zoneId: 'bonusDmg',
                    value: 0,
                    ref: { characterIdx: 1, zoneId: 'totalAtk', threshold: 0, pct: 1 }
                }
            ]
        }
        const bOwner = buff('b-owner', '只作用于乙', [{ zoneId: 'atkPct', value: 100 }])
        const res = runContributionAnalysis(
            {
                ...makeRequest(makeEntry({ character: '甲' }), [bRef, bOwner], config, {
                    [ENTRY_ID]: ['b-ref', 'b-owner']
                }),
                team: team2,
                charInfoMap: infos
            },
            ['single-loss']
        )
        const owner = res.buff[0].buffs.find((b) => b.id === 'b-owner')
        assert.ok(owner, '经转模引用影响本角色的 Buff 必须计入（按作用域判定会漏掉）')
        assert.ok(owner.contributionNorm > 0)
    })

    it('目标侧乘区（集谐·干涉层数）也按「移除该 Buff」计入', () => {
        // 集谐区 = 1 + 0.12% × 谐度破坏增幅 × 层数：先给 100 点谐度破坏增幅，再挂 2 层集谐
        const bTuneBreak = buff('b-tb', '谐度破坏增幅', [{ zoneId: 'tuneBreakBoost', value: 100 }])
        const bStrain = buff('b-strain', '集谐干涉', [{ zoneId: 'tuneStrainLayer', value: 2 }])
        const res = runContributionAnalysis(
            makeRequest(entry, [bTuneBreak, bStrain], config, { [ENTRY_ID]: ['b-tb', 'b-strain'] }),
            ['single-loss']
        )
        const strain = res.buff[0].buffs.find((b) => b.id === 'b-strain')
        assert.ok(strain, '目标侧 Buff 必须出现在该角色的贡献列表里')
        assert.equal(strain.zones[0].zoneId, 'tuneStrainLayer')
        // 移除 2 层：集谐区从 1.24 掉回 1，损失 = 基线 × (1 - 1/1.24)
        const expected = res.buff[0].totalDamageNorm * (1 - 1 / (1 + 0.0012 * 100 * 2))
        assert.ok(Math.abs(strain.contributionNorm - expected) < 1e-6, '损失应等于集谐区消失带来的差值')
    })
})

describe('表级 14 词分：标准方案的对照分', () => {
    const standardSlots = buildStandardSlots({
        element: charInfo.element,
        statNodes: charInfo.statNodes,
        tags: charInfo.tags
    })

    it('当前配装就是标准方案时，总分与表级14词分相同（同一公式）', () => {
        const res = runContributionAnalysis(makeRequest(makeEntry(), [], configWithEchoes(standardSlots)), [
            'single-loss'
        ])
        const sa = res.substat['single-loss'][0]
        assert.ok(sa.standardSubstatPctNorm !== null, '有角色信息时必须算出对照分')
        assert.ok(sa.standardSubstatPctNorm! > 0)
        assert.ok(
            Math.abs(sa.substatTotalPctNorm - sa.standardSubstatPctNorm!) < 1e-9,
            '当前配置 = 标准方案 时两个分数必须相等（同一公式、同一基线口径）'
        )
    })

    it('当前配装不同时，对照分只由标准方案决定（与当前配置无关）', () => {
        const runWith = (config: ConfigState) =>
            runContributionAnalysis(makeRequest(makeEntry(), [], config), ['single-loss']).substat['single-loss'][0]
        const poor = runWith(configWith(echoWithSubstats([{ type: '攻击%', value: 10, unit: '%' }])))
        const rich = runWith(configWith(echoWithSubstats([{ type: '暴击率', value: 40, unit: '%' }])))
        assert.ok(poor.standardSubstatPctNorm !== null && rich.standardSubstatPctNorm !== null)
        assert.equal(poor.standardSubstatPctNorm, rich.standardSubstatPctNorm, '对照分与当前声骸无关')
        assert.ok(
            Math.abs(poor.substatTotalPctNorm - rich.substatTotalPctNorm) > 1e-6,
            '当前配装不同时，总分本来就该不同'
        )
    })
})

describe('多段数条目：单成分也提取「技能单段」', () => {
    const entry = makeEntry({
        hits: 4,
        ratioValue: 27.36 * 4,
        ratioParts: [{ ratioNum: 27.36, baseType: '攻击' }]
    })
    const config = configWith(emptyEcho())
    const result = computeOneEntry(
        entry,
        0,
        config.characters[0].echoes,
        [],
        {},
        {},
        config,
        team,
        charInfoMap,
        weaponInfoMap,
        DEFAULT_CONDITION_PROFILE
    )
    const ctx: DamageTraceCtx = {
        buffSets: [],
        damageEntryBuffSetIds: {},
        damageEntryDamageTypes: {},
        configState: config,
        team,
        charInfoMap,
        weaponInfoMap,
        conditionProfile: DEFAULT_CONDITION_PROFILE
    }
    const seg = buildDamageSegments(result, ctx)

    it('单成分 + 4 段：因子名「技能单段」、单段倍率 = 成分倍率、权重含段数', () => {
        assert.equal(result.ratioFactors?.length, 1)
        const factor = result.ratioFactors![0]
        assert.equal(factor.label, '技能单段')
        assert.equal(factor.segmentRatio, 27.36)
        assert.ok(Math.abs(factor.weight - 27.36 * 4) < 1e-9, '权重 = 单段倍率 × 段数')
        // 界面在「因子数 > 1 或 段数 > 1」时渲染因子表，所以这里必须是 1 因子 + 4 段
        assert.equal(seg.factors.length, 1)
        assert.equal(seg.hits, 4)
        // 拆成技能单段后，不暴击 / 期望 / 暴击都必须是**单段**值，而不是 4 段合计
        assert.ok(Math.abs(seg.factors[0].damage - result.expectedPerHit / 4) < 1e-6)
        assert.ok(Math.abs(seg.factors[0].nonCrit - result.nonCritPerHit / 4) < 1e-6)
        assert.ok(Math.abs(seg.factors[0].crit - result.critPerHit / 4) < 1e-6)
        assert.ok(Math.abs(seg.factors[0].share - 1) < 1e-12)
    })
})

describe('复合倍率因子：单段伤害 × 因子段数之和 = 条目期望', () => {
    // 倍率串 "20%+30%*2"（共 80% 每段，2 段 → ratioValue 160%）+ 额外倍率 50%
    const entry = makeEntry({
        id: ENTRY_ID,
        hits: 2,
        ratioValue: 160,
        ratioParts: [
            { ratioNum: 20, baseType: '攻击' },
            { ratioNum: 30, mult: 2, baseType: '攻击' }
        ]
    })
    const config = configWith(emptyEcho())
    const bExtra = buff('b-extra', '额外倍率 buff', [{ zoneId: 'extraRatio', value: 50 }])
    const bindings = { [ENTRY_ID]: ['b-extra'] }

    const result = computeOneEntry(
        entry,
        0,
        config.characters[0].echoes,
        [bExtra],
        bindings,
        {},
        config,
        team,
        charInfoMap,
        weaponInfoMap,
        DEFAULT_CONDITION_PROFILE
    )
    const ctx: DamageTraceCtx = {
        buffSets: [bExtra],
        damageEntryBuffSetIds: bindings,
        damageEntryDamageTypes: {},
        configState: config,
        team,
        charInfoMap,
        weaponInfoMap,
        conditionProfile: DEFAULT_CONDITION_PROFILE
    }
    const seg = buildDamageSegments(result, ctx)

    it('引擎记录 3 个因子：两个技能成分 + 额外倍率', () => {
        const factors = result.ratioFactors ?? []
        assert.equal(factors.length, 3)
        assert.deepEqual(
            factors.map((f) => f.kind),
            ['skill', 'skill', 'buff']
        )
        // 权重 = 倍率% × 成分乘数 × 段数：20×1×2=40、30×2×2=120、额外 50×2=100
        assert.deepEqual(
            factors.map((f) => f.weight),
            [40, 120, 100]
        )
        // 单段倍率不含乘数与段数：47.22%*2 只记 47.22
        assert.deepEqual(
            factors.map((f) => f.segmentRatio),
            [20, 30, 50]
        )
        assert.deepEqual(
            factors.map((f) => f.label),
            ['技能成分 1', '技能成分 2', '额外倍率']
        )
        assert.deepEqual(
            factors.map((f) => f.note),
            [undefined, '×2', 'Buff 提供']
        )
        assert.equal(
            factors.reduce((s, f) => s + f.weight, 0),
            entry.ratioValue + 100
        )
    })

    it('溯源把额外倍率拆到来源 Buff 上，单段伤害 × 因子段数之和 = 条目期望', () => {
        assert.equal(seg.factors.length, 3)
        const extra = seg.factors.find((f) => f.kind === 'buff')!
        assert.equal(extra.label, '额外倍率 buff', '额外倍率应按来源 Buff 名拆分')
        // 每个因子自身的段数 = weight / segmentRatio；单段伤害乘回段数才是条目合计
        const segmentCount = (f: (typeof seg.factors)[number]) => (f.segmentRatio > 0 ? f.weight / f.segmentRatio : 0)
        const sum = seg.factors.reduce((s, f) => s + f.damage * segmentCount(f), 0)
        assert.ok(Math.abs(sum - result.expectedPerHit) < 1e-6, '单段伤害 × 因子段数之和必须等于条目期望')
        const shareSum = seg.factors.reduce((s, f) => s + f.share, 0)
        assert.ok(Math.abs(shareSum - 1) < 1e-9)
        // 20%/80% 与额外 50%：占比 40/260、120/260、100/260
        assert.ok(Math.abs(seg.factors[0].share - 40 / 260) < 1e-9)
        assert.ok(Math.abs(seg.factors[2].share - 100 / 260) < 1e-9)
        // 单段伤害与「单段倍率」同口径：weight 260 对应条目期望，因此每 1 点倍率的伤害 = 期望 / 260
        assert.ok(Math.abs(seg.factors[0].damage - (result.expectedPerHit / 260) * 20) < 1e-6)
        assert.ok(Math.abs(seg.factors[1].damage - (result.expectedPerHit / 260) * 30) < 1e-6)
        assert.ok(Math.abs(extra.damage - (result.expectedPerHit / 260) * 50) < 1e-6)
    })

    it('未命中时因子伤害全部归零（与条目归零一致）', () => {
        const missedSeg = buildDamageSegments(result, ctx, true)
        assert.ok(missedSeg.factors.every((f) => f.damage === 0))
        assert.ok(missedSeg.factors.every((f) => f.share > 0))
    })
})
