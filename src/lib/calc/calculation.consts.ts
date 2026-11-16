import type { BuffConf } from './calculation.types'
import {
    ACTION_GROUPS,
    BUFF_ACTIONS,
    REF_SOURCES,
    REF_SOURCE_MAP,
    type ActionId,
    type BuffActionDef,
    type RefSourceDef
} from '$lib/calc/core-config'

/**
 * @desc 界面与迁移共用的兼容层：作用注册表（`registry/actions.ts`）派生出的
 * 「乘区形态」视图。命名沿用旧口径（`ZONE_*`），语义已改为「Buff 作用」——
 * 「乘区」一词现在只指公式链上的乘子（增伤区 / 防御区 / 暴击区…），不再是这里的实体。
 */
export type { ActionId, ActionCombine, ActionSide, BuffActionDef, PanelDim, RefSourceDef } from '$lib/calc/core-config'
export {
    ACTION_GROUPS,
    ACTION_MAP,
    BUFF_ACTIONS,
    REF_SOURCES,
    REF_SOURCE_MAP,
    refWrittenBy,
    writtenByOf
} from '$lib/calc/core-config'

/** @desc 全部作用定义（顺序 = 界面「添加作用」右栏；与旧 `ZONE_DEFS` 逐项对齐） */
export const ZONE_DEFS = BUFF_ACTIONS

/** @desc 作用 id 联合类型（由注册表推导） */
export type ZoneId = ActionId

/** @desc 作用定义查询表（key 用宽 string：历史 id / 导入数据可能不在当前清单内，取不到即为 undefined） */
export const ZONE_MAP: Map<string, BuffActionDef> = new Map(BUFF_ACTIONS.map((a) => [a.id, a]))

/** @desc 作用分组（「添加作用」与 Buff 集编辑器按此分区展示；顺序即展示顺序） */
export const ZONE_SECTIONS: readonly { title: string; ids: readonly string[] }[] = ACTION_GROUPS.map((title) => ({
    title,
    ids: BUFF_ACTIONS.filter((a) => a.group === title).map((a) => a.id)
}))

/** @desc 分区后的作用清单（每个分区一组定义，顺序与 `ZONE_SECTIONS` 一致；未列入分区的兜底进「其它」） */
export const ZONE_SECTION_VIEWS: { title: string; defs: BuffActionDef[] }[] = (() => {
    const listed = new Set<string>(ZONE_SECTIONS.flatMap((s) => [...s.ids]))
    const views: { title: string; defs: BuffActionDef[] }[] = ZONE_SECTIONS.map((s) => ({
        title: s.title,
        defs: s.ids.map((id) => ZONE_MAP.get(id)).filter((d): d is BuffActionDef => Boolean(d))
    }))
    const rest = BUFF_ACTIONS.filter((z) => !listed.has(z.id))
    if (rest.length > 0) views.push({ title: '其它', defs: [...rest] })
    return views
})()

/** @desc 作用 id → 所属分区标题（界面分组与提示用） */
export const ZONE_SECTION_OF: Map<string, string> = new Map(
    ZONE_SECTION_VIEWS.flatMap((s) => s.defs.map((d) => [d.id, s.title] as const))
)

/** @desc 旧作用 id → 现作用 id 别名表（历史工程 / 工坊 Buff 集 / 分享数据里的旧 id 在归一化时重映射） */
export const LEGACY_ZONE_IDS: Record<string, string> = {
    customFinalDmg: 'specialFinal1',
    customFinalDmgMul: 'specialFinal2'
}

/** @desc 把历史作用 id 归一化为当前 id（已是当前 id 或无法识别的 id 原样返回） */
export const resolveZoneId = (id: string): string => LEGACY_ZONE_IDS[id] ?? id

/**
 * @desc **不能作为引用写入目标**的作用：目标侧作用（值挂在目标面板上，由 Buff 直接聚合，
 * 不接受「按面板读数回写」这种形态）。目前只有集谐干涉层数。
 *
 * 注意与「能作为引用**来源**」区分：后者是 `REF_SOURCES`（可被读取的面板属性）。
 */
export const ZONE_NO_REF_IDS = new Set<string>(BUFF_ACTIONS.filter((a) => a.side === 'target').map((a) => a.id))

