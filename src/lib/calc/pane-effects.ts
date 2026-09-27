/**
 * @desc 跨角色引用的「影响源」纯逻辑：把面板乘区、作用域判定与条目归属抽到这里，
 * 让计算引擎 store、拉表界面与数据迁移共用同一口径（迁移不能用带 runes 的 store）。
 *
 * 语义（伤害是当下的，buff 也是当下的）：
 * - 某段伤害引用了角色 Y 的面板属性 Z 时，**绑定到这段伤害**的、作用域指向 Y 且会改写 Z 的 Buff，
 *   会参与 Y 在这一段下的面板计算 —— 这些 Buff 就是该段伤害的「影响源」。
 * - v2 → v3 迁移用同一套判定，把「旧语义下通过 Y 的其它条目间接生效」的影响源补勾到引用它们的伤害段上。
 */

import type { BuffInstance, BuffZoneValue } from './calculation.types'
import type { CharSlot } from '$lib/types/project'
import { parseValueString } from '$lib/utils/parse-value-string'

/** @desc 面板属性 id（ref 可引用的乘区）→ 会改写该面板的乘区键（与 compute 的 ZONE_OPS 口径一致） */
export const PANEL_TO_ZONES: Record<string, string[]> = {
    baseAtk: ['atkFlat', 'atkPct'],
    totalAtk: ['atkFlat', 'atkPct'],
    baseHp: ['hpFlat', 'hpPct'],
    totalHp: ['hpFlat', 'hpPct'],
    baseDef: ['defFlat', 'defPct'],
    totalDef: ['defFlat', 'defPct'],
    recharge: ['recharge'],
    tuneBreakBoost: ['tuneBreakBoost'],
    offTuneBuildupRate: ['offTuneBuildupRate'],
    critRate: ['critRate'],
    critDmg: ['critDmg']
}

/** @desc 作用域是否作用于给定角色槽位（与引擎 scopeMatches 同口径；charIdx < 0 表示非角色条目/效应伤害） */
export const scopeTouches = (scope: 'all' | number[], charIdx: number, isEffect: boolean): boolean => {
    if (scope === 'all') return true
    if (scope.length === 0) return isEffect && charIdx < 0
    return scope.includes(charIdx)
}

/** @desc Buff 实例的全部乘区（variants 优先，兼容单变体 zones 写法） */
export const zonesOf = (buff: BuffInstance): BuffZoneValue[] =>
    buff.variants?.length ? buff.variants.flatMap((v) => v.zones ?? []) : (buff.zones ?? [])

/** @desc 某 Buff 直接改写（add，非引用 / 非覆盖 / 非零）的乘区键集合 */
export const buffPanelZoneIds = (buff: BuffInstance): Set<string> => {
    const ids = new Set<string>()
    for (const z of zonesOf(buff)) {
        if (z.ref || z.override || z.value === 0) continue
        ids.add(z.zoneId)
    }
    return ids
}

/** @desc 某 Buff 的引用目标（转模）列表：被引用角色槽位 + 被引用面板属性 id */
export const refTargetsOf = (buff: BuffInstance): { characterIdx: number; zoneId: string }[] => {
    const out: { characterIdx: number; zoneId: string }[] = []
    for (const z of zonesOf(buff)) {
        if (!z.ref) continue
        out.push({ characterIdx: z.ref.characterIdx, zoneId: z.ref.zoneId })
    }
    return out
}

/** @desc 该 Buff 是否改写了某个面板属性（被引用乘区） */
export const rewritesPanel = (buff: BuffInstance, refZoneId: string): string[] => {
    const keys = PANEL_TO_ZONES[refZoneId] ?? []
    if (keys.length === 0) return []
    const zones = buffPanelZoneIds(buff)
    return keys.filter((k) => zones.has(k))
}

/** @desc 单条伤害的「影响源」：会改写「本段所引用面板」的其它 Buff（buffId → 被引用角色 + 被改写乘区） */
export interface PaneEffectSource {
    /** @desc 被本段引用的角色槽位（这些 Buff 作用于该角色） */
    charIdx: number
    /** @desc 被改写的面板乘区键（ZONE_REF_DEFS 的 id） */
    zoneIds: string[]
}

