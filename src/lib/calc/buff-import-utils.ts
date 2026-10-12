// Buff 导入纯函数（手动导入弹窗 / AI 工具共用）：构造带 ownerIdx 的导入条目 + 冲突检测
// 归属重指（ownerIdxFor / rewriteOwnerIn*）在 buff-owner.ts：那是 store 与本文件共用的逻辑，
// 放这里会形成 store ↔ utils 循环依赖，故再导出一次保持既有导入路径可用。
import type { BuffLibraryEntity, BuffLibraryBuff, BuffLibraryScope } from '$lib/data/buff-library.svelte'
import type { CharSlot } from '$lib/types/project'
import type { ImportBuffInput } from './calculation.store.svelte'
import type { BuffCondition, BuffConf, BuffZoneValue } from './calculation.types'
import { ownerIdxFor, ownerIdxOfItem, rewriteOwnerInZones } from './buff-owner'

export type { BuffLibraryEntity }
export { ownerIdxFor, ownerIdxOfItem, primaryOwnerOf, rewriteOwnerInCondition, rewriteOwnerInZones } from './buff-owner'

export function toImportItem(
    b: { name: string; scope?: BuffLibraryScope; condition?: BuffCondition; zones: ImportBuffInput['zones'] },
    ownerIdx: number
): ImportBuffInput {
    return {
        name: b.name,
        scope: b.scope,
        ownerIdx,
        ...(b.condition ? { condition: b.condition } : {}),
        // 乘区条目（含乘区级生效条件 condition）原样带入，导入时不丢条件
        zones: b.zones
    }
}

/**
 * @desc 实体全部 Buff → 导入条目：多主人时 self（主人专属）按每个主人生成独立条目，其它 scope 单条（引用第一主人）。
 * 每条都带上**该实体在当前配队里的真实归属槽位**，供导入时重指链阶条件与引用。
 */
export function buildEntityImportItems(
    entity: BuffLibraryEntity,
    team: [CharSlot, CharSlot, CharSlot] | undefined
): ImportBuffInput[] {
    const owners = ownerIdxFor(team, entity)
    const firstOwner = owners[0] ?? -1
    const selfItemsFor = (owner: number): ImportBuffInput[] =>
        entity.buffs
            .filter((b) => b.scope === 'self')
            .map((b) =>
                toImportItem({ name: b.buffName, scope: b.scope, condition: b.condition, zones: b.zones }, owner)
            )
    if (owners.length > 1) {
        const otherItems = entity.buffs
            .filter((b) => b.scope !== 'self')
            .map((b) =>
                toImportItem({ name: b.buffName, scope: b.scope, condition: b.condition, zones: b.zones }, firstOwner)
            )
        return [...owners.flatMap(selfItemsFor), ...otherItems]
    }
    return entity.buffs.map((b: BuffLibraryBuff) =>
        toImportItem({ name: b.buffName, scope: b.scope, condition: b.condition, zones: b.zones }, firstOwner)
    )
}

// ── 冲突检测：同名（内容不同）与完全一致 ────────────────────────────────────

/** @desc 与已有 buff 内容完全一致（条件 + 乘区 + 乘区条件全同，名字可不同）的导入项 */
export interface IdenticalImport {
    /** @desc 导入项在批次里的下标（决议回填用） */
    index: number
    /** @desc 导入项名字 */
    name: string
    /** @desc 命中的已有 buff（内容一致，但名字不同） */
    existingId: string
    existingName: string
    /** @desc 该导入项要落的归属槽位（-1 = 无归属）；同名多主人时用于区分 */
    slot: number
}

/** @desc 同名但内容不同：需要用户选择「跳过 / 覆盖」 */
export interface ConflictImport {
    index: number
    name: string
    existingId: string
    /** @desc 该导入项要落的归属槽位（-1 = 无归属）；同名多主人时用于区分 */
    slot: number
}

export interface ImportConflictReport {
    /** @desc 同名冲突（内容不同） */
    conflicts: ConflictImport[]
    /** @desc 内容完全一致但名字不同 → 询问是否把已有 buff 改名为导入的名字 */
    identical: IdenticalImport[]
}

/** @desc 数值稳定编码：把 ±0 归一，避免 -0 / 0 被当成不同 */
const numKey = (v: number): string => (Object.is(v, -0) ? '0' : String(v))

/** @desc 乘区级条件编码（只含属性/伤害类型，排序后比较） */
const zoneConditionKey = (cond: BuffCondition | undefined): string => {
    if (!cond) return ''
    const elements = [...(cond.elements ?? [])].sort()
    const damageTypes = [...(cond.damageTypes ?? [])].sort()
    if (!elements.length && !damageTypes.length) return ''
    return JSON.stringify({ elements, damageTypes })
}

/** @desc 引用编码（含归属槽位之外的换算参数） */
const refKey = (ref: BuffZoneValue['ref']): string => {
    if (!ref) return ''
    const parts = [
        ref.zoneId,
        `pct=${numKey(ref.pct)}`,
        `th=${numKey(ref.threshold)}`,
        `d=${ref.discrete ? 1 : 0}`,
        ref.lower === undefined ? '' : `lo=${numKey(ref.lower)}`,
        ref.upper === undefined ? '' : `up=${numKey(ref.upper)}`,
        ref.divisor === undefined ? '' : `dv=${numKey(ref.divisor)}`,
        ref.multiplier === undefined ? '' : `mu=${numKey(ref.multiplier)}`
    ]
    return parts.filter(Boolean).join('|')
}

