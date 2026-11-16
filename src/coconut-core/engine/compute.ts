import type {
    DamageEntry,
    BuffInstance,
    BuffZoneValue,
    BuffCondition,
    BuffRule,
    EnemyTypeKind,
    ZoneRef
} from './calculation.types'
import type { ConfigState, EchoSlotConfig } from './config.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { ResultEntry, MultiplierZone, RatioFactor } from './result.types'
import type { CharSlot } from '$lib/types/project'
import { TARGET_SIDE_ZONE_IDS, ZONE_NO_REF_IDS } from './calculation.consts'
import {
    applyZone,
    clonePanel,
    emptyPanel,
    recomputeTotals,
    type CharacterPanel,
    type TargetPanel
} from '$coconut/panel'
import { ACTION_MAP, REF_SOURCE_MAP } from '$coconut/actions'
import { evaluateFormula } from '$coconut/evaluate'
import { STAT_WRITES } from '$coconut/stats'
import {
    isEffectEntry,
    FORMULAS,
    formulaOf,
    formulaAcceptsRef,
    CRIT_ACTION_IDS,
    type CritBase,
    PANEL_BASE_DEFAULT,
    PANEL_BASE_TYPES,
    MULTIPLIERS,
    usesCoefficientFormula,
    type FormulaCtx,
    type FormulaDef
} from '$coconut/formulas'

/** @desc 条目是否走系数基类口径（双暴基准 0/100）—— 由公式注册表推导，引擎与界面共用 */
export { usesCoefficientFormula }
import { evaluateCondition } from './condition'
import { evaluateRules, resolveActiveBuffIds, ruleMet, type RuleContext, type RuleStats } from './rules'
import { getEffectMultiplier, getEffectBurstMultiplier, EFFECT_BASE_VALUE } from '$lib/consts/effect-data'
import {
    NON_DIRECT_ELEMENT,
    TYPE_BONUS_MAP,
    ELEMENT_BONUS_MAP,
    WEAPON_SUBSTAT_NAME_MAP,
    SUBSTAT_DECIMAL_TO_PCT
} from '$lib/consts/game-terms'
import { SECOND_MAIN_STAT } from '$lib/consts/stat-data'

// ── helpers ──

import { inferDamageTypes } from './utils'
import { buildEchoDescByEntry } from './skill-infer'

/**
 * @desc 解析引用转模读数：从「本条目可见面板」里取被引用角色的属性（无面板时视为 0）。
 *
 * `ZoneRef` 的语义：读到的面板值减去 `threshold` 后的部分，按 `pct`（线性）或
 * `divisor`/`multiplier`（离散取整）折算，最后按 `lower`/`upper` 截断。
 */
function resolveRefValue(ref: ZoneRef, panel: CharacterPanel, target: TargetPanel): number {
    const source = REF_SOURCE_MAP.get(ref.zoneId)
    if (!source) return 0
    const statValue = source.get(panel, target)
    const excess = statValue - ref.threshold
    let value: number
    if (ref.discrete) {
        if (excess <= 0) return 0
        const divisor = ref.divisor ?? 1
        const multiplier = ref.multiplier ?? 0
        /**
         * @desc 档位数取整前加一个极小的容差：小数档长会被浮点除算少一档
         * （实测 divisor 0.1、excess 0.3 → 2.9999999999999716 → floor 2，少给一档）。
         * 容差只用于吸收除法误差，不会把「真的差一点」的输入凑成一档。
         */
        const steps = Math.floor(excess / divisor + 1e-9)
        value = steps * multiplier
    } else {
        // 离散转模不写 pct（缺省 0）；这里兜一下，避免历史数据里 pct 缺失算出 NaN
        value = (excess * (ref.pct ?? 0)) / 100
    }
    if (ref.lower !== undefined) value = Math.max(ref.lower, value)
    if (ref.upper !== undefined) value = Math.min(ref.upper, value)
    return value
}

/** @desc 解析某个伤害条目最终生效的伤害类型集合（显式配置优先，其次按技能/声骸描述推断） */
export function resolveDamageTypes(
    entry: DamageEntry,
    damageEntryDamageTypes: Record<string, string[]>,
    charInfoMap?: Record<string, CharacterInfo>,
    echoDescByEntry?: Record<string, string>
): string[] {
    const explicit = damageEntryDamageTypes[entry.id] ?? []
    if (explicit.length > 0) return explicit
    return inferDamageTypes(
        entry,
        entry.character ? charInfoMap?.[entry.character] : undefined,
        echoDescByEntry?.[entry.id]
    )
}

/**
 * @desc 把装备/词条上的属性词条（元素加成 / 类型加成 / 面板作用）写入角色面板。
 *
 * 落点由 `registry/stats.ts` 的 `STAT_WRITES` 决定；系数口径（`critBase === 'coefficient'`）时
 * 丢弃装备双暴 —— 系数基类条目的双暴是它自己临时的一份（决议 D1）。
 */
const applyEntryStatToAccum = (
    label: string,
    value: number,
    acc: CharacterPanel,
    critBase: CritBase = 'panel'
): void => {
    const write = STAT_WRITES[label]
    if (!write) return
    if (write.kind === 'elementBonus') {
        const el = ELEMENT_BONUS_MAP[label]
        acc.elementBonus[el] = (acc.elementBonus[el] ?? 0) + value
        return
    }
    if (write.kind === 'typeBonus') {
        const t = TYPE_BONUS_MAP[label]
        acc.typeBonus[t] = (acc.typeBonus[t] ?? 0) + value
        return
    }
    if (write.kind !== 'action') return
    if (critBase === 'coefficient' && CRIT_ACTION_IDS.includes(write.action)) return
    applyZone(acc, write.action, value)
}

// ── compute base stat accum from echoes + weapon ──

function accumulateEchoes(
    echoes: EchoSlotConfig[],
    weaponSubstatValue: number,
    weaponSubstatLabel: string | undefined,
    acc: CharacterPanel,
    critBase: CritBase = 'panel'
) {
    if (weaponSubstatLabel) {
        applyEntryStatToAccum(weaponSubstatLabel, weaponSubstatValue, acc, critBase)
    }
    for (const echo of echoes) {
        if (echo.mainStat) {
            applyEntryStatToAccum(echo.mainStat.type, echo.mainStat.value, acc, critBase)
        }
        if (echo.secondMainStat) {
            if (echo.secondMainStat.type === '攻击') applyZone(acc, 'atkFlat', echo.secondMainStat.value)
            else if (echo.secondMainStat.type === '生命') applyZone(acc, 'hpFlat', echo.secondMainStat.value)
        } else {
            const secData = SECOND_MAIN_STAT[echo.cost as keyof typeof SECOND_MAIN_STAT]
            if (secData) {
                if (secData.label === '攻击') applyZone(acc, 'atkFlat', secData.value)
                else if (secData.label === '生命') applyZone(acc, 'hpFlat', secData.value)
            }
        }
        for (const sub of echo.substats) {
            applyEntryStatToAccum(sub.type, sub.value, acc, critBase)
        }
    }
}

// ── build final character stats (per-entry, includes buffs bound to this entry) ──

export interface ConditionProfile {
    chains: number[]
    refinements: number[]
}

export const DEFAULT_CONDITION_PROFILE: ConditionProfile = { chains: [0, 0, 0], refinements: [1, 1, 1] }

/**
 * @desc Buff 级**规则**求值的固定装置：面板（`zoneCompare`）与敌人类型是「本次伤害」级别的输入，
 * 由引擎按条目现算并缓存在这一个对象上（同一条目的多次判定复用同一份面板）。
 */
export interface RuleEvalDeps {
    team: CharSlot[]
    configState: ConfigState
    charInfoMap: Record<string, CharacterInfo>
    weaponInfoMap: Record<string, WeaponInfo>
    /** @desc 工程敌人类型（缺省 = 未知，敌人类型规则不构成否定） */
    enemyType?: EnemyTypeKind
}

/** @desc 单条目规则求值装置（面板懒算 + 缓存；`statsOf` 缺省表示调用方拿不到面板） */
interface EntryRuleDeps {
    enemyType?: EnemyTypeKind
    /** @desc 本条目显示名（面板里判定伤害名规则用；undefined = 无条目上下文，规则不构成否定） */
    damageName?: string
    /** @desc 读某槽位「无条件部分」面板；`excludeBuffId` = 正在判定的 Buff（其自身贡献不计入） */
    statsOf?: (charIdx: number, excludeBuffId?: string) => RuleStats | undefined
}

/** @desc 面板判定用的静态上下文：**不含** `statsOf`（面板不得自引用） */
interface PanelContext {
    chains: number[]
    refinements: number[]
    damageName?: string
    enemyType?: EnemyTypeKind
}

/** @desc 把角色面板压成规则可读的「无条件部分」数值（单位与面板显示一致） */
const ruleStatsOf = (stats: CharacterPanel): RuleStats => ({
    atk: Math.round(stats.total.atk),
    hp: Math.round(stats.total.hp),
    def: Math.round(stats.total.def),
    recharge: stats.zones.recharge,
    offTuneBuildupRate: stats.zones.offTuneBuildupRate,
    tuneBreakBoost: Math.round(stats.zones.tuneBreakBoost),
    unisonBoonLayer: stats.zones.unisonBoonLayer,
    critRate: stats.zones.critRate,
    critDmg: stats.zones.critDmg
})

