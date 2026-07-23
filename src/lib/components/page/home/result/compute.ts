import type { DamageEntry, BuffSet, ZoneRef } from '../calculation/calculation.types'
import type { ConfigState, EchoSlotConfig } from '../config/config.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import type { ResultEntry } from './result.types'
import type { CharSlot } from '$lib/data/types'
import { getEffectMultiplier, getEffectBurstMultiplier, EFFECT_BASE_VALUE } from '$lib/consts/effect-data'
import { NON_DIRECT_ELEMENT } from '../timeline/timeline.consts'

// ── helpers ──

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v))
}

const REF_STAT_MAP: Record<string, keyof CharacterComputed> = {
    base_atk: 'baseAtk',
    total_atk: 'totalAtk',
    base_hp: 'baseHp',
    total_hp: 'totalHp',
    base_def: 'baseDef',
    total_def: 'totalDef',
    recharge: 'recharge',
    harmony_dmg: 'totalTune',
    crit_rate: 'critRate',
    crit_dmg: 'critDmg'
}

function resolveRefValue(ref: ZoneRef, allCharStats: CharacterComputed[]): number {
    const stats = allCharStats[ref.characterIdx]
    if (!stats) return 0
    const key = REF_STAT_MAP[ref.zoneId]
    if (!key) return 0
    const statValue = stats[key] as number
    let value = ((statValue - ref.threshold) * ref.pct) / 100
    if (ref.lower !== undefined) value = Math.max(ref.lower, value)
    if (ref.upper !== undefined) value = Math.min(ref.upper, value)
    return value
}

const ELEMENT_BONUS_MAP: Record<string, string> = {
    冷凝伤害加成: '冷凝',
    热熔伤害加成: '热熔',
    导电伤害加成: '导电',
    气动伤害加成: '气动',
    衍射伤害加成: '衍射',
    湮灭伤害加成: '湮灭'
}

const TYPE_BONUS_MAP: Record<string, string> = {
    普攻伤害加成: '普攻',
    重击伤害加成: '重击',
    共鸣技能伤害加成: '共鸣技能',
    共鸣解放伤害加成: '共鸣解放'
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
        case 'atk_flat':
            acc.flatAtk += value
            break
        case 'atk_pct':
            acc.pctAtk += value
            break
        case 'hp_flat':
            acc.flatHp += value
            break
        case 'hp_pct':
            acc.pctHp += value
            break
        case 'def_flat':
            acc.flatDef += value
            break
        case 'def_pct':
            acc.pctDef += value
            break
        case 'crit_rate':
            acc.critRate += value
            break
        case 'crit_dmg':
            acc.critDmg += value
            break
        case 'recharge':
            acc.recharge += value
            break
        case 'harmony_dmg':
            acc.tune += value
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
    tune: number
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
        tune: 0,
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
    totalTune: number
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
    tuneStrain: number
    finalDmg: number
    dmgTakenInc: number
    customMult: number
    dmgRedPen: number
    elementBonus: Record<string, number>
    typeBonus: Record<string, number>
}