const zoneEntryKey = (z: BuffZoneValue): string =>
    [z.zoneId, numKey(z.value), z.override ? 'o' : 'a', refKey(z.ref), zoneConditionKey(z.condition)].join('~')

/**
 * @desc 只比较**内容**（乘区条目 + 乘区条件 + 实例级条件），比较前各自排序，
 * 因此导入顺序不同、乘区顺序不同也算「同效果」；不含归属槽位与作用域（那是使用侧的选择）。
 */
export function buffContentKey(buff: { zones: readonly BuffZoneValue[]; condition?: BuffCondition | null }): string {
    const zones = [...buff.zones].map(zoneEntryKey).sort().join(';')
    const cond = buff.condition ?? undefined
    const gate = JSON.stringify({
        chains: (cond?.chains ?? []).map((c) => `${numKey(c.min)}`).sort(),
        refinements: (cond?.refinements ?? []).map((c) => `${numKey(c.min)}`).sort()
    })
    return `${zones}##${gate}`
}

/** @desc 导入项的**期望内容签名**：与 `buffContentKey` 同口径，但作用在尚未落库的 ImportBuffInput 上 */
export function importItemContentKey(item: ImportBuffInput): string {
    const owner = ownerIdxOfItem(item)
    const zones: BuffZoneValue[] = (item.zones ?? []).map((z) => {
        const zone: BuffZoneValue = { zoneId: z.zoneId as BuffZoneValue['zoneId'], value: z.value }
        if (z.override) zone.override = true
        if (z.condition) zone.condition = z.condition
        if (z.ref) {
            zone.ref = {
                characterIdx: owner,
                zoneId: z.ref.targetZoneId as never,
                threshold: z.ref.threshold ?? 0,
                pct: z.ref.pct,
                lower: z.ref.lower,
                upper: z.ref.upper,
                discrete: z.ref.discrete,
                divisor: z.ref.divisor,
                multiplier: z.ref.multiplier
            }
        }
        return zone
    })
    // 与 store 落库时一致：引用归属统一重指到实体主人
    return buffContentKey({ zones: rewriteOwnerInZones(zones, owner), condition: item.condition ?? null })
}

/**
 * @desc 检测导入批次与已有 buff 的冲突：
 * - `conflicts`：同名但内容不同 → 交给用户选择跳过/覆盖
 * - `identical`：内容完全一致（乘区/条件全同）但名字不同 → 询问是否把已有 buff 改名成导入的名字
 * - 同名且内容也完全一致的，两边都不报（无意义，直接跳过即可）
 *
 * **批次内去重必须带上归属槽位**（曾经的 bug）：同一套装/武器/首位被多名角色装备时，
 * `buildEntityImportItems` 会为**每个主人**各生成一条 `self` 条目 —— 它们同名、同内容，
 * 只有归属槽位不同。旧实现只按名字去重，于是除第一个主人外的条目全被丢掉，
 * 症状就是「套装/武器/首位一样时，buff 只导入给了一个角色」。
 */
export function detectImportConflicts(
    items: readonly ImportBuffInput[],
    existing: readonly BuffConf[]
): { report: ImportConflictReport; deduped: ImportBuffInput[] } {
    const byName = new Map(existing.map((b) => [b.name, b]))
    const byContent = new Map<string, BuffConf>()
    for (const b of existing) {
        const key = buffContentKey(b)
        if (!byContent.has(key)) byContent.set(key, b)
    }

    const conflicts: ConflictImport[] = []
    const identical: IdenticalImport[] = []
    /** @desc 批次内已收录的 (名字, 归属槽位) */
    const seenBatch = new Set<string>()
    /** @desc 已就「内容一致」问过的已有 buff：同一已有条目只问一次（多主人变体会命中同一个） */
    const seenIdentical = new Set<string>()
    const deduped: ImportBuffInput[] = []

    items.forEach((item) => {
        const name = item.name.trim()
        if (!name) return
        const slot = ownerIdxOfItem(item)
        const dedupeKey = `${name}\u0000${slot}`
        if (seenBatch.has(dedupeKey)) return
        seenBatch.add(dedupeKey)
        const index = deduped.length
        deduped.push(item)

        const hit = byName.get(name)
        const contentKey = importItemContentKey(item)
        if (hit) {
            // 同名：内容也一致 → 视为无冲突（覆盖=跳过，不打扰用户）
            if (buffContentKey(hit) !== contentKey) conflicts.push({ index, name, existingId: hit.id, slot })
            return
        }
        const same = byContent.get(contentKey)
        if (same && !seenIdentical.has(same.id)) {
            seenIdentical.add(same.id)
            identical.push({ index, name, existingId: same.id, existingName: same.name, slot })
        }
    })

    return { report: { conflicts, identical }, deduped }
}
