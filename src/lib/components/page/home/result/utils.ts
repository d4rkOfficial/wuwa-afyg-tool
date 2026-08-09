import type { ResultEntry } from './result.types'
import type { DamageEntry } from '../calculation/calculation.types'

/** @desc 自动推导伤害类型：效应条目（isEffect）→「效应伤害」；其余按技能类型推断，常态攻击再按招式名分普攻/重击 */
export function inferDamageTypes(entry: DamageEntry): string[] {
    // 效应结算条目自动推导为「效应伤害」
    if (entry.isEffect) return ['效应伤害']
    switch (entry.skillType) {
        case '常态攻击':
            return entry.hitName.includes('重击') ? ['重击伤害'] : ['普攻伤害']
        case '共鸣技能':
            return ['共鸣技能伤害']
        case '共鸣解放':
            return ['共鸣解放伤害']
        case '声骸技能':
            return ['声骸技能伤害']
        case '变奏技能':
            return ['变奏技能伤害']
        case '延奏技能':
            return ['延奏技能伤害']
        default:
            // 无法推导的类型统一归为「其它类型伤害」
            return ['其它类型伤害']
    }
}

export const DAMAGE_TYPE_CATEGORIES = [
    '普攻',
    '重击',
    '共鸣技能',
    '共鸣解放',
    '变奏技能',
    '延奏技能',
    '声骸技能',
    '其它'
] as const

export type DamageTypeCategory = (typeof DAMAGE_TYPE_CATEGORIES)[number]

export const TYPE_COLORS: Record<DamageTypeCategory, string> = {
    普攻: '#8b95c9',
    重击: '#a48bc9',
    共鸣技能: '#7ba4d4',
    共鸣解放: '#d18a8a',
    变奏技能: '#86b8a0',
    延奏技能: '#7fb0ac',
    声骸技能: '#cd93b8',
    其它: '#9aa3ad'
}

const FULL_TO_CATEGORY: Record<string, DamageTypeCategory> = {
    普攻伤害: '普攻',
    重击伤害: '重击',
    共鸣技能伤害: '共鸣技能',
    共鸣解放伤害: '共鸣解放',
    变奏技能伤害: '变奏技能',
    延奏技能伤害: '延奏技能',
    声骸技能伤害: '声骸技能'
}

export interface DirectDamageByType {
    character: string
    total: number
    byType: Record<DamageTypeCategory, number>
}

export function aggregateDirectDamageByType(entries: ResultEntry[]): DirectDamageByType[] {
    const result: DirectDamageByType[] = []
    const indexMap = new Map<string, number>()

    for (const e of entries) {
        if (e.damageTypes.length === 0) continue
        let idx = indexMap.get(e.character)
        if (idx === undefined) {
            idx = result.length
            indexMap.set(e.character, idx)
            result.push({
                character: e.character,
                total: 0,
                byType: Object.fromEntries(DAMAGE_TYPE_CATEGORIES.map((c) => [c, 0])) as Record<
                    DamageTypeCategory,
                    number
                >
            })
        }
        const agg = result[idx]
        const share = e.totalDamage / e.damageTypes.length
        for (const dt of e.damageTypes) {
            agg.byType[FULL_TO_CATEGORY[dt] ?? '其它'] += share
        }
        agg.total += e.totalDamage
    }

    return result
}
