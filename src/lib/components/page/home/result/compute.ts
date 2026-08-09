import type { DamageEntry, BuffSet, ZoneRef } from '../calculation/calculation.types'
import type { ConfigState, EchoSlotConfig } from '../config/config.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { ResultEntry, MultiplierZone } from './result.types'
import type { CharSlot } from '$lib/data/types'
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

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v))
}

import type { EnemyConfig } from '../config/config.types'

import { inferDamageTypes } from './utils'

function resolveDamageTypes(entry: DamageEntry, damageEntryDamageTypes: Record<string, string[]>): string[] {
    const explicit = damageEntryDamageTypes[entry.id] ?? []
    return explicit.length > 0 ? explicit : inferDamageTypes(entry)
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

// ── zone -> normal stat map ──

function applyZoneToAccum(zoneId: string, value: number, acc: CharAccum) {
    switch (zoneId) {
        case 'atkFlat':
            acc.flatAtk += value
            break
        case 'atkPct':
            acc.pctAtk += value
            break
        case 'hpFlat':
            acc.flatHp += value
            break
        case 'hpPct':
            acc.pctHp += value
            break
        case 'defFlat':
            acc.flatDef += value
            break
        case 'defPct':
            acc.pctDef += value
            break
        case 'critRate':
            acc.critRate += value
            break
        case 'critDmg':
            acc.critDmg += value
            break
        case 'recharge':
            acc.recharge += value
            break
        case 'tuneBreakBoost':
            acc.tuneBreakBoost += value
            break
        case 'offTuneBuildupRate':
            acc.offTuneBuildupRate += value
            break
    }
}

function applyEntryStatToAccum(label: string, value: number, acc: CharAccum) {
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
            acc.flatAtk += value
            break
        case '生命':
            acc.flatHp += value
            break
        case '防御':
            acc.flatDef += value
            break
        case '攻击%':
            acc.pctAtk += value
            break
        case '生命%':
            acc.pctHp += value
            break
        case '防御%':
            acc.pctDef += value
            break
        case '暴击率':
            acc.critRate += value
            break
        case '暴击伤害':
            acc.critDmg += value
            break
        case '共鸣效率':
            acc.recharge += value
            break
        case '治疗加成':
            break // not used in damage formula
    }
}

interface CharAccum {
    flatAtk: number
    pctAtk: number
    flatHp: number
    pctHp: number
    flatDef: number
    pctDef: number
    critRate: number
    critDmg: number
    recharge: number
    tuneBreakBoost: number
    offTuneBuildupRate: number
    elementBonus: Record<string, number>
    typeBonus: Record<string, number>
}

function emptyAccum(): CharAccum {
    return {
        flatAtk: 0,
        pctAtk: 0,
        flatHp: 0,
        pctHp: 0,
        flatDef: 0,
        pctDef: 0,
        critRate: 5,
        critDmg: 150,
        recharge: 100,
        tuneBreakBoost: 0,
        offTuneBuildupRate: 100,
        elementBonus: {},
        typeBonus: {}
    }
}

// ── compute base stat accum from echoes + weapon ──

function accumulateEchoes(
    echoes: EchoSlotConfig[],
    weaponSubstatValue: number,
    weaponSubstatLabel: string | undefined,
    acc: CharAccum
) {
    if (weaponSubstatLabel) {
        applyEntryStatToAccum(weaponSubstatLabel, weaponSubstatValue, acc)
    }
    for (const echo of echoes) {
        if (echo.mainStat) {
            applyEntryStatToAccum(echo.mainStat.type, echo.mainStat.value, acc)
        }
        if (echo.secondMainStat) {
            if (echo.secondMainStat.type === '攻击') acc.flatAtk += echo.secondMainStat.value
            else if (echo.secondMainStat.type === '生命') acc.flatHp += echo.secondMainStat.value
        } else {
            const secData = SECOND_MAIN_STAT[echo.cost as keyof typeof SECOND_MAIN_STAT]
            if (secData) {
                if (secData.label === '攻击') acc.flatAtk += secData.value
                else if (secData.label === '生命') acc.flatHp += secData.value
            }
        }
        for (const sub of echo.substats) {
            applyEntryStatToAccum(sub.type, sub.value, acc)
        }
    }
}

