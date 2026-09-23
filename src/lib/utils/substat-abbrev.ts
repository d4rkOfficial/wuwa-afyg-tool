/**
 * @desc 声骸词条缩写：把完整词条名压成卡片里能塞下的简写。
 *
 * 规则（主缩 / 副缩）：
 * - 暴击率 → 暴击 / 暴、暴击伤害 → 暴伤 / 爆、治疗加成 → 治疗 /（无）、共鸣效率 → 共效 / 充
 * - `XX%` → XX / 大X（如 攻击% → 攻击 / 大攻）
 * - `XX` → XX / 小X（如 攻击 → 攻击 / 小攻）
 * - `XX属性加成` → XX /（无）
 * - `XX伤害加成` → XX / XX（元素伤害加成是 3cost 主词条，如 热熔伤害加成 → 热熔；副词条里的
 *   共鸣技能 → 共技、共鸣解放 → 共解）
 */

/** @desc 主词条缩写表（键为完整词条名，值为主词条简写） */
export const MAIN_STAT_ABBREV: Record<string, string> = {
    暴击率: '暴击',
    暴击伤害: '暴伤',
    治疗加成: '治疗',
    生命: '生命',
    攻击: '攻击',
    防御: '防御',
    '生命%': '生命',
    '攻击%': '攻击',
    '防御%': '防御',
    共鸣效率: '共效'
}

/** @desc 副词条缩写表；值为空串表示该词条没有副缩（不可能作为副词条出现） */
export const SUBSTAT_ABBREV: Record<string, string> = {
    暴击率: '暴',
    暴击伤害: '爆',
    治疗加成: '',
    生命: '小生',
    攻击: '小攻',
    防御: '小防',
    '生命%': '大生',
    '攻击%': '大攻',
    '防御%': '大防',
    共鸣效率: '充',
    普攻伤害加成: '普攻',
    重击伤害加成: '重击',
    共鸣技能伤害加成: '共技',
    共鸣解放伤害加成: '共解'
}

/** @desc 主词条简写（未收录时按规则兜底，兜不住就返回原名） */
export const abbrevMainStat = (label: string | null | undefined): string => {
    if (!label) return ''
    const hit = MAIN_STAT_ABBREV[label]
    if (hit !== undefined) return hit
    if (label.endsWith('属性加成')) return label.slice(0, -'属性加成'.length)
    // 元素伤害加成（3cost 主词条）：热熔伤害加成 → 热熔；共鸣技能/共鸣解放沿用副缩表的 共技/共解
    if (label.endsWith('伤害加成')) return SUBSTAT_ABBREV[label] ?? label.slice(0, -'伤害加成'.length)
    if (label.endsWith('%')) return label.slice(0, -1)
    return label
}

/** @desc 副词条简写（未收录时按规则兜底；该词条无副缩时返回空串） */
export const abbrevSubstat = (label: string | null | undefined): string => {
    if (!label) return ''
    const hit = SUBSTAT_ABBREV[label]
    if (hit !== undefined) return hit
    if (label.endsWith('属性加成')) return ''
    if (label.endsWith('伤害加成')) return label.slice(0, -'伤害加成'.length)
    if (label.endsWith('%')) return `大${label.slice(0, 1)}`
    return `小${label.slice(0, 1)}`
}
