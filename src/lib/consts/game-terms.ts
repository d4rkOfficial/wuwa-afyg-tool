// ── Elements ──
export const ELEMENTS = ['物理', '冷凝', '热熔', '导电', '气动', '衍射', '湮灭'] as const
export type Element = (typeof ELEMENTS)[number]

export const ELEMENT_MAP: Record<number, string> = {
    1: '冷凝',
    2: '热熔',
    3: '导电',
    4: '气动',
    5: '衍射',
    6: '湮灭'
} as const

export const ELEMENT_COLORS: Record<string, string> = {
    冷凝: '#0284c7',
    热熔: '#ea580c',
    导电: '#7c3aed',
    气动: '#059669',
    衍射: '#ca8a04',
    湮灭: '#db2777'
} as const

export const ELEMENT_ORDER = ['冷凝', '热熔', '导电', '气动', '衍射', '湮灭'] as const

// ── Weapon Types ──
export const WEAPON_TYPES = ['长刃', '迅刀', '佩枪', '臂铠', '音感仪'] as const
export type WeaponType = (typeof WEAPON_TYPES)[number]

export const WEAPON_TYPE_MAP: Record<number, string> = {
    1: '长刃',
    2: '迅刀',
    3: '佩枪',
    4: '臂铠',
    5: '音感仪'
} as const

// ── Skill Types ──
export const SKILL_TYPES = ['常态攻击', '共鸣技能', '共鸣解放', '共鸣回路', '变奏技能', '延奏技能'] as const

export type SkillType = (typeof SKILL_TYPES)[number]

export const SKILL_TYPE_ECHO = '声骸技能'
export const SKILL_TYPE_CUSTOM = '自定义'
export const SKILL_TYPE_TUNE_BREAK = '谐度破坏'
export const SKILL_TYPE_TUNE_RESPONSE = '偏谐响应'
export const SKILL_TYPE_EFFECT = '效应结算'

// ── Damage Types (用于 DAMAGE_TYPES 数组和私服/战斗日志匹配) ──
export const DAMAGE_TYPES = [
    '普攻伤害',
    '重击伤害',
    '共鸣技能伤害',
    '共鸣解放伤害',
    '声骸技能伤害',
    '变奏技能伤害',
    '延奏技能伤害',
    '协同攻击伤害',
    '效应伤害',
    '其它类型伤害'
] as const

export const DAMAGE_TYPE_SHORT: Record<string, string> = {
    普攻伤害: '普攻',
    重击伤害: '重击',
    共鸣技能伤害: '共技',
    共鸣解放伤害: '共解',
    声骸技能伤害: '声骸',
    变奏技能伤害: '变奏',
    延奏技能伤害: '延奏',
    协同攻击伤害: '协同',
    效应伤害: '效应',
    其它类型伤害: '其它'
} as const

export const DAMAGE_BONUS_LABELS = ['普攻伤害加成', '重击伤害加成', '共鸣技能伤害加成', '共鸣解放伤害加成'] as const

export const TYPE_BONUS_MAP: Record<string, string> = {
    普攻伤害加成: '普攻',
    重击伤害加成: '重击',
    共鸣技能伤害加成: '共鸣技能',
    共鸣解放伤害加成: '共鸣解放'
} as const

export const ELEMENT_BONUS_MAP = Object.fromEntries(ELEMENT_ORDER.map((el) => [`${el}伤害加成`, el])) satisfies Record<
    string,
    string
>

// ── Base Stat Types ──
export const BASE_STATS = ['攻击', '生命', '防御'] as const
export type BaseStat = (typeof BASE_STATS)[number]

const TUNE_UNIT = '偏谐系数'
export const PCT_UNITS = ['攻击%', '生命%', '防御%', TUNE_UNIT] as const

export const BASE_STAT_TUNE = TUNE_UNIT
export const BASE_STAT_EFFECT = '效应系数'
export const BASE_STAT_FIXED = '固定'

// ── Enemy ──
export const ENEMY_TYPES = ['BOSS', '精英怪', '小怪'] as const
export type EnemyType = (typeof ENEMY_TYPES)[number]
export const CHAR_LEVEL = 90

// ── Phase ──
export const PHASE_KEYS = ['team', 'timeline', 'calculation', 'config'] as const
export type PhaseKey = (typeof PHASE_KEYS)[number]

export const PHASE_LABELS: Record<PhaseKey, string> = {
    team: '队伍配置',
    timeline: '排轴',
    calculation: '拉表',
    config: '词条/环境配置'
}

// ── Echo Cost ──
export const COST_MAP: Record<number, number> = { 0: 1, 1: 3, 2: 4, 3: 4 } as const

// 该声骸可属于任何套装（特殊处理）
export const HECATE_ECHO = '赫卡忒'

// ── Weapon Substat Name Mapping (API short form → canonical form) ──
export const WEAPON_SUBSTAT_NAME_MAP: Record<string, string> = {
    暴击: '暴击率',
    攻击: '攻击%',
    生命: '生命%',
    防御: '防御%'
} as const

/** Substat names where the API raw value is a decimal fraction needing ×100 */
export const SUBSTAT_DECIMAL_TO_PCT = new Set(['攻击%', '生命%', '防御%'])

// ── Non-direct Configs (effect / tune) ──
export const NON_DIRECT_CONFIGS = [
    { name: SKILL_TYPE_TUNE_BREAK, category: '处决' as const, max: 0 },
    { name: '震谐响应', category: '响应' as const, max: 0 },
    { name: '骇破响应', category: '响应' as const, max: 0 },
    { name: '光噪效应', category: '效应' as const, max: 19, element: '衍射' },
    { name: '风蚀效应', category: '效应' as const, max: 12, element: '气动' },
    { name: '霜渐效应', category: '效应' as const, max: 19, element: '冷凝' },
    { name: '聚爆效应', category: '效应' as const, max: 19, element: '热熔' },
    { name: '电磁效应', category: '效应' as const, max: 19, element: '导电' },
    { name: '虚湮效应', category: '效应' as const, max: 9, element: '湮灭' }
] as const

export const NON_DIRECT_ELEMENT = NON_DIRECT_CONFIGS.reduce<Record<string, string>>(
    (acc, cfg) => {
        if ('element' in cfg) acc[cfg.name] = cfg.element
        return acc
    },
    { 电磁爆发: '导电' }
)