/**
 * @desc 计算某段伤害的影响源集合。
 * @param ownCharIdx 本段所属角色槽位（-1 = 非角色条目/效应伤害）
 * @param ownActive 本段的引用是否成立（作用域作用于本段所属角色）
 * @param boundIds 本段已绑定的 Buff id
 */
export const paneEffectSourcesOf = (
    ownCharIdx: number,
    isEffect: boolean,
    boundIds: readonly string[],
    buffs: readonly BuffInstance[]
): Record<string, PaneEffectSource> => {
    if (boundIds.length === 0) return {}
    const bound = new Set(boundIds)
    const out: Record<string, PaneEffectSource> = {}
    for (const buff of buffs) {
        // 只有在本段真正生效的 Buff，它的引用才谈得上「影响源」
        if (!bound.has(buff.id) || !scopeTouches(buff.scope, ownCharIdx, isEffect)) continue
        for (const ref of refTargetsOf(buff)) {
            if (ref.characterIdx < 0 || ref.characterIdx === ownCharIdx) continue
            const keys = PANEL_TO_ZONES[ref.zoneId]
            if (!keys?.length) continue
            for (const other of buffs) {
                if (other.id === buff.id) continue
                if (!scopeTouches(other.scope, ref.characterIdx, false)) continue
                const hits = rewritesPanel(other, ref.zoneId)
                if (hits.length === 0) continue
                const existing = out[other.id]
                if (existing && existing.charIdx === ref.characterIdx) {
                    for (const h of hits) if (!existing.zoneIds.includes(h)) existing.zoneIds.push(h)
                    continue
                }
                if (existing) continue
                out[other.id] = { charIdx: ref.characterIdx, zoneIds: [...hits] }
            }
        }
    }
    return out
}

/** @desc 某伤害条目的归属信息（迁移用：判断本段属于哪个角色 / 是否效应伤害） */
export interface EntryOwner {
    character: string | null
    isEffect: boolean
}

/**
 * @desc 从时间线数据推导 `条目 id → { 角色, 是否效应条目 }`。
 * 条目 id 方案与 store 的 `buildDamageEntriesFromTimeline` 保持一致
 * （倍率条目 `{blockId}-{skillType}|{hitName}#{基础类型}`、固定值 `#固定`、非直伤 `{blockId}-nd|{名称}`）。
 * 只需要 id 与归属，故不依赖技能缓存（响应条目的倍率/元素不参与判定）。
 */
export const entryOwnersFromTimeline = (raw: unknown): Record<string, EntryOwner> => {
    const out: Record<string, EntryOwner> = {}
    const tl = raw as { damageBlocks?: unknown } | null
    const blocks = Array.isArray(tl?.damageBlocks) ? (tl!.damageBlocks as Record<string, unknown>[]) : []
    for (const db of blocks) {
        const blockId = String(db.id ?? '')
        const hits = Array.isArray(db.skillHits) ? (db.skillHits as Record<string, unknown>[]) : []
        for (const hit of hits) {
            const character = typeof hit.character === 'string' ? hit.character : null
            const skillType = String(hit.skillType ?? '')
            const hitName = String(hit.hitName ?? '')
            const comps = parseValueString(String(hit.ratio ?? ''))
            // 与 store 同口径：`implicitSuffix` 的成分继承「最后一个显式后缀成分」的基础类型
            let contextBaseType = '攻击'
            for (let i = comps.length - 1; i >= 0; i--) {
                const c = comps[i]
                if (c.flatValue !== undefined) continue
                if (!c.implicitSuffix) {
                    contextBaseType = c.baseType
                    break
                }
            }
            const baseTypes = new Set<string>()
            let flatTotal = 0
            for (const c of comps) {
                if (c.flatValue !== undefined) flatTotal += c.flatValue
                else baseTypes.add(c.implicitSuffix ? contextBaseType : c.baseType)
            }
            for (const baseType of baseTypes) {
                out[`${blockId}-${skillType}|${hitName}#${baseType}`] = { character, isEffect: false }
            }
            if (flatTotal > 0) out[`${blockId}-${skillType}|${hitName}#固定`] = { character, isEffect: false }
        }
        const nds = Array.isArray(db.nonDirectEntries) ? (db.nonDirectEntries as Record<string, unknown>[]) : []
        for (const nd of nds) {
            const name = String(nd.name ?? '')
            if (nd.category === '响应') {
                const responders = Array.isArray(nd.responders) ? (nd.responders as unknown[]) : []
                for (const r of responders) {
                    out[`${blockId}-nd|${name}#${String(r)}`] = { character: String(r), isEffect: false }
                }
                continue
            }
            if (nd.category === '处决') {
                const responders = Array.isArray(nd.responders) ? (nd.responders as unknown[]) : []
                out[`${blockId}-nd|${name}`] = {
                    character: responders[0] ? String(responders[0]) : null,
                    isEffect: false
                }
                continue
            }
            if (nd.category === '效应') {
                if (name === '电磁爆发') continue
                out[`${blockId}-nd|${name}`] = { character: null, isEffect: true }
            }
        }
    }
    return out
}

