/**
 * @desc 下拉表（`dropdown-table.svelte`）的**纯计算层**：可见 Buff 筛选、Buff 差异模式数据、
 * 「上一段/下一段同角色直伤」「上一个/下一个同名效应」查找（复制增益/伤害类型的共同基元）。
 *
 * 与 `spread-table.utils.ts` 同一分工：只搬「输入 → 输出」的纯计算，交互与 store 写入留在组件里；
 * store 侧能力（条件判定口径）由调用方以函数参数注入。
 */
import type { BuffSet, DamageEntry } from '$lib/calc/calculation.types'
import type { PaneEffectSource } from '$lib/calc/pane-effects'
import { LAYERED_BUFF_PATTERN } from '$lib/calc/calculation.consts'
import { buffScopeOk, isDirectDamage } from './damage-table.utils'

/** @desc 叠层子项的显示名：只取「数字 + 后缀」（前缀已由文件夹行显示）；不匹配叠层命名时回落原名 */
export const layeredChildLabel = (name: string): string => name.match(LAYERED_BUFF_PATTERN)?.slice(2).join('') ?? name

/** @desc Buff 差异模式的单条：逐条目对比上一段（同角色直伤 / 同名效应），标出 新增/移除/不变/全局 */
export interface BuffDiffItem {
    setId: string
    name: string
    type: 'added' | 'removed' | 'same' | 'global'
}

/** @desc 从 fromIndex 往**后**找第一个同角色直伤 */
export const findNextDirectEntry = (
    entries: readonly DamageEntry[],
    fromIndex: number,
    charName: string | null | undefined
): DamageEntry | undefined => {
    for (let i = fromIndex + 1; i < entries.length; i++) {
        const e = entries[i]
        if (e.character === charName && isDirectDamage(e)) return e
    }
    return undefined
}

/** @desc 从 fromIndex 往**前**找第一个同角色直伤 */
export const findPrevDirectEntry = (
    entries: readonly DamageEntry[],
    fromIndex: number,
    charName: string | null | undefined
): DamageEntry | undefined => {
    for (let i = fromIndex - 1; i >= 0; i--) {
        const e = entries[i]
        if (e.character === charName && isDirectDamage(e)) return e
    }
    return undefined
}

/** @desc 从 fromIndex 往**后**找第一个同名效应 */
export const findNextEffectEntry = (
    entries: readonly DamageEntry[],
    fromIndex: number,
    hitName: string
): DamageEntry | undefined => {
    for (let i = fromIndex + 1; i < entries.length; i++) {
        const e = entries[i]
        if (e.isEffect && e.hitName === hitName) return e
    }
    return undefined
}

/** @desc 从 fromIndex 往**前**找第一个同名效应 */
export const findPrevEffectEntry = (
    entries: readonly DamageEntry[],
    fromIndex: number,
    hitName: string
): DamageEntry | undefined => {
    for (let i = fromIndex - 1; i >= 0; i--) {
        const e = entries[i]
        if (e.isEffect && e.hitName === hitName) return e
    }
    return undefined
}

/**
 * @desc 对当前展开条目可见的 Buff：非全局、（作用域匹配 或 属于跨角色引用影响源）、条件满足。
 * 影响源优先判定：它作用域不含本角色，但会改写「本段引用到的角色面板」，勾上即生效。
 */
export const visibleBuffSetsOf = (args: {
    buffSets: readonly BuffSet[]
    globalBuffSetIds: readonly string[]
    entryPaneSources: Record<string, PaneEffectSource>
    selectedEntry: DamageEntry | null
    entryCharIdx: number
    matches: (bs: BuffSet | undefined, entry: DamageEntry) => boolean
}): BuffSet[] =>
    args.buffSets.filter((b) => {
        if (args.globalBuffSetIds.includes(b.id)) return false
        if (args.entryPaneSources[b.id] !== undefined) {
            return !args.selectedEntry || args.matches(b, args.selectedEntry)
        }
        if (!buffScopeOk(b, args.selectedEntry?.isEffect, args.entryCharIdx)) return false
        if (args.selectedEntry && !args.matches(b, args.selectedEntry)) return false
        return true
    })

/**
 * @desc Buff 差异模式的数据：逐条目对比上一段（同角色直伤 / 同名效应），标出 新增/移除/不变/全局。
 * `matches` 为条件匹配口径（由组件注入，与平铺视图同一份 `buffMatchesEntry`）。
 */
export const buildEntryBuffDiff = (args: {
    damageEntries: readonly DamageEntry[]
    entryBuffSetIdMap: Record<string, string[]>
    globalBuffSetIds: readonly string[]
    buffById: ReadonlyMap<string, BuffSet>
    matches: (bs: BuffSet | undefined, entry: DamageEntry) => boolean
}): Record<string, BuffDiffItem[]> => {
    const { damageEntries, entryBuffSetIdMap, globalBuffSetIds, buffById, matches } = args
    const result: Record<string, BuffDiffItem[]> = {}
    for (let i = 0; i < damageEntries.length; i++) {
        const e = damageEntries[i]
        const match = (sid: string) => matches(buffById.get(sid), e)
        const nameOf = (sid: string) => buffById.get(sid)?.name ?? ''
        const boundIds = entryBuffSetIdMap[e.id] ?? []

        const globalItems = boundIds
            .filter((sid) => globalBuffSetIds.includes(sid) && match(sid))
            .map((sid) => ({ setId: sid, name: nameOf(sid), type: 'global' as const }))
        const regularItems = (type: 'same' | 'added') =>
            boundIds
                .filter((sid) => !globalBuffSetIds.includes(sid) && match(sid))
                .map((sid) => ({ setId: sid, name: nameOf(sid), type }))

        const isFirstCharEntry = e.character
            ? !damageEntries.slice(0, i).some((p) => p.character === e.character)
            : true

        // 处决/响应：与上一段比较没有意义（同类同名多条），一律按「不变」展示
        if (e.isTuneBreak || e.isTuneResponse) {
            result[e.id] = [...(isFirstCharEntry ? globalItems : []), ...regularItems('same')]
            continue
        }

        const prevId = (
            e.isEffect
                ? findPrevEffectEntry(damageEntries, i, e.hitName)
                : findPrevDirectEntry(damageEntries, i, e.character)
        )?.id
        if (!prevId) {
            result[e.id] = [...(isFirstCharEntry ? globalItems : []), ...regularItems('added')]
            continue
        }

        const curr = new Set(boundIds)
        const prev = new Set(entryBuffSetIdMap[prevId] ?? [])
        const items: BuffDiffItem[] = []
        for (const id of curr) {
            if (!prev.has(id) && match(id)) items.push({ setId: id, name: nameOf(id), type: 'added' })
        }
        for (const id of prev) {
            if (!curr.has(id) && match(id)) items.push({ setId: id, name: nameOf(id), type: 'removed' })
        }
        result[e.id] = items
    }
    return result
}
