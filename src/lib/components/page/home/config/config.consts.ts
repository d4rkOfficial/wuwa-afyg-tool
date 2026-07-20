import type { EchoStat } from '$lib/types/game-data'
import type { EchoSlotConfig, CharEchoConfig, EnemyConfig, ConfigState } from './config.types'

export const RESISTANCE_KEYS = ['物理', '冷凝', '热熔', '导电', '气动', '衍射', '湮灭']

function emptySlot(cost = 1): EchoSlotConfig {
    return { cost, mainStat: null, secondMainStat: null, substats: [] }
}

function emptyChar(): CharEchoConfig {
    return { echoes: [emptySlot(), emptySlot(), emptySlot(), emptySlot(), emptySlot()] }
}

export function defaultEnemy(): EnemyConfig {
    return {
        type: '精英怪',
        level: 90,
        defense: 1592,
        resistances: Object.fromEntries(RESISTANCE_KEYS.map((k) => [k, 0])),
        dmgReduction: 0
    }
}

export function defaultConfig(): ConfigState {
    return {
        characters: [emptyChar(), emptyChar(), emptyChar()],
        enemy: defaultEnemy()
    }
}

export function totalCost(slots: EchoSlotConfig[]): number {
    return slots.reduce((s, e) => s + e.cost, 0)
}

export function canSetCost(slots: EchoSlotConfig[], index: number, newCost: number): boolean {
    const otherTotal = slots.reduce((s, e, i) => s + (i === index ? 0 : e.cost), 0)
    return otherTotal + newCost <= 12
}
