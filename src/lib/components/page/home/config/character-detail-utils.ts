import type { CharSlot } from '$lib/types/project'
import type { ConfigState } from '$lib/calc/config.types'
import type { CalcState } from '$lib/calc/calculation.types'
import type { CharacterInfo, WeaponInfo } from '$lib/api/types'
import {
    ELEMENT_BONUS_MAP,
    TYPE_BONUS_MAP,
    WEAPON_SUBSTAT_NAME_MAP,
    SUBSTAT_DECIMAL_TO_PCT
} from '$lib/consts/game-terms'
import { SECOND_MAIN_STAT } from '$lib/consts/stat-data'
import { getConditionProfile } from '$lib/calc/calculation.store.svelte'

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
    // info.element 已是属性中文名（如「冷凝」），与主题变量 --theme-element-* 的键一一对应
    return `var(--theme-element-${info.element})`
}

/** @desc 武器副词条展示文案：攻击%/生命%/防御% 按比值 ×100 并保留两位小数（百分号在数字后），其余类型原样拼接 */
export const formatWeaponSubstat = (substat: { name: string; value: string }): string => {
    const canonicalName = WEAPON_SUBSTAT_NAME_MAP[substat.name] ?? substat.name
    if (!SUBSTAT_DECIMAL_TO_PCT.has(canonicalName)) return `${canonicalName} ${substat.value}`
    const raw = parseFloat(substat.value)
    const pct = raw < 1 ? raw * 100 : raw
    return `${canonicalName.replace('%', '')} ${pct.toFixed(2)}%`
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
    const elementDmg: Record<string, number> = {}
    const typeDmg: Record<string, number> = {}
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
        // 软条件（伤害属性/伤害类型）语义：
        // - 面板数值（攻击/生命/防御/充能/偏谐/双暴等非加成项）：带任何软条件一律不计入面板
        // - bonusDmg（加成）：仅「单一属性条件」或「单一类型条件」时分流计入对应属性/类型加成；
        //   属性与类型条件并存时不进入任何加成；无软条件时计入全伤害加成
        const hasElementCond = Array.isArray(cond?.elements) && cond.elements.length > 0
        const hasTypeCond = Array.isArray(cond?.damageTypes) && cond.damageTypes.length > 0
        const hasSoftCond = hasElementCond || hasTypeCond
        for (const z of bs.zones) {
            const zoneId = z.zoneId
            if (zoneId === 'bonusDmg') {
                if (hasElementCond && hasTypeCond) continue
                if (hasElementCond) {
                    for (const el of cond.elements ?? []) {
                        elementDmg[el] = (elementDmg[el] ?? 0) + z.value
                    }
                } else if (hasTypeCond) {
                    // 与计算引擎同源键（「共鸣解放伤害」→「共鸣解放」），并入声骸/武器副属性的同类型加成
                    for (const dt of cond.damageTypes ?? []) {
                        const key = dt.replace('伤害', '')
                        typeDmg[key] = (typeDmg[key] ?? 0) + z.value
                    }
                } else {
                    bonusDmg += z.value
                }
                continue
            }
            // 非加成面板数值：带任何软条件一律不计入面板
            if (hasSoftCond) continue
            switch (zoneId) {
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
