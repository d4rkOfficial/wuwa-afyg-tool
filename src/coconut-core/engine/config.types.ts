import type { EchoStat } from '$lib/types/game-data'

export interface EchoSlotConfig {
    cost: number
    mainStat: EchoStat | null
    secondMainStat: EchoStat | null
    substats: EchoStat[]
}

export interface CharEchoConfig {
    echoes: [EchoSlotConfig, EchoSlotConfig, EchoSlotConfig, EchoSlotConfig, EchoSlotConfig]
}

export interface EnemyConfig {
    type: 'BOSS' | '精英怪' | '小怪'
    level: number
    defense: number
    defenseLocked?: boolean
    resistances: Record<string, number>
    dmgReduction: number
}

export interface ConfigState {
    characters: [CharEchoConfig, CharEchoConfig, CharEchoConfig]
    enemy: EnemyConfig
}