/**
 * @desc 能计入「无条件部分」面板的 Buff（`zoneCompare` 读到的数值来源）。
 *
 * 判定拆成三层，关键是**哪一层不需要面板**：
 * - 作用域覆盖该角色（与生效范围同口径）；
 * - 规则里**不含 `buffActive`** —— 它要「哪些 Buff 生效」这个结论，而结论又要读面板，互相递归；
 * - 除 `zoneCompare` 外的规则（链 / 阶 / 伤害名 / 敌人类型）在该条目上成立 —— 这些规则都不读面板。
 *
 * `zoneCompare` 规则本身在此**不参与判定**：正在求值的就是它，因此「带门槛的产层源」
 * （如「每层 +1 层、至多 4 层」的 `lt 4` 自封顶）照样进面板，再由 `statsOf` 把该 Buff 自身摘掉。
 * 带属性/类型条件的乘区条目与带引用的条目仍然排除（引用要读别人的面板，可能再触发规则判定）。
 */
const panelBuffsOf = (
    charIdx: number,
    entry: DamageEntry,
    candidates: readonly BuffInstance[],
    ctx: PanelContext
): BuffInstance[] => {
    const ruleCtx: RuleContext = {
        chains: ctx.chains,
        refinements: ctx.refinements,
        activeCharIdx: charIdx,
        ...(ctx.damageName !== undefined ? { damageName: ctx.damageName } : {}),
        ...(ctx.enemyType !== undefined ? { enemyType: ctx.enemyType } : {})
    }
    const eligible = (buff: BuffInstance): boolean => {
        if (!scopeMatches(buff, charIdx, isEffectEntry(entry))) return false
        const rules = buff.rules ?? []
        if (rules.some((rule) => rule.kind === 'buffActive')) return false
        return rules.every((rule) => rule.kind === 'zoneCompare' || ruleMet(rule, ruleCtx))
    }
    return candidates
        .filter(eligible)
        .map((buff) => ({ ...buff, zones: buff.zones.filter((zone) => !zone.condition && !zone.ref) }))
}

/** @desc 由「面板可计入 Buff 列表」算出角色面板（装备 + 这些 Buff 的不带条件/引用的乘区条目） */
const panelStatsOf = (charIdx: number, plain: BuffInstance[], deps: RuleEvalDeps): CharacterPanel | undefined => {
    const slot = deps.team[charIdx]
    const charInfo = slot?.character ? deps.charInfoMap[slot.character] : undefined
    if (!slot || !charInfo) return undefined
    const stats = computeCharacterStats(
        charInfo,
        slot.weapon,
        deps.weaponInfoMap[slot.weapon ?? ''] ?? null,
        deps.configState.characters[charIdx]?.echoes ?? [],
        plain,
        undefined
    )
    for (const zone of overrideZonesOf(plain, undefined)) applyZone(stats, zone.zoneId, zone.value, 'override')
    recomputeTotals(stats)
    return stats
}

/**
 * @desc 面板里能否「减掉自己」：加算写入直接减掉即可；但**覆盖写入**会改三维合计、
 * 连乘写入（`combine: 'multiply'`）不可逆 —— 这两类退回整表重算。
 */
const subtractSafeOf = (zone: BuffZoneValue): boolean =>
    !zone.override && ACTION_MAP.get(zone.zoneId)?.combine !== 'multiply'

/** @desc 从面板里摘掉自己：拷贝后逐条减法写回，再重算三维面板 */
const panelStatsWithoutZones = (base: CharacterPanel, zones: readonly BuffZoneValue[]): RuleStats => {
    const stats = clonePanel(base)
    for (const zone of zones) applyZone(stats, zone.zoneId, -zone.value)
    recomputeTotals(stats)
    return ruleStatsOf(stats)
}

/**
 * @desc 为一条伤害条目装配规则求值装置（面板按槽位懒算并缓存）。
 *
 * 缓存分两层：**基准面板**（某槽位，含全部可计入 Buff）每槽位只算一次；带 `excludeBuffId` 的
 * 结果按「槽位 + Buff id」再缓存一层 —— 逐 Buff 摘掉自己只是拷贝后做减法，不是重算面板。
 */
const entryRuleDepsOf = (
    entry: DamageEntry,
    candidates: readonly BuffInstance[],
    deps: RuleEvalDeps | undefined,
    profile: ConditionProfile,
    matchEntry = true
): EntryRuleDeps => {
    if (!deps) return {}
    const panelCtx: PanelContext = {
        chains: profile.chains,
        refinements: profile.refinements,
        ...(matchEntry ? { damageName: entry.displayName } : {}),
        ...(deps.enemyType !== undefined ? { enemyType: deps.enemyType } : {})
    }
    const plainCache = new Map<number, BuffInstance[]>()
    const baseCache = new Map<number, CharacterPanel | undefined>()
    const statsCache = new Map<string, RuleStats | undefined>()

    /** @desc 某槽位的面板可计入 Buff 列表（按槽位缓存） */
    const plainOf = (charIdx: number): BuffInstance[] => {
        const cached = plainCache.get(charIdx)
        if (cached) return cached
        const plain = panelBuffsOf(charIdx, entry, candidates, panelCtx)
        plainCache.set(charIdx, plain)
        return plain
    }

    /** @desc 基准面板（含全部可计入 Buff） */
    const baseOf = (charIdx: number): CharacterPanel | undefined => {
        if (!baseCache.has(charIdx)) baseCache.set(charIdx, panelStatsOf(charIdx, plainOf(charIdx), deps))
        return baseCache.get(charIdx)
    }

    /**
     * @desc 摘掉某 Buff 自身后的面板数值。
     *
     * 只有「面板真的把它算进去了」才需要摘：加算条目按 `activeZonesOf` 同口径过滤后直接减法，
     * 覆盖写入（改 `totalAtk/…`）与 `specialFinal2` 连乘则退回「重算一份不含它的面板」。
     */
    const statsWithout = (charIdx: number, base: CharacterPanel, excludeBuffId: string): RuleStats => {
        const own = plainOf(charIdx).find((buff) => buff.id === excludeBuffId)
        const ownZones = own?.zones.filter((zone) => !zone.ref && zone.value !== 0) ?? []
        const ownAdds = ownZones.filter((zone) => !zone.override)
        const ownOverrides = ownZones.filter((zone) => zone.override)
        if (ownOverrides.length === 0 && ownAdds.length === 0) return ruleStatsOf(base)
        if (ownOverrides.length === 0 && ownAdds.every(subtractSafeOf)) {
            return panelStatsWithoutZones(base, ownAdds)
        }
        const rest = plainOf(charIdx).filter((buff) => buff.id !== excludeBuffId)
        const rebuilt = panelStatsOf(charIdx, rest, deps)
        return ruleStatsOf(rebuilt ?? base)
    }

    return {
        ...(deps.enemyType !== undefined ? { enemyType: deps.enemyType } : {}),
        ...(matchEntry ? { damageName: entry.displayName } : {}),
        statsOf: (charIdx: number, excludeBuffId?: string): RuleStats | undefined => {
            const key = `${charIdx}|${excludeBuffId ?? ''}`
            if (statsCache.has(key)) return statsCache.get(key)
            const base = baseOf(charIdx)
            const value = !base
                ? undefined
                : excludeBuffId
                  ? statsWithout(charIdx, base, excludeBuffId)
                  : ruleStatsOf(base)
            statsCache.set(key, value)
            return value
        }
    }
}

/** @desc 组装规则求值上下文（链阶来自生效配置，条目上下文来自 `zoneCtx`） */
const ruleContextOf = (
    profile: ConditionProfile,
    charIdx: number,
    zoneCtx: { damageName?: string },
    deps: EntryRuleDeps
): RuleContext => ({
    chains: profile.chains,
    refinements: profile.refinements,
    activeCharIdx: charIdx,
    ...(zoneCtx.damageName !== undefined ? { damageName: zoneCtx.damageName } : {}),
    ...(deps.enemyType !== undefined ? { enemyType: deps.enemyType } : {}),
    ...(deps.statsOf ? { statsOf: deps.statsOf } : {})
})

/**
 * @desc 判定某个 Buff 的规则是否全部满足（引擎与「隐藏条件不匹配」筛选共用同一口径）。
 * `deps` 缺省（拿不到面板/敌人类型）时相关规则「不构成否定」，只有 `buffActive` 仍需 `activeOf`。
 *
 * `buffId` = 被判定 Buff 自己的 id：`zoneCompare` 用它把本 Buff 的乘区从面板里摘掉
 * （「每层 +1、至多 N 层」这类自封顶写法依赖这一点）。
 */
export function buffRulesMet(
    rules: BuffRule[] | undefined,
    profile: ConditionProfile,
    charIndex: number,
    ctx: { damageName?: string } = {},
    deps: EntryRuleDeps = {},
    activeOf?: (buffId: string) => boolean,
    buffId?: string
): boolean {
    return evaluateRules(rules, {
        ...ruleContextOf(profile, charIndex, ctx, deps),
        ...(buffId !== undefined ? { currentBuffId: buffId } : {}),
        ...(activeOf ? { activeOf } : {})
    })
}

/** @desc 条目是否绑定该 Buff（scope 按作用域匹配） */
const scopeMatches = (buff: BuffInstance, charIndex: number, isEffect: boolean): boolean => {
    if (buff.scope === 'all') return true
    if (buff.scope.length === 0) return isEffect && charIndex < 0
    return buff.scope.includes(charIndex)
}

