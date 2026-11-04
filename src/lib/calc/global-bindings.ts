/**
 * @desc 全局 Buff 的自动绑定纯逻辑（store / 迁移 / 测试共用）。
 *
 * 全局 Buff 不是「只属于某个角色」，而是「始终作为候选出现在相关条目上」：
 * - 作用域仍决定它到底给谁加属性（`activeBoundForChar` 会再按 charIdx 过滤），
 *   所以把作用域 [1] 的全局 Buff 绑到别的角色的条目上，不会让那个角色白吃属性；
 * - 但跨角色引用（转模）读的是「本条目可见的被引用角色面板」，候选 Buff 必须先挂在本条目上。
 *   若全局自作用域 Buff 只按作用域绑到主人自己的条目，队友引用主人面板时就会看不到它
 *   （典型症状：仇远固有天赋放全局后，队友的暴击率转模仍然少 8%）。
 *
 * 因此：全局 Buff 绑到「作用域命中的条目」**以及「引用了作用域角色的条目」**，其余的条目不绑，
 * 避免把无关条目的绑定表撑大、也避免差异视图把全局自 Buff 误列到其它角色行。
 */

import type { BuffConf } from './calculation.types'
import { scopeTouches } from './pane-effects'

export interface GlobalBindingEntry {
    id: string
    character: string | null
    isEffect: boolean
}

export interface GlobalBindingArgs {
    entries: readonly GlobalBindingEntry[]
    team: readonly { character: string | null }[]
    buffs: readonly BuffConf[]
    globalIds: readonly string[]
    bindings: Record<string, string[]>
}

/** @desc 本条目上「当前能生效的 Buff」引用到的角色槽位（转模来源） */
const activeRefTargetsOf = (
    ids: Iterable<string>,
    buffById: ReadonlyMap<string, BuffConf>,
    ownerIdx: number,
    isEffect: boolean
): Set<number> => {
    const targets = new Set<number>()
    for (const id of ids) {
        const buff = buffById.get(id)
        if (!buff || !scopeTouches(buff.scope, ownerIdx, isEffect)) continue
        for (const zone of buff.zones ?? []) {
            if (zone.ref && zone.ref.characterIdx >= 0) targets.add(zone.ref.characterIdx)
        }
    }
    return targets
}

/**
 * @desc 重建全局 Buff 绑定：
 * 1. 先剥掉所有旧的全局绑定（避免条目被改作用域/删除后留下过期绑定）；
 * 2. 对每个条目，保留非全局绑定；
 * 3. 把全局 Buff 挂到「作用域命中本条目主人」或「本条目引用了该 Buff 作用域角色」的条目上。
 */
export const rebuildGlobalBindings = (args: GlobalBindingArgs): Record<string, string[]> => {
    const { entries, team, buffs, globalIds, bindings } = args
    if (globalIds.length === 0) return bindings

    const globalSet = new Set(globalIds)
    const globalBuffs = buffs.filter((buff) => globalSet.has(buff.id))
    const buffById = new Map(buffs.map((buff) => [buff.id, buff]))
    const charIdxOf = new Map<string, number>()
    team.forEach((slot, i) => {
        if (slot.character) charIdxOf.set(slot.character, i)
    })

    const next: Record<string, string[]> = {}
    for (const [entryId, ids] of Object.entries(bindings)) {
        const filtered = ids.filter((id) => !globalSet.has(id))
        if (filtered.length > 0) next[entryId] = filtered
    }

    for (const entry of entries) {
        const ownerIdx = entry.character ? (charIdxOf.get(entry.character) ?? -1) : -1
        const kept = next[entry.id] ?? []
        // 全局 Buff 本身也可能带引用（例如全局 team Buff 转模读角色面板），一并纳入来源判定
        const refTargets = activeRefTargetsOf([...kept, ...globalIds], buffById, ownerIdx, entry.isEffect)
        const applicable = globalBuffs.filter(
            (buff) =>
                scopeTouches(buff.scope, ownerIdx, entry.isEffect) ||
                [...refTargets].some((refIdx) => scopeTouches(buff.scope, refIdx, false))
        )
        const merged = [...new Set([...kept, ...applicable.map((buff) => buff.id)])]
        if (merged.length > 0) next[entry.id] = merged
    }

    return next
}