// ── build final character stats (per-entry, includes buffs bound to this entry) ──

interface CharacterComputed {
    baseAtk: number
    baseHp: number
    baseDef: number
    totalAtk: number
    totalHp: number
    totalDef: number
    totalTuneBreakBoost: number
    offTuneBuildupRate: number
    recharge: number
    atkPctSum: number
    atkFlatSum: number
    hpPctSum: number
    hpFlatSum: number
    defPctSum: number
    defFlatSum: number
    critRate: number
    critDmg: number
    // buff multipliers (as percentages, divide by 100 in formula)
    bonusDmg: number
    deepenDmg: number
    resPen: number
    defPen: number
    defDown: number
    resDown: number
    tuneStrainLayer: number
    finalDmg: number
    dmgTakenInc: number
    customMult: number
    dmgRedPen: number
    extraRatio: number
    elementBonus: Record<string, number>
    typeBonus: Record<string, number>
}

export interface ConditionProfile {
    chains: number[]
    refinements: number[]
}

export const DEFAULT_CONDITION_PROFILE: ConditionProfile = { chains: [0, 0, 0], refinements: [1, 1, 1] }

// 生效条件判定：chain/refinement 参考其归属角色（conditionRefCharIdx）的链/精炼，
// 未指定参考角色则回退到当前角色自身判断；charIndex<0（效应/无角色）时条件型 buff 不生效。
// elements/damageTypes 为条目级条件，需结合 entry 判定；无 entry（角色级聚合）时不生效。
// 供计算与「隐藏条件不匹配」过滤共用。
export function conditionMet(
    bs: BuffSet,
    profile: ConditionProfile,
    charIndex: number,
    entry?: DamageEntry,
    damageEntryDamageTypes?: Record<string, string[]>
): boolean {
    const cond = bs.condition
    if (!cond) return true
    const refIdx = bs.conditionRefCharIdx ?? charIndex
    if (cond.chain !== undefined) {
        if (refIdx < 0) return false
        if ((profile.chains[refIdx] ?? 0) < cond.chain) return false
    }
    if (cond.refinement !== undefined) {
        if (refIdx < 0) return false
        if ((profile.refinements[refIdx] ?? 1) < cond.refinement) return false
    }
    if (cond.elements?.length) {
        if (!entry) return false
        if (!cond.elements.includes(entry.damageElement)) return false
    }
    if (cond.damageTypes?.length) {
        if (!entry) return false
        const types = resolveDamageTypes(entry, damageEntryDamageTypes ?? {})
        if (!cond.damageTypes.some((dt) => types.includes(dt))) return false
    }
    return true
}

function getBoundBuffSets(
    entry: DamageEntry,
    charIndex: number,
    buffSets: BuffSet[],
    damageEntryBuffSetIds: Record<string, string[]>,
    damageEntryDamageTypes: Record<string, string[]>,
    profile: ConditionProfile = DEFAULT_CONDITION_PROFILE
): BuffSet[] {
    const boundIds = damageEntryBuffSetIds[entry.id] ?? []
    return buffSets.filter((bs) => {
        if (!boundIds.includes(bs.id)) return false
        if (bs.scope === 'all') return conditionMet(bs, profile, charIndex, entry, damageEntryDamageTypes)
        if (Array.isArray(bs.scope) && bs.scope.length === 0)
            return charIndex < 0 && conditionMet(bs, profile, charIndex, entry, damageEntryDamageTypes)
        return (
            (bs.scope as number[]).includes(charIndex) &&
            conditionMet(bs, profile, charIndex, entry, damageEntryDamageTypes)
        )
    })
}