/**
 * @desc 返回某伤害条目实际生效的 Buff 集（按范围 + Buff 级规则过滤），溯源模块复用同一口径。
 * `matchEntry=false` 时忽略条目级的属性/类型条件（用于角色级聚合面板，与旧行为一致）。
 */
export function getBoundBuffSets(
    entry: DamageEntry,
    charIndex: number,
    buffSets: BuffInstance[],
    damageEntryBuffSetIds: Record<string, string[]>,
    damageEntryDamageTypes: Record<string, string[]>,
    profile: ConditionProfile = DEFAULT_CONDITION_PROFILE,
    charInfoMap?: Record<string, CharacterInfo>,
    echoDescByEntry?: Record<string, string>,
    matchEntry = true,
    rulesDeps?: RuleEvalDeps
): BuffInstance[] {
    return boundBuffs(
        entry,
        charIndex,
        buffSets,
        damageEntryBuffSetIds,
        damageEntryDamageTypes,
        profile,
        charInfoMap,
        echoDescByEntry,
        matchEntry,
        rulesDeps
    )
}

/** @desc 绑定到该条目的 Buff 候选（只按绑定关系取，不做作用域 / 条件过滤；再按每个角色槽位分别激活） */
const entryCandidateBuffs = (
    entry: DamageEntry,
    buffSets: BuffInstance[],
    damageEntryBuffSetIds: Record<string, string[]>
): BuffInstance[] => {
    const boundIds = damageEntryBuffSetIds[entry.id] ?? []
    if (boundIds.length === 0) return []
    return buffSets.filter((b) => boundIds.includes(b.id))
}

/**
 * @desc 某角色槽位在「本条目」下真正生效的 Buff：作用域匹配 + Buff 级规则（链/阶/伤害名/面板/敌人类型/依赖）。
 *
 * `buffActive` 依赖按**最小不动点**求值（`resolveActiveBuffIds`）：从一个都未生效出发反复激活，
 * 因此「A 需要 B、B 需要 A」这类脏数据会稳定落在「都不生效」上（创建期已禁止成环）。
 * 乘区条目自身的条件不在这里过滤 —— 由 activeZonesOf / refZonesOf / overrideZonesOf 逐条判定。
 *
 * `ignoreScope=true` 用于**目标侧乘区**的聚合（见 targetSideZonesOf）：层数挂在目标身上，
 * 不区分角色槽位，但仍然区分「特效专属」（空作用域只在特效条目上生效）。
 */
const activeBoundForChar = (
    candidates: readonly BuffInstance[],
    charIdx: number,
    isEffect: boolean,
    profile: ConditionProfile,
    ctx: { damageName?: string },
    deps: EntryRuleDeps,
    ignoreScope = false
): BuffInstance[] => {
    const scopeOk = (buff: BuffInstance): boolean =>
        ignoreScope ? scopeMatchesTargetSide(buff, isEffect) : scopeMatches(buff, charIdx, isEffect)
    const active = resolveActiveBuffIds(candidates, scopeOk, ruleContextOf(profile, charIdx, ctx, deps))
    return candidates.filter((buff) => active.has(buff.id))
}

/** @desc 目标侧聚合的作用域口径：只区分「特效专属 / 其余」，不区分具体角色槽位 */
const scopeMatchesTargetSide = (buff: BuffInstance, isEffect: boolean): boolean =>
    Array.isArray(buff.scope) && buff.scope.length === 0 ? isEffect : true

/** @desc 生效 Buff（引擎内部用：逐条作用写入面板） */
function boundBuffs(
    entry: DamageEntry,
    charIndex: number,
    buffSets: BuffInstance[],
    damageEntryBuffSetIds: Record<string, string[]>,
    damageEntryDamageTypes: Record<string, string[]>,
    profile: ConditionProfile,
    charInfoMap?: Record<string, CharacterInfo>,
    echoDescByEntry?: Record<string, string>,
    matchEntry = true,
    rulesDeps?: RuleEvalDeps
): BuffInstance[] {
    const candidates = entryCandidateBuffs(entry, buffSets, damageEntryBuffSetIds)
    const deps = entryRuleDepsOf(entry, candidates, rulesDeps, profile, matchEntry)
    return activeBoundForChar(
        candidates,
        charIndex,
        isEffectEntry(entry),
        profile,
        // matchEntry=false 时没有条目上下文：伤害名规则不构成否定（角色级聚合口径）
        matchEntry ? { damageName: entry.displayName } : {},
        deps
    )
}

/** @desc 编译侧入口：某条目在某角色槽位下真正生效的 Buff（作用域 + Buff 级规则 + 依赖闭包都算完） */
export function entryActiveBuffs(args: {
    entry: DamageEntry
    charIndex: number
    buffSets: readonly BuffInstance[]
    bindings: Readonly<Record<string, readonly string[]>>
    damageTypes: Readonly<Record<string, readonly string[]>>
    profile: ConditionProfile
}): BuffInstance[] {
    const bindings = Object.fromEntries(Object.entries(args.bindings).map(([key, ids]) => [key, [...ids]]))
    const damageTypes = Object.fromEntries(Object.entries(args.damageTypes).map(([key, ids]) => [key, [...ids]]))
    return boundBuffs(args.entry, args.charIndex, [...args.buffSets], bindings, damageTypes, args.profile)
}

/** @desc 编译侧入口：某角色的**词条**（声骸主词条 + cost 派生副主词条 + 副词条 + 武器副属性） */
export function entryStatsOf(args: { weaponInfo: WeaponInfo | null; echoes: readonly EchoSlotConfig[] }): {
    mainStats: { key: string; value: string }[]
    subStats: { key: string; value: string }[]
} {
    const mainStats: { key: string; value: string }[] = []
    const subStats: { key: string; value: string }[] = []

    const weaponSubstat = args.weaponInfo?.substat
    if (weaponSubstat) {
        const raw = parseFloat(weaponSubstat.value)
        const canonical = WEAPON_SUBSTAT_NAME_MAP[weaponSubstat.name] ?? weaponSubstat.name
        const value = SUBSTAT_DECIMAL_TO_PCT.has(canonical) && raw < 1 ? raw * 100 : raw
        subStats.push({ key: canonical, value: String(value) })
    }

    for (const echo of args.echoes) {
        if (echo.mainStat) mainStats.push({ key: echo.mainStat.type, value: String(echo.mainStat.value) })
        if (echo.secondMainStat) {
            mainStats.push({ key: echo.secondMainStat.type, value: String(echo.secondMainStat.value) })
        } else {
            const derived = SECOND_MAIN_STAT[echo.cost as keyof typeof SECOND_MAIN_STAT]
            if (derived) mainStats.push({ key: derived.label, value: String(derived.value) })
        }
        for (const sub of echo.substats) subStats.push({ key: sub.type, value: String(sub.value) })
    }

    return { mainStats, subStats }
}

/** @desc 计算某个角色槽位某条目可见的完整贡献（装备 + 绑定且生效的 Buff 条目）。
 *  门槛判定（作用域 + 实例级硬性条件）由调用方先完成，此处只做乘区写入（含每条目自身的乘区条件）。
 *
 *  `critBase='coefficient'` 用于**系数基类条目**（处决/响应/效应/偏谐系数直伤）：
 *  基础双暴与装备双暴都不计入（基准改 0% / 100%）—— 这类条目的双暴是它自己临时的一份，
 *  追加写入照常生效，只有引用写入被 `formulaAcceptsRef` 剔除
 *  （追加/引用对它们没有意义，见 `COEFF_OVERRIDE_ONLY_ZONE_IDS`）。 */
function computeCharacterStats(
    charInfo: CharacterInfo,
    weaponName: string | null,
    weaponInfo: WeaponInfo | null,
    echoes: EchoSlotConfig[],
    boundBuffs: BuffInstance[],
    ctx?: ZoneCtx,
    critBase: CritBase = 'panel'
): CharacterPanel {
    const panel = emptyPanel(critBase)
    panel.base.atk = Math.round(charInfo.lv90BaseStats.atk + (weaponInfo?.lv90BaseAtk ?? 0))
    panel.base.hp = Math.round(charInfo.lv90BaseStats.hp)
    panel.base.def = Math.round(charInfo.lv90BaseStats.def)
    panel.zones.tuneBreakBoost = Math.round(charInfo.lv90BaseStats.tuneBreakBoost)

    const wSubValue = weaponInfo?.substat ? parseFloat(weaponInfo.substat.value) : 0
    const wSubName = weaponInfo?.substat?.name
    let wSubCanonicalName: string | undefined
    let wSubCanonicalValue = wSubValue
    if (wSubName) {
        wSubCanonicalName = WEAPON_SUBSTAT_NAME_MAP[wSubName] ?? wSubName
        if (SUBSTAT_DECIMAL_TO_PCT.has(wSubCanonicalName) && wSubValue < 1) {
            wSubCanonicalValue = wSubValue * 100
        }
    }
    accumulateEchoes(echoes, wSubCanonicalValue, wSubCanonicalName, panel, critBase)

    // 一切皆 buff：绑定到该角色的 Buff 逐条作用于面板（作用级条件在此过滤）
    for (const z of activeZonesOf(boundBuffs, ctx)) {
        applyZone(panel, z.zoneId, z.value)
    }

    recomputeTotals(panel)
    panel.zones.tuneBreakBoost = Math.round(panel.zones.tuneBreakBoost)
    return panel
}

