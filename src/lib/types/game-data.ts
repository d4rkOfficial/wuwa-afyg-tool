export interface Character {
    name: string
    star: number
    element: string
    weaponType: string
}

export interface Weapon {
    name: string
    star: number
    weaponType: string
}

export interface Echo {
    name: string
    sets: string[]
    cost: number
}

export interface WeaponConfig {
    name: string | null
    refinement: number
}

export interface EchoStat {
    type: string
    value: number
    unit: string
}

export interface EchoConfig {
    name: string | null
    cost: number
    set: string | null
    mainStat: EchoStat | null
    secondMainStat: EchoStat | null
    substats: EchoStat[]
}

export interface CharacterConfig {
    id: string
    name: string | null
    weapon: WeaponConfig | null
    echoes: [EchoConfig, EchoConfig, EchoConfig, EchoConfig, EchoConfig]
}

export interface TeamConfig {
    characters: CharacterConfig[]
}
