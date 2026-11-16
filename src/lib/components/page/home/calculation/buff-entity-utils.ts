import { ZONE_MAP } from '$lib/calc/calculation.consts'

/** @desc 乘区 id → 显示名（未知 id 原样返回） */
export const zoneLabel = (id: string) => ZONE_MAP.get(id as never)?.label ?? id

/** @desc 乘区单位（仅百分比乘区返回 `%`，其余返回空串） */
export const zoneUnit = (id: string) => (ZONE_MAP.get(id as never)?.unit === '%' ? '%' : '')

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

/** @desc 百分比 → 最简「除数 / 乘数」（如 25% → ÷4×1） */
export const simplifyPct = (pct: number): { divisor: number; multiplier: number } => {
    if (pct === 0) return { divisor: 1, multiplier: 0 }
    const num = Math.round(pct)
    const g = gcd(num, 100)
    return { divisor: 100 / g, multiplier: num / g }
}