/** @desc 生效 Buff 的全部作用条目（引擎逐条写入面板的唯一出口） */
const collectZones = (buffs: BuffInstance[]): BuffZoneValue[] => buffs.flatMap((b) => b.zones)

/** @desc 乘区级条件求值上下文：伤害段上下文 + 链阶档位（`isEffect` / `damageName` 供 Buff 级规则使用） */
export interface ZoneCtx {
    chains: number[]
    refinements: number[]
    element?: string
    damageTypes?: string[]
    /** @desc 本条目是否效应伤害（目标侧规则的作用域口径） */
    isEffect?: boolean
    /** @desc 本条目显示名（伤害名规则用） */
    damageName?: string
}

/**
 * @desc 乘区自身条件是否满足（乘区级只允许 伤害类型/属性；Buff 级规则由 `buffRulesMet` 统一把关）。
 * 除引擎逐条写入外，**溯源**（`damage-trace` 的来源列表）也复用同一判据：条件不满足的乘区既不计入数值，
 * 也不得列为来源（否则「来源之和 = 乘区数值」这条不变式会被破坏）。
 */
export const zoneConditionMet = (zone: { condition?: BuffCondition }, ctx: ZoneCtx): boolean =>
    evaluateCondition(zone.condition, {
        ...(ctx.element !== undefined ? { element: ctx.element } : {}),
        ...(ctx.damageTypes !== undefined ? { damageTypes: ctx.damageTypes } : {})
    })

/**
 * @desc 生效 Buff 提供的直接贡献乘区（跳过引用/覆盖/零值；乘区条件不满足者逐条剔除）。
 * 同一乘区可有多条：`if (链阶硬门槛满足) { 各条目各自 add if 自身条件满足 }` —— 满足的全部相加。
 *
 * 系数基类条目的双暴是它自己临时的一份（`critBase`），因此**追加写入同样合法** ——
 * 不需要任何「系数条目上双暴不生效」的 gate（决议 D2）。
 */
const activeZonesOf = (buffs: BuffInstance[], ctx?: ZoneCtx): { zoneId: string; value: number }[] =>
    collectZones(buffs).flatMap((z) =>
        !z.ref && !z.override && z.value !== 0 && (!ctx || zoneConditionMet(z, ctx))
            ? [{ zoneId: z.zoneId as string, value: z.value }]
            : []
    )

/**
 * @desc 生效 Buff 里带引用标记的乘区（转模：稍后按面板解析；乘区条件不满足者剔除）。
 * 系数口径下双暴不接受引用写入（`formulaAcceptsRef`，决议 D24）：那种面板是条目临时的一份，
 * 把别的面板搬过来对它没有意义。
 */
const refZonesOf = (
    buffs: BuffInstance[],
    ctx?: ZoneCtx,
    critBase: CritBase = 'panel'
): {
    zoneId: string
    ref: ZoneRef
}[] =>
    collectZones(buffs).flatMap((z) =>
        z.ref &&
        !ZONE_NO_REF_IDS.has(z.zoneId) &&
        (!ctx || zoneConditionMet(z, ctx)) &&
        formulaAcceptsRef(critBase, z.zoneId)
            ? [{ zoneId: z.zoneId as string, ref: z.ref }]
            : []
    )

/**
 * @desc 目标侧乘区合计（目前只有集谐·干涉层数）：挂在目标/怪物身上，**全队共用一份**。
 *
 * 与 `activeZonesOf` 的区别只有作用域：目标侧不看 buff 指向哪个角色槽位 ——
 * 一条「作用域=角色1」的集谐 buff 也照样给全队提供层数，因此不存在「某某角色的集谐干涉层数」。
 * 其余口径完全一致：Buff 级规则按 `charIdx = -1`（无角色上下文）判定、
 * 乘区级条件按本条目属性/类型判定；覆盖条目取最后一条覆盖值（同 applyZone 的覆盖语义）。
 */
export function targetSideZonesOf(
    candidates: readonly BuffInstance[],
    profile: ConditionProfile,
    zoneCtx: ZoneCtx,
    deps: EntryRuleDeps = {}
): { zoneId: string; value: number }[] {
    const sums = new Map<string, number>()
    const overrides = new Map<string, number>()
    const active = resolveActiveBuffIds(
        candidates,
        (buff) => scopeMatchesTargetSide(buff, zoneCtx.isEffect ?? false),
        ruleContextOf(profile, -1, zoneCtx, deps)
    )
    for (const buff of candidates) {
        if (!active.has(buff.id)) continue
        for (const z of buff.zones) {
            if (!TARGET_SIDE_ZONE_IDS.has(z.zoneId) || z.ref) continue
            if (!zoneConditionMet(z, zoneCtx)) continue
            if (z.override) {
                if (z.value !== 0) overrides.set(z.zoneId, z.value)
                continue
            }
            if (z.value !== 0) sums.set(z.zoneId, (sums.get(z.zoneId) ?? 0) + z.value)
        }
    }
    const out: { zoneId: string; value: number }[] = []
    for (const [zoneId, value] of sums) out.push({ zoneId, value: overrides.get(zoneId) ?? value })
    for (const [zoneId, value] of overrides) if (!sums.has(zoneId)) out.push({ zoneId, value })
    return out
}

/**
 * @desc 构建目标面板：敌人配置初值 + Buff 对目标侧作用的写入。
 *
 * 与角色面板同构（都按条目构建）：目标侧不看 Buff 指向哪个角色槽位 —— 一条「作用域=角色1」的
 * 集谐 buff 也照样给全队提供层数，因此不存在「某某角色的集谐干涉层数」。
 */
export const buildTargetPanel = (
    candidates: readonly BuffInstance[],
    profile: ConditionProfile,
    zoneCtx: ZoneCtx,
    enemy: ConfigState['enemy'],
    deps: EntryRuleDeps = {}
): TargetPanel => {
    const panel: TargetPanel = {
        type: enemy.type,
        defense: enemy.defense,
        dmgReduction: enemy.dmgReduction,
        resistances: enemy.resistances,
        zones: {}
    }
    for (const { zoneId, value } of targetSideZonesOf(candidates, profile, zoneCtx, deps)) {
        panel.zones[zoneId] = value
    }
    return panel
}

/** @desc 取目标侧某乘区的合计值（读不到即 0） */
export const targetSideValueOf = (
    candidates: readonly BuffInstance[],
    profile: ConditionProfile,
    zoneCtx: ZoneCtx,
    zoneId: string,
    deps: EntryRuleDeps = {}
): number => targetSideZonesOf(candidates, profile, zoneCtx, deps).find((z) => z.zoneId === zoneId)?.value ?? 0

/**
 * @desc 目标侧乘区的来源 Buff（溯源用）：不做作用域过滤，其余口径与 `getBoundBuffSets` 一致。
 * 集谐层数的来源可能挂在别的角色身上，只列「本段所属角色」的 buff 会漏掉它们。
 */
export function getTargetSideSourceBuffs(
    entry: DamageEntry,
    buffSets: BuffInstance[],
    damageEntryBuffSetIds: Record<string, string[]>,
    damageEntryDamageTypes: Record<string, string[]>,
    profile: ConditionProfile = DEFAULT_CONDITION_PROFILE,
    charInfoMap?: Record<string, CharacterInfo>,
    echoDescByEntry?: Record<string, string>,
    matchEntry = true,
    rulesDeps?: RuleEvalDeps
): BuffInstance[] {
    const candidates = entryCandidateBuffs(entry, buffSets, damageEntryBuffSetIds)
    const deps = entryRuleDepsOf(entry, candidates, rulesDeps, profile, matchEntry)
    return activeBoundForChar(
        candidates,
        -1,
        isEffectEntry(entry),
        profile,
        matchEntry ? { damageName: entry.displayName } : {},
        deps,
        true
    )
}

/**
 * @desc 该 Buff 对某个伤害条目**是否还有任何贡献**（拉表用：属性/类型条件不满足的格子应判为不可勾）。
 *
 * 条件分层之后，**属性/类型条件挂在乘区条目上**（`BuffZoneValue.condition`），Buff 级规则在 `rules`。
 * 表格若只看其中一层，就会出现「条件不满足、格子却仍可勾选」的 bug。
 *
 * 口径与引擎 `activeZonesOf` / `refZonesOf` 完全一致（同一套 zoneConditionMet）：
 * 只要**存在至少一条**乘区条目「自身条件满足 且 值/引用/覆盖能生效」，就算有贡献。
 * 因此「一条不匹配 + 一条无条件」仍然算有贡献（引擎确实会把无条件那条计入），不会误判为不可用。
 *
 * 本函数只用于**界面判定**（拿不到队伍/配置面板）：`buffActive` 规则按「引用项视为存活」判定，
 * 面板 / 敌人类型 / 伤害名规则缺上下文时「不构成否定」。
 */