function getBoundBuffSets(
    entryId: string,
    charIndex: number,
    buffSets: BuffSet[],
    damageEntryBuffSetIds: Record<string, string[]>
): BuffSet[] {
    const boundIds = damageEntryBuffSetIds[entryId] ?? []
    return buffSets.filter((bs) => {
        if (!boundIds.includes(bs.id)) return false
        if (bs.scope === 'all') return true
        return (bs.scope as number[]).includes(charIndex)
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
    const baseTune = Math.round(charInfo.lv90BaseStats.tune)

    const acc = emptyAccum()
    acc.tune = baseTune

    const wSubValue = weaponInfo?.substat ? parseFloat(weaponInfo.substat.value) : 0
    accumulateEchoes(echoes, wSubValue, weaponInfo?.substat?.name, acc)

    // buff multipliers (separate from base stat accum)
    let bonusDmg = 0,
        deepenDmg = 0
    let resPen = 0,
        defPen = 0,
        defDown = 0
    let resDown = 0,
        tuneStrain = 0
    let finalDmg = 0,
        dmgTakenInc = 0
    let customMult = 0,
        dmgRedPen = 0

    for (const bs of boundBuffSets) {
        for (const z of bs.zones) {
            if (z.ref) continue
            if (z.value === 0) continue
            const value = z.value
            switch (z.zoneId) {
                case 'bonus_dmg':
                    bonusDmg += value
                    break
                case 'deepen_dmg':
                    deepenDmg += value
                    break
                case 'res_pen':
                    resPen += value
                    break
                case 'def_pen':
                    defPen += value
                    break
                case 'def_down':
                    defDown += value
                    break
                case 'res_down':
                    resDown += value
                    break
                case 'tune_strain':
                    tuneStrain += value
                    break
                case 'final_dmg':
                    finalDmg += value
                    break
                case 'dmg_taken_inc':
                    dmgTakenInc += value
                    break
                case 'custom_final_dmg':
                    customMult += value
                    break
                case 'dmg_red_pen':
                    dmgRedPen += value
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
    const totalTune = Math.round(acc.tune)

    return {
        baseAtk,
        baseHp,
        baseDef,
        totalAtk: baseAtk + atkGreen,
        totalHp: baseHp + hpGreen,
        totalDef: baseDef + defGreen,
        totalTune,
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
        tuneStrain,
        finalDmg,
        dmgTakenInc,
        customMult,
        dmgRedPen,
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
        baseValue = totalStat * ratioNum
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
    const harmonyMulti = 1 + 0.0012 * stats.totalTune * stats.tuneStrain

    // crit (cap at 100%)
    const critDecimal = Math.min(stats.critRate, 100) / 100
    const critDmgDecimal = stats.critDmg / 100
    const critAvg = 1 + critDecimal * critDmgDecimal

    // defense zone
    const defFactor = 792 + enemy.level * 8
    const defMulti = enemy.defense / (defFactor * (1 - stats.defPen / 100) * (1 - stats.defDown / 100) + enemy.defense)

    // resistance zone
    const baseResist = (enemy.resistances[entry.damageElement] ?? 0) / 100
    let combinedResist = (1 - baseResist) * (1 - stats.resPen / 100) + stats.resDown / 100
    if (combinedResist > 1) {
        combinedResist = 1 + (combinedResist - 1) / 2
    }
    const resMulti = combinedResist

    // damage reduction zone
    const dmgRedMulti = 1 - enemy.dmgReduction / 100 - stats.dmgRedPen / 100

    // total multiplier (for display)
    const totalMultiplier =
        ratioNum *
        bonus *
        deepen *
        vulnerability *
        harmonyMulti *
        finalDmg *
        customMult *
        defMulti *
        resMulti *
        dmgRedMulti *
        critAvg

    const expectedPerHit = Math.round(
        baseValue *
            deepen *
            bonus *
            critAvg *
            vulnerability *
            resMulti *
            dmgRedMulti *
            defMulti *
            harmonyMulti *
            finalDmg *
            customMult
    )

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
        baseAtk: stats.baseAtk,
        totalAtk: stats.totalAtk,
        atkPctSum: stats.atkPctSum,
        atkFlatSum: stats.atkFlatSum,
        totalHp: stats.totalHp,
        hpPctSum: stats.hpPctSum,
        hpFlatSum: stats.hpFlatSum,
        totalDef: stats.totalDef,
        defPctSum: stats.defPctSum,
        defFlatSum: stats.defFlatSum,
        totalTune: stats.totalTune,
        dmgBonus: totalDmgBonus / 100,
        deepen: stats.deepenDmg / 100,
        critRate: critDecimal,
        critDmg: critDmgDecimal,
        defMulti,
        resMulti,
        dmgRedMulti,
        finalDmg: stats.finalDmg / 100,
        finalHarmony: stats.tuneStrain > 0 ? harmonyMulti - 1 : 0,
        customMult,
        vulnerability: stats.dmgTakenInc / 100,
        rawPerHit: Math.round(
            baseValue * deepen * bonus * resMulti * dmgRedMulti * defMulti * harmonyMulti * finalDmg * customMult
        ),
        expectedPerHit: Math.round(expectedPerHit),
        totalDamage: Math.round(expectedPerHit)
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
        totalHp: 0,
        hpPctSum: 0,
        hpFlatSum: 0,
        totalDef: 0,
        defPctSum: 0,
        defFlatSum: 0,
        totalTune: 0,
        dmgBonus: 0,
        deepen: 0,
        critRate: 0,
        critDmg: 0,
        defMulti: 0,
        resMulti: 0,
        dmgRedMulti: 0,
        finalDmg: 0,
        finalHarmony: 0,
        customMult: 1,
        vulnerability: 0,
        rawPerHit: 0,
        expectedPerHit: 0,
        totalDamage: 0
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
    const tuneCoeff = TUNE_COEFF_MAP[enemy.type] ?? 716.2
    const baseUnit = TUNE_BASE_UNIT
    const baseValue = tuneCoeff * ratioNum

    // harmony zone: 1 + tuneStat / 100
    const harmonyZone = 1 + stats.totalTune / 100

    // defense zone (same as direct damage)
    const defFactor = 792 + enemy.level * 8
    const defMulti = enemy.defense / (defFactor * (1 - stats.defPen / 100) * (1 - stats.defDown / 100) + enemy.defense)

    // resistance zone (element from entry)
    const baseResist = (enemy.resistances[entry.damageElement] ?? 0) / 100
    let combinedResist = (1 - baseResist) * (1 - stats.resPen / 100) + stats.resDown / 100
    if (combinedResist > 1) {
        combinedResist = 1 + (combinedResist - 1) / 2
    }
    const resMulti = combinedResist

    // damage reduction zone
    const dmgRedMulti = 1 - enemy.dmgReduction / 100 - stats.dmgRedPen / 100

    // final dmg & custom mult
    const finalDmgDec = stats.finalDmg / 100
    const customMultVal = stats.customMult !== 0 ? 1 + stats.customMult / 100 : 1

    const totalPerHit = baseValue * defMulti * resMulti * dmgRedMulti * harmonyZone * (1 + finalDmgDec) * customMultVal
    const expectedPerHit = Math.round(totalPerHit)

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
        totalMultiplier: ratioNum * defMulti * resMulti * dmgRedMulti * harmonyZone * (1 + finalDmgDec) * customMultVal,
        baseAtk: tuneCoeff,
        totalAtk: 0,
        atkPctSum: 0,
        atkFlatSum: 0,
        totalHp: 0,
        hpPctSum: 0,
        hpFlatSum: 0,
        totalDef: 0,
        defPctSum: 0,
        defFlatSum: 0,
        totalTune: stats.totalTune,
        dmgBonus: 0,
        deepen: 0,
        critRate: 0,
        critDmg: 0,
        defMulti,
        resMulti,
        dmgRedMulti,
        finalDmg: finalDmgDec,
        finalHarmony: harmonyZone - 1,
        customMult: customMultVal,
        vulnerability: 0,
        rawPerHit: expectedPerHit,
        expectedPerHit,
        totalDamage: expectedPerHit
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
        totalTune: 0,
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
        tuneStrain: 0,
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
    const layers = Math.round(entry.ratioValue)
    const burstLayers = entry.burstLayers ?? 0
    const effectMult = getEffectMultiplier(entry.hitName, layers)
    const burstMult = getEffectBurstMultiplier(entry.hitName, burstLayers)
    const multiplier = effectMult + burstMult
    const ratioNum = multiplier
    const element = (NON_DIRECT_ELEMENT as Record<string, string>)[entry.hitName] ?? ''

    const baseUnit = '效应系数'
    const baseValue = Math.round(EFFECT_BASE_VALUE * ratioNum)

    // defense zone
    const defFactor = 792 + enemy.level * 8
    const defMulti = enemy.defense / (defFactor * (1 - stats.defPen / 100) * (1 - stats.defDown / 100) + enemy.defense)

    // resistance zone
    const baseResist = (enemy.resistances[element] ?? 0) / 100
    let combinedResist = (1 - baseResist) * (1 - stats.resPen / 100) + stats.resDown / 100
    if (combinedResist > 1) combinedResist = 1 + (combinedResist - 1) / 2
    const resMulti = combinedResist

    // damage reduction zone
    const dmgRedMulti = 1 - enemy.dmgReduction / 100 - stats.dmgRedPen / 100

    // final dmg & custom mult
    const finalDmgDec = stats.finalDmg / 100
    const customMultVal = stats.customMult !== 0 ? 1 + stats.customMult / 100 : 1

    const totalPerHit = baseValue * defMulti * resMulti * dmgRedMulti * (1 + finalDmgDec) * customMultVal
    const expectedPerHit = Math.round(totalPerHit)

    return {
        id: entry.id,
        character: entry.character ?? '',
        hitName: entry.hitName,
        skillType: entry.skillType ?? '',
        displayName: entry.displayName,
        element,
        ratioNum,
        hits: entry.hits,
        sourceTimelineBlockId: entry.sourceTimelineBlockId,
        baseValue,
        baseUnit,
        totalMultiplier: ratioNum * defMulti * resMulti * dmgRedMulti * (1 + finalDmgDec) * customMultVal,
        baseAtk: EFFECT_BASE_VALUE,
        totalAtk: 0,
        atkPctSum: 0,
        atkFlatSum: 0,
        totalHp: 0,
        hpPctSum: 0,
        hpFlatSum: 0,
        totalDef: 0,
        defPctSum: 0,
        defFlatSum: 0,
        totalTune: stats.totalTune,
        dmgBonus: 0,
        deepen: 0,
        critRate: 0,
        critDmg: 0,
        defMulti,
        resMulti,
        dmgRedMulti,
        finalDmg: finalDmgDec,
        finalHarmony: 0,
        customMult: customMultVal,
        vulnerability: 0,
        rawPerHit: expectedPerHit,
        expectedPerHit,
        totalDamage: expectedPerHit
    }
}

// ── apply resolved ref value to stats (after partial stats are computed) ──

function applyRefToStats(stats: CharacterComputed, zoneId: string, value: number): void {
    switch (zoneId) {
        case 'bonus_dmg':
            stats.bonusDmg += value
            break
        case 'deepen_dmg':
            stats.deepenDmg += value
            break
        case 'res_pen':
            stats.resPen += value
            break
        case 'def_pen':
            stats.defPen += value
            break
        case 'def_down':
            stats.defDown += value
            break
        case 'res_down':
            stats.resDown += value
            break
        case 'tune_strain':
            stats.tuneStrain += value
            break
        case 'final_dmg':
            stats.finalDmg += value
            break
        case 'dmg_taken_inc':
            stats.dmgTakenInc += value
            break
        case 'custom_final_dmg':
            stats.customMult += value
            break
        case 'dmg_red_pen':
            stats.dmgRedPen += value
            break
        case 'atk_flat':
            stats.atkFlatSum += value
            break
        case 'atk_pct':
            stats.atkPctSum += value
            break
        case 'hp_flat':
            stats.hpFlatSum += value
            break
        case 'hp_pct':
            stats.hpPctSum += value
            break
        case 'def_flat':
            stats.defFlatSum += value
            break
        case 'def_pct':
            stats.defPctSum += value
            break
        case 'crit_rate':
            stats.critRate += value
            break
        case 'crit_dmg':
            stats.critDmg += value
            break
        case 'recharge':
            stats.recharge += value
            break
        case 'harmony_dmg':
            stats.totalTune += value
            break
    }
    stats.totalAtk = stats.baseAtk + Math.round(stats.atkFlatSum + (stats.baseAtk * stats.atkPctSum) / 100)
    stats.totalHp = stats.baseHp + Math.round(stats.hpFlatSum + (stats.baseHp * stats.hpPctSum) / 100)
    stats.totalDef = stats.baseDef + Math.round(stats.defFlatSum + (stats.baseDef * stats.defPctSum) / 100)
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
    weaponInfoMap: Record<string, WeaponInfo>
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
            if (bs.scope === 'all') return true
            return (bs.scope as number[]).includes(i)
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
        const boundBuffSets =
            charIndex >= 0 ? getBoundBuffSets(entry.id, charIndex, buffSets, damageEntryBuffSetIds) : []
        const charInfo = charName ? charInfoMap[charName] : undefined

        // Compute partial stats (echo+weapon + non-ref buffs only)
        const partialStats = charInfo
            ? computeCharacterStats(charInfo, weaponName, weaponInfo, echoes, boundBuffSets)
            : emptyCharacterStats()

        // Resolve ref zones and apply to stats (final step)
        const stats = { ...partialStats }
        for (const bs of boundBuffSets) {
            for (const z of bs.zones) {
                if (!z.ref) continue
                const resolved = resolveRefValue(z.ref, charFullStats)
                if (resolved === 0) continue
                applyRefToStats(stats, z.zoneId, resolved)
            }
        }

        // effect damage
        if (entry.isEffect) {
            return computeEffectEntry(entry, stats, enemy)
        }
        if (!charName || !charInfo || charIndex < 0) return makeStubEntry(entry)

        // tune damage (处决/响应)
        if (entry.isTuneBreak || entry.isTuneResponse) {
            return computeTuneEntry(entry, stats, enemy)
        }

        // direct damage
        const damageTypes = damageEntryDamageTypes[entry.id] ?? []
        return computeResultEntry(entry, stats, enemy, damageTypes)
    })
}
