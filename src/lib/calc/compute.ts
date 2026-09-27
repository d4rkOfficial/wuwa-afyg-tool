import type { DamageEntry, BuffInstance, BuffVariant, BuffCondition, ZoneRef } from './calculation.types'
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

function resolveDamageTypes(
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

function resolveRefValue(ref: ZoneRef, allCharStats: CharacterComputed[]): number {
    const stats = allCharStats[ref.characterIdx]
    if (!stats) return 0
    const key = REF_STAT_MAP[ref.zoneId]
    if (!key) return 0
    const statValue = stats[key] as number
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
        customMult: 0,
        customFinalDmgMul: 1,
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

/** @desc 判定某个 buff / 变体的生效条件（引擎与「隐藏条件不匹配」筛选共用同一口径） */
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
 * @desc 某个 Buff 实例对给定条目实际生效的变体列表（整块条件 + 各变体子条件均满足）。
 * 同名多乘区 buff 的语义在此落地：一个实例的多个变体各自判定子条件，满足者全部叠加。
 */
export function activeVariants(
    buff: BuffInstance,
    profile: ConditionProfile,
    charIndex: number,
    ctx: Partial<ConditionContext> = {}
): BuffVariant[] {
    if (!buffConditionMet(buff.condition, profile, charIndex, ctx, buff.conditionRefCharIdx)) return []
    const variants = buff.variants?.length ? buff.variants : [{ id: `${buff.id}-v1`, zones: buff.zones }]
    return variants.filter((v) => buffConditionMet(v.condition, profile, charIndex, ctx, buff.conditionRefCharIdx))
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

interface BoundBuff {
    buff: BuffInstance
    variants: BuffVariant[]
}

/** @desc 条目是否绑定该 Buff（scope 按作用域匹配） */
const scopeMatches = (buff: BuffInstance, charIndex: number, isEffect: boolean): boolean => {
    if (buff.scope === 'all') return true
    if (buff.scope.length === 0) return isEffect && charIndex < 0
    return buff.scope.includes(charIndex)
}

/**
 * @desc 返回某伤害条目实际生效的 Buff 集（按范围 + 整块条件 + 变体子条件过滤），溯源模块复用同一口径。
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
    ).map((b) => b.buff)
}

/** @desc 生效 Buff 及其生效变体（引擎内部用：逐变体写入乘区） */
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
): BoundBuff[] {
    const boundIds = damageEntryBuffSetIds[entry.id] ?? []
    const damageTypes = matchEntry
        ? resolveDamageTypes(entry, damageEntryDamageTypes, charInfoMap, echoDescByEntry)
        : undefined
    const ctx: ConditionContext = {
        chains: profile.chains,
        refinements: profile.refinements,
        refCharIdx: charIndex >= 0 ? charIndex : undefined,
        ...(matchEntry ? { element: entry.damageElement, damageTypes: damageTypes ?? [] } : {})
    }
    const out: BoundBuff[] = []
    for (const buff of buffSets) {
        if (!boundIds.includes(buff.id)) continue
        if (!scopeMatches(buff, charIndex, entry.isEffect)) continue
        const variants = activeVariants(buff, profile, charIndex, ctx)
        if (variants.length > 0) out.push({ buff, variants })
    }
    return out
}

/** @desc 计算某个角色槽位某条目可见的完整贡献（装备 + 绑定且生效的 Buff 变体）。
 *  条件判定（实例级硬性条件 + 变体子条件 + 乘区级条件）均已在此前完成，此处只做乘区写入。 */
function computeCharacterStats(
    charInfo: CharacterInfo,
    weaponName: string | null,
    weaponInfo: WeaponInfo | null,
    echoes: EchoSlotConfig[],
    boundBuffs: BoundBuff[],
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

    // 一切皆 buff：绑定到该角色的 Buff 逐变体写入同一贡献累加器（乘区级条件在此过滤）
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

/** @desc 展平「生效 Buff → 生效变体」列表（引擎逐变体写入乘区的唯一出口） */
const collectVariants = (buffs: BoundBuff[]): BuffVariant[] => buffs.flatMap((b) => b.variants)

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

/** @desc 生效变体提供的直接贡献乘区（跳过引用/覆盖/零值；乘区级条件不满足者剔除） */
const activeZonesOf = (buffs: BoundBuff[], ctx?: ZoneCtx): { zoneId: string; value: number }[] =>
    collectVariants(buffs).flatMap((v) =>
        v.zones
            .filter((z) => !z.ref && !z.override && z.value !== 0)
            .filter((z) => !ctx || zoneConditionMet(z, ctx))
            .map((z) => ({ zoneId: z.zoneId as string, value: z.value }))
    )

/** @desc 生效变体里带引用标记的乘区（转模：稍后按面板解析；乘区级条件不满足者剔除） */
const refZonesOf = (buffs: BoundBuff[], ctx?: ZoneCtx): { zoneId: string; ref: ZoneRef }[] =>
    collectVariants(buffs).flatMap((v) =>
        v.zones
            .filter((z): z is typeof z & { ref: ZoneRef } => Boolean(z.ref) && !ZONE_NO_REF_IDS.has(z.zoneId))
            .filter((z) => !ctx || zoneConditionMet(z, ctx))
            .map((z) => ({ zoneId: z.zoneId as string, ref: z.ref }))
    )

/** @desc 生效变体里带覆盖标记的乘区（直接覆盖合计值；乘区级条件不满足者剔除） */
const overrideZonesOf = (buffs: BoundBuff[], ctx?: ZoneCtx): { zoneId: string; value: number }[] =>
    collectVariants(buffs).flatMap((v) =>
        v.zones
            .filter((z) => Boolean(z.override) && !z.ref && z.value !== 0)
            .filter((z) => !ctx || zoneConditionMet(z, ctx))
            .map((z) => ({ zoneId: z.zoneId as string, value: z.value }))
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
    const customMult = (stats.customMult !== 0 ? 1 + stats.customMult / 100 : 1) * stats.customFinalDmgMul
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
    const customMultVal = (stats.customMult !== 0 ? 1 + stats.customMult / 100 : 1) * stats.customFinalDmgMul

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
        customMult: 0,
        customFinalDmgMul: 1,
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
    const customMultVal = (stats.customMult !== 0 ? 1 + stats.customMult / 100 : 1) * stats.customFinalDmgMul

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

/** @desc 按「本条目可见面板」解析 ref（转模）：本角色槽位用该条目的 partialStats（仅含绑定到本条目的 buff），
 *  其它角色槽位沿用角色级 full stats（跨角色引用无时间轴粒度）；避免单条目绑定的 buff 泄漏到其它条目的转模 */
function resolveRefsForEntry(
    stats: CharacterComputed,
    partialStats: CharacterComputed,
    refSource: CharacterComputed[],
    charIndex: number,
    boundBuffs: BoundBuff[],
    ctx?: ZoneCtx
): void {
    const entryRefStats = refSource.slice()
    if (charIndex >= 0) entryRefStats[charIndex] = partialStats
    for (const { zoneId, ref } of refZonesOf(boundBuffs, ctx)) {
        const resolved = resolveRefValue(ref, entryRefStats)
        if (resolved === 0) continue
        applyZone(stats, zoneId, resolved)
        recomputeTotals(stats)
    }
}

/** @desc 某角色槽位在其全部条目上绑定过的 Buff 集合（角色级聚合面板用：取并集后按条件过滤） */
function charLevelBoundBuffs(
    charIndex: number,
    charName: string | null,
    damageEntries: DamageEntry[],
    buffSets: BuffInstance[],
    damageEntryBuffSetIds: Record<string, string[]>,
    conditionProfile: ConditionProfile
): BoundBuff[] {
    if (!charName || charIndex < 0) return []
    const boundIds = new Set<string>()
    for (const entry of damageEntries) {
        if (entry.character !== charName) continue
        for (const id of damageEntryBuffSetIds[entry.id] ?? []) boundIds.add(id)
    }
    const ctx: ConditionContext = {
        chains: conditionProfile.chains,
        refinements: conditionProfile.refinements,
        refCharIdx: charIndex
    }
    const out: BoundBuff[] = []
    for (const buff of buffSets) {
        if (!boundIds.has(buff.id)) continue
        if (!scopeMatches(buff, charIndex, false)) continue
        const variants = activeVariants(buff, conditionProfile, charIndex, ctx)
        if (variants.length > 0) out.push({ buff, variants })
    }
    return out
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

    // Phase 1: per-character full stats (echo+weapon + all non-ref buffs from all entries)
    // Used as the data source for ZoneRef resolution
    const charFullStats: CharacterComputed[] = team.map((slot, i) => {
        if (!slot.character || !charInfoMap[slot.character]) return emptyCharacterStats()
        const bound = charLevelBoundBuffs(
            i,
            slot.character,
            damageEntries,
            buffSets,
            damageEntryBuffSetIds,
            conditionProfile
        )
        return computeCharacterStats(
            charInfoMap[slot.character],
            slot.weapon,
            weaponInfoMap[slot.weapon ?? ''] ?? null,
            configState.characters[i]?.echoes ?? [],
            bound
        )
    })

    // Phase 2: per-entry computation with ref resolution as final step
    /** @desc 声骸技能文案索引（伤害类型规则2：声骸技能条目的「视为/为 XX 伤害」） */
    const echoDescByEntry = buildEchoDescByEntry(damageEntries, team, getEchoSkillText())
    return damageEntries.map((entry) => {
        const charName = entry.character
        const charIndex = team.findIndex((s) => s.character === charName)
        const weaponName = charIndex >= 0 ? (team[charIndex]?.weapon ?? null) : null
        const weaponInfo = weaponInfoMap[weaponName ?? ''] ?? null
        const echoes = charIndex >= 0 ? (configState.characters[charIndex]?.echoes ?? []) : []
        const entryBound = boundBuffs(
            entry,
            charIndex,
            buffSets,
            damageEntryBuffSetIds,
            damageEntryDamageTypes,
            conditionProfile,
            charInfoMap,
            echoDescByEntry
        )
        const charInfo = charName ? charInfoMap[charName] : undefined
        const damageTypes = resolveDamageTypes(entry, damageEntryDamageTypes, charInfoMap, echoDescByEntry)
        /** @desc 乘区级条件上下文（伤害段属性/类型 + 链阶档位） */
        const zoneCtx: ZoneCtx = {
            chains: conditionProfile.chains,
            refinements: conditionProfile.refinements,
            element: entry.damageElement,
            damageTypes
        }

        // Compute partial stats (echo+weapon + non-ref buffs only)
        let partialStats: CharacterComputed
        if (charInfo) {
            partialStats = computeCharacterStats(charInfo, weaponName, weaponInfo, echoes, entryBound)
        } else {
            partialStats = emptyCharacterStats()
            for (const z of activeZonesOf(entryBound, zoneCtx)) {
                applyZone(partialStats, z.zoneId, z.value)
            }
            recomputeTotals(partialStats)
        }

        // Resolve ref zones and apply to stats
        const stats = { ...partialStats }
        resolveRefsForEntry(stats, partialStats, charFullStats, charIndex, entryBound, zoneCtx)

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

export function getCharFullStatsForChar(
    charIndex: number,
    echoes: EchoSlotConfig[],
    damageEntries: DamageEntry[],
    buffSets: BuffInstance[],
    damageEntryBuffSetIds: Record<string, string[]>,
    charInfoMap: Record<string, CharacterInfo>,
    team: CharSlot[],
    weaponInfoMap: Record<string, WeaponInfo>,
    conditionProfile: ConditionProfile = DEFAULT_CONDITION_PROFILE
): CharacterComputed {
    const slot = team[charIndex]
    if (!slot?.character || !charInfoMap[slot.character]) return emptyCharacterStats()

    const bound = charLevelBoundBuffs(
        charIndex,
        slot.character,
        damageEntries,
        buffSets,
        damageEntryBuffSetIds,
        conditionProfile
    )

    return computeCharacterStats(
        charInfoMap[slot.character],
        slot.weapon,
        weaponInfoMap[slot.weapon ?? ''] ?? null,
        echoes,
        bound
    )
}

export function computeOneEntry(
    entry: DamageEntry,
    charIndex: number,
    echoes: EchoSlotConfig[],
    fullStats: CharacterComputed[],
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
    const bound = boundBuffs(
        entry,
        charIndex,
        buffSets,
        damageEntryBuffSetIds,
        damageEntryDamageTypes,
        conditionProfile,
        charInfoMap,
        echoDescByEntry
    )

    // 解析条目伤害类型（显式优先，否则自动推导；效应条目推导为「效应伤害」）
    const damageTypes = resolveDamageTypes(entry, damageEntryDamageTypes, charInfoMap, echoDescByEntry)
    /** @desc 乘区级条件上下文 */
    const zoneCtx: ZoneCtx = {
        chains: conditionProfile.chains,
        refinements: conditionProfile.refinements,
        element: entry.damageElement,
        damageTypes
    }

    // partial stats (echo+weapon + non-ref buffs)
    const partialStats = charInfo
        ? computeCharacterStats(charInfo, weaponName, wInfo, echoes, bound, zoneCtx)
        : emptyCharacterStats()

    // resolve ref zones
    const stats = { ...partialStats }
    resolveRefsForEntry(stats, partialStats, fullStats, charIndex, bound, zoneCtx)
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
