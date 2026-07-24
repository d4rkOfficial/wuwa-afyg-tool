import type { EchoStat } from '$lib/types/game-data'
import type { EchoSlotConfig, CharEchoConfig, EnemyConfig, ConfigState } from './config.types'
import { ELEMENTS } from '$lib/consts/game-terms'

export const RESISTANCE_KEYS = ELEMENTS

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
        defense: 792 + 8 * 90,
        defenseLocked: false,
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
