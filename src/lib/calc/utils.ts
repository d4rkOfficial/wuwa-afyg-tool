import type { ResultEntry } from './result.types'
import type { DamageEntry } from './calculation.types'

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
    '协同',
    '效应',
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
    协同: '#e0a458',
    效应: '#c978e0',
    其它: '#9aa3ad'
}

const FULL_TO_CATEGORY: Record<string, DamageTypeCategory> = {
    普攻伤害: '普攻',
    重击伤害: '重击',
    共鸣技能伤害: '共鸣技能',
    共鸣解放伤害: '共鸣解放',
    变奏技能伤害: '变奏技能',
    延奏技能伤害: '延奏技能',
    声骸技能伤害: '声骸技能',
    协同攻击伤害: '协同',
    效应伤害: '效应'
}

export interface DirectDamageTypeSlice {
    label: string
    value: number
    pct: number
    color: string
}

export interface DirectDamageByType {
    character: string
    total: number
    slices: DirectDamageTypeSlice[]
}

/** @desc 十六进制颜色 → [r,g,b]（0-255） */
function hexToRgb(hex: string): [number, number, number] {
    const v = parseInt(hex.slice(1), 16)
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
    const clamp = (x: number) => Math.max(0, Math.min(255, Math.round(x)))
    return `#${((1 << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).slice(1)}`
}

/** @desc RGB → HSL（h:0-360, s/l:0-1） */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    const rn = r / 255
    const gn = g / 255
    const bn = b / 255
    const max = Math.max(rn, gn, bn)
    const min = Math.min(rn, gn, bn)
    const l = (max + min) / 2
    const d = max - min
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
    let h = 0
    if (d !== 0) {
        if (max === rn) h = ((gn - bn) / d) % 6
        else if (max === gn) h = (bn - rn) / d + 2
        else h = (rn - gn) / d + 4
        h = (((h * 60) % 360) + 360) % 360
    }
    return [h, s, l]
}

/** @desc HSL → RGB（0-255） */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    const hn = (((h % 360) + 360) % 360) / 360
    const c = (1 - Math.abs(2 * l - 1)) * s
    const x = c * (1 - Math.abs(((hn * 6) % 2) - 1))
    const m = l - c / 2
    let r = 0
    let g = 0
    let b = 0
    if (hn < 1 / 6) {
        r = c
        g = x
    } else if (hn < 2 / 6) {
        r = x
        g = c
    } else if (hn < 3 / 6) {
        g = c
        b = x
    } else if (hn < 4 / 6) {
        g = x
        b = c
    } else if (hn < 5 / 6) {
        r = x
        b = c
    } else {
        r = c
        b = x
    }
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

/**
 * @desc 组合类别颜色：等权混合所有构成类型颜色，并在 HSL 中提升饱和度避免发灰。
 * 支持 2 元 / 3 元 / 任意 N 元组合；结果确定（与类型顺序无关）。
 */
function combinedColor(cats: DamageTypeCategory[]): string {
    const n = cats.length
    if (n === 0) return TYPE_COLORS['其它']
    if (n === 1) return TYPE_COLORS[cats[0]]
    const [r, g, b] = cats.reduce<[number, number, number]>(
        (acc, c) => {
            const [cr, cg, cb] = hexToRgb(TYPE_COLORS[c])
            return [acc[0] + cr, acc[1] + cg, acc[2] + cb]
        },
        [0, 0, 0]
    )
    const [h, s, l] = rgbToHsl(r / n, g / n, b / n)
    const boostedS = Math.min(1, s * 1.4 + 0.1)
    const [nr, ng, nb] = hslToRgb(h, boostedS, l)
    return rgbToHex(nr, ng, nb)
}

/**
 * @desc 直伤按类型占比（仅含角色来源、非纯效应的直伤）。
 * 单一类型计入自身类别；同时属于多个类型（a&b…）的伤害独立成「a&b」组合类别，不再分摊进各单一类型。
 */
export function aggregateDirectDamageByType(entries: ResultEntry[]): DirectDamageByType[] {
    const result: DirectDamageByType[] = []
    const indexMap = new Map<string, number>()
    const sliceMaps: Map<string, { value: number; cats: DamageTypeCategory[] }>[] = []

    for (const e of entries) {
        // 排除：无伤害类型、纯效应条目（baseUnit === '效应系数'，无角色来源）、无角色来源直伤（无名组不生成）；
        // 「视为效应」的直伤（有角色、baseUnit 非效应系数）保留
        if (e.damageTypes.length === 0 || e.baseUnit === '效应系数' || !e.character) continue
        let idx = indexMap.get(e.character)
        if (idx === undefined) {
            idx = result.length
            indexMap.set(e.character, idx)
            result.push({ character: e.character, total: 0, slices: [] })
            sliceMaps.push(new Map())
        }
        const agg = result[idx]
        const sm = sliceMaps[idx]
        // 按类别顺序去重排序；多类型拼接「a&b」组合标签
        const cats = [...new Set(e.damageTypes.map((dt) => FULL_TO_CATEGORY[dt] ?? '其它'))].sort(
            (a, b) => DAMAGE_TYPE_CATEGORIES.indexOf(a) - DAMAGE_TYPE_CATEGORIES.indexOf(b)
        )
        const label = cats.length > 1 ? cats.join('&') : cats[0]
        const existing = sm.get(label)
        if (existing) existing.value += e.totalDamage
        else sm.set(label, { value: e.totalDamage, cats })
        agg.total += e.totalDamage
    }

    for (let i = 0; i < result.length; i++) {
        result[i].slices = [...sliceMaps[i].entries()].map(([label, { value, cats }]) => ({
            label,
            value,
            pct: result[i].total > 0 ? (value / result[i].total) * 100 : 0,
            color: cats.length > 1 ? combinedColor(cats) : TYPE_COLORS[cats[0] ?? '其它']
        }))
        result[i].slices.sort((a, b) => b.value - a.value)
    }

    return result
}