/**
 * @desc v2 → v3 迁移：为「引用了其它角色面板」的伤害段补齐影响源绑定。
 *
 * 旧语义下，被引用角色的面板由该角色**全部条目**上绑定的 Buff 组成；新语义下只看**本段伤害**绑定了什么。
 * 因此旧工程里那些只勾在被引用角色身上的副作用 Buff 会突然失效。迁移把它们补勾到引用它们的伤害段上：
 * - 只新增绑定，绝不删除（只加不减，幂等）
 * - 跳过全局 Buff（全局本来就会自动绑定到所有条目）
 * - 跳过自引用（引用自己角色的面板时，新旧语义下都只看本段绑定，无需补偿）
 * - 条件是否满足不参与判定：与旧语义跨条件变化保持等价（以后改链/阶/类型时行为一致）
 */
export const bindPaneEffectSources = (
    buffs: readonly BuffInstance[],
    bindings: Record<string, string[]>,
    owners: Record<string, EntryOwner>,
    team: readonly CharSlot[]
): Record<string, string[]> => {
    const buffById = new Map(buffs.map((b) => [b.id, b]))
    const charIdxOf = (name: string | null | undefined): number =>
        name ? team.findIndex((s) => s.character === name) : -1

    /** @desc 角色槽位 → 其名下全部伤害条目 id（判定「旧语义下该 Buff 是否参与了这个角色的面板」） */
    const entriesOfChar = new Map<number, string[]>()
    for (const [entryId, owner] of Object.entries(owners)) {
        const i = charIdxOf(owner.character)
        if (i < 0) continue
        const list = entriesOfChar.get(i)
        if (list) list.push(entryId)
        else entriesOfChar.set(i, [entryId])
    }
    const wasBoundToChar = (buffId: string, charIdx: number): boolean =>
        (entriesOfChar.get(charIdx) ?? []).some((entryId) => (bindings[entryId] ?? []).includes(buffId))

    const out: Record<string, string[]> = {}
    for (const [entryId, ids] of Object.entries(bindings)) {
        const owner = owners[entryId]
        if (!owner) {
            out[entryId] = [...ids]
            continue
        }
        const ownIdx = charIdxOf(owner.character)
        const bound = new Set(ids)
        const add = new Set<string>()
        for (const id of ids) {
            const buff = buffById.get(id)
            if (!buff) continue
            if (!scopeTouches(buff.scope, ownIdx, owner.isEffect)) continue
            for (const ref of refTargetsOf(buff)) {
                const target = ref.characterIdx
                if (target < 0 || target === ownIdx) continue
                const keys = PANEL_TO_ZONES[ref.zoneId]
                if (!keys?.length) continue
                for (const cand of buffs) {
                    if (cand.id === buff.id || cand.global) continue
                    if (bound.has(cand.id) || add.has(cand.id)) continue
                    if (!scopeTouches(cand.scope, target, false)) continue
                    if (rewritesPanel(cand, ref.zoneId).length === 0) continue
                    if (!wasBoundToChar(cand.id, target)) continue
                    add.add(cand.id)
                }
            }
        }
        out[entryId] = add.size > 0 ? [...ids, ...add] : [...ids]
    }
    return out
}