export const buffContributesToEntry = (
    buff: BuffInstance,
    ctx: { element?: string; damageTypes?: string[]; damageName?: string },
    profile: ConditionProfile = DEFAULT_CONDITION_PROFILE,
    charIndex = -1,
    deps: EntryRuleDeps = {}
): boolean => {
    const rulesOk = buffRulesMet(
        buff.rules,
        profile,
        charIndex,
        ctx.damageName !== undefined ? { damageName: ctx.damageName } : {},
        deps,
        () => true,
        buff.id
    )
    if (!rulesOk) return false
    const zoneCtx: ZoneCtx = {
        chains: profile.chains,
        refinements: profile.refinements,
        ...(ctx.element !== undefined ? { element: ctx.element } : {}),
        ...(ctx.damageTypes !== undefined ? { damageTypes: ctx.damageTypes } : {})
    }
    return collectZones([buff]).some((z) => {
        if (!zoneConditionMet(z, zoneCtx)) return false
        if (ZONE_NO_REF_IDS.has(z.zoneId) && z.ref) return z.value !== 0
        if (z.ref) return true
        return z.value !== 0 || !!z.override
    })
}

/**
 * @desc 拉表格子「未达门槛」判定装置：为**一条伤害条目**装配一次规则求值器，之后逐 Buff 判定其 Buff 级规则。
 *
 * 与引擎同口径：候选集 = 该条目**当前已绑定**的 Buff —— 面板（`zoneCompare` 读的「无条件部分」）
 * 与生效集合（`buffActive` 依赖）都只由它们组成，等于「这一段伤害当下」的门槛状态。
 *
 * 必须「一次装配、多次判定」：一条行有几十上百列，逐格重建面板 + 生效集合会把整表拖到不可用。
 */
export function createEntryRuleMatcher(args: {
    entry: DamageEntry
    /** @desc 该条目已绑定的 Buff（引擎同口径的候选集） */
    boundBuffs: readonly BuffInstance[]
    profile: ConditionProfile
    deps: RuleEvalDeps
}): (buff: BuffInstance) => boolean {
    const { entry, profile, deps } = args
    const charIdx = deps.team.findIndex((slot) => slot.character === entry.character)
    /** @desc 条目上下文（伤害名规则用；引擎 `zoneCtx` 同口径） */
    const entryCtx = { damageName: entry.displayName }
    const ruleDeps = entryRuleDepsOf(entry, args.boundBuffs, deps, profile)
    const ctx = ruleContextOf(profile, charIdx, entryCtx, ruleDeps)
    const active = resolveActiveBuffIds(args.boundBuffs, () => true, ctx)
    const activeOf = (buffId: string): boolean => active.has(buffId)
    return (buff) => buffRulesMet(buff.rules, profile, charIdx, entryCtx, ruleDeps, activeOf, buff.id)
}

/**
 * @desc 生效 Buff 里带覆盖标记的乘区（覆盖优先于一切：在最后直接替换该乘区合计值；乘区条件不满足者剔除）。
 * 同一乘区跨 Buff 出现多个覆盖时，按 Buff 进入计算的顺序依次写入 —— 后进入者最终生效。
 */
const overrideZonesOf = (buffs: BuffInstance[], ctx?: ZoneCtx): { zoneId: string; value: number }[] =>
    collectZones(buffs).flatMap((z) =>
        z.override && !z.ref && z.value !== 0 && (!ctx || zoneConditionMet(z, ctx))
            ? [{ zoneId: z.zoneId as string, value: z.value }]
            : []
    )

// ── 复合倍率因子（结果页下拉的「每一因子的伤害」） ──

/**
 * @desc 把条目的倍率成分转成因子（`%` 条目为「百分比×成分乘数×段数」，固定值条目为「固定值×段数」）。
 *
 * 两个数刻意分开记：
 * - `weight` 参与伤害分摊（含成分乘数与段数）；
 * - `segmentRatio` 只描述该成分自身的单段倍率（倍率串里的 `47.22%*2` → 47.22%），界面「单段倍率」列用它。
 *
 * 命名：**只有一个技能成分**（或拿不到成分信息）时叫「技能单段」—— 这是「提取单段」的语义，
 * 与倍率链里的「段数」chunk 对应；多个成分时才用「技能成分 N」区分。
 */
const skillRatioFactors = (entry: DamageEntry): RatioFactor[] => {
    const hits = entry.hits || 1
    const parts = entry.ratioParts ?? []
    if (parts.length === 0) {
        return [{ label: '技能单段', weight: entry.ratioValue, segmentRatio: entry.ratioValue / hits, kind: 'skill' }]
    }
    const single = parts.length === 1
    return parts.map((part, i) => {
        const flat = part.flatValue !== undefined
        return {
            label: flat ? `固定值成分 ${i + 1}` : single ? '技能单段' : `技能成分 ${i + 1}`,
            ...(part.mult && part.mult > 1 ? { note: `×${part.mult}` } : {}),
            weight: flat ? part.flatValue! * hits : part.ratioNum * (part.mult ?? 1) * hits,
            segmentRatio: flat ? part.flatValue! : part.ratioNum,
            kind: 'skill' as const
        }
    })
}

/** @desc 追加「额外倍率」因子（buff 提供；权重 = 额外倍率% × 段数，与技能倍率同一量纲） */
const withExtraRatioFactor = (factors: RatioFactor[], extraRatio: number, hits: number): RatioFactor[] =>
    extraRatio === 0
        ? factors
        : [
              ...factors,
              {
                  label: '额外倍率',
                  weight: extraRatio * hits,
                  segmentRatio: extraRatio,
                  kind: 'buff',
                  note: 'Buff 提供'
              }
          ]

// ── compute a single ResultEntry ──

// ────────────────────────────── 公式求值（直伤 / 处决 / 效应 / 固定值 共用） ──────────────────────────────

/** @desc 偏谐系数（处决 / 偏谐系数直伤）的基值系数：按敌人类型取表 */
const TUNE_COEFF_MAP: Record<string, number> = {
    BOSS: 10027,
    精英怪: 2149,
    小怪: 716.2
}

/** @desc 条目实际生效的伤害属性：效应条目用效应自身的属性映射，其余用条目属性 */
const elementOfFormula = (def: FormulaDef, entry: DamageEntry): string =>
    def.base.kind === 'effectTable'
        ? ((NON_DIRECT_ELEMENT as Record<string, string>)[entry.hitName] ?? '')
        : entry.damageElement

/** @desc 组装公式求值上下文（增伤区的元素 / 类型加成在此按条目一次性求和） */
const formulaCtxOf = (
    panel: CharacterPanel,
    entry: DamageEntry,
    damageTypes: string[],
    element: string,
    target: TargetPanel
): FormulaCtx => {
    let typeBonusSum = 0
    for (const dt of damageTypes) typeBonusSum += panel.typeBonus[dt.replace('伤害', '')] ?? 0
    return {
        panel,
        element,
        damageTypes,
        elementBonus: panel.elementBonus[element] ?? 0,
        typeBonus: typeBonusSum,
        target
    }
}

/** @desc 基值解析结果：基值、有效倍率、以及各类公式需要的附加量 */
interface ResolvedBase {
    /** @desc `ResultEntry.baseUnit` 的取值 */
    baseUnit: string
    /** @desc `ResultEntry.baseAtk` 的取值（面板攻击 / 偏谐系数 / 效应基础值） */
    baseAtkField: number
    /** @desc 有效倍率（含额外倍率与段数） */
    effectiveRatio: number
    /** @desc `ResultEntry.ratioNum` 的取值（直伤为原始倍率，其余为有效倍率） */
    reportedRatio: number
    baseValue: number
    /** @desc 效应条目的层数倍率成分（用于 `ratioFactors`） */
    effect?: { name: string; layers: number; effectMult: number; burstLayers: number; burstMult: number }
}

/** @desc 解析基值（`base` 配方是数据，这里只是四个分支的执行体） */
const resolveBase = (def: FormulaDef, entry: DamageEntry, panel: CharacterPanel, ctx: FormulaCtx): ResolvedBase => {
    const hits = entry.hits || 1
    const extraRatio = panel.zones.extraRatio ?? 0

    if (def.base.kind === 'fixed') {
        return {
            baseUnit: '固定',
            baseAtkField: 0,
            effectiveRatio: 1,
            reportedRatio: 1,
            baseValue: entry.ratioValue
        }
    }

    if (def.base.kind === 'effectTable') {
        const layers = Math.round(entry.ratioValue)
        const burstLayers = entry.burstLayers ?? 0
        const effectMult = getEffectMultiplier(entry.hitName, layers)
        const burstMult = getEffectBurstMultiplier(entry.hitName, burstLayers)
        const effectiveRatio = (effectMult + burstMult) * hits + (extraRatio / 100) * hits
        return {
            baseUnit: '效应系数',
            baseAtkField: EFFECT_BASE_VALUE,
            effectiveRatio,
            reportedRatio: effectiveRatio,
            baseValue: Math.round(EFFECT_BASE_VALUE * effectiveRatio),
            effect: { name: entry.hitName, layers, effectMult, burstLayers, burstMult }
        }
    }

    const ratio = entry.ratioUnit === '%' ? entry.ratioValue / 100 : entry.ratioValue
    const effectiveRatio = ratio + (extraRatio / 100) * hits

    if (def.base.kind === 'enemyCoeff') {
        const coeff = TUNE_COEFF_MAP[ctx.target.type] ?? 716.2
        return {
            baseUnit: '偏谐系数',
            baseAtkField: coeff,
            effectiveRatio,
            reportedRatio: effectiveRatio,
            baseValue: coeff * effectiveRatio
        }
    }

    // panelStat：基值类型决定取三维里的哪一项（映射见 `registry/formulas.ts` 的 `PANEL_BASE_TYPES`）
    const mapped = PANEL_BASE_TYPES[entry.damageBaseType] ?? PANEL_BASE_TYPES[PANEL_BASE_DEFAULT]
    return {
        baseUnit: mapped.unit,
        baseAtkField: panel.base.atk,
        effectiveRatio,
        reportedRatio: ratio,
        baseValue: panel.total[mapped.dim] * effectiveRatio
    }
}

