// ── nanoka 原始数据类型 ─────────────────────────────────────────────────
// 这些类型描述 nanoka.cc 上游文件的具体结构，仅由 nanoka 适配器内部使用。
// 规范化的应用契约请见 $lib/api/types。

// ── 多语言文本 ──
// 列表文件里的名称字段直接按语言平铺（zh/en/ja/ko）；语言目录实际只有
// zh/en/ja/ko 四种，其它值由适配器回退中文。

export interface LocalizedText {
    zh: string
    en?: string
    ja?: string
    ko?: string
}

// ── List types ──

export interface NanokaCharacter extends LocalizedText {
    icon: string
    rank: number
    weapon: number
    element: number
}

export interface NanokaWeapon extends LocalizedText {
    icon: string
    rank: number
    type: number
}

export interface NanokaEcho extends LocalizedText {
    icon: string
    rank: number[]
    group: number[]
    intensity: number
    phantom?: string
}

export interface NanokaSonataSet {
    id: number
    icon: string
    name: LocalizedText
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

/** @desc 角色定位标签；color 为不带 # 的 6 位 hex，icon 为 UE 资源路径（Atlas 下每标签一张独立小图） */
export interface ZhCharacterTag {
    name: string
    desc: string
    icon: string
    color: string
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
    tag: Record<string, ZhCharacterTag>
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
