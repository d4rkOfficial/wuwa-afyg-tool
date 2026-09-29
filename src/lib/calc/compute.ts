import type { DamageEntry, BuffInstance, BuffZoneValue, BuffCondition, ZoneRef } from './calculation.types'
import type { ConfigState, EchoSlotConfig } from './config.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { ResultEntry, MultiplierZone } from './result.types'
import type { CharSlot } from '$lib/types/project'
import { ZONE_NO_REF_IDS } from './calculation.consts'
import { applyZone, recomputeTotals, type CharacterComputed } from './zone-ops'
import { evaluateCondition, type ConditionContext } from './condition'
import { getEffectMultiplier, getEffectBurstMultiplier, EFFECT_BASE_VALUE } from '$lib/consts/effect-data'
import {
    NON_DIRECT_ELEMENT,
    TYPE_BONUS_MAP,
    ELEMENT_BONUS_MAP,
    WEAPON_SUBSTAT_NAME_MAP,
    SUBSTAT_DECIMAL_TO_PCT,
    CHAR_LEVEL
} from '$lib/consts/game-terms'
import { SECOND_MAIN_STAT } from '$lib/consts/stat-data'

// ── helpers ──

import type { EnemyConfig } from './config.types'

import { inferDamageTypes } from './utils'
import { buildEchoDescByEntry } from './skill-infer'
import { getEchoSkillText } from '$lib/data/char-info.svelte'

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
 * 实战对比验证：鸣潮减防与穿防为独立乘算 (1-减防)×(1-穿防)，
 * 非加算 (1-减防-穿防)，原算法（加算）低估了减防/穿防收益
 */
function computeDefMulti(enemy: EnemyConfig, defPen: number, defDown: number): number {
    const defBase = enemy.defense
    const defEff = Math.max(defBase * (1 - defDown / 100) * (1 - defPen / 100), 0)
    const charTerm = 800 + 8 * CHAR_LEVEL
    return Math.max(charTerm / (defEff + charTerm), 0.01)
}

/**
 * 抗性乘区（分段公式，effResist 为有效抗性，单位小数，可负）
 * - 抗性 < 0（抗性被穿/降穿透成负）：抗性乘区 = 1 + |抗性| / 2（减半收益）
 * - 0 <= 抗性 < 80%：抗性乘区 = 1 - 抗性（线性减免）
 * - 抗性 >= 80%：抗性乘区 = 1 / ((抗性 + 0.2) * 5)（封顶，防接近 100% 时伤害归零）
 */
function computeResMulti(baseResist: number, resPen: number, resDown: number): number {
    const effResist = baseResist - resPen / 100 - resDown / 100
    if (effResist < 0) return 1 + Math.abs(effResist) / 2
    if (effResist < 0.8) return 1 - effResist
    return 1 / ((effResist + 0.2) * 5)
}

const REF_STAT_MAP: Record<string, keyof CharacterComputed> = {
    baseAtk: 'baseAtk',
    totalAtk: 'totalAtk',
    baseHp: 'baseHp',
    totalHp: 'totalHp',
    baseDef: 'baseDef',
    totalDef: 'totalDef',
    recharge: 'recharge',
    tuneBreakBoost: 'totalTuneBreakBoost',
    offTuneBuildupRate: 'offTuneBuildupRate',
    critRate: 'critRate',
    critDmg: 'critDmg'
}

/** @desc 解析引用转模读数：从「本条目可见面板」里取被引用角色的属性（无面板时视为 0） */
function resolveRefValue(ref: ZoneRef, panel: CharacterComputed | undefined): number {
    if (!panel) return 0
    const key = REF_STAT_MAP[ref.zoneId]
    if (!key) return 0
    const statValue = panel[key] as number
    const excess = statValue - ref.threshold
    let value: number
    if (ref.discrete) {
        if (excess <= 0) return 0
        const divisor = ref.divisor ?? 1
        const multiplier = ref.multiplier ?? 0
        const steps = Math.floor(excess / divisor)
        value = steps * multiplier
    } else {
        value = (excess * ref.pct) / 100
    }
    if (ref.lower !== undefined) value = Math.max(ref.lower, value)
    if (ref.upper !== undefined) value = Math.min(ref.upper, value)
    return value
}

function isElementBonus(label: string): boolean {
    return label in ELEMENT_BONUS_MAP
}

function isTypeBonus(label: string): boolean {
    return label in TYPE_BONUS_MAP
}

/** @desc 把装备/词条上的属性词条（元素加成 / 类型加成 / 面板词条）写入角色贡献累加器 */
function applyEntryStatToAccum(label: string, value: number, acc: CharacterComputed) {
    if (isElementBonus(label)) {
        const el = ELEMENT_BONUS_MAP[label]
        acc.elementBonus[el] = (acc.elementBonus[el] ?? 0) + value
        return
    }
    if (isTypeBonus(label)) {
        const t = TYPE_BONUS_MAP[label]
        acc.typeBonus[t] = (acc.typeBonus[t] ?? 0) + value
        return
    }
    switch (label) {
        case '攻击':
            applyZone(acc, 'atkFlat', value)
            break
        case '生命':
            applyZone(acc, 'hpFlat', value)
            break
        case '防御':
            applyZone(acc, 'defFlat', value)
            break
        case '攻击%':
            applyZone(acc, 'atkPct', value)
            break
        case '生命%':
            applyZone(acc, 'hpPct', value)
            break
        case '防御%':
            applyZone(acc, 'defPct', value)
            break
        case '暴击率':
            applyZone(acc, 'critRate', value)
            break
        case '暴击伤害':
            applyZone(acc, 'critDmg', value)
            break
        case '共鸣效率':
            applyZone(acc, 'recharge', value)
            break
        case '治疗加成':
            break // not used in damage formula
    }
}

