// ── 规范化契约类型 ────────────────────────────────────────────────────────
// 应用对上游数据的统一契约。任何上游通过 DataProvider 适配器（见
// $lib/api/provider）把这些类型返回给应用，应用不感知具体上游结构。

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

// ── INFO types ──

export interface SkillEntry {
    name: string
    type: '常态攻击' | '共鸣技能' | '共鸣解放' | '共鸣回路' | '变奏技能' | '延奏技能' | '谐度破坏'
    desc: string
    // [name, value, element, energy, tune]：energy=共鸣能量；tune=偏谐值。
    // energy/tune 为该伤害行全部 hit 的合计结果（已 /100，直接是最终数值而非 *N/多项式表达式）
    values: [name: string, value: string, element: string, energy?: string, tune?: string][]
    // 上游伤害字典（rate_lv/energy/weakness_lvl 等）；延奏倍率推断只对非空字典生效
    damage?: Record<string, unknown>
}

export interface StatNode {
    name: string
    desc: string
}

export interface ResonanceChain {
    name: string
    desc: string
}

/** @desc 角色定位标签（上游 tag 字段，如「主力输出」「快速协奏」） */
export interface CharacterTag {
    /** @desc 上游标签 id（同一 id 在所有角色上语义固定，可用于稳定比较） */
    id: string
    name: string
    desc: string
    /** @desc CSS 颜色（#RRGGBB；上游给的是不带 # 的 6 位 hex，缺失时为空串） */
    color: string
    /** @desc 可直接渲染的图片 URL（白色蒙版图形，展示时按 color 上色）；缺失时为空串 */
    icon: string
}

export interface CharacterInfo {
    rarity: 4 | 5
    element: '冷凝' | '热熔' | '导电' | '气动' | '衍射' | '湮灭'
    weaponType: '长刃' | '迅刀' | '佩枪' | '臂铠' | '音感仪'
    /** @desc 定位标签（按上游 id 升序；无标签时为空数组） */
    tags: CharacterTag[]
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
