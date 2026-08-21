import type { ZoneDef, BuffSet } from './calculation.types'

/** @desc 全部乘区定义（拉表页可配置的 Buff 乘区清单）：攻击/生命/防御/双暴/充能/谐度/增伤/加深/穿透/减抗/终伤/易伤/额外倍率等，unit 区分百分比与固定值 */
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
    { id: 'customFinalDmgMul', label: '倍率/其它(特殊终伤·乘算)', unit: '%' },

    { id: 'extraRatio', label: '额外倍率', unit: '%' }
] as const satisfies readonly ZoneDef[]

/** @desc ZoneId 联合类型与查询 Map（由 ZONE_DEFS 派生，供界面与计算引擎快速查乘区定义） */
export type ZoneId = (typeof ZONE_DEFS)[number]['id']

export const ZONE_MAP = new Map(ZONE_DEFS.map((z) => [z.id, z]))

/** @desc 可被「引用」的属性清单（ZoneRef 的目标）：角色白值/当前面板/充能/谐度/双暴等 */
export const ZONE_REF_DEFS = [
    { id: 'baseAtk', label: '攻击白值', unit: 'flat' },
    { id: 'totalAtk', label: '当前攻击', unit: 'flat' },
    { id: 'baseHp', label: '生命白值', unit: 'flat' },
    { id: 'totalHp', label: '生命上限', unit: 'flat' },
    { id: 'baseDef', label: '防御白值', unit: 'flat' },
    { id: 'totalDef', label: '当前防御', unit: 'flat' },
    { id: 'recharge', label: '共鸣效率', unit: '%' },
    { id: 'tuneBreakBoost', label: '谐度破坏增幅', unit: 'flat' },
    { id: 'offTuneBuildupRate', label: '偏谐值累积效率', unit: '%' },
    { id: 'critRate', label: '暴击率', unit: '%' },
    { id: 'critDmg', label: '暴击伤害', unit: '%' }
] as const satisfies readonly ZoneDef[]

/** @desc 引用属性的查询 Map（同上，供 ZoneRef 目标查表） */
export const ZONE_REF_MAP: Map<string, ZoneDef> = new Map(ZONE_REF_DEFS.map((z) => [z.id, z]))

/** @desc 把 "15%" 之类的字符串解析为小数（15% → 0.15） */
export function parseRatio(r: string): number {
    return parseFloat(r.replace('%', '')) / 100
}

/** @desc 伤害类型常量（普攻/重击/…伤害 及其短名），转出到 game-terms 常量 */
export { DAMAGE_TYPES, DAMAGE_TYPE_SHORT } from '$lib/consts/game-terms'

/** @desc 叠层 Buff 命名模式：匹配「前缀+数字+后缀」（如 3+30%/6+75% 这类按层数展开的同源倍率条目） */
export const LAYERED_BUFF_PATTERN = /^(.+?)(\d+)([^\d]*)$/

/** @desc 叠层文件夹中「数字变量」的通用占位名（表头/文件夹名中代表随层数变化的数字） */
export const LAYERED_BUFF_VAR = '?'

/** @desc 分组条目：folder=叠层文件夹（同前缀 ≥2 条自动归组），item=普通 Buff 条目 */
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

/** @desc 按叠层命名规则把 Buff 列表分组：同「前缀+后缀」且 ≥2 条归入一个 folder（folder 内部保持原顺序），其余保持 item */
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
                    name: m[1] + LAYERED_BUFF_VAR + m[3],
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
