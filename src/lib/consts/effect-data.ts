const G = 0.813
const R = 3.41

const EFFECT_BASE: Record<string, number> = {
    光噪效应: 30.0,
    霜渐效应: 24.5,
    聚爆效应: 84.0,
    电磁效应: 50.0
}

function segment1(base: number, n: number): number {
    return (base / 100) * (1 + (n - 1) * G)
}

function segment2(base: number, n: number): number {
    const l10 = (base / 100) * (1 + 9 * G)
    return l10 + (base / 100) * G * R * (n - 10)
}

export function getEffectMultiplier(name: string, layers: number): number {
    if (layers <= 0) return 0
    if (name === '虚湮效应') return 0
    if (name === '风蚀效应') {
        return layers === 1 ? 0.45 : (layers - 1) * 1.125
    }

    const base = EFFECT_BASE[name]
    if (base === undefined) return 0

    if (layers <= 10) return segment1(base, layers)
    return segment2(base, layers)
}

export function getEffectBurstMultiplier(name: string, layers: number): number {
    if (name !== '电磁效应' || layers <= 0) return 0
    return getEffectMultiplier(name, layers)
}

export function hasEffectDamage(name: string): boolean {
    return name !== '虚湮效应'
}
