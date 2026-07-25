import type { EchoStat } from '$lib/types/game-data'
import { SUBSTAT_OPTIONS } from './stat-data'

// ── tier probability pool ──

interface TierPool {
    value: number
    prob: number
}

interface SubstatRollPool {
    tierPools: TierPool[]
    cumulative: number[]
    unit: string
}

function makePool(tiers: TierPool[]): SubstatRollPool {
    const cumulative: number[] = []
    let sum = 0
    for (const t of tiers) {
        sum += t.prob
        cumulative.push(sum)
    }
    return { tierPools: tiers, cumulative, unit: tiers[0] && tiers[0].value > 10 ? '' : '%' }
}

// all 13 substat types with their tier probability pools
const POOLS: Record<string, SubstatRollPool> = {
    暴击率: makePool([
        { value: 6.3, prob: 23.33 },
        { value: 6.9, prob: 23.33 },
        { value: 7.5, prob: 23.33 },
        { value: 8.1, prob: 8 },
        { value: 8.7, prob: 8 },
        { value: 9.3, prob: 8 },
        { value: 9.9, prob: 3 },
        { value: 10.5, prob: 3 }
    ]),
    暴击伤害: makePool([
        { value: 12.6, prob: 23.33 },
        { value: 13.8, prob: 23.33 },
        { value: 15, prob: 23.33 },
        { value: 16.2, prob: 8 },
        { value: 17.4, prob: 8 },
        { value: 18.6, prob: 8 },
        { value: 19.8, prob: 3 },
        { value: 21, prob: 3 }
    ]),
    '攻击%': makePool([
        { value: 6.4, prob: 6.8 },
        { value: 7.1, prob: 7.77 },
        { value: 7.9, prob: 20.39 },
        { value: 8.6, prob: 24.27 },
        { value: 9.4, prob: 17.48 },
        { value: 10.1, prob: 14.56 },
        { value: 10.9, prob: 5.83 },
        { value: 11.6, prob: 2.91 }
    ]),
    '生命%': makePool([
        { value: 6.4, prob: 6.8 },
        { value: 7.1, prob: 7.77 },
        { value: 7.9, prob: 20.39 },
        { value: 8.6, prob: 24.27 },
        { value: 9.4, prob: 17.48 },
        { value: 10.1, prob: 14.56 },
        { value: 10.9, prob: 5.83 },
        { value: 11.6, prob: 2.91 }
    ]),
    '防御%': makePool([
        { value: 8.1, prob: 6.8 },
        { value: 9, prob: 7.77 },
        { value: 10, prob: 20.39 },
        { value: 10.9, prob: 24.27 },
        { value: 11.8, prob: 17.48 },
        { value: 12.8, prob: 14.56 },
        { value: 13.8, prob: 5.83 },
        { value: 14.7, prob: 2.91 }
    ]),
    普攻伤害加成: makePool([
        { value: 6.4, prob: 6.8 },
        { value: 7.1, prob: 7.77 },
        { value: 7.9, prob: 20.39 },
        { value: 8.6, prob: 24.27 },
        { value: 9.4, prob: 17.48 },
        { value: 10.1, prob: 14.56 },
        { value: 10.9, prob: 5.83 },
        { value: 11.6, prob: 2.91 }
    ]),
    重击伤害加成: makePool([
        { value: 6.4, prob: 6.8 },
        { value: 7.1, prob: 7.77 },
        { value: 7.9, prob: 20.39 },
        { value: 8.6, prob: 24.27 },
        { value: 9.4, prob: 17.48 },
        { value: 10.1, prob: 14.56 },
        { value: 10.9, prob: 5.83 },
        { value: 11.6, prob: 2.91 }
    ]),
    共鸣技能伤害加成: makePool([
        { value: 6.4, prob: 6.8 },
        { value: 7.1, prob: 7.77 },
        { value: 7.9, prob: 20.39 },
        { value: 8.6, prob: 24.27 },
        { value: 9.4, prob: 17.48 },
        { value: 10.1, prob: 14.56 },
        { value: 10.9, prob: 5.83 },
        { value: 11.6, prob: 2.91 }
    ]),
    共鸣解放伤害加成: makePool([
        { value: 6.4, prob: 6.8 },
        { value: 7.1, prob: 7.77 },
        { value: 7.9, prob: 20.39 },
        { value: 8.6, prob: 24.27 },
        { value: 9.4, prob: 17.48 },
        { value: 10.1, prob: 14.56 },
        { value: 10.9, prob: 5.83 },
        { value: 11.6, prob: 2.91 }
    ]),
    生命: makePool([
        { value: 320, prob: 6.8 },
        { value: 360, prob: 7.77 },
        { value: 390, prob: 20.39 },
        { value: 430, prob: 24.27 },
        { value: 470, prob: 17.48 },
        { value: 510, prob: 14.56 },
        { value: 540, prob: 5.83 },
        { value: 580, prob: 2.91 }
    ]),
    共鸣效率: makePool([
        { value: 6.8, prob: 6.8 },
        { value: 7.6, prob: 7.77 },
        { value: 8.4, prob: 20.39 },
        { value: 9.2, prob: 24.27 },
        { value: 10, prob: 17.48 },
        { value: 10.8, prob: 14.56 },
        { value: 11.6, prob: 5.83 },
        { value: 12.4, prob: 2.91 }
    ]),
    攻击: makePool([
        { value: 30, prob: 6.8 },
        { value: 40, prob: 52.43 },
        { value: 50, prob: 37.86 },
        { value: 60, prob: 2.91 }
    ]),
    防御: makePool([
        { value: 40, prob: 14.56 },
        { value: 50, prob: 44.66 },
        { value: 60, prob: 32.04 },
        { value: 70, prob: 8.74 }
    ])
}

export const ROLLABLE_TYPES = Object.keys(POOLS)

// ── weighted tier roll ──

function rollTier(pool: SubstatRollPool): number {
    const r = Math.random() * 100
    for (let i = 0; i < pool.cumulative.length; i++) {
        if (r < pool.cumulative[i]) return pool.tierPools[i].value
    }
    return pool.tierPools[pool.tierPools.length - 1].value
}

// ── shuffle (Fisher-Yates) ──

function shuffle<T>(arr: T[]): T[] {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
}

// ── check if array contains all target types ──

function containsAllTargets(substats: EchoStat[], targets: string[]): boolean {
    const present = new Set(substats.map((s) => s.type))
    return targets.every((t) => present.has(t))
}

// ── simulate enhancement ──

export function simulateEnhancement(targetTypes: string[]): { substats: EchoStat[]; attempts: number } {
    let attempts = 0
    while (true) {
        attempts++
        const picked = shuffle(ROLLABLE_TYPES).slice(0, 5)
        const substats: EchoStat[] = picked.map((type) => {
            const pool = POOLS[type]
            const value = rollTier(pool)
            return { type, value, unit: pool.unit }
        })
        if (containsAllTargets(substats, targetTypes)) {
            return { substats, attempts }
        }
    }
}