/**
 * @desc 逐条乘子求值：**委托给内核的唯一实现**（`evaluateFormula`），这里只把结果转成引擎侧的
 * 输出形状（`values` 供后续按乘子名取值）。工具箱不再自己算乘子。
 */
const runChain = (
    def: FormulaDef,
    ctx: FormulaCtx
): { values: Map<string, number>; parts: MultiplierZone[]; product: number; productNoCrit: number } => {
    const evaluation = evaluateFormula({
        formula: def.id,
        baseValue: 0,
        element: ctx.element,
        panel: ctx.panel,
        target: ctx.target,
        elementBonus: ctx.elementBonus,
        typeBonus: ctx.typeBonus
    })
    const values = new Map(evaluation.multipliers.map((zone) => [zone.id, zone.value] as const))
    return {
        values,
        parts: evaluation.multipliers,
        product: evaluation.product,
        productNoCrit: evaluation.productNoCrit
    }
}

/** @desc 效应条目的倍率因子（层数倍率 + 爆发倍率，两者相加构成总倍率） */
const effectRatioFactors = (effect: NonNullable<ResolvedBase['effect']>, hits: number): RatioFactor[] => {
    const factors: RatioFactor[] = [
        {
            label: `${effect.name} ${effect.layers} 层`,
            weight: effect.effectMult * hits * 100,
            segmentRatio: effect.effectMult * 100,
            kind: 'effect'
        }
    ]
    if (effect.burstMult > 0) {
        factors.push({
            label: `${effect.name}爆发 ${effect.burstLayers} 层`,
            weight: effect.burstMult * hits * 100,
            segmentRatio: effect.burstMult * 100,
            kind: 'effect'
        })
    }
    return factors
}

/**
 * @desc 单条目结算（直伤 / 处决 / 偏谐响应 / 效应 / 固定值共用）。
 *
 * 结构：`公式（基值配方 + 有序乘子链）` → `基值 × ∏乘子`。四条公式的差异全部在注册表里，
 * 这里只剩「基值怎么解析」与「`ResultEntry` 字段怎么物化」两件事。
 */
const computeFormulaEntry = (
    entry: DamageEntry,
    panel: CharacterPanel,
    target: TargetPanel,
    damageTypes: string[]
): ResultEntry => {
    const def = FORMULAS[formulaOf(entry)]
    const element = elementOfFormula(def, entry)
    const ctx = formulaCtxOf(panel, entry, damageTypes, element, target)
    const hits = entry.hits || 1
    const z = (id: string): number => panel.zones[id] ?? 0
    const { values, parts, product, productNoCrit } = runChain(def, ctx)
    const base = resolveBase(def, entry, panel, ctx)

    // ── 固定值条目：旁路全部乘子 ──
    if (def.base.kind === 'fixed') {
        const r = makeStubEntry(entry)
        r.ratioNum = 1
        r.baseValue = Math.round(base.baseValue)
        r.baseUnit = '固定'
        r.expectedPerHit = Math.round(base.baseValue)
        r.rawPerHit = Math.round(base.baseValue)
        r.totalDamage = Math.round(base.baseValue)
        r.totalMultiplier = 1
        r.damageTypes = damageTypes
        r.ratioFactors = skillRatioFactors(entry)
        return r
    }

    const critDmgDecimal = z('critDmg') / 100
    const canCrit = def.canCrit(panel, ctx)
    const fromPanel = def.base.kind === 'panelStat'

    const nonCritRaw = base.baseValue * productNoCrit
    const expectedRaw = base.baseValue * product
    const nonCritPerHit = Math.round(nonCritRaw)
    const critPerHit = Math.round(nonCritRaw * critDmgDecimal)
    const expectedPerHit = Math.round(expectedRaw)

    const unisonZone = values.get(MULTIPLIERS.unison.id)
    const tuneStrainZone = values.get(MULTIPLIERS.tuneStrain.id)
    const tuneBreakZone = values.get(MULTIPLIERS.tuneBreak.id)
    const customMult = values.get(MULTIPLIERS.special.id) ?? 1

    const ratioFactors =
        base.effect !== undefined
            ? withExtraRatioFactor(effectRatioFactors(base.effect, hits), z('extraRatio'), hits)
            : withExtraRatioFactor(skillRatioFactors(entry), z('extraRatio'), hits)

    return {
        id: entry.id,
        character: entry.character ?? '',
        hitName: entry.hitName,
        skillType: entry.skillType ?? '',
        displayName: entry.displayName,
        element,
        formula: def.id,
        panel: { base: { ...panel.base }, total: { ...panel.total }, zones: { ...panel.zones } },
        ratioNum: base.reportedRatio,
        hits: entry.hits,
        sourceTimelineBlockId: entry.sourceTimelineBlockId,
        baseValue: Math.round(base.baseValue),
        baseUnit: base.baseUnit,
        totalMultiplier: base.effectiveRatio * product,
        baseAtk: base.baseAtkField,
        totalAtk: fromPanel ? panel.total.atk : 0,
        atkPctSum: fromPanel ? z('atkPct') : 0,
        atkFlatSum: fromPanel ? z('atkFlat') : 0,
        baseHp: fromPanel ? panel.base.hp : 0,
        totalHp: fromPanel ? panel.total.hp : 0,
        hpPctSum: fromPanel ? z('hpPct') : 0,
        hpFlatSum: fromPanel ? z('hpFlat') : 0,
        baseDef: fromPanel ? panel.base.def : 0,
        totalDef: fromPanel ? panel.total.def : 0,
        defPctSum: fromPanel ? z('defPct') : 0,
        defFlatSum: fromPanel ? z('defFlat') : 0,
        totalTuneBreakBoost: z('tuneBreakBoost'),
        // 增伤区只属于面板基类（系数基类条目不吃增伤，其词条加成不得出现在结果里）
        dmgBonus: fromPanel ? (z('bonusDmg') + ctx.elementBonus + ctx.typeBonus) / 100 : 0,
        deepen: values.has(MULTIPLIERS.deepen.id) ? z('deepenDmg') / 100 : 0,
        critRate: Math.min(z('critRate'), 100) / 100,
        critDmg: critDmgDecimal,
        defMulti: values.get(MULTIPLIERS.defense.id) ?? 0,
        resMulti: values.get(MULTIPLIERS.resist.id) ?? 0,
        dmgRedMulti: values.get(MULTIPLIERS.dmgRed.id) ?? 0,
        finalDmg: z('finalDmg') / 100,
        finalTuneStrainMulti:
            tuneStrainZone !== undefined && (target.zones.tuneStrainLayer ?? 0) > 0 ? tuneStrainZone - 1 : 0,
        finalTuneBreakZone: tuneBreakZone !== undefined ? tuneBreakZone - 1 : 0,
        finalUnisonMulti: unisonZone !== undefined && z('unisonBoonLayer') > 0 ? unisonZone - 1 : 0,
        customMult,
        extraRatio: z('extraRatio'),
        vulnerability: values.has(MULTIPLIERS.vuln.id) ? z('dmgTakenInc') / 100 : 0,
        rawPerHit: nonCritPerHit,
        expectedPerHit,
        totalDamage: expectedPerHit,
        totalDamageRaw: expectedRaw,
        // 不可暴击时「暴击 / 不暴击」两列保持与期望同值，避免下游旧勾选把该段算成 0
        nonCritPerHit: canCrit ? nonCritPerHit : expectedPerHit,
        critPerHit: canCrit ? critPerHit : expectedPerHit,
        canCrit,
        multiplierZones: parts,
        damageTypes: def.reportsDamageTypes ? damageTypes : [],
        ...(fromPanel ? { elBonus: ctx.elementBonus, typeBonus: ctx.typeBonus } : {}),
        ratioFactors
    }
}

function makeStubEntry(entry: DamageEntry): ResultEntry {
    return {
        id: entry.id,
        character: entry.character ?? '',
        hitName: entry.hitName,
        skillType: entry.skillType ?? '',
        displayName: entry.displayName,
        element: entry.damageElement,
        formula: formulaOf(entry),
        panel: { base: { atk: 0, hp: 0, def: 0 }, total: { atk: 0, hp: 0, def: 0 }, zones: {} },
        ratioNum: entry.ratioUnit === '%' ? entry.ratioValue / 100 : entry.ratioValue,
        hits: entry.hits,
        sourceTimelineBlockId: entry.sourceTimelineBlockId,
        baseValue: 0,
        baseUnit: '固定',
        totalMultiplier: 0,
        baseAtk: 0,
        totalAtk: 0,
        atkPctSum: 0,
        atkFlatSum: 0,
        baseHp: 0,
        totalHp: 0,
        hpPctSum: 0,
        hpFlatSum: 0,
        baseDef: 0,
        totalDef: 0,
        defPctSum: 0,
        defFlatSum: 0,
        totalTuneBreakBoost: 0,
        dmgBonus: 0,
        deepen: 0,
        critRate: 0,
        critDmg: 0,
        defMulti: 0,
        resMulti: 0,
        dmgRedMulti: 0,
        finalDmg: 0,
        finalTuneStrainMulti: 0,
        finalTuneBreakZone: 0,
        finalUnisonMulti: 0,
        customMult: 1,
        extraRatio: 0,
        vulnerability: 0,
        rawPerHit: 0,
        expectedPerHit: 0,
        totalDamage: 0,
        totalDamageRaw: 0,
        nonCritPerHit: 0,
        critPerHit: 0,
        canCrit: false,
        multiplierZones: [],
        damageTypes: [],
        ratioFactors: []
    }
}

