// ── Effect Multiplier Formula ──

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

// ── Effect Base Damage (每层预计算伤害值, 用于异常伤害公式中的"异常伤害基础值") ──

export const EFFECT_BASE_DAMAGE: Record<string, number[]> = {
    光噪效应: [431, 781, 1131, 1481, 1831, 2181, 2531, 2881, 3231, 3581, 4775, 5969, 7162],
    霜渐效应: [352, 638, 924, 1210, 1495, 1781, 2067, 2353, 2639, 2925, 3900, 4874, 5849],
    聚爆效应: [1206, 2186, 3166, 4146, 5126, 6106, 7086, 8067, 9047, 10027, 13369, 16711, 20053],
    电磁效应: [718, 1301, 1885, 2468, 3052, 3635, 4218, 4802, 5385, 5969, 7958, 9947, 11937],
    风蚀效应: [646, 1615, 3230, 4844, 6459, 8073, 9688, 11302, 12917, 14531, 16146, 17760]
}

// ── 谐度破坏 (Tune / Harmony) Data ──

export interface TuneHit {
    weaponType: string
    label: string // e.g. "对COST1通用"
    multiplier: number // e.g. 16.0 (1600%)
    damage: number // e.g. 4477
    hitCount: number // 段数
    target: 'cost1' | 'cost3' | 'cost4' | string
    isGeneral: boolean // 是否为通用伤害
}

export const TUNE_DATA: TuneHit[] = [
    // 通用
    {
        weaponType: '*',
        label: '对COST1通用',
        multiplier: 16.0,
        damage: 4477,
        hitCount: 1,
        target: 'cost1',
        isGeneral: true
    },
    {
        weaponType: '*',
        label: '对COST3通用',
        multiplier: 16.0,
        damage: 13429,
        hitCount: 2,
        target: 'cost3',
        isGeneral: true
    },
    {
        weaponType: '*',
        label: '对COST4通用',
        multiplier: 16.0,
        damage: 62668,
        hitCount: 7,
        target: 'cost4',
        isGeneral: true
    },
    // 长刃追加
    {
        weaponType: '长刃',
        label: '长刃-1',
        multiplier: 1.7334,
        damage: 6790,
        hitCount: 1,
        target: '追加',
        isGeneral: false
    },
    {
        weaponType: '长刃',
        label: '长刃-2',
        multiplier: 2.2666,
        damage: 8878,
        hitCount: 1,
        target: '追加',
        isGeneral: false
    },
    {
        weaponType: '长刃',
        label: '长刃-3',
        multiplier: 12.0,
        damage: 47001,
        hitCount: 5,
        target: '追加',
        isGeneral: false
    },
    {
        weaponType: '佩枪',
        label: '佩枪',
        multiplier: 16.0,
        damage: 62668,
        hitCount: 7,
        target: '追加',
        isGeneral: false
    },
    {
        weaponType: '臂铠',
        label: '臂铠',
        multiplier: 16.0,
        damage: 62668,
        hitCount: 7,
        target: '追加',
        isGeneral: false
    },
    {
        weaponType: '迅刀',
        label: '迅刀-1',
        multiplier: 1.0,
        damage: 3917,
        hitCount: 4,
        target: '追加',
        isGeneral: false
    },
    {
        weaponType: '迅刀',
        label: '迅刀-2',
        multiplier: 12.0,
        damage: 47001,
        hitCount: 5,
        target: '追加',
        isGeneral: false
    },
    {
        weaponType: '音感仪',
        label: '音感仪',
        multiplier: 16.0,
        damage: 62668,
        hitCount: 7,
        target: '追加',
        isGeneral: false
    }
]

export function getTuneDamage(
    weaponType: string,
    echoCost: number
): { multiplier: number; damage: number; hitCount: number }[] {
    const results: { multiplier: number; damage: number; hitCount: number }[] = []

    // 通用部分
    const costKey = `cost${echoCost}` as 'cost1' | 'cost3' | 'cost4'
    const general = TUNE_DATA.find((t) => t.isGeneral && t.target === costKey)
    if (general) results.push({ multiplier: general.multiplier, damage: general.damage, hitCount: general.hitCount })

    // 武器追加部分
    const extras = TUNE_DATA.filter((t) => !t.isGeneral && t.weaponType === weaponType)
    for (const e of extras) results.push({ multiplier: e.multiplier, damage: e.damage, hitCount: e.hitCount })

    return results
}