/** @desc 界面不提供「覆盖」写入的作用（引擎侧写模式恒合法，不构成 gate） */
export const ZONE_NO_OVERRIDE_IDS = new Set<string>(BUFF_ACTIONS.filter((a) => !a.overridable).map((a) => a.id))

/**
 * @desc 目标侧作用：数值挂在**目标/怪物**身上，全队共用一份，没有「某角色的」这一说。
 *
 * 引擎聚合这些作用时**不按作用域过滤**（一条「作用域=角色1」的集谐 buff 也照样给全队提供层数），
 * 因此不存在「某某角色的集谐干涉层数」。
 */
export const TARGET_SIDE_ZONE_IDS = new Set<string>(BUFF_ACTIONS.filter((a) => a.side === 'target').map((a) => a.id))

/** @desc 可作为引用（转模）来源的面板属性清单 */
export const ZONE_REF_DEFS = REF_SOURCES

/** @desc 引用属性的查询 Map（同上，供 ZoneRef 目标查表） */
export const ZONE_REF_MAP: ReadonlyMap<string, RefSourceDef> = REF_SOURCE_MAP

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
export interface GroupedBuffConfItem {
    key: string
    type: 'item' | 'folder'
    buffSet?: BuffConf
    prefix?: string
    name?: string
    prefixText?: string
    suffixText?: string
    children?: BuffConf[]
}

/** @desc Buff 作用域归类（四态）：通用 / 全队 / 仅效应 / 指定角色子集 */
export interface BuffScopeClass {
    kind: 'all' | 'charsAll' | 'effect' | 'chars'
    /** @desc kind='chars' 时的角色槽位（去重升序） */
    idxs: number[]
}

/**
 * @desc 归类一个 Buff 的作用域（列表作用域徽标 / 生效成员卡共用口径），四态一一对应：
 * - `'all'` → **通用**（三名角色 + 效应伤害都吃）
 * - `[0,1,2]`（槽位覆盖全部角色）→ **全队**（只有三名角色，**不含**效应伤害）
 * - `[]` → **仅效应**
 * - 其余槽位数组 → 指定角色子集
 *
 * 注意 `[0,1,2]`（全队）与 `'all'`（通用）是**不同**状态：引擎里 `'all'` 连效应条目一起生效，
 * 而 `[0,1,2]` 只对三个角色槽位生效（效应条目没有角色槽位）。
 */
export const classifyBuffScope = (scope: 'all' | number[] | undefined, teamSize = 3): BuffScopeClass => {
    if (!Array.isArray(scope)) return { kind: 'all', idxs: [] }
    const idxs = [...new Set(scope)].filter((i) => Number.isInteger(i) && i >= 0 && i < teamSize).sort((a, b) => a - b)
    if (idxs.length === 0) return { kind: 'effect', idxs: [] }
    if (idxs.length >= teamSize) return { kind: 'charsAll', idxs: [] }
    return { kind: 'chars', idxs }
}

/** @desc 作用域是否命中效应伤害（`'all'` 与 `[]` 命中；`[0,1,2]` 及其它角色子集不命中） */
export const scopeIncludesEffect = (scope: 'all' | number[] | undefined): boolean =>
    !Array.isArray(scope) || scope.length === 0

/** @desc 作用域命中的角色槽位（去重升序；`'all'` 与 `[0,1,2]` 都是全部槽位；`[]` 为空） */
export const scopeCharIdxs = (scope: 'all' | number[] | undefined, teamSize = 3): number[] =>
    Array.isArray(scope) ? classifyBuffScope(scope, teamSize).idxs : Array.from({ length: teamSize }, (_, i) => i)

/** @desc 自然序比较（数字段按数值比较），用于最低一级数字目录排序 */
const compareNaturalKey = (a: string, b: string): number =>
    a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })

/** @desc 按叠层命名规则把 Buff 列表分组：同「前缀+后缀」且 ≥2 条归入一个 folder（folder 内按数字升序），其余保持 item */
export function groupBuffSets(buffSets: BuffConf[]): GroupedBuffConfItem[] {
    const result: GroupedBuffConfItem[] = []
    const pattern = LAYERED_BUFF_PATTERN
    const prefixGroups = new Map<string, { suffix: string; items: BuffConf[] }>()
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
    const folders: GroupedBuffConfItem[] = []
    const items: GroupedBuffConfItem[] = []
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