function computeCharacterStats(
    charInfo: CharacterInfo,
    weaponName: string | null,
    weaponInfo: WeaponInfo | null,
    echoes: EchoSlotConfig[],
    boundBuffSets: BuffSet[]
): CharacterComputed {
    const baseAtk = Math.round(charInfo.lv90BaseStats.atk + (weaponInfo?.lv90BaseAtk ?? 0))
    const baseHp = Math.round(charInfo.lv90BaseStats.hp)
    const baseDef = Math.round(charInfo.lv90BaseStats.def)
    const baseTuneBreakBoost = Math.round(charInfo.lv90BaseStats.tuneBreakBoost)

    const acc = emptyAccum()
    acc.tuneBreakBoost = baseTuneBreakBoost

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

    // buff multipliers (separate from base stat accum)
    let bonusDmg = 0,
        deepenDmg = 0
    let resPen = 0,
        defPen = 0,
        defDown = 0
    let resDown = 0,
        tuneStrainLayer = 0
    let finalDmg = 0,
        dmgTakenInc = 0
    let customMult = 0,
        dmgRedPen = 0,
        extraRatio = 0

    for (const bs of boundBuffSets) {
        for (const z of bs.zones) {
            if (z.ref || z.override) continue
            if (z.value === 0) continue
            const value = z.value
            switch (z.zoneId) {
                case 'bonusDmg':
                    bonusDmg += value
                    break
                case 'deepenDmg':
                    deepenDmg += value
                    break
                case 'resPen':
                    resPen += value
                    break
                case 'defPen':
                    defPen += value
                    break
                case 'defDown':
                    defDown += value
                    break
                case 'resDown':
                    resDown += value
                    break
                case 'tuneStrainLayer':
                    tuneStrainLayer += value
                    break
                case 'finalDmg':
                    finalDmg += value
                    break
                case 'dmgTakenInc':
                    dmgTakenInc += value
                    break
                case 'customFinalDmg':
                    customMult += value
                    break
                case 'dmgRedPen':
                    dmgRedPen += value
                    break
                case 'extraRatio':
                    extraRatio += value
                    break
                default:
                    applyZoneToAccum(z.zoneId, value, acc)
                    break
            }
        }
    }

    const atkGreen = Math.round(acc.flatAtk + (baseAtk * acc.pctAtk) / 100)
    const hpGreen = Math.round(acc.flatHp + (baseHp * acc.pctHp) / 100)
    const defGreen = Math.round(acc.flatDef + (baseDef * acc.pctDef) / 100)
    const totalTuneBreakBoost = Math.round(acc.tuneBreakBoost)

    return {
        baseAtk,
        baseHp,
        baseDef,
        totalAtk: baseAtk + atkGreen,
        totalHp: baseHp + hpGreen,
        totalDef: baseDef + defGreen,
        totalTuneBreakBoost,
        offTuneBuildupRate: acc.offTuneBuildupRate,
        recharge: acc.recharge,
        atkPctSum: acc.pctAtk,
        atkFlatSum: acc.flatAtk,
        hpPctSum: acc.pctHp,
        hpFlatSum: acc.flatHp,
        defPctSum: acc.pctDef,
        defFlatSum: acc.flatDef,
        critRate: acc.critRate,
        critDmg: acc.critDmg,
        bonusDmg,
        deepenDmg,
        resPen,
        defPen,
        defDown,
        resDown,
        tuneStrainLayer,
        finalDmg,
        dmgTakenInc,
        customMult,
        dmgRedPen,
        extraRatio,
        elementBonus: acc.elementBonus,
        typeBonus: acc.typeBonus
    }
}

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
    const customMult = stats.customMult !== 0 ? 1 + stats.customMult / 100 : 1
    const tuneStrainMulti = 1 + 0.0012 * stats.totalTuneBreakBoost * stats.tuneStrainLayer

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
        { label: '终伤区', value: finalDmg, detail: `(1 + ${stats.finalDmg.toFixed(1)}%)` },
        { label: '特殊乘区', value: customMult, detail: customMult.toFixed(4) }
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
        customMult,
        vulnerability: stats.dmgTakenInc / 100,
        rawPerHit: Math.round(
            baseValue * deepen * bonus * resMulti * dmgRedMulti * defMulti * tuneStrainMulti * finalDmg * customMult
        ),
        expectedPerHit,
        totalDamage: expectedPerHit,
        totalDamageRaw: expectedRaw,
        nonCritPerHit,
        critPerHit,
        canCrit: entry.damageBaseType !== '偏谐系数',
        multiplierZones: multZones,
        damageTypes
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
    const customMultVal = stats.customMult !== 0 ? 1 + stats.customMult / 100 : 1

    // vulnerability zone (易伤区)
    const vulnerability = 1 + stats.dmgTakenInc / 100

    const totalPerHit =
        baseValue *
        vulnerability *
        defMulti *
        resMulti *
        dmgRedMulti *
        tuneBreakZone *
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
        { label: '特殊乘区', value: customMultVal, detail: customMultVal.toFixed(4) }
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
        finalDmg: 0,
        dmgTakenInc: 0,
        customMult: 0,
        dmgRedPen: 0,
        elementBonus: {},
        typeBonus: {}
    }
}

