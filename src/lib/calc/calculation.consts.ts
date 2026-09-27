import type { ZoneDef, BuffSet } from './calculation.types'

/** @desc 全部乘区定义（拉表页可配置的 Buff 乘区清单）：按「基本固定值 → 基本百分比 → 双暴 → 增伤拐 → 特殊终伤 → 倍率 → 使目标 → 对目标 → 层数」分区排列（见 ZONE_SECTIONS） */
export const ZONE_DEFS = [
    { id: 'atkFlat', label: '攻击固定值', unit: 'flat' },
    { id: 'hpFlat', label: '生命固定值', unit: 'flat' },
    { id: 'defFlat', label: '防御固定值', unit: 'flat' },
    { id: 'tuneBreakBoost', label: '谐度破坏增幅', unit: 'flat' },

    { id: 'atkPct', label: '攻击百分比', unit: '%' },
    { id: 'hpPct', label: '生命百分比', unit: '%' },
    { id: 'defPct', label: '防御百分比', unit: '%' },
    { id: 'recharge', label: '共鸣效率', unit: '%' },
    { id: 'offTuneBuildupRate', label: '偏谐值累积效率', unit: '%' },

    { id: 'critRate', label: '暴击率', unit: '%' },
    { id: 'critDmg', label: '暴击伤害', unit: '%' },

    { id: 'bonusDmg', label: '加成(增伤区)', unit: '%' },
    { id: 'deepenDmg', label: '加深(加深区)', unit: '%' },
    { id: 'dmgTakenInc', label: '伤害提升(易伤区)', unit: '%' },
    { id: 'finalDmg', label: '最终伤害(终伤区)', unit: '%' },

    { id: 'specialFinal1', label: '特殊终伤(1)', unit: '%' },
    { id: 'specialFinal2', label: '特殊终伤(2)', unit: '%' },

    { id: 'extraRatio', label: '额外倍率', unit: '%' },

    { id: 'defDown', label: '防御降低(减防)', unit: '%' },
    { id: 'resDown', label: '抗性降低(减抗)', unit: '%' },

    { id: 'resPen', label: '属性抗性无视(穿抗)', unit: '%' },
    { id: 'defPen', label: '防御无视(穿防)', unit: '%' },
    { id: 'dmgRedPen', label: '免伤无视(穿免)', unit: '%' },

    { id: 'tuneStrainLayer', label: '集谐干涉层数', unit: 'flat' },
    { id: 'unisonBoonLayer', label: '同奏增益层数', unit: 'flat' }
] as const satisfies readonly ZoneDef[]

/** @desc ZoneId 联合类型与查询 Map（由 ZONE_DEFS 派生，供界面与计算引擎快速查乘区定义） */
export type ZoneId = (typeof ZONE_DEFS)[number]['id']

/** @desc 乘区定义查询表（key 用宽 string：历史 id / 导入数据可能不在当前清单内，取不到即为 undefined） */
export const ZONE_MAP: Map<string, ZoneDef> = new Map(ZONE_DEFS.map((z) => [z.id, z]))

/** @desc 乘区分组（「添加乘区」与工坊 Buff 集编辑器按此分区展示；顺序即展示顺序） */
export const ZONE_SECTIONS = [
    { title: '基本固定值', ids: ['atkFlat', 'hpFlat', 'defFlat', 'tuneBreakBoost'] },
    { title: '基本百分比', ids: ['atkPct', 'hpPct', 'defPct', 'recharge', 'offTuneBuildupRate'] },
    { title: '双暴', ids: ['critRate', 'critDmg'] },
    { title: '常见增伤拐', ids: ['bonusDmg', 'deepenDmg', 'dmgTakenInc', 'finalDmg'] },
    { title: '特殊增伤拐或倍率提升', ids: ['specialFinal1', 'specialFinal2'] },
    { title: '倍率追加或锚定', ids: ['extraRatio'] },
    { title: '使目标', ids: ['defDown', 'resDown'] },
    { title: '对目标', ids: ['resPen', 'defPen', 'dmgRedPen'] },
    { title: '层数相关独立终伤', ids: ['tuneStrainLayer', 'unisonBoonLayer'] }
] as const satisfies readonly { title: string; ids: readonly ZoneId[] }[]

/** @desc 分区后的乘区清单（每个分区一组定义，顺序与 ZONE_SECTIONS 一致；未列入分区的乘区兜底进「其它」） */
export const ZONE_SECTION_VIEWS: { title: string; defs: ZoneDef[] }[] = (() => {
    const listed = new Set<string>(ZONE_SECTIONS.flatMap((s) => [...s.ids]))
    const views: { title: string; defs: ZoneDef[] }[] = ZONE_SECTIONS.map((s) => ({
        title: s.title,
        defs: s.ids.map((id) => ZONE_MAP.get(id)).filter((d): d is ZoneDef => Boolean(d))
    }))
    const rest = ZONE_DEFS.filter((z) => !listed.has(z.id))
    if (rest.length > 0) views.push({ title: '其它', defs: [...rest] })
    return views
})()

/** @desc 乘区 id → 所属分区标题（界面分组与提示用） */
export const ZONE_SECTION_OF: Map<string, string> = new Map(
    ZONE_SECTION_VIEWS.flatMap((s) => s.defs.map((d) => [d.id, s.title] as const))
)

/** @desc 旧乘区 id → 现乘区 id 别名表（历史工程 / 工坊 Buff 集 / 分享数据里的旧 id 在归一化时重映射） */
export const LEGACY_ZONE_IDS: Record<string, string> = {
    customFinalDmg: 'specialFinal1',
    customFinalDmgMul: 'specialFinal2'
}

/** @desc 把历史乘区 id 归一化为当前 id（已是当前 id 或无法识别的 id 原样返回） */
export const resolveZoneId = (id: string): string => LEGACY_ZONE_IDS[id] ?? id

/** @desc 层数类乘区（集谐干涉/同奏增益等）：只支持直接填固定层数，不支持 ref 引用/转模（引擎/UI/AI 共用判定） */
export const ZONE_NO_REF_IDS = new Set<string>(['tuneStrainLayer', 'unisonBoonLayer'])

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

/** @desc 按叠层命名规则把 Buff 列表分组：同「前缀+后缀」且 ≥2 条归入一个 folder（folder 内按数字升序），其余保持 item */
export function groupBuffSets(buffSets: BuffSet[]): GroupedBuffSetItem[] {
    const result: GroupedBuffSetItem[] = []
    const pattern = LAYERED_BUFF_PATTERN
    const prefixGroups = new Map<string, { suffix: string; items: BuffSet[] }>()
    /** @desc 名字里的数字（用于目录内自动排序），无数字按 0 */
    const numOf = (name: string): number => {
        const m = name.match(pattern)
        const n = m ? parseInt(m[2], 10) : 0
        return Number.isFinite(n) ? n : 0
    }

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
        if (g.items.length >= 2) {
            folderKeys.add(key)
            // 三级目录：同源条目按名字里的数字自动升序（1层 < 2层 < 10层）
            g.items.sort((a, b) => numOf(a.name) - numOf(b.name))
        }
    }

    const seenFolders = new Set<string>()
    for (const bs of buffSets) {
        const m = bs.name.match(pattern)
        if (m) {
            const key = m[1] + m[3]
            if (folderKeys.has(key) && !seenFolders.has(key)) {
                seenFolders.add(key)
                result.push({
                    key: `folder:${key}`,
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
