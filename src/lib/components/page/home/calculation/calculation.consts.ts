import type { ZoneDef } from './calculation.types'

export const ZONE_DEFS: ZoneDef[] = [
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
    { id: 'target_bonus', label: '对目标加成(增伤区)', unit: '%' },

    { id: 'deepen_dmg', label: '加深(加深区)', unit: '%' },
    { id: 'target_deepen', label: '对目标加深(加深区)', unit: '%' },

    { id: 'res_pen', label: '对目标属性抗性无视(穿抗)', unit: '%' },
    { id: 'def_pen', label: '对目标防御无视(穿防)', unit: '%' },
    { id: 'dmg_red_pen', label: '对目标免伤无视(穿免)', unit: '%' },

    { id: 'res_down', label: '目标抗性降低(减抗)', unit: '%' },
    { id: 'tune_strain', label: '集谐最终伤害(集谐区)', unit: '%' },

    { id: 'final_dmg', label: '最终伤害(终伤区)', unit: '%' },
    { id: 'target_final_dmg', label: '目标受最终伤害(终伤区)', unit: '%' },

    { id: 'dmg_taken_inc', label: '伤害提升(易伤区)', unit: '%' },
    { id: 'target_dmg_taken_inc', label: '目标受到伤害提升(易伤区)', unit: '%' },

    { id: 'custom_final_dmg', label: '倍率/其它', unit: '%' }
]

export const ZONE_MAP = new Map(ZONE_DEFS.map((z) => [z.id, z]))

export function parseRatio(r: string): number {
    return parseFloat(r.replace('%', '')) / 100
}