function emptyAccum(): CharacterComputed {
    return {
        baseAtk: 0,
        baseHp: 0,
        baseDef: 0,
        totalAtk: 0,
        totalHp: 0,
        totalDef: 0,
        totalTuneBreakBoost: 0,
        offTuneBuildupRate: 100,
        recharge: 100,
        atkPctSum: 0,
        atkFlatSum: 0,
        hpPctSum: 0,
        hpFlatSum: 0,
        defPctSum: 0,
        defFlatSum: 0,
        critRate: 5,
        critDmg: 150,
        bonusDmg: 0,
        deepenDmg: 0,
        resPen: 0,
        defPen: 0,
        defDown: 0,
        resDown: 0,
        tuneStrainLayer: 0,
        unisonBoonLayer: 0,
        finalDmg: 0,
        dmgTakenInc: 0,
        specialFinal1: 0,
        specialFinal2Mul: 1,
        dmgRedPen: 0,
        extraRatio: 0,
        elementBonus: {},
        typeBonus: {}
    }
}

// ── compute base stat accum from echoes + weapon ──

function accumulateEchoes(
    echoes: EchoSlotConfig[],
    weaponSubstatValue: number,
    weaponSubstatLabel: string | undefined,
    acc: CharacterComputed
) {
    if (weaponSubstatLabel) {
        applyEntryStatToAccum(weaponSubstatLabel, weaponSubstatValue, acc)
    }
    for (const echo of echoes) {
        if (echo.mainStat) {
            applyEntryStatToAccum(echo.mainStat.type, echo.mainStat.value, acc)
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
            applyEntryStatToAccum(sub.type, sub.value, acc)
        }
    }
}

// ── build final character stats (per-entry, includes buffs bound to this entry) ──

export interface ConditionProfile {
    chains: number[]
    refinements: number[]
}

export const DEFAULT_CONDITION_PROFILE: ConditionProfile = { chains: [0, 0, 0], refinements: [1, 1, 1] }

/** @desc 判定某个 Buff 的生效条件（引擎与「隐藏条件不匹配」筛选共用同一口径） */
export function buffConditionMet(
    condition: BuffInstance['condition'],
    profile: ConditionProfile,
    charIndex: number,
    ctx: Partial<ConditionContext> = {},
    refCharIdx?: number
): boolean {
    const chains = ctx.chains ?? profile.chains
    const refinements = ctx.refinements ?? profile.refinements
    return evaluateCondition(condition, {
        chains,
        refinements,
        refCharIdx: refCharIdx ?? (charIndex >= 0 ? charIndex : undefined),
        ...(ctx.element !== undefined ? { element: ctx.element } : {}),
        ...(ctx.damageTypes !== undefined ? { damageTypes: ctx.damageTypes } : {})
    })
}

/**
 * @desc 兼容旧口径的条件判定（表格「隐藏条件不匹配」筛选复用）：
 * 同时支持新条件结构（chains/refinements）与旧字段（chain/refinement/elements/damageTypes）。
 * 传入 entry 时按条目属性/伤害类型判定；不传时忽略条目级子条件（角色级聚合）。
 */
export function conditionMet(
    bs: BuffInstance,
    profile: ConditionProfile,
    charIndex: number,
    entry?: DamageEntry,
    damageEntryDamageTypes?: Record<string, string[]>,
    charInfoMap?: Record<string, CharacterInfo>,
    echoDescByEntry?: Record<string, string>
): boolean {
    const element = entry?.damageElement
    const damageTypes = entry
        ? resolveDamageTypes(entry, damageEntryDamageTypes ?? {}, charInfoMap, echoDescByEntry)
        : undefined
    return buffConditionMet(
        bs.condition,
        profile,
        charIndex,
        {
            ...(element !== undefined ? { element } : {}),
            ...(damageTypes !== undefined ? { damageTypes } : {})
        },
        bs.conditionRefCharIdx
    )
}

/** @desc 条目是否绑定该 Buff（scope 按作用域匹配） */
const scopeMatches = (buff: BuffInstance, charIndex: number, isEffect: boolean): boolean => {
    if (buff.scope === 'all') return true
    if (buff.scope.length === 0) return isEffect && charIndex < 0
    return buff.scope.includes(charIndex)
}

/**
 * @desc 返回某伤害条目实际生效的 Buff 集（按范围 + 整块硬性条件过滤），溯源模块复用同一口径。
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
    matchEntry = true
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
        matchEntry
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
 * @desc 某角色槽位在「本条目」下真正生效的 Buff：作用域匹配 + 整块硬性条件（链/阶硬门槛）。
 * 条件里的链/阶以**该角色槽位**为参考（作用域指向谁，就按谁的链阶判定）。
 * 乘区条目自身的条件不在这里过滤 —— 由 activeZonesOf / refZonesOf / overrideZonesOf 逐条判定。
 */
const activeBoundForChar = (
    candidates: BuffInstance[],
    charIdx: number,
    isEffect: boolean,
    profile: ConditionProfile,
    ctx: Partial<ConditionContext>
): BuffInstance[] => {
    const out: BuffInstance[] = []
    for (const buff of candidates) {
        if (!scopeMatches(buff, charIdx, isEffect)) continue
        if (!buffConditionMet(buff.condition, profile, charIdx, ctx, buff.conditionRefCharIdx)) continue
        out.push(buff)
    }
    return out
}

/** @desc 生效 Buff（引擎内部用：逐条乘区条目写入累加器） */
function boundBuffs(
    entry: DamageEntry,
    charIndex: number,
    buffSets: BuffInstance[],
    damageEntryBuffSetIds: Record<string, string[]>,
    damageEntryDamageTypes: Record<string, string[]>,
    profile: ConditionProfile,
    charInfoMap?: Record<string, CharacterInfo>,
    echoDescByEntry?: Record<string, string>,
    matchEntry = true
): BuffInstance[] {
    const ctx: Partial<ConditionContext> = matchEntry
        ? {
              element: entry.damageElement,
              damageTypes: resolveDamageTypes(entry, damageEntryDamageTypes, charInfoMap, echoDescByEntry)
          }
        : {}
    return activeBoundForChar(
        entryCandidateBuffs(entry, buffSets, damageEntryBuffSetIds),
        charIndex,
        entry.isEffect,
        profile,
        ctx
    )
}

