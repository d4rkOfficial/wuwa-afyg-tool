import type { ZoneDef } from './calculation.types'

/**
 * @description 使用 harmony 错误表述，是遗留问题，不能乱动，理解成谐度（tune）即可
 */
export const ZONE_DEFS = [
    { id: 'atk_flat', label: '攻击固定值', unit: 'flat' },
    { id: 'atk_pct', label: '攻击百分比', unit: '%' },

    { id: 'hp_flat', label: '生命固定值', unit: 'flat' },
    { id: 'hp_pct', label: '生命百分比', unit: '%' },

    { id: 'def_flat', label: '防御固定值', unit: 'flat' },
    { id: 'def_pct', label: '防御百分比', unit: '%' },

    { id: 'crit_rate', label: '暴击率', unit: '%' },
    { id: 'crit_dmg', label: '暴击伤害', unit: '%' },

    { id: 'recharge', label: '共鸣效率', unit: '%' },

    { id: 'harmony_dmg', label: '谐度破坏增幅', unit: '%' },
    { id: 'harmony_acc', label: '偏谐值累积效率', unit: '%' },

    { id: 'bonus_dmg', label: '加成(增伤区)', unit: '%' },

    { id: 'deepen_dmg', label: '加深(加深区)', unit: '%' },

    { id: 'res_pen', label: '对目标属性抗性无视(穿抗)', unit: '%' },
    { id: 'def_pen', label: '对目标防御无视(穿防)', unit: '%' },
    { id: 'def_down', label: '目标防御降低(减防)', unit: '%' },
    { id: 'dmg_red_pen', label: '对目标免伤无视(穿免)', unit: '%' },

    { id: 'res_down', label: '目标抗性降低(减抗)', unit: '%' },
    { id: 'tune_strain', label: '集谐干涉层数(集谐区)', unit: 'flat' },

    { id: 'final_dmg', label: '最终伤害(终伤区)', unit: '%' },

    { id: 'dmg_taken_inc', label: '伤害提升(易伤区)', unit: '%' },

    { id: 'custom_final_dmg', label: '倍率/其它', unit: '%' }
] as const satisfies readonly ZoneDef[]

export type ZoneId = (typeof ZONE_DEFS)[number]['id']

export const ZONE_MAP = new Map(ZONE_DEFS.map((z) => [z.id, z]))

export const ZONE_REF_DEFS = [
    { id: 'base_atk', label: '攻击白值', unit: 'flat' },
    { id: 'total_atk', label: '当前攻击', unit: 'flat' },
    { id: 'base_hp', label: '生命白值', unit: 'flat' },
    { id: 'total_hp', label: '当前最大生命', unit: 'flat' },
    { id: 'base_def', label: '防御白值', unit: 'flat' },
    { id: 'total_def', label: '当前防御', unit: 'flat' },
    { id: 'recharge', label: '共鸣效率', unit: '%' },
    { id: 'harmony_dmg', label: '谐度破坏增幅', unit: '%' },
    { id: 'harmony_acc', label: '偏谐值累积效率', unit: '%' },
    { id: 'crit_rate', label: '暴击率', unit: '%' },
    { id: 'crit_dmg', label: '暴击伤害', unit: '%' }
] as const satisfies readonly ZoneDef[]

export const ZONE_REF_MAP: Map<string, ZoneDef> = new Map(ZONE_REF_DEFS.map((z) => [z.id, z]))

export function parseRatio(r: string): number {
    return parseFloat(r.replace('%', '')) / 100
}

export { DAMAGE_TYPES, DAMAGE_TYPE_SHORT } from '$lib/consts/game-terms'