// ── 引用转模：按「本条目可见面板」解析（写入口径统一走 applyZone）──

/**
 * @desc 按「本条目可见面板」解析 ref（转模）。
 *
 * 口径：**伤害是当下的，buff 也是当下的** —— 被引用角色的面板只由**绑定到本条目**的 Buff 组成
 * （作用域指向被引用角色的 Buff 被勾到本条目上，就参与该角色在这一段的面板；未勾选的其它条目绑定不参与）。
 * 本角色槽位直接用本条目面板 `partialStats`；其它角色槽位按需现算（`panelOf` 内部带缓存）。
 *
 * 系数口径下双暴的引用写入被 `refZonesOf` 剔除（`formulaAcceptsRef`）。
 */
function resolveRefsForEntry(
    stats: CharacterPanel,
    panelOf: (charIdx: number) => CharacterPanel,
    target: TargetPanel,
    boundBuffs: BuffInstance[],
    ctx?: ZoneCtx,
    critBase: CritBase = 'panel'
): void {
    for (const { zoneId, ref } of refZonesOf(boundBuffs, ctx, critBase)) {
        const resolved = resolveRefValue(ref, panelOf(ref.characterIdx), target)
        if (resolved === 0) continue
        applyZone(stats, zoneId, resolved)
        recomputeTotals(stats)
    }
}

/**
 * @desc 构建「本条目可见」的某角色槽位面板：装备/词条 + 绑定到本条目的、作用域指向该角色的 Buff。
 * 与角色槽位级面板（把该角色全部条目上的绑定取并集）的区别：这里严格只看这一段伤害勾了什么。
 *
 * 被引用角色的面板恒按**角色口径**构建（含双暴）：系数基类条目的双暴是它自己临时的一份，
 * 不接受把别的面板搬过来（`formulaAcceptsRef`）。
 */
function buildEntryPanel(
    refIdx: number,
    ownStats: CharacterPanel,
    charIndex: number,
    entry: DamageEntry,
    candidates: BuffInstance[],
    profile: ConditionProfile,
    ctx: ZoneCtx,
    team: CharSlot[],
    configState: ConfigState,
    charInfoMap: Record<string, CharacterInfo>,
    weaponInfoMap: Record<string, WeaponInfo>,
    deps: EntryRuleDeps = {}
): CharacterPanel {
    if (refIdx === charIndex) return ownStats
    const slot = team[refIdx]
    if (!slot?.character || !charInfoMap[slot.character]) return emptyPanel('panel')
    const bound = activeBoundForChar(candidates, refIdx, isEffectEntry(entry), profile, ctx, deps)
    const panel = computeCharacterStats(
        charInfoMap[slot.character],
        slot.weapon,
        weaponInfoMap[slot.weapon ?? ''] ?? null,
        configState.characters[refIdx]?.echoes ?? [],
        bound,
        ctx
    )
    for (const z of overrideZonesOf(bound, ctx)) applyZone(panel, z.zoneId, z.value, 'override')
    recomputeTotals(panel)
    return panel
}

// ── main entry point ──

export function computeAll(
    damageEntries: DamageEntry[],
    buffSets: BuffInstance[],
    damageEntryBuffSetIds: Record<string, string[]>,
    damageEntryDamageTypes: Record<string, string[]>,
    configState: ConfigState,
    team: CharSlot[],
    charInfoMap: Record<string, CharacterInfo>,
    weaponInfoMap: Record<string, WeaponInfo>,
    conditionProfile: ConditionProfile = DEFAULT_CONDITION_PROFILE,
    /** @desc 声骸技能文案索引（伤害类型推导规则2）；缺省 = 规则2 不参与 */
    echoSkillText: Record<string, string> = {}
): ResultEntry[] {
    const enemy = configState.enemy
    /** @desc Buff 级规则的固定装置（敌人类型来自工程配置；面板按条目现算） */
    const ruleDeps: RuleEvalDeps = {
        team,
        configState,
        charInfoMap,
        weaponInfoMap,
        ...(enemy?.type ? { enemyType: enemy.type } : {})
    }

    // 逐条目计算：条目面板 = 装备 + 绑定到本条目的 Buff；被引用角色的面板同样只看本条目勾选的 Buff
    /** @desc 声骸技能文案索引（伤害类型规则2：声骸技能条目的「视为/为 XX 伤害」） */
    const echoDescByEntry = buildEchoDescByEntry(damageEntries, team, echoSkillText)
    return damageEntries.map((entry) => {
        const charName = entry.character
        const charIndex = team.findIndex((s) => s.character === charName)
        const weaponName = charIndex >= 0 ? (team[charIndex]?.weapon ?? null) : null
        const weaponInfo = weaponInfoMap[weaponName ?? ''] ?? null
        const echoes = charIndex >= 0 ? (configState.characters[charIndex]?.echoes ?? []) : []
        const damageTypes = resolveDamageTypes(entry, damageEntryDamageTypes, charInfoMap, echoDescByEntry)
        /** @desc 乘区级条件上下文（伤害段属性/类型 + 链阶档位 + Buff 级规则所需的条目上下文） */
        const zoneCtx: ZoneCtx = {
            chains: conditionProfile.chains,
            refinements: conditionProfile.refinements,
            element: entry.damageElement,
            damageTypes,
            isEffect: isEffectEntry(entry),
            damageName: entry.displayName
        }
        const candidates = entryCandidateBuffs(entry, buffSets, damageEntryBuffSetIds)
        const critBase: CritBase = FORMULAS[formulaOf(entry)].critBase
        const entryRuleDeps = entryRuleDepsOf(entry, candidates, ruleDeps, conditionProfile)
        const entryBound = activeBoundForChar(
            candidates,
            charIndex,
            isEffectEntry(entry),
            conditionProfile,
            zoneCtx,
            entryRuleDeps
        )
        const charInfo = charName ? charInfoMap[charName] : undefined
        /** @desc 系数基类条目（处决/响应/效应/偏谐系数直伤）：不吃角色面板双暴（基准 0% / 100%），双暴只有覆盖生效 */

        // Compute partial stats (echo+weapon + non-ref buffs only)
        let partialStats: CharacterPanel
        if (charInfo) {
            partialStats = computeCharacterStats(
                charInfo,
                weaponName,
                weaponInfo,
                echoes,
                entryBound,
                zoneCtx,
                critBase
            )
        } else {
            partialStats = emptyPanel(critBase)
            for (const z of activeZonesOf(entryBound, zoneCtx)) {
                applyZone(partialStats, z.zoneId, z.value)
            }
            recomputeTotals(partialStats)
        }

        // 被引用角色面板：按需现算（同一槽位只算一次）
        const panelCache = new Map<number, CharacterPanel>()
        const panelOf = (refIdx: number): CharacterPanel => {
            // 出伤者（`characterIdx = -1`）= 本条目所属角色；其余按槽位
            const idx = refIdx < 0 ? charIndex : refIdx
            if (idx === charIndex) return partialStats
            const cached = panelCache.get(idx)
            if (cached) return cached
            const built = buildEntryPanel(
                idx,
                partialStats,
                charIndex,
                entry,
                candidates,
                conditionProfile,
                zoneCtx,
                team,
                configState,
                charInfoMap,
                weaponInfoMap,
                entryRuleDeps
            )
            panelCache.set(idx, built)
            return built
        }

        // Resolve ref zones and apply to stats
        const stats = clonePanel(partialStats)
        const targetPanel = buildTargetPanel(candidates, conditionProfile, zoneCtx, enemy, entryRuleDeps)
        resolveRefsForEntry(stats, panelOf, targetPanel, entryBound, zoneCtx, critBase)

        // Apply override zones (set value directly, takes precedence over everything)
        for (const z of overrideZonesOf(entryBound, zoneCtx)) {
            applyZone(stats, z.zoneId, z.value, 'override')
        }

        // 系数基类条目（效应）不吃面板，无角色也能算；其余条目缺角色时给占位结果
        if (!isEffectEntry(entry) && (!charName || !charInfo || charIndex < 0)) return makeStubEntry(entry)
        return computeFormulaEntry(
            entry,
            stats,
            buildTargetPanel(candidates, conditionProfile, zoneCtx, enemy, entryRuleDeps),
            damageTypes
        )
    })
}