/** @desc 计算某个角色槽位某条目可见的完整贡献（装备 + 绑定且生效的 Buff 条目）。
 *  门槛判定（作用域 + 实例级硬性条件）均已在此前完成，此处只做乘区写入（含每条目自身的乘区条件）。 */
function computeCharacterStats(
    charInfo: CharacterInfo,
    weaponName: string | null,
    weaponInfo: WeaponInfo | null,
    echoes: EchoSlotConfig[],
    boundBuffs: BuffInstance[],
    ctx?: ZoneCtx
): CharacterComputed {
    const baseAtk = Math.round(charInfo.lv90BaseStats.atk + (weaponInfo?.lv90BaseAtk ?? 0))
    const baseHp = Math.round(charInfo.lv90BaseStats.hp)
    const baseDef = Math.round(charInfo.lv90BaseStats.def)
    const baseTuneBreakBoost = Math.round(charInfo.lv90BaseStats.tuneBreakBoost)

    const acc = emptyAccum()
    acc.baseAtk = baseAtk
    acc.baseHp = baseHp
    acc.baseDef = baseDef
    acc.totalTuneBreakBoost = baseTuneBreakBoost

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
    accumulateEchoes(echoes, wSubCanonicalValue, wSubCanonicalName, acc)

    // 一切皆 buff：绑定到该角色的 Buff 逐条乘区条目写入同一贡献累加器（乘区级条件在此过滤）
    for (const z of activeZonesOf(boundBuffs, ctx)) {
        applyZone(acc, z.zoneId, z.value)
    }

    const atkGreen = Math.round(acc.atkFlatSum + (baseAtk * acc.atkPctSum) / 100)
    const hpGreen = Math.round(acc.hpFlatSum + (baseHp * acc.hpPctSum) / 100)
    const defGreen = Math.round(acc.defFlatSum + (baseDef * acc.defPctSum) / 100)

    return {
        ...acc,
        baseAtk,
        baseHp,
        baseDef,
        totalAtk: baseAtk + atkGreen,
        totalHp: baseHp + hpGreen,
        totalDef: baseDef + defGreen,
        totalTuneBreakBoost: Math.round(acc.totalTuneBreakBoost)
    }
}

/** @desc 生效 Buff 的全部乘区条目（引擎逐条写入累加器的唯一出口） */
const collectZones = (buffs: BuffInstance[]): BuffZoneValue[] => buffs.flatMap((b) => b.zones)

/** @desc 乘区级条件求值上下文：伤害段上下文 + 链阶档位 */
interface ZoneCtx {
    chains: number[]
    refinements: number[]
    element?: string
    damageTypes?: string[]
}

/** @desc 乘区自身条件是否满足（乘区级只允许 伤害类型/属性；链阶由实例级把关） */
const zoneConditionMet = (zone: { condition?: BuffCondition }, ctx: ZoneCtx): boolean =>
    evaluateCondition(zone.condition, {
        chains: ctx.chains,
        refinements: ctx.refinements,
        ...(ctx.element !== undefined ? { element: ctx.element } : {}),
        ...(ctx.damageTypes !== undefined ? { damageTypes: ctx.damageTypes } : {})
    })

/**
 * @desc 生效 Buff 提供的直接贡献乘区（跳过引用/覆盖/零值；乘区条件不满足者逐条剔除）。
 * 同一乘区可有多条：`if (链阶硬门槛满足) { 各条目各自 add if 自身条件满足 }` —— 满足的全部相加。
 */
const activeZonesOf = (buffs: BuffInstance[], ctx?: ZoneCtx): { zoneId: string; value: number }[] =>
    collectZones(buffs).flatMap((z) =>
        !z.ref && !z.override && z.value !== 0 && (!ctx || zoneConditionMet(z, ctx))
            ? [{ zoneId: z.zoneId as string, value: z.value }]
            : []
    )

/** @desc 生效 Buff 里带引用标记的乘区（转模：稍后按面板解析；乘区条件不满足者剔除） */
const refZonesOf = (buffs: BuffInstance[], ctx?: ZoneCtx): { zoneId: string; ref: ZoneRef }[] =>
    collectZones(buffs).flatMap((z) =>
        z.ref && !ZONE_NO_REF_IDS.has(z.zoneId) && (!ctx || zoneConditionMet(z, ctx))
            ? [{ zoneId: z.zoneId as string, ref: z.ref }]
            : []
    )

/**
 * @desc 该 Buff 对某个伤害条目**是否还有任何贡献**（表格「隐藏条件不匹配」筛选用）。
 *
 * 为什么不能用实例级条件代替：条件分层之后，**属性/类型条件挂在乘区条目上**（`BuffZoneValue.condition`），
 * 实例级只剩链/阶硬门槛。表格若只看实例级条件，就会出现「乘区条件不满足、格子却仍可勾选」的 bug。
 *
 * 口径与引擎 `activeZonesOf` / `refZonesOf` 完全一致（同一套 zoneConditionMet）：
 * 只要**存在至少一条**乘区条目「自身条件满足 且 值/引用/覆盖能生效」，就算有贡献。
 * 因此「一条不匹配 + 一条无条件」仍然算有贡献（引擎确实会把无条件那条计入），不会误判为不可用。
 *
 * 注意：`element` 必须一并传入（引擎的 ZoneCtx 也带 element）—— evaluateCondition 对
 * `damageTypes` 子句要求同时具备条目上下文，只给 damageTypes 会让条件恒判不满足。
 */
