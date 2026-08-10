import type { CharSlot } from '$lib/data/types'
import type { ConfigState } from './config.types'
import type { CalcState } from '../calculation/calculation.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import {
    ELEMENT_ORDER,
    ELEMENT_BONUS_MAP,
    TYPE_BONUS_MAP,
    ELEMENT_MAP,
    DAMAGE_TYPE_SHORT,
    WEAPON_SUBSTAT_NAME_MAP,
    SUBSTAT_DECIMAL_TO_PCT
} from '$lib/consts/game-terms'
import { SECOND_MAIN_STAT } from '$lib/consts/stat-data'
import { getConditionProfile } from '../calculation/calculation.store.svelte'

export interface CharStats {
    name: string
    weapon: string | null
    atkWhite: number
    atkGreen: number
    atkTotal: number
    hpWhite: number
    hpGreen: number
    hpTotal: number
    defWhite: number
    defGreen: number
    defTotal: number
    tune: number
    recharge: number
    critRate: number
    critDmg: number
    healBonus: number
    elementDmg: Record<string, number>
    typeDmg: Record<string, number>
    bonusDmg: number
}

export function charElementColorOf(name: string, charInfoMap: Record<string, CharacterInfo>): string {
    const info = charInfoMap[name]
    if (!info) return '#71717a'
    const el = (ELEMENT_MAP as Record<string, string>)[info.element] ?? ''
    return el ? `var(--theme-element-${el})` : '#71717a'
}