/** @desc 单条目重算：面板与引用同样只看「这一段伤害勾选的 Buff」（与 computeAll 同口径） */
export function computeOneEntry(
    entry: DamageEntry,
    charIndex: number,
    echoes: EchoSlotConfig[],
    buffSets: BuffInstance[],
    damageEntryBuffSetIds: Record<string, string[]>,
    damageEntryDamageTypes: Record<string, string[]>,
    configState: ConfigState,
    team: CharSlot[],
    charInfoMap: Record<string, CharacterInfo>,
    weaponInfoMap: Record<string, WeaponInfo>,
    conditionProfile: ConditionProfile = DEFAULT_CONDITION_PROFILE,
    echoSkillText: Record<string, string> = {}
): ResultEntry {
    const enemy = configState.enemy
    const charName = entry.character
    const weaponName = charIndex >= 0 ? (team[charIndex]?.weapon ?? null) : null
    const wInfo = weaponInfoMap[weaponName ?? ''] ?? null
    const charInfo = charName ? charInfoMap[charName] : undefined
    /** @desc 声骸技能文案索引（伤害类型规则2） */
    const echoDescByEntry = buildEchoDescByEntry([entry], team, echoSkillText)

    // 解析条目伤害类型（显式优先，否则自动推导；效应条目推导为「效应伤害」）
    const damageTypes = resolveDamageTypes(entry, damageEntryDamageTypes, charInfoMap, echoDescByEntry)
    /** @desc 乘区级条件上下文（含 Buff 级规则所需的条目上下文） */
    const zoneCtx: ZoneCtx = {
        chains: conditionProfile.chains,
        refinements: conditionProfile.refinements,
        element: entry.damageElement,
        damageTypes,
        isEffect: isEffectEntry(entry),
        damageName: entry.displayName
    }
    const candidates = entryCandidateBuffs(entry, buffSets, damageEntryBuffSetIds)
    /** @desc 系数基类条目（处决/响应/效应/偏谐系数直伤）：不吃角色面板双暴（基准 0% / 100%），双暴只有覆盖生效 */
    const critBase: CritBase = FORMULAS[formulaOf(entry)].critBase
    const entryRuleDeps = entryRuleDepsOf(
        entry,
        candidates,
        {
            team,
            configState,
            charInfoMap,
            weaponInfoMap,
            ...(enemy?.type ? { enemyType: enemy.type } : {})
        },
        conditionProfile
    )
    const bound = activeBoundForChar(
        candidates,
        charIndex,
        isEffectEntry(entry),
        conditionProfile,
        zoneCtx,
        entryRuleDeps
    )

    // partial stats (echo+weapon + non-ref buffs)
    const partialStats = charInfo
        ? computeCharacterStats(charInfo, weaponName, wInfo, echoes, bound, zoneCtx, critBase)
        : emptyPanel(critBase)

    // 被引用角色面板：按需现算（同一槽位只算一次）
    const panelCache = new Map<number, CharacterPanel>()
    const panelOf = (refIdx: number): CharacterPanel => {
        // 出伤者（`characterIdx = -1`）= 本条目所属角色；其余按槽位
        const idx = refIdx < 0 ? charIndex : refIdx
        if (idx === charIndex) return partialStats
        const cached = panelCache.get(idx)
        if (cached) return cached
        const built = buildEntryPanel(
            idx,
            partialStats,
            charIndex,
            entry,
            candidates,
            conditionProfile,
            zoneCtx,
            team,
            configState,
            charInfoMap,
            weaponInfoMap,
            entryRuleDeps
        )
        panelCache.set(idx, built)
        return built
    }

    // resolve ref zones
    const stats = clonePanel(partialStats)
    const targetPanel = buildTargetPanel(candidates, conditionProfile, zoneCtx, enemy, entryRuleDeps)
    resolveRefsForEntry(stats, panelOf, targetPanel, bound, zoneCtx, critBase)
    for (const z of overrideZonesOf(bound, zoneCtx)) {
        applyZone(stats, z.zoneId, z.value, 'override')
    }

    // 系数基类条目（效应）不吃面板，无角色也能算；其余条目缺角色时给占位结果
    if (!isEffectEntry(entry) && (!charName || !charInfo || charIndex < 0)) return makeStubEntry(entry)
    return computeFormulaEntry(
        entry,
        stats,
        buildTargetPanel(candidates, conditionProfile, zoneCtx, enemy, entryRuleDeps),
        damageTypes
    )
}

/** @desc 引用（转模）解析所需的入口上下文：与 `computeAll` 的入参同源（溯源的 `DamageTraceCtx` 结构上等价） */
export interface RefResolveContext {
    buffSets: BuffInstance[]
    damageEntryBuffSetIds: Record<string, string[]>
    damageEntryDamageTypes: Record<string, string[]>
    configState: ConfigState
    team: CharSlot[]
    charInfoMap: Record<string, CharacterInfo>
    weaponInfoMap: Record<string, WeaponInfo>
    conditionProfile: ConditionProfile
    /** @desc 声骸技能文案索引（伤害类型推导规则2）；缺省 = 规则2 不参与 */
    echoSkillText?: Record<string, string>
}

/**
 * @desc 某条目上「引用（转模）乘区」的**实际数值**：键为 `${buffId}#${zoneIndex}`（`BuffInstance.zones` 下标）。
 *
 * 溯源只展示**结果**，不展示转模过程（不做「攻击白值 超出2000 每100→5 ≤30」这类规则文案），
 * 但结果必须与引擎逐条目结算写进乘区的数值完全相同 —— 因此这里刻意复用引擎同一条链路
 * （`entryBound` → 本条目可见面板 → `resolveRefValue`），而不是在溯源里另算一遍公式。
 */
export const resolveRefZoneValues = (entry: DamageEntry, ctx: RefResolveContext): Map<string, number> => {
    const out = new Map<string, number>()
    const charName = entry.character
    const charIndex = ctx.team.findIndex((s) => s.character === charName)
    const weaponName = charIndex >= 0 ? (ctx.team[charIndex]?.weapon ?? null) : null
    const weaponInfo = ctx.weaponInfoMap[weaponName ?? ''] ?? null
    const echoes = charIndex >= 0 ? (ctx.configState.characters[charIndex]?.echoes ?? []) : []
    const echoDescByEntry = buildEchoDescByEntry([entry], ctx.team, ctx.echoSkillText ?? {})
    const damageTypes = resolveDamageTypes(entry, ctx.damageEntryDamageTypes, ctx.charInfoMap, echoDescByEntry)
    const zoneCtx: ZoneCtx = {
        chains: ctx.conditionProfile.chains,
        refinements: ctx.conditionProfile.refinements,
        element: entry.damageElement,
        damageTypes,
        isEffect: isEffectEntry(entry),
        damageName: entry.displayName
    }
    const candidates = entryCandidateBuffs(entry, ctx.buffSets, ctx.damageEntryBuffSetIds)
    const critBase: CritBase = FORMULAS[formulaOf(entry)].critBase
    const ruleDeps = entryRuleDepsOf(entry, candidates, ctx, ctx.conditionProfile)
    const entryBound = activeBoundForChar(
        candidates,
        charIndex,
        isEffectEntry(entry),
        ctx.conditionProfile,
        zoneCtx,
        ruleDeps
    )
    const charInfo = charName ? ctx.charInfoMap[charName] : undefined

    let partialStats: CharacterPanel
    if (charInfo) {
        partialStats = computeCharacterStats(charInfo, weaponName, weaponInfo, echoes, entryBound, zoneCtx, critBase)
    } else {
        partialStats = emptyPanel(critBase)
        for (const z of activeZonesOf(entryBound, zoneCtx)) {
            applyZone(partialStats, z.zoneId, z.value)
        }
        recomputeTotals(partialStats)
    }

    const targetPanel = buildTargetPanel(candidates, ctx.conditionProfile, zoneCtx, ctx.configState.enemy, ruleDeps)

    // 被引用角色面板：与 computeAll 同一套「按需现算 + 缓存」；引用一律读**回写前**的面板
    const panelCache = new Map<number, CharacterPanel>()
    const panelOf = (refIdx: number): CharacterPanel => {
        // 出伤者（`characterIdx = -1`）= 本条目所属角色；其余按槽位
        const idx = refIdx < 0 ? charIndex : refIdx
        if (idx === charIndex) return partialStats
        const cached = panelCache.get(idx)
        if (cached) return cached
        const built = buildEntryPanel(
            idx,
            partialStats,
            charIndex,
            entry,
            candidates,
            ctx.conditionProfile,
            zoneCtx,
            ctx.team,
            ctx.configState,
            ctx.charInfoMap,
            ctx.weaponInfoMap
        )
        panelCache.set(idx, built)
        return built
    }

    for (const bs of entryBound) {
        bs.zones.forEach((z, zi) => {
            if (!z.ref || ZONE_NO_REF_IDS.has(z.zoneId) || !zoneConditionMet(z, zoneCtx)) return
            // 系数基类条目上双暴引用不生效（双暴只有「覆盖」生效），连解算都不做，溯源才不会列出幻影来源
            if (!formulaAcceptsRef(critBase, z.zoneId)) return
            out.set(`${bs.id}#${zi}`, resolveRefValue(z.ref, panelOf(z.ref.characterIdx), targetPanel))
        })
    }
    return out
}

export function cloneEchoesWithoutAllSubstats(echoes: EchoSlotConfig[]): EchoSlotConfig[] {
    return echoes.map((echo) => ({
        ...echo,
        substats: []
    }))
}

export function cloneEchoesWithoutSubstat(
    echoes: EchoSlotConfig[],
    echoIdx: number,
    substatIdx: number
): EchoSlotConfig[] {
    return echoes.map((echo, ei) => {
        if (ei !== echoIdx) return echo
        return {
            ...echo,
            substats: echo.substats.filter((_, si) => si !== substatIdx)
        }
    })
}
