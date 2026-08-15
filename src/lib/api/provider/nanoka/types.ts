// ── nanoka 原始数据类型 ─────────────────────────────────────────────────
// 这些类型描述 nanoka.cc 上游文件的具体结构，仅由 nanoka 适配器内部使用。
// 规范化的应用契约请见 $lib/api/types。

// ── List types ──

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

// ── zh detail types ──

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

// ── manifest（nanoka 版本清单） ──

export interface NanokaManifest {
    ww?: {
        latest?: string
        available?: string[]
    }
}
