export interface StatOption {
    label: string
    maxValue: number
    unit: string
}

export interface SecondStat {
    label: string
    value: number
    unit: string
}

export interface SubstatOption {
    label: string
    /** 副词条各档位固定值，从低到高排列 */
    tiers: number[]
    unit: string
}

export const MAIN_STAT_POOL: Record<number, StatOption[]> = {
    4: [
        { label: '暴击率', maxValue: 22, unit: '%' },
        { label: '暴击伤害', maxValue: 44, unit: '%' },
        { label: '攻击%', maxValue: 33, unit: '%' },
        { label: '生命%', maxValue: 33, unit: '%' },
        { label: '防御%', maxValue: 41.8, unit: '%' },
        { label: '治疗加成', maxValue: 26.4, unit: '%' }
    ],
    3: [
        { label: '冷凝伤害加成', maxValue: 30, unit: '%' },
        { label: '热熔伤害加成', maxValue: 30, unit: '%' },
        { label: '导电伤害加成', maxValue: 30, unit: '%' },
        { label: '气动伤害加成', maxValue: 30, unit: '%' },
        { label: '衍射伤害加成', maxValue: 30, unit: '%' },
        { label: '湮灭伤害加成', maxValue: 30, unit: '%' },
        { label: '攻击%', maxValue: 30, unit: '%' },
        { label: '生命%', maxValue: 30, unit: '%' },
        { label: '防御%', maxValue: 38, unit: '%' },
        { label: '共鸣效率', maxValue: 32, unit: '%' }
    ],
    1: [
        { label: '攻击%', maxValue: 18, unit: '%' },
        { label: '生命%', maxValue: 22.8, unit: '%' },
        { label: '防御%', maxValue: 18, unit: '%' }
    ]
} as const

export const SECOND_MAIN_STAT: Record<number, SecondStat> = {
    4: { label: '攻击', value: 150, unit: '' },
    3: { label: '攻击', value: 100, unit: '' },
    1: { label: '生命', value: 2280, unit: '' }
} as const

export const SUBSTAT_OPTIONS: SubstatOption[] = [
    { label: '生命', tiers: [320, 360, 390, 430, 470, 510, 540, 580], unit: '' },
    { label: '攻击', tiers: [30, 40, 50, 60], unit: '' },
    { label: '防御', tiers: [40, 50, 60, 70], unit: '' },
    { label: '生命%', tiers: [6.4, 7.1, 7.9, 8.6, 9.4, 10.1, 10.9, 11.6], unit: '%' },
    { label: '攻击%', tiers: [6.4, 7.1, 7.9, 8.6, 9.4, 10.1, 10.9, 11.6], unit: '%' },
    { label: '防御%', tiers: [8.1, 9.0, 10.0, 10.9, 11.8, 12.8, 13.8, 14.7], unit: '%' },
    { label: '暴击率', tiers: [6.3, 6.9, 7.5, 8.1, 8.7, 9.3, 9.9, 10.5], unit: '%' },
    { label: '暴击伤害', tiers: [12.6, 13.8, 15.0, 16.2, 17.4, 18.6, 19.8, 21.0], unit: '%' },
    { label: '共鸣效率', tiers: [6.8, 7.6, 8.4, 9.2, 10.0, 10.8, 11.6, 12.4], unit: '%' },
    { label: '普攻伤害加成', tiers: [6.4, 7.1, 7.9, 8.6, 9.4, 10.1, 10.9, 11.6], unit: '%' },
    { label: '重击伤害加成', tiers: [6.4, 7.1, 7.9, 8.6, 9.4, 10.1, 10.9, 11.6], unit: '%' },
    { label: '共鸣技能伤害加成', tiers: [6.4, 7.1, 7.9, 8.6, 9.4, 10.1, 10.9, 11.6], unit: '%' },
    { label: '共鸣解放伤害加成', tiers: [6.4, 7.1, 7.9, 8.6, 9.4, 10.1, 10.9, 11.6], unit: '%' }
] as const
