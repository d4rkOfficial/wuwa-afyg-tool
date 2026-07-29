// ── List types ──

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

export interface EchoSetItem {
    name: string
    pieces: number[]
}

export interface NanokaCharacter {
    icon: string
    rank: number
    weapon: number
    element: number
    zh: string
}

export interface NanokaWeapon {
    icon: string
    rank: number
    type: number
    zh: string
}

export interface NanokaEcho {
    icon: string
    rank: number[]
    group: number[]
    intensity: number
    zh: string
    phantom?: string
}

export interface NanokaSonataSet {
    id: number
    icon: string
    name: { zh: string }
    set: Record<string, unknown>
}

export type NanokaSonata = Record<string, NanokaSonataSet>

// ── INFO types ──

export interface SkillEntry {
    name: string
    type: '常态攻击' | '共鸣技能' | '共鸣解放' | '共鸣回路' | '变奏技能' | '延奏技能' | '谐度破坏'
    desc: string
    values: [name: string, value: string, element: string][]
}

export interface StatNode {
    name: string
    desc: string
}

export interface ResonanceChain {
    name: string
    desc: string
}

export interface CharacterInfo {
    rarity: 4 | 5
    element: '冷凝' | '热熔' | '导电' | '气动' | '衍射' | '湮灭'
    weaponType: '长刃' | '迅刀' | '佩枪' | '臂铠' | '音感仪'
    lv90BaseStats: {
        hp: number
        atk: number
        def: number
        tuneBreakBoost: number
    }
    skills: SkillEntry[]
    statNodes: StatNode[]
    chains: ResonanceChain[]
}

export interface WeaponInfo {
    rarity: 1 | 2 | 3 | 4 | 5
    type: '长刃' | '迅刀' | '佩枪' | '臂铠' | '音感仪'
    lv90BaseAtk: number
    substat: {
        name: string
        value: string
    }
    effect: {
        name: string
        desc: string
    }
}

export interface EchoInfo {
    cost: number
    skill: {
        desc: string
        values: [name: string, value: string, element: string][]
    }
    groups: string[]
}

export interface EchoSetInfo {
    bonuses: Record<string, string>
}

// ── Raw nanoka zh detail types ──

export interface ZhDamageEntry {
    element: number
    related_property: string
    type: number
    rate_lv: number[]
    energy: number
    element_power: number
    hardness_lv: number
    tough_lv: number
    weakness_lvl: number
}

export interface ZhSkillTreeNode {
    parent_nodes: number[]
    node_type: number
    coordinate: number
    un_lock_condition: number
    skill_branch_ids: string[]
    consume: { key: number; value: number }[]
    skill: {
        name: string
        desc?: string
        simple_desc?: string
        param?: string[]
        simple_param?: string[]
        icon?: string
        type?: string
        level?: Record<string, { name: string; param: string[][]; format?: unknown }>
        damage?: Record<string, ZhDamageEntry>
        consume?: Record<string, unknown[]>
    }
}

export interface ZhCharacterDetail {
    id: number
    rarity: number
    weapon: number
    element: number
    name: string
    desc: string
    icon: string
    stats: Record<string, Record<string, { life: number; atk: number; def: number }>>
    tag: Record<string, { name: string; desc: string; icon: string; color: string }>
    skill_trees: Record<string, ZhSkillTreeNode>
    chains: Record<
        string,
        {
            name: string
            desc: string
            param: string[]
            icon: string
        }
    >
    recommend?: { weapon: number[] }
}

export interface ZhWeaponDetail {
    id: number
    rarity: number
    type: number
    name: string
    desc: string
    icon: string
    stats: Record<string, Record<string, { name: string; value: number; is_ratio: boolean; is_percent: boolean }[]>>
    effect: string
    effect_name: string
    param: string[][]
}

export interface ZhEchoDetail {
    id: number
    name: string
    rarity: number[]
    intensity: number
    icon: string
    skill: {
        desc: string
        simple_desc: string
        param: string[][]
        icon: string
        damage?: Record<string, ZhDamageEntry>
    }
    group: Record<
        string,
        {
            id: number
            name: string
            icon: string
            color: string
            set: Record<string, { desc: string; param: string[] }>
        }
    >
}

export type ZhSonataDetail = Record<
    string,
    {
        id: number
        name: string
        icon: string
        color: string
        set: Record<string, { desc: string; param: string[] }>
    }
>
