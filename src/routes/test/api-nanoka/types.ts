export interface Manifest {
    ww: { latest: string; available: string[] }
}

export interface CharacterEntry {
    icon: string
    rank: number
    weapon: number
    element: number
    zh: string
    en: string
}

export interface WeaponEntry {
    icon: string
    rank: number
    type: number
    zh: string
    en: string
    atk: number
    sub: string
}

export interface EchoEntry {
    icon: string
    rank: number[]
    group: number[]
    intensity: number
    zh: string
    en: string
    phantom?: string
}

export interface SonataSet {
    id: number
    icon: string
    name: { zh: string; en: string }
    set: Record<string, unknown>
}