export function computeCharStats(
    slot: CharSlot,
    idx: number,
    charInfoMap: Record<string, CharacterInfo>,
    weaponInfoMap: Record<string, WeaponInfo>,
    configState: ConfigState | null,
    calcState: CalcState | null
): CharStats | null {
    if (!slot.character || !charInfoMap[slot.character]) return null
    const charInfo = charInfoMap[slot.character]
    const weaponInfo = weaponInfoMap[slot.weapon ?? ''] ?? null
    const echoes = configState?.characters?.[idx]?.echoes ?? []

    const atkWhite = Math.round(charInfo.lv90BaseStats.atk + (weaponInfo?.lv90BaseAtk ?? 0))
    const hpWhite = Math.round(charInfo.lv90BaseStats.hp)
    const defWhite = Math.round(charInfo.lv90BaseStats.def)

    let flatAtk = 0,
        pctAtk = 0
    let flatHp = 0,
        pctHp = 0
    let flatDef = 0,
        pctDef = 0
    let tune = charInfo.lv90BaseStats.tuneBreakBoost
    let recharge = 100
    let critRate = 5
    let critDmg = 150
    let healBonus = 0
    let elementDmg: Record<string, number> = {}
    let typeDmg: Record<string, number> = {}
    let bonusDmg = 0

    function add(type: string, value: number) {
        switch (type) {
            case '攻击':
                flatAtk += value
                break
            case '生命':
                flatHp += value
                break
            case '防御':
                flatDef += value
                break
            case '攻击%':
                pctAtk += value
                break
            case '生命%':
                pctHp += value
                break
            case '防御%':
                pctDef += value
                break
            case '暴击率':
                critRate += value
                break
            case '暴击伤害':
                critDmg += value
                break
            case '共鸣效率':
                recharge += value
                break
            case '治疗加成':
                healBonus += value
                break
            default:
                if (type in ELEMENT_BONUS_MAP) {
                    const el = ELEMENT_BONUS_MAP[type]
                    elementDmg[el] = (elementDmg[el] ?? 0) + value
                } else if (type in TYPE_BONUS_MAP) {
                    const t = TYPE_BONUS_MAP[type]
                    typeDmg[t] = (typeDmg[t] ?? 0) + value
                }
                break
        }
    }

    if (weaponInfo?.substat?.name) {
        const sv = parseFloat(weaponInfo.substat.value)
        const wName = weaponInfo.substat.name
        const canonicalName = WEAPON_SUBSTAT_NAME_MAP[wName] ?? wName
        const canonicalValue = SUBSTAT_DECIMAL_TO_PCT.has(canonicalName) && sv < 1 ? sv * 100 : sv
        add(canonicalName, canonicalValue)
    }

    for (const echo of echoes) {
        if (echo.mainStat) add(echo.mainStat.type, echo.mainStat.value)
        if (echo.secondMainStat) {
            if (echo.secondMainStat.type === '攻击') flatAtk += echo.secondMainStat.value
            else if (echo.secondMainStat.type === '生命') flatHp += echo.secondMainStat.value
        } else {
            const secData = SECOND_MAIN_STAT[echo.cost as keyof typeof SECOND_MAIN_STAT]
            if (secData) {
                if (secData.label === '攻击') flatAtk += secData.value
                else if (secData.label === '生命') flatHp += secData.value
            }
        }
        for (const sub of echo.substats) add(sub.type, sub.value)
    }

    const charGlobalId = `global-${slot.character}`
    // 全局文件夹全部纳入：global-all / 每角色 global-角色名 / 标记 global 的 buff，
    // 按作用域（all 或包含该角色槽位）过滤，与该角色在计算中的生效范围一致
    const globalBuffs = (calcState?.buffSets ?? []).filter((bs) => {
        if (!bs.global && !bs.id.startsWith('global-')) return false
        if (bs.scope === 'all') return true
        return Array.isArray(bs.scope) && bs.scope.includes(idx)
    })
    // 兼容旧工程：无任何全局 buff 时回退到原 global-角色名 匹配
    const fallbackGlobalBuffs = (calcState?.buffSets ?? []).filter((bs) => bs.id === charGlobalId)
    const effectiveGlobalBuffs = globalBuffs.length > 0 ? globalBuffs : fallbackGlobalBuffs
    for (const bs of effectiveGlobalBuffs) {
        // 链/阶门槛：角色共鸣链 / 武器精炼配置不满足则不计入该加成
        const cond = bs.condition
        if (cond && (cond.chain !== undefined || cond.refinement !== undefined)) {
            const refIdx = bs.conditionRefCharIdx ?? idx
            if (cond.chain !== undefined) {
                if (refIdx < 0) continue
                if ((getConditionProfile().chains[refIdx] ?? 0) < cond.chain) continue
            }
            if (cond.refinement !== undefined) {
                if (refIdx < 0) continue
                if ((getConditionProfile().refinements[refIdx] ?? 1) < cond.refinement) continue
            }
        }
        // 条件属性/类型加成：bonusDmg 按 condition 分流到对应元素/类型，否则计入全伤害
        const isElementCond = Array.isArray(cond?.elements) && cond.elements.length > 0
        const isTypeCond = Array.isArray(cond?.damageTypes) && cond.damageTypes.length > 0
        for (const z of bs.zones) {
            switch (z.zoneId) {
                case 'atkFlat':
                    flatAtk += z.value
                    break
                case 'atkPct':
                    pctAtk += z.value
                    break
                case 'hpFlat':
                    flatHp += z.value
                    break
                case 'hpPct':
                    pctHp += z.value
                    break
                case 'defFlat':
                    flatDef += z.value
                    break
                case 'defPct':
                    pctDef += z.value
                    break
                case 'critRate':
                    critRate += z.value
                    break
                case 'critDmg':
                    critDmg += z.value
                    break
                case 'recharge':
                    recharge += z.value
                    break
                case 'tuneBreakBoost':
                    tune += z.value
                    break
                case 'bonusDmg':
                    if (isElementCond) {
                        for (const el of cond.elements ?? []) {
                            elementDmg[el] = (elementDmg[el] ?? 0) + z.value
                        }
                    } else if (isTypeCond) {
                        for (const dt of cond.damageTypes ?? []) {
                            const key = DAMAGE_TYPE_SHORT[dt as keyof typeof DAMAGE_TYPE_SHORT] ?? dt
                            typeDmg[key] = (typeDmg[key] ?? 0) + z.value
                        }
                    } else {
                        bonusDmg += z.value
                    }
                    break
            }
        }
    }

    const atkGreen = Math.round(flatAtk + (atkWhite * pctAtk) / 100)
    const hpGreen = Math.round(flatHp + (hpWhite * pctHp) / 100)
    const defGreen = Math.round(flatDef + (defWhite * pctDef) / 100)

    return {
        name: slot.character,
        weapon: slot.weapon,
        atkWhite,
        atkGreen,
        atkTotal: atkWhite + atkGreen,
        hpWhite,
        hpGreen,
        hpTotal: hpWhite + hpGreen,
        defWhite,
        defGreen,
        defTotal: defWhite + defGreen,
        tune,
        recharge,
        critRate,
        critDmg,
        healBonus,
        elementDmg,
        typeDmg,
        bonusDmg
    }
}
