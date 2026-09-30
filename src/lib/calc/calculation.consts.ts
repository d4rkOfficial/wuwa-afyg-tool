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
    { id: 'unisonBoonLayer', label: '同奏增益层数', unit: 'flat' },

    { id: 'customLayer1', label: '自定义层数(1)', unit: 'flat' },
    { id: 'customLayer2', label: '自定义层数(2)', unit: 'flat' },
    { id: 'customLayer3', label: '自定义层数(3)', unit: 'flat' }
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
    { title: '层数相关独立终伤', ids: ['tuneStrainLayer', 'unisonBoonLayer'] },
    { title: '自定义层数', ids: ['customLayer1', 'customLayer2', 'customLayer3'] }
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

/**
 * @desc 不支持 ref 引用/转模的乘区（引擎/UI/AI 共用判定）。
 *
 * 目前**只有集谐干涉层数**在名单里：它只允许直接填固定层数。同奏增益层数与
 * 自定义层数(1)(2)(3) 都可以引用；新增乘区默认即可引用，只有确实需要「只允许固定值」时才加进来。
 */
export const ZONE_NO_REF_IDS = new Set<string>(['tuneStrainLayer'])

/** @desc 不支持「覆盖」语义的乘区：百分比类与额外倍率恒为追加（界面不显示覆盖按钮，store/工坊/导入共用判定） */
export const ZONE_NO_OVERRIDE_IDS = new Set<string>(['atkPct', 'hpPct', 'defPct', 'extraRatio'])

/**
 * @desc 目标侧乘区：数值挂在**目标/怪物**身上，全队共用一份，没有「某角色的」这一说。
 *
 * 目前只有集谐·干涉层数（`tuneStrainLayer`）：由队伍施加在目标身上。
 * 引擎聚合这些乘区时**不按作用域过滤**（一条「作用域=角色1」的集谐 buff 也照样给全队提供层数），
 * 因此不存在「某某角色的集谐干涉层数」。它也因此不能配引用、不能作为引用来源。
 */
export const TARGET_SIDE_ZONE_IDS = new Set<string>(['tuneStrainLayer'])

/**
 * @desc 可被「引用」的来源清单（ZoneRef 的目标）：角色白值/当前面板/充能/谐度/双暴，
 * 以及**按角色独立**的层数（同奏增益层数、自定义层数(1)(2)(3)）。
 */
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
    { id: 'critDmg', label: '暴击伤害', unit: '%' },

    /**
     * @desc 层数类来源：读**被引用角色**自己累计的层数（每个角色独立）。
     * 同奏增益层数与自定义层数属于角色，因此可被其它乘区按角色引用；
     * 集谐干涉层数不属于角色，故不作为引用来源。
     */
    { id: 'unisonBoonLayer', label: '同奏增益层数', unit: 'flat' },
    { id: 'customLayer1', label: '自定义层数(1)', unit: 'flat' },
    { id: 'customLayer2', label: '自定义层数(2)', unit: 'flat' },
    { id: 'customLayer3', label: '自定义层数(3)', unit: 'flat' }
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

/** @desc Buff 作用域归类：全队=三个角色都能吃到 / 效应专属=仅效应伤害（空数组）/ 指定角色槽位 */
export interface BuffScopeClass {
    kind: 'all' | 'effect' | 'chars'
    /** @desc kind='chars' 时的角色槽位（去重升序） */
    idxs: number[]
}

/**
 * @desc 归类一个 Buff 的作用域（列表作用域徽标共用口径）：
 * - `'all'` → 全队
 * - 空数组 → 效应专属（只对效应伤害生效）
 * - 槽位数组 → 指定角色；**槽位覆盖全部角色时等价于全队**（只显示「全队」，不再逐个列角色名）
 */
export const classifyBuffScope = (scope: 'all' | number[] | undefined, teamSize = 3): BuffScopeClass => {
    if (!Array.isArray(scope)) return { kind: 'all', idxs: [] }
    const idxs = [...new Set(scope)].filter((i) => Number.isInteger(i) && i >= 0 && i < teamSize).sort((a, b) => a - b)
    if (idxs.length === 0) return { kind: 'effect', idxs: [] }
    if (idxs.length >= teamSize) return { kind: 'all', idxs: [] }
    return { kind: 'chars', idxs }
}

/** @desc 自然序比较（数字段按数值比较），用于最低一级数字目录排序 */
const compareNaturalKey = (a: string, b: string): number =>
    a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })

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
    const folders: GroupedBuffSetItem[] = []
    const items: GroupedBuffSetItem[] = []
    for (const bs of buffSets) {
        const m = bs.name.match(pattern)
        if (m) {
            const key = m[1] + m[3]
            if (folderKeys.has(key)) {
                if (seenFolders.has(key)) continue
                seenFolders.add(key)
                // 最低一级目录：数字文件夹总是排在所有 buff 条目的上方（按自然序）
                folders.push({
                    key: `folder:${key}`,
                    type: 'folder',
                    name: m[1] + LAYERED_BUFF_VAR + m[3],
                    prefix: key,
                    prefixText: m[1],
                    suffixText: m[3],
                    children: prefixGroups.get(key)!.items
                })
                continue
            }
        }
        items.push({ key: bs.id, type: 'item', buffSet: bs })
    }
    folders.sort((a, b) => compareNaturalKey(a.prefix ?? '', b.prefix ?? ''))
    result.push(...folders, ...items)

    return result
}