export const buffContributesToEntry = (
    buff: BuffInstance,
    ctx: { element?: string; damageTypes?: string[] },
    profile: ConditionProfile = DEFAULT_CONDITION_PROFILE,
    charIndex = -1
): boolean => {
    const ctxForCondition: Partial<ConditionContext> = {
        ...(ctx.element !== undefined ? { element: ctx.element } : {}),
        ...(ctx.damageTypes !== undefined ? { damageTypes: ctx.damageTypes } : {})
    }
    if (!buffConditionMet(buff.condition, profile, charIndex, ctxForCondition, buff.conditionRefCharIdx)) {
        return false
    }
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
 * @desc 生效 Buff 里带覆盖标记的乘区（覆盖优先于一切：在最后直接替换该乘区合计值；乘区条件不满足者剔除）。
 * 同一乘区跨 Buff 出现多个覆盖时，按 Buff 进入计算的顺序依次写入 —— 后进入者最终生效。
 */
const overrideZonesOf = (buffs: BuffInstance[], ctx?: ZoneCtx): { zoneId: string; value: number }[] =>
    collectZones(buffs).flatMap((z) =>
        z.override && !z.ref && z.value !== 0 && (!ctx || zoneConditionMet(z, ctx))
            ? [{ zoneId: z.zoneId as string, value: z.value }]
            : []
    )

// ── compute a single ResultEntry ──

function computeResultEntry(
    entry: DamageEntry,
    stats: CharacterComputed,
    enemy: ConfigState['enemy'],
    damageTypes: string[]
): ResultEntry {
    const ratioNum = entry.ratioUnit === '%' ? entry.ratioValue / 100 : entry.ratioValue
    const effectiveRatio = ratioNum + (stats.extraRatio / 100) * (entry.hits || 1)

    // determine base stat and baseValue
    let totalStat = 0
    let baseUnit = '固定'
    let baseValue = 0

    if (entry.ratioUnit === '%') {
        switch (entry.damageBaseType) {
            case '攻击':
                totalStat = stats.totalAtk
                baseUnit = '攻击'
                break
            case '生命':
                totalStat = stats.totalHp
                baseUnit = '生命'
                break
            case '防御':
                totalStat = stats.totalDef
                baseUnit = '防御'
                break
            case '偏谐系数':
                totalStat = stats.totalAtk
                baseUnit = '偏谐系数'
                break
            default:
                totalStat = stats.totalAtk
                baseUnit = '攻击'
                break
        }
        baseValue = totalStat * effectiveRatio
    } else {
        baseValue = entry.ratioValue
        // fixed damage: skip all multipliers, show 100%
        const r: ResultEntry = makeStubEntry(entry)
        r.ratioNum = 1
        r.baseValue = Math.round(baseValue)
        r.baseUnit = '固定'
        r.expectedPerHit = Math.round(baseValue)
        r.rawPerHit = Math.round(baseValue)
        r.totalDamage = Math.round(baseValue)
        r.totalMultiplier = 1
        r.damageTypes = damageTypes
        return r
    }

    // element/type bonus -> total dmg bonus
    const elBonus = stats.elementBonus[entry.damageElement] ?? 0
    let typeBonusSum = 0
    for (const dt of damageTypes) {
        const key = dt.replace('伤害', '')
        typeBonusSum += stats.typeBonus[key] ?? 0
    }
    const totalDmgBonus = stats.bonusDmg + elBonus + typeBonusSum

    // ── formula multipliers ──

    const deepen = 1 + stats.deepenDmg / 100
    const bonus = 1 + totalDmgBonus / 100
    const vulnerability = 1 + stats.dmgTakenInc / 100
    const finalDmg = 1 + stats.finalDmg / 100
    const customMult = (stats.specialFinal1 !== 0 ? 1 + stats.specialFinal1 / 100 : 1) * stats.specialFinal2Mul
    const tuneStrainMulti = 1 + 0.0012 * stats.totalTuneBreakBoost * stats.tuneStrainLayer

    /** @desc 同奏区：1 + 3% × 同奏增益层数（直伤/效应/处决响应全生效的独立乘区） */
    const unisonMulti = 1 + 0.03 * stats.unisonBoonLayer

    // crit (cap at 100%)
    const critDecimal = Math.min(stats.critRate, 100) / 100
    const critDmgDecimal = stats.critDmg / 100
    const critAvg = 1 + critDecimal * (critDmgDecimal - 1)

    // defense zone
    const defMulti = computeDefMulti(enemy, stats.defPen, stats.defDown)

    // resistance zone
    const baseResist = (enemy.resistances[entry.damageElement] ?? 0) / 100
    const resMulti = computeResMulti(baseResist, stats.resPen, stats.resDown)

    // damage reduction zone
    const dmgRedMulti = 1 - enemy.dmgReduction / 100 - stats.dmgRedPen / 100

    // total multiplier (for display)
    const totalMultiplier =
        effectiveRatio *
        bonus *
        deepen *
        vulnerability *
        tuneStrainMulti *
        unisonMulti *
        finalDmg *
        customMult *
        defMulti *
        resMulti *
        dmgRedMulti *
        critAvg

    // non-crit and crit per hit (all zones except crit)
    const nonCritRaw =
        baseValue *
        deepen *
        bonus *
        vulnerability *
        resMulti *
        dmgRedMulti *
        defMulti *
        tuneStrainMulti *
        unisonMulti *
        finalDmg *
        customMult
    const nonCritPerHit = Math.round(nonCritRaw)
    const critPerHit = Math.round(nonCritRaw * critDmgDecimal)

    const expectedRaw =
        baseValue *
        deepen *
        bonus *
        critAvg *
        vulnerability *
        resMulti *
        dmgRedMulti *
        defMulti *
        tuneStrainMulti *
        unisonMulti *
        finalDmg *
        customMult
    const expectedPerHit = Math.round(expectedRaw)

    const multZones: MultiplierZone[] = [
        { label: '加深区', value: deepen, detail: `(1 + ${stats.deepenDmg.toFixed(1)}%)` },
        { label: '增伤区', value: bonus, detail: `(1 + ${totalDmgBonus.toFixed(1)}%)` },
        { label: '易伤区', value: vulnerability, detail: `(1 + ${stats.dmgTakenInc.toFixed(1)}%)` },
        { label: '抗性区', value: resMulti, detail: resMulti.toFixed(4) },
        { label: '免伤区', value: dmgRedMulti, detail: dmgRedMulti.toFixed(4) },
        { label: '防御区', value: defMulti, detail: defMulti.toFixed(4) },
        {
            label: '集谐区',
            value: tuneStrainMulti,
            detail:
                stats.tuneStrainLayer > 0
                    ? `(1 + ${((tuneStrainMulti - 1) * 100).toFixed(1)}%)`
                    : tuneStrainMulti.toFixed(4)
        },
        {
            label: '同奏区',
            value: unisonMulti,
            detail:
                stats.unisonBoonLayer > 0 ? `(1 + ${((unisonMulti - 1) * 100).toFixed(1)}%)` : unisonMulti.toFixed(4)
        },
        { label: '终伤区', value: finalDmg, detail: `(1 + ${stats.finalDmg.toFixed(1)}%)` },
        { label: '特殊区', value: customMult, detail: customMult.toFixed(4) }
    ]

    return {
        id: entry.id,
        character: entry.character ?? '',
        hitName: entry.hitName,
        skillType: entry.skillType ?? '',
        displayName: entry.displayName,
        element: entry.damageElement,
        ratioNum,
        hits: entry.hits,
        sourceTimelineBlockId: entry.sourceTimelineBlockId,
        baseValue: Math.round(baseValue),
        baseUnit,
        totalMultiplier,
        extraRatio: stats.extraRatio,
        baseAtk: stats.baseAtk,
        totalAtk: stats.totalAtk,
        atkPctSum: stats.atkPctSum,
        atkFlatSum: stats.atkFlatSum,
        baseHp: stats.baseHp,
        totalHp: stats.totalHp,
        hpPctSum: stats.hpPctSum,
        hpFlatSum: stats.hpFlatSum,
        baseDef: stats.baseDef,
        totalDef: stats.totalDef,
        defPctSum: stats.defPctSum,
        defFlatSum: stats.defFlatSum,
        totalTuneBreakBoost: stats.totalTuneBreakBoost,
        dmgBonus: totalDmgBonus / 100,
        deepen: stats.deepenDmg / 100,
        critRate: critDecimal,
        critDmg: critDmgDecimal,
        defMulti,
        resMulti,
        dmgRedMulti,
        finalDmg: stats.finalDmg / 100,
        finalTuneStrainMulti: stats.tuneStrainLayer > 0 ? tuneStrainMulti - 1 : 0,
        finalTuneBreakZone: 0,
        finalUnisonMulti: stats.unisonBoonLayer > 0 ? unisonMulti - 1 : 0,
        customMult,
        vulnerability: stats.dmgTakenInc / 100,
        rawPerHit: Math.round(
            baseValue *
                deepen *
                bonus *
                resMulti *
                dmgRedMulti *
                defMulti *
                tuneStrainMulti *
                unisonMulti *
                finalDmg *
                customMult
        ),
        expectedPerHit,
        totalDamage: expectedPerHit,
        totalDamageRaw: expectedRaw,
        nonCritPerHit,
        critPerHit,
        canCrit: entry.damageBaseType !== '偏谐系数',
        multiplierZones: multZones,
        damageTypes,
        // 溯源辅助：增伤区元素/类型拆分（%）
        elBonus,
        typeBonus: typeBonusSum
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
        damageTypes: []
    }
}

// ── tune (处决/响应) computation ──

const TUNE_COEFF_MAP: Record<string, number> = {
    BOSS: 10027,
    精英怪: 2149,
    小怪: 716.2
}

const TUNE_BASE_UNIT = '偏谐系数'

function computeTuneEntry(entry: DamageEntry, stats: CharacterComputed, enemy: ConfigState['enemy']): ResultEntry {
    const ratioNum = entry.ratioUnit === '%' ? entry.ratioValue / 100 : entry.ratioValue
    const effectiveRatio = ratioNum + (stats.extraRatio / 100) * (entry.hits || 1)
    const tuneCoeff = TUNE_COEFF_MAP[enemy.type] ?? 716.2
    const baseUnit = TUNE_BASE_UNIT
    const baseValue = tuneCoeff * effectiveRatio

    // tune break zone: 1 + tuneBreakBoost / 100
    const tuneBreakZone = 1 + stats.totalTuneBreakBoost / 100

    // defense zone (same as direct damage)
    const defMulti = computeDefMulti(enemy, stats.defPen, stats.defDown)

    // resistance zone (element from entry)
    const baseResist = (enemy.resistances[entry.damageElement] ?? 0) / 100
    const resMulti = computeResMulti(baseResist, stats.resPen, stats.resDown)

    // damage reduction zone
    const dmgRedMulti = 1 - enemy.dmgReduction / 100 - stats.dmgRedPen / 100

    // final dmg & custom mult
    const finalDmgDec = stats.finalDmg / 100
    const customMultVal = (stats.specialFinal1 !== 0 ? 1 + stats.specialFinal1 / 100 : 1) * stats.specialFinal2Mul

    // 同奏区：1 + 3% × 同奏增益层数（全伤害通用乘区）
    const unisonMulti = 1 + 0.03 * stats.unisonBoonLayer

    // vulnerability zone (易伤区)
    const vulnerability = 1 + stats.dmgTakenInc / 100

    const totalPerHit =
        baseValue *
        vulnerability *
        defMulti *
        resMulti *
        dmgRedMulti *
        tuneBreakZone *
        unisonMulti *
        (1 + finalDmgDec) *
        customMultVal
    const expectedPerHit = Math.round(totalPerHit)

    const multZones: MultiplierZone[] = [
        { label: '抗性区', value: resMulti, detail: resMulti.toFixed(4) },
        { label: '免伤区', value: dmgRedMulti, detail: dmgRedMulti.toFixed(4) },
        { label: '防御区', value: defMulti, detail: defMulti.toFixed(4) },
        { label: '谐度增幅区', value: tuneBreakZone, detail: `(1 + ${stats.totalTuneBreakBoost.toFixed(1)}%)` },
        { label: '易伤区', value: vulnerability, detail: `(1 + ${stats.dmgTakenInc.toFixed(1)}%)` },
        { label: '终伤区', value: 1 + finalDmgDec, detail: `(1 + ${stats.finalDmg.toFixed(1)}%)` },
        {
            label: '同奏区',
            value: unisonMulti,
            detail:
                stats.unisonBoonLayer > 0 ? `(1 + ${((unisonMulti - 1) * 100).toFixed(1)}%)` : unisonMulti.toFixed(4)
        },
        { label: '特殊区', value: customMultVal, detail: customMultVal.toFixed(4) }
    ]

    return {
        id: entry.id,
        character: entry.character ?? '',
        hitName: entry.hitName,
        skillType: entry.skillType ?? '',
        displayName: entry.displayName,
        element: entry.damageElement,
        ratioNum: effectiveRatio,
        hits: entry.hits,
        sourceTimelineBlockId: entry.sourceTimelineBlockId,
        baseValue: Math.round(baseValue),
        baseUnit,
        totalMultiplier:
            effectiveRatio *
            vulnerability *
            defMulti *
            resMulti *
            dmgRedMulti *
            tuneBreakZone *
            unisonMulti *
            (1 + finalDmgDec) *
            customMultVal,
        baseAtk: tuneCoeff,
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
        totalTuneBreakBoost: stats.totalTuneBreakBoost,
        dmgBonus: 0,
        deepen: 0,
        critRate: 0,
        critDmg: 0,
        defMulti,
        resMulti,
        dmgRedMulti,
        finalDmg: finalDmgDec,
        finalTuneStrainMulti: 0,
        finalTuneBreakZone: tuneBreakZone - 1,
        finalUnisonMulti: stats.unisonBoonLayer > 0 ? unisonMulti - 1 : 0,
        customMult: customMultVal,
        extraRatio: stats.extraRatio,
        vulnerability: stats.dmgTakenInc / 100,
        totalDamageRaw: totalPerHit,
        rawPerHit: expectedPerHit,
        expectedPerHit,
        totalDamage: expectedPerHit,
        nonCritPerHit: expectedPerHit,
        critPerHit: expectedPerHit,
        canCrit: false,
        multiplierZones: multZones,
        damageTypes: []
    }
}

function emptyCharacterStats(): CharacterComputed {
    return {
        baseAtk: 0,
        baseHp: 0,
        baseDef: 0,
        totalAtk: 0,
        totalHp: 0,
        totalDef: 0,
        totalTuneBreakBoost: 0,
        offTuneBuildupRate: 100,
        extraRatio: 0,
        recharge: 100,
        atkPctSum: 0,
        atkFlatSum: 0,
        hpPctSum: 0,
        hpFlatSum: 0,
        defPctSum: 0,
        defFlatSum: 0,
        critRate: 5,
        critDmg: 150,
        bonusDmg: 0,
        deepenDmg: 0,
        resPen: 0,
        defPen: 0,
        defDown: 0,
        resDown: 0,
        tuneStrainLayer: 0,
        unisonBoonLayer: 0,
        finalDmg: 0,
        dmgTakenInc: 0,
        specialFinal1: 0,
        specialFinal2Mul: 1,
        dmgRedPen: 0,
        elementBonus: {},
        typeBonus: {}
    }
}

// ── effect damage ──

function computeEffectEntry(
    entry: DamageEntry,
    stats: CharacterComputed,
    enemy: ConfigState['enemy'],
    damageTypes: string[]
): ResultEntry {
    /** @desc
     * ── 倍率：查表取效应倍率（EFFECT_TABLE[效应名][层数]，见 $lib/consts/effect-data.ts）──
     * entry.ratioValue 即效应层数；burstLayers 仅电磁效应 > 0（其余效应为 0）
     */
    const layers = Math.round(entry.ratioValue)
    const burstLayers = entry.burstLayers ?? 0
    const effectMult = getEffectMultiplier(entry.hitName, layers)
    const burstMult = getEffectBurstMultiplier(entry.hitName, burstLayers)
    const multiplier = (effectMult + burstMult) * (entry.hits || 1)
    const ratioNum = multiplier

    /** @desc ── 加「额外倍率」乘区（buff 提供，效应伤害专属增益）── */
    const effectiveRatio = ratioNum + (stats.extraRatio / 100) * (entry.hits || 1)
    const element = (NON_DIRECT_ELEMENT as Record<string, string>)[entry.hitName] ?? ''

    /** @desc ── 基础值：效应伤害有独立基础值 3674，与角色攻击力无关（不吃攻击/暴击/增伤/面板类）── */
    const baseUnit = '效应系数'
    const baseValue = Math.round(EFFECT_BASE_VALUE * effectiveRatio)

    /** @desc 防御区：独立乘算 (1-减防)×(1-穿防)（非加算），800+8×等级 减伤公式 */
    const defMulti = computeDefMulti(enemy, stats.defPen, stats.defDown)

    /** @desc 抗性区：分段公式（负抗减半收益 / 线性减免 / ≥80% 封顶，防止伤害归零） */
    const baseResist = (enemy.resistances[element] ?? 0) / 100
    const resMulti = computeResMulti(baseResist, stats.resPen, stats.resDown)

    /** @desc 免伤区：1 - 敌人免伤 - 穿免 */
    const dmgRedMulti = 1 - enemy.dmgReduction / 100 - stats.dmgRedPen / 100

    /** @desc 加深区：1 + 加深%（效应吃加深、不吃谐度增幅） */
    const deepen = 1 + stats.deepenDmg / 100

    /** @desc 终伤区 & 特殊区：1 + 终伤%；自定义倍率（≠0 才生效） */
    const finalDmgDec = stats.finalDmg / 100
    const customMultVal = (stats.specialFinal1 !== 0 ? 1 + stats.specialFinal1 / 100 : 1) * stats.specialFinal2Mul

    /** @desc 同奏区：1 + 3% × 同奏增益层数（全伤害通用乘区，效应伤害同样生效） */
    const unisonMulti = 1 + 0.03 * stats.unisonBoonLayer

    /** @desc ── 汇总：基础值 × 各乘区乘积 = 单段期望伤害（无易伤区，效应伤害不吃易伤）── */
    const totalPerHit =
        baseValue * defMulti * resMulti * dmgRedMulti * deepen * (1 + finalDmgDec) * customMultVal * unisonMulti
    const expectedPerHit = Math.round(totalPerHit)

    /** @desc 乘区明细（供结果页展示乘区分解） */
    const multZones: MultiplierZone[] = [
        { label: '加深区', value: deepen, detail: `(1 + ${stats.deepenDmg.toFixed(1)}%)` },
        { label: '抗性区', value: resMulti, detail: resMulti.toFixed(4) },
        { label: '免伤区', value: dmgRedMulti, detail: dmgRedMulti.toFixed(4) },
        { label: '防御区', value: defMulti, detail: defMulti.toFixed(4) },
        { label: '终伤区', value: 1 + finalDmgDec, detail: `(1 + ${stats.finalDmg.toFixed(1)}%)` },
        {
            label: '同奏区',
            value: unisonMulti,
            detail:
                stats.unisonBoonLayer > 0 ? `(1 + ${((unisonMulti - 1) * 100).toFixed(1)}%)` : unisonMulti.toFixed(4)
        },
        { label: '特殊区', value: customMultVal, detail: customMultVal.toFixed(4) }
    ]

    /** @desc
     * ── 输出 ResultEntry：效应伤害不能暴击（canCrit: false）、伤害类型为推导/显式结果（damageTypes: ['效应伤害'] 等）、
     * 面板类字段（攻击/双暴等）恒为 0，基础值来自独立常量 EFFECT_BASE_VALUE ──
     */
    return {
        id: entry.id,
        character: entry.character ?? '',
        hitName: entry.hitName,
        skillType: entry.skillType ?? '',
        displayName: entry.displayName,
        element,
        ratioNum: effectiveRatio,
        hits: entry.hits,
        sourceTimelineBlockId: entry.sourceTimelineBlockId,
        baseValue,
        baseUnit,
        totalMultiplier:
            effectiveRatio *
            defMulti *
            resMulti *
            dmgRedMulti *
            deepen *
            (1 + finalDmgDec) *
            customMultVal *
            unisonMulti,
        baseAtk: EFFECT_BASE_VALUE,
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
        totalTuneBreakBoost: stats.totalTuneBreakBoost,
        dmgBonus: 0,
        deepen: stats.deepenDmg / 100,
        critRate: 0,
        critDmg: 0,
        defMulti,
        resMulti,
        dmgRedMulti,
        finalDmg: finalDmgDec,
        finalTuneStrainMulti: 0,
        finalTuneBreakZone: 0,
        finalUnisonMulti: stats.unisonBoonLayer > 0 ? unisonMulti - 1 : 0,
        customMult: customMultVal,
        extraRatio: stats.extraRatio,
        vulnerability: 0,
        totalDamageRaw: totalPerHit,
        rawPerHit: expectedPerHit,
        expectedPerHit,
        totalDamage: expectedPerHit,
        nonCritPerHit: expectedPerHit,
        critPerHit: expectedPerHit,
        canCrit: false,
        multiplierZones: multZones,
        damageTypes
    }
}

// ── 引用转模：按「本条目可见面板」解析（乘区算子统一走 ZONE_OPS）──

/**
 * @desc 按「本条目可见面板」解析 ref（转模）。
 *
 * 口径：**伤害是当下的，buff 也是当下的** —— 被引用角色的面板只由**绑定到本条目**的 Buff 组成
 * （作用域指向被引用角色的 Buff 被勾到本条目上，就参与该角色在这一段的面板；未勾选的其它条目绑定不参与）。
 * 本角色槽位直接用本条目面板 `partialStats`；其它角色槽位按需现算（`panelOf` 内部带缓存）。
 */
function resolveRefsForEntry(
    stats: CharacterComputed,
    panelOf: (charIdx: number) => CharacterComputed,
    boundBuffs: BuffInstance[],
    ctx?: ZoneCtx
): void {
    for (const { zoneId, ref } of refZonesOf(boundBuffs, ctx)) {
        const resolved = resolveRefValue(ref, panelOf(ref.characterIdx))
        if (resolved === 0) continue
        applyZone(stats, zoneId, resolved)
        recomputeTotals(stats)
    }
}

/**
 * @desc 构建「本条目可见」的某角色槽位面板：装备/词条 + 绑定到本条目的、作用域指向该角色的 Buff。
 * 与角色槽位级面板（把该角色全部条目上的绑定取并集）的区别：这里严格只看这一段伤害勾了什么。
 */
function buildEntryPanel(
    refIdx: number,
    ownStats: CharacterComputed,
    charIndex: number,
    entry: DamageEntry,
    candidates: BuffInstance[],
    profile: ConditionProfile,
    ctx: ZoneCtx,
    team: CharSlot[],
    configState: ConfigState,
    charInfoMap: Record<string, CharacterInfo>,
    weaponInfoMap: Record<string, WeaponInfo>
): CharacterComputed {
    if (refIdx === charIndex) return ownStats
    const slot = team[refIdx]
    if (!slot?.character || !charInfoMap[slot.character]) return emptyCharacterStats()
    const bound = activeBoundForChar(candidates, refIdx, entry.isEffect, profile, ctx)
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
    conditionProfile: ConditionProfile = DEFAULT_CONDITION_PROFILE
): ResultEntry[] {
    const enemy = configState.enemy

    // 逐条目计算：条目面板 = 装备 + 绑定到本条目的 Buff；被引用角色的面板同样只看本条目勾选的 Buff
    /** @desc 声骸技能文案索引（伤害类型规则2：声骸技能条目的「视为/为 XX 伤害」） */
    const echoDescByEntry = buildEchoDescByEntry(damageEntries, team, getEchoSkillText())
    return damageEntries.map((entry) => {
        const charName = entry.character
        const charIndex = team.findIndex((s) => s.character === charName)
        const weaponName = charIndex >= 0 ? (team[charIndex]?.weapon ?? null) : null
        const weaponInfo = weaponInfoMap[weaponName ?? ''] ?? null
        const echoes = charIndex >= 0 ? (configState.characters[charIndex]?.echoes ?? []) : []
        const damageTypes = resolveDamageTypes(entry, damageEntryDamageTypes, charInfoMap, echoDescByEntry)
        /** @desc 乘区级条件上下文（伤害段属性/类型 + 链阶档位） */
        const zoneCtx: ZoneCtx = {
            chains: conditionProfile.chains,
            refinements: conditionProfile.refinements,
            element: entry.damageElement,
            damageTypes
        }
        const candidates = entryCandidateBuffs(entry, buffSets, damageEntryBuffSetIds)
        const entryBound = activeBoundForChar(candidates, charIndex, entry.isEffect, conditionProfile, zoneCtx)
        const charInfo = charName ? charInfoMap[charName] : undefined

        // Compute partial stats (echo+weapon + non-ref buffs only)
        let partialStats: CharacterComputed
        if (charInfo) {
            partialStats = computeCharacterStats(charInfo, weaponName, weaponInfo, echoes, entryBound, zoneCtx)
        } else {
            partialStats = emptyCharacterStats()
            for (const z of activeZonesOf(entryBound, zoneCtx)) {
                applyZone(partialStats, z.zoneId, z.value)
            }
            recomputeTotals(partialStats)
        }

        // 被引用角色面板：按需现算（同一槽位只算一次）
        const panelCache = new Map<number, CharacterComputed>()
        const panelOf = (refIdx: number): CharacterComputed => {
            if (refIdx === charIndex) return partialStats
            const cached = panelCache.get(refIdx)
            if (cached) return cached
            const built = buildEntryPanel(
                refIdx,
                partialStats,
                charIndex,
                entry,
                candidates,
                conditionProfile,
                zoneCtx,
                team,
                configState,
                charInfoMap,
                weaponInfoMap
            )
            panelCache.set(refIdx, built)
            return built
        }

        // Resolve ref zones and apply to stats
        const stats = { ...partialStats }
        resolveRefsForEntry(stats, panelOf, entryBound, zoneCtx)

        // Apply override zones (set value directly, takes precedence over everything)
        for (const z of overrideZonesOf(entryBound, zoneCtx)) {
            applyZone(stats, z.zoneId, z.value, 'override')
        }

        // effect damage
        if (entry.isEffect) {
            return computeEffectEntry(entry, stats, enemy, damageTypes)
        }
        if (!charName || !charInfo || charIndex < 0) return makeStubEntry(entry)

        // tune damage (处决/响应) + 偏谐系数直伤按响应公式计算
        if (entry.isTuneBreak || entry.isTuneResponse || entry.damageBaseType === '偏谐系数') {
            return computeTuneEntry(entry, stats, enemy)
        }

        // direct damage
        return computeResultEntry(entry, stats, enemy, damageTypes)
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
    conditionProfile: ConditionProfile = DEFAULT_CONDITION_PROFILE
): ResultEntry {
    const enemy = configState.enemy
    const charName = entry.character
    const weaponName = charIndex >= 0 ? (team[charIndex]?.weapon ?? null) : null
    const wInfo = weaponInfoMap[weaponName ?? ''] ?? null
    const charInfo = charName ? charInfoMap[charName] : undefined
    /** @desc 声骸技能文案索引（伤害类型规则2） */
    const echoDescByEntry = buildEchoDescByEntry([entry], team, getEchoSkillText())

    // 解析条目伤害类型（显式优先，否则自动推导；效应条目推导为「效应伤害」）
    const damageTypes = resolveDamageTypes(entry, damageEntryDamageTypes, charInfoMap, echoDescByEntry)
    /** @desc 乘区级条件上下文 */
    const zoneCtx: ZoneCtx = {
        chains: conditionProfile.chains,
        refinements: conditionProfile.refinements,
        element: entry.damageElement,
        damageTypes
    }
    const candidates = entryCandidateBuffs(entry, buffSets, damageEntryBuffSetIds)
    const bound = activeBoundForChar(candidates, charIndex, entry.isEffect, conditionProfile, zoneCtx)

    // partial stats (echo+weapon + non-ref buffs)
    const partialStats = charInfo
        ? computeCharacterStats(charInfo, weaponName, wInfo, echoes, bound, zoneCtx)
        : emptyCharacterStats()

    // 被引用角色面板：按需现算（同一槽位只算一次）
    const panelCache = new Map<number, CharacterComputed>()
    const panelOf = (refIdx: number): CharacterComputed => {
        if (refIdx === charIndex) return partialStats
        const cached = panelCache.get(refIdx)
        if (cached) return cached
        const built = buildEntryPanel(
            refIdx,
            partialStats,
            charIndex,
            entry,
            candidates,
            conditionProfile,
            zoneCtx,
            team,
            configState,
            charInfoMap,
            weaponInfoMap
        )
        panelCache.set(refIdx, built)
        return built
    }

    // resolve ref zones
    const stats = { ...partialStats }
    resolveRefsForEntry(stats, panelOf, bound, zoneCtx)
    for (const z of overrideZonesOf(bound, zoneCtx)) {
        applyZone(stats, z.zoneId, z.value, 'override')
    }

    if (entry.isEffect) {
        return computeEffectEntry(entry, stats, enemy, damageTypes)
    }
    if (!charName || !charInfo || charIndex < 0) return makeStubEntry(entry)
    if (entry.isTuneBreak || entry.isTuneResponse || entry.damageBaseType === '偏谐系数') {
        return computeTuneEntry(entry, stats, enemy)
    }
    return computeResultEntry(entry, stats, enemy, damageTypes)
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
