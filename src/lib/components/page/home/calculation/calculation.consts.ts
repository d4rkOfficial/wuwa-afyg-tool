import type { ZoneDef, BuffSet } from './calculation.types'

export const ZONE_DEFS = [
    { id: 'atkFlat', label: '攻击固定值', unit: 'flat' },
    { id: 'atkPct', label: '攻击百分比', unit: '%' },

    { id: 'hpFlat', label: '生命固定值', unit: 'flat' },
    { id: 'hpPct', label: '生命百分比', unit: '%' },

    { id: 'defFlat', label: '防御固定值', unit: 'flat' },
    { id: 'defPct', label: '防御百分比', unit: '%' },

    { id: 'critRate', label: '暴击率', unit: '%' },
    { id: 'critDmg', label: '暴击伤害', unit: '%' },

    { id: 'recharge', label: '共鸣效率', unit: '%' },

    { id: 'tuneBreakBoost', label: '谐度破坏增幅', unit: 'flat' },
    { id: 'offTuneBuildupRate', label: '偏谐值累积效率', unit: '%' },

    { id: 'bonusDmg', label: '加成(增伤区)', unit: '%' },

    { id: 'deepenDmg', label: '加深(加深区)', unit: '%' },

    { id: 'resPen', label: '对目标属性抗性无视(穿抗)', unit: '%' },
    { id: 'defPen', label: '对目标防御无视(穿防)', unit: '%' },
    { id: 'defDown', label: '目标防御降低(减防)', unit: '%' },
    { id: 'dmgRedPen', label: '对目标免伤无视(穿免)', unit: '%' },

    { id: 'resDown', label: '目标抗性降低(减抗)', unit: '%' },
    { id: 'tuneStrainLayer', label: '集谐干涉层数', unit: 'flat' },

    { id: 'finalDmg', label: '最终伤害(终伤区)', unit: '%' },

    { id: 'dmgTakenInc', label: '伤害提升(易伤区)', unit: '%' },

    { id: 'customFinalDmg', label: '倍率/其它(特殊终伤)', unit: '%' },

    { id: 'extraRatio', label: '额外倍率', unit: '%' }
] as const satisfies readonly ZoneDef[]

export type ZoneId = (typeof ZONE_DEFS)[number]['id']

export const ZONE_MAP = new Map(ZONE_DEFS.map((z) => [z.id, z]))

export const ZONE_REF_DEFS = [
    { id: 'baseAtk', label: '攻击白值', unit: 'flat' },
    { id: 'totalAtk', label: '当前攻击', unit: 'flat' },
    { id: 'baseHp', label: '生命白值', unit: 'flat' },
    { id: 'totalHp', label: '当前最大生命', unit: 'flat' },
    { id: 'baseDef', label: '防御白值', unit: 'flat' },
    { id: 'totalDef', label: '当前防御', unit: 'flat' },
    { id: 'recharge', label: '共鸣效率', unit: '%' },
    { id: 'tuneBreakBoost', label: '谐度破坏增幅', unit: 'flat' },
    { id: 'offTuneBuildupRate', label: '偏谐值累积效率', unit: '%' },
    { id: 'critRate', label: '暴击率', unit: '%' },
    { id: 'critDmg', label: '暴击伤害', unit: '%' }
] as const satisfies readonly ZoneDef[]

export const ZONE_REF_MAP: Map<string, ZoneDef> = new Map(ZONE_REF_DEFS.map((z) => [z.id, z]))

export function parseRatio(r: string): number {
    return parseFloat(r.replace('%', '')) / 100
}

export { DAMAGE_TYPES, DAMAGE_TYPE_SHORT } from '$lib/consts/game-terms'

export const LAYERED_BUFF_PATTERN = /^(.+?)(\d+)([^\d]*)$/

export interface GroupedBuffSetItem {
    key: string
    type: 'item' | 'folder'
    buffSet?: BuffSet
    prefix?: string
    name?: string
    prefixText?: string
    suffixText?: string
    children?: BuffSet[]
}

export function groupBuffSets(buffSets: BuffSet[]): GroupedBuffSetItem[] {
    const result: GroupedBuffSetItem[] = []
    const pattern = LAYERED_BUFF_PATTERN
    const prefixGroups = new Map<string, { suffix: string; items: BuffSet[] }>()

    for (const bs of buffSets) {
        const m = bs.name.match(pattern)
        if (m) {
            const key = m[1] + m[3]
            if (!prefixGroups.has(key)) prefixGroups.set(key, { suffix: m[3], items: [] })
            prefixGroups.get(key)!.items.push(bs)
        }
    }

    const folderKeys = new Set<string>()
    for (const [key, g] of prefixGroups) {
        if (g.items.length >= 2) folderKeys.add(key)
    }

    const seenFolders = new Set<string>()
    for (const bs of buffSets) {
        const m = bs.name.match(pattern)
        if (m) {
            const key = m[1] + m[3]
            if (folderKeys.has(key) && !seenFolders.has(key)) {
                seenFolders.add(key)
                result.push({
                    key: 'folder:' + key,
                    type: 'folder',
                    name: m[1] + 'N' + m[3],
                    prefix: key,
                    prefixText: m[1],
                    suffixText: m[3],
                    children: prefixGroups.get(key)!.items
                })
            } else if (!folderKeys.has(key)) {
                result.push({ key: bs.id, type: 'item', buffSet: bs })
            }
        } else {
            result.push({ key: bs.id, type: 'item', buffSet: bs })
        }
    }

    return result
}