// ── effect damage ──

function computeEffectEntry(entry: DamageEntry, stats: CharacterComputed, enemy: ConfigState['enemy']): ResultEntry {
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

    /** @desc 终伤区 & 特殊乘区：1 + 终伤%；自定义倍率（≠0 才生效） */
    const finalDmgDec = stats.finalDmg / 100
    const customMultVal = stats.customMult !== 0 ? 1 + stats.customMult / 100 : 1

    /** @desc ── 汇总：基础值 × 各乘区乘积 = 单段期望伤害（无易伤区，效应伤害不吃易伤）── */
    const totalPerHit = baseValue * defMulti * resMulti * dmgRedMulti * deepen * (1 + finalDmgDec) * customMultVal
    const expectedPerHit = Math.round(totalPerHit)

    /** @desc 乘区明细（供结果页展示乘区分解） */
    const multZones: MultiplierZone[] = [
        { label: '加深区', value: deepen, detail: `(1 + ${stats.deepenDmg.toFixed(1)}%)` },
        { label: '抗性区', value: resMulti, detail: resMulti.toFixed(4) },
        { label: '免伤区', value: dmgRedMulti, detail: dmgRedMulti.toFixed(4) },
        { label: '防御区', value: defMulti, detail: defMulti.toFixed(4) },
        { label: '终伤区', value: 1 + finalDmgDec, detail: `(1 + ${stats.finalDmg.toFixed(1)}%)` },
        { label: '特殊乘区', value: customMultVal, detail: customMultVal.toFixed(4) }
    ]

    /** @desc
     * ── 输出 ResultEntry：效应伤害不能暴击（canCrit: false）、无伤害类型（damageTypes: []）、
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
            effectiveRatio * defMulti * resMulti * dmgRedMulti * deepen * (1 + finalDmgDec) * customMultVal,
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
        deepen: stats.deepenDmg,
        critRate: 0,
        critDmg: 0,
        defMulti,
        resMulti,
        dmgRedMulti,
        finalDmg: finalDmgDec,
        finalTuneStrainMulti: 0,
        finalTuneBreakZone: 0,
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
        damageTypes: []
    }
}

// ── apply resolved ref value to stats (after partial stats are computed) ──

function applyRefToStats(stats: CharacterComputed, zoneId: string, value: number): void {
    switch (zoneId) {
        case 'bonusDmg':
            stats.bonusDmg += value
            break
        case 'deepenDmg':
            stats.deepenDmg += value
            break
        case 'resPen':
            stats.resPen += value
            break
        case 'defPen':
            stats.defPen += value
            break
        case 'defDown':
            stats.defDown += value
            break
        case 'resDown':
            stats.resDown += value
            break
        case 'tuneStrainLayer':
            stats.tuneStrainLayer += value
            break
        case 'finalDmg':
            stats.finalDmg += value
            break
        case 'dmgTakenInc':
            stats.dmgTakenInc += value
            break
        case 'customFinalDmg':
            stats.customMult += value
            break
        case 'dmgRedPen':
            stats.dmgRedPen += value
            break
        case 'extraRatio':
            stats.extraRatio += value
            break
        case 'atkFlat':
            stats.atkFlatSum += value
            break
        case 'atkPct':
            stats.atkPctSum += value
            break
        case 'hpFlat':
            stats.hpFlatSum += value
            break
        case 'hpPct':
            stats.hpPctSum += value
            break
        case 'defFlat':
            stats.defFlatSum += value
            break
        case 'defPct':
            stats.defPctSum += value
            break
        case 'critRate':
            stats.critRate += value
            break
        case 'critDmg':
            stats.critDmg += value
            break
        case 'recharge':
            stats.recharge += value
            break
        case 'tuneBreakBoost':
            stats.totalTuneBreakBoost += value
            break
        case 'offTuneBuildupRate':
            stats.offTuneBuildupRate += value
            break
    }
    stats.totalAtk = stats.baseAtk + Math.round(stats.atkFlatSum + (stats.baseAtk * stats.atkPctSum) / 100)
    stats.totalHp = stats.baseHp + Math.round(stats.hpFlatSum + (stats.baseHp * stats.hpPctSum) / 100)
    stats.totalDef = stats.baseDef + Math.round(stats.defFlatSum + (stats.baseDef * stats.defPctSum) / 100)
}

function applyOverrideToStats(stats: CharacterComputed, zoneId: string, value: number): void {
    switch (zoneId) {
        case 'bonusDmg':
            stats.bonusDmg = value
            break
        case 'deepenDmg':
            stats.deepenDmg = value
            break
        case 'resPen':
            stats.resPen = value
            break
        case 'defPen':
            stats.defPen = value
            break
        case 'defDown':
            stats.defDown = value
            break
        case 'resDown':
            stats.resDown = value
            break
        case 'tuneStrainLayer':
            stats.tuneStrainLayer = value
            break
        case 'finalDmg':
            stats.finalDmg = value
            break
        case 'dmgTakenInc':
            stats.dmgTakenInc = value
            break
        case 'customFinalDmg':
            stats.customMult = value
            break
        case 'dmgRedPen':
            stats.dmgRedPen = value
            break
        case 'atkFlat':
            stats.totalAtk = value
            break
        case 'hpFlat':
            stats.totalHp = value
            break
        case 'defFlat':
            stats.totalDef = value
            break
        case 'critRate':
            stats.critRate = value
            break
        case 'critDmg':
            stats.critDmg = value
            break
        case 'recharge':
            stats.recharge = value
            break
        case 'tuneBreakBoost':
            stats.totalTuneBreakBoost = value
            break
        case 'offTuneBuildupRate':
            stats.offTuneBuildupRate = value
            break
    }
}

// ── main entry point ──

export function computeAll(
    damageEntries: DamageEntry[],
    buffSets: BuffSet[],
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

        const charBuffSetIds = new Set<string>()
        for (const entry of damageEntries) {
            if (entry.character !== slot.character) continue
            const boundIds = damageEntryBuffSetIds[entry.id] ?? []
            for (const id of boundIds) charBuffSetIds.add(id)
        }

        const charBoundBuffSets = buffSets.filter((bs) => {
            if (!charBuffSetIds.has(bs.id)) return false
            if (bs.scope === 'all') return conditionMet(bs, conditionProfile, i)
            return (bs.scope as number[]).includes(i) && conditionMet(bs, conditionProfile, i)
        })

        return computeCharacterStats(
            charInfoMap[slot.character],
            slot.weapon,
            weaponInfoMap[slot.weapon ?? ''] ?? null,
            configState.characters[i]?.echoes ?? [],
            charBoundBuffSets
        )
    })

    // Phase 2: per-entry computation with ref resolution as final step
    return damageEntries.map((entry) => {
        const charName = entry.character
        const charIndex = team.findIndex((s) => s.character === charName)
        const weaponName = charIndex >= 0 ? (team[charIndex]?.weapon ?? null) : null
        const weaponInfo = weaponInfoMap[weaponName ?? ''] ?? null
        const echoes = charIndex >= 0 ? (configState.characters[charIndex]?.echoes ?? []) : []
        const boundBuffSets = getBoundBuffSets(
            entry,
            charIndex,
            buffSets,
            damageEntryBuffSetIds,
            damageEntryDamageTypes,
            conditionProfile
        )
        const charInfo = charName ? charInfoMap[charName] : undefined

        // Compute partial stats (echo+weapon + non-ref buffs only)
        let partialStats: CharacterComputed
        if (charInfo) {
            partialStats = computeCharacterStats(charInfo, weaponName, weaponInfo, echoes, boundBuffSets)
        } else {
            partialStats = emptyCharacterStats()
            for (const bs of boundBuffSets) {
                for (const z of bs.zones) {
                    if (z.ref || z.override || z.value === 0) continue
                    applyRefToStats(partialStats, z.zoneId, z.value)
                }
            }
        }

        // Resolve ref zones and apply to stats
        const stats = { ...partialStats }
        for (const bs of boundBuffSets) {
            for (const z of bs.zones) {
                if (!z.ref) continue
                const resolved = resolveRefValue(z.ref, charFullStats)
                if (resolved === 0) continue
                applyRefToStats(stats, z.zoneId, resolved)
            }
        }

        // Apply override zones (set value directly, takes precedence over everything)
        for (const bs of boundBuffSets) {
            for (const z of bs.zones) {
                if (!z.override || z.value === 0 || z.ref) continue
                applyOverrideToStats(stats, z.zoneId, z.value)
            }
        }

        // effect damage
        if (entry.isEffect) {
            return computeEffectEntry(entry, stats, enemy)
        }
        if (!charName || !charInfo || charIndex < 0) return makeStubEntry(entry)

        // tune damage (处决/响应) + 偏谐系数直伤按响应公式计算
        if (entry.isTuneBreak || entry.isTuneResponse || entry.damageBaseType === '偏谐系数') {
            return computeTuneEntry(entry, stats, enemy)
        }

        // direct damage
        const damageTypes = resolveDamageTypes(entry, damageEntryDamageTypes)
        return computeResultEntry(entry, stats, enemy, damageTypes)
    })
}

export function getCharFullStatsForChar(
    charIndex: number,
    echoes: EchoSlotConfig[],
    damageEntries: DamageEntry[],
    buffSets: BuffSet[],
    damageEntryBuffSetIds: Record<string, string[]>,
    charInfoMap: Record<string, CharacterInfo>,
    team: CharSlot[],
    weaponInfoMap: Record<string, WeaponInfo>,
    conditionProfile: ConditionProfile = DEFAULT_CONDITION_PROFILE
): CharacterComputed {
    const slot = team[charIndex]
    if (!slot?.character || !charInfoMap[slot.character]) return emptyCharacterStats()

    const charBuffSetIds = new Set<string>()
    for (const entry of damageEntries) {
        if (entry.character !== slot.character) continue
        const boundIds = damageEntryBuffSetIds[entry.id] ?? []
        for (const id of boundIds) charBuffSetIds.add(id)
    }

    const charBoundBuffSets = buffSets.filter((bs) => {
        if (!charBuffSetIds.has(bs.id)) return false
        if (bs.scope === 'all') return conditionMet(bs, conditionProfile, charIndex)
        return (bs.scope as number[]).includes(charIndex) && conditionMet(bs, conditionProfile, charIndex)
    })

    return computeCharacterStats(
        charInfoMap[slot.character],
        slot.weapon,
        weaponInfoMap[slot.weapon ?? ''] ?? null,
        echoes,
        charBoundBuffSets
    )
}

export function computeOneEntry(
    entry: DamageEntry,
    charIndex: number,
    echoes: EchoSlotConfig[],
    fullStats: CharacterComputed[],
    buffSets: BuffSet[],
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
    const boundBuffSets = getBoundBuffSets(
        entry,
        charIndex,
        buffSets,
        damageEntryBuffSetIds,
        damageEntryDamageTypes,
        conditionProfile
    )

    // partial stats (echo+weapon + non-ref buffs)
    const partialStats = charInfo
        ? computeCharacterStats(charInfo, weaponName, wInfo, echoes, boundBuffSets)
        : emptyCharacterStats()

    // resolve ref zones
    const stats = { ...partialStats }
    for (const bs of boundBuffSets) {
        for (const z of bs.zones) {
            if (!z.ref) continue
            const resolved = resolveRefValue(z.ref, fullStats)
            if (resolved === 0) continue
            applyRefToStats(stats, z.zoneId, resolved)
        }
    }

    if (entry.isEffect) {
        return computeEffectEntry(entry, stats, enemy)
    }
    if (!charName || !charInfo || charIndex < 0) return makeStubEntry(entry)
    if (entry.isTuneBreak || entry.isTuneResponse || entry.damageBaseType === '偏谐系数') {
        return computeTuneEntry(entry, stats, enemy)
    }
    const damageTypes = resolveDamageTypes(entry, damageEntryDamageTypes)
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
