export { getEffectMultiplier, getEffectBurstMultiplier, hasEffectDamage } from './effect-data'

export function getTuneDamage(
    _weaponType: string,
    _echoCost: number
): { multiplier: number; damage: number; hitCount: number }[] {
    return []
}

export const EFFECT_BASE_DAMAGE: Record<string, number[]> = {}
