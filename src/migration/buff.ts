/**
 * @desc Buff 乘区 / 条件归一化与拉表计算态（CalcState）迁移。
 *
 * 口径（v7 起）：Buff 级条件统一为 `BuffInstance.rules`（discriminated union，全部 AND），
 * 实例级 `condition`（链/阶）与 `conditionRefCharIdx` 由迁移换算为规则，输出里只出现 `rules`；
 * 乘区级条件（伤害属性 / 伤害类型）保持原样，挂在各乘区条目上。
 */

import type { BuffCondition, BuffInstance, BuffTreeState, BuffZoneValue, CalcState } from '$lib/calc/calculation.types'
import { normalizeBuffTree } from '$lib/calc/buff-tree-state'
import { ZONE_MAP, resolveZoneId } from '$lib/calc/calculation.consts'
import { isConditionEmpty, normalizeCondition, normalizeZoneCondition } from '$lib/calc/condition'
import { normalizeRules, rulesFromLegacyCondition, type LegacyGateCondition } from '$lib/calc/rules'
import { asRecord, genId, isLegacyAutoGlobal, isRecord, pickNum } from './shared'

// ── Buff 归一化：乘区条目列表（含旧 variants 拍平）与乘区级条件 ──

/** @desc 归一化乘区条目列表：乘区 id 别名重映射、保留已知乘区键、引用、覆盖标记与乘区级生效条件 */
export const normalizeZoneList = (zones: unknown): BuffZoneValue[] => {
    if (!Array.isArray(zones)) return []
    const out: BuffZoneValue[] = []
    for (const raw of zones) {
        const z = asRecord(raw)
        const zoneId = resolveZoneId(String(z.zoneId ?? ''))
        if (!ZONE_MAP.has(zoneId)) continue
        const next: BuffZoneValue = { zoneId: zoneId as BuffZoneValue['zoneId'], value: pickNum(z.value, 0) }
        if (z.ref) next.ref = z.ref as BuffZoneValue['ref']
        if (z.override) next.override = true
        const zoneCondition = normalizeZoneCondition(asRecord(z.condition) as BuffCondition)
        if (zoneCondition) next.condition = zoneCondition
        out.push(next)
    }
    return out
}

/** @desc v3 及更早数据里的「同名变体」（仅在迁移时读取） */
interface LegacyVariant {
    condition?: Record<string, unknown>
    zones?: unknown
}

/** @desc 读取 `variants` 字段（类型里没有这一项，按宽松结构取，便于拍平迁移） */
const legacyVariantsOf = (buff: Record<string, unknown>): LegacyVariant[] => {
    const raw = buff.variants
    return Array.isArray(raw) ? (raw.filter(isRecord) as LegacyVariant[]) : []
}

/**
 * @desc 归一化某个 Buff 的乘区条目列表。
 *
 * `variants[]`（同名变体）在这里**拍平成同一个 zones 列表**：变体级子条件下放到该变体的每个条目上
 * （与引擎「变体条件满足后其乘区才计入」等价）；Buff 级的属性/类型条件同样下放。
 * 链/阶条件（实例级）不作为乘区条件 —— 它们在 `normalizeBuff` 里换算为 Buff 级规则。
 */
export const normalizeZones = (buff: Partial<BuffInstance> & Record<string, unknown>): BuffZoneValue[] => {
    const buffLevel = normalizeZoneCondition(asRecord(buff.condition) as BuffCondition) ?? {}
    /** @desc 与一段附加条件合并后写回条目（交集为空 = 永远不满足，返回 null 表示丢弃该条目） */
    const applyCondition = (zone: BuffZoneValue, extra: BuffCondition): BuffZoneValue | null => {
        const merged = andZoneConditions(extra, zone.condition ?? {})
        if (merged === null) return null
        const next: BuffZoneValue = { ...zone }
        if (isConditionEmpty(merged)) delete next.condition
        else next.condition = merged
        return next
    }

    const variants = legacyVariantsOf(buff)
    if (variants.length > 0) {
        const out: BuffZoneValue[] = []
        for (const variant of variants) {
            const variantLevel = normalizeZoneCondition(asRecord(variant?.condition) as BuffCondition) ?? {}
            const gate = andZoneConditions(buffLevel, variantLevel)
            if (gate === null) continue
            for (const zone of normalizeZoneList(variant?.zones)) {
                const next = applyCondition(zone, gate)
                if (next) out.push(next)
            }
        }
        return out
    }

    const out: BuffZoneValue[] = []
    for (const zone of normalizeZoneList(buff.zones)) {
        const next = applyCondition(zone, buffLevel)
        if (next) out.push(next)
    }
    return out
}

/**
 * @desc 合并两个乘区级条件（AND 语义：两段条件必须同时满足）。
 * - 属性：单值语义，同类取**交集**（element ∈ A 且 element ∈ B ⇔ element ∈ A∩B）
 * - 伤害类型：多值语义，同类取交集（取「共同的类型」这一最严读法）
 * - 交集为空 → 永远不满足，返回 null（调用方据此丢弃该条目）
 */
const andZoneConditions = (a: BuffCondition, b: BuffCondition): BuffCondition | null => {
    if (isConditionEmpty(a)) return b
    if (isConditionEmpty(b)) return a
    const elements = intersect(a.elements, b.elements)
    if (elements === null) return null
    const damageTypes = intersect(a.damageTypes, b.damageTypes)
    if (damageTypes === null) return null
    return {
        ...(elements ? { elements } : {}),
        ...(damageTypes ? { damageTypes } : {})
    }
}

/** @desc 两段同类子句取交集：任一侧未限定则取另一侧；交集为空返回 null（表示永远不满足） */
const intersect = (a: string[] | undefined, b: string[] | undefined): string[] | undefined | null => {
    if (!a?.length) return b?.length ? b : undefined
    if (!b?.length) return a
    const shared = a.filter((x) => b.includes(x))
    return shared.length > 0 ? [...new Set(shared)] : null
}

/**
 * @desc 归一化单个 Buff 实例。
 * Buff 实例级只保留 **规则**（`rules`）；伤害属性 / 伤害类型条件下放到每个乘区条目。
 * `condition.chains/refinements/chain/refinement` + `conditionRefCharIdx` 换算为链/阶规则，
 * `starred` 等不在白名单里的字段一律抹掉（不返回）。
 */
export const normalizeBuff = (raw: Partial<BuffInstance> & Record<string, unknown>): BuffInstance => {
    const id = typeof raw.id === 'string' && raw.id ? raw.id : genId('buff')
    const owner = typeof raw.conditionRefCharIdx === 'number' ? raw.conditionRefCharIdx : 0
    const legacyCondition = asRecord(raw.condition) as LegacyGateCondition & BuffCondition
    const rules = normalizeRules(raw.rules) ?? rulesFromLegacyCondition(legacyCondition, owner)
    const base: Partial<BuffInstance> = {
        id,
        name: typeof raw.name === 'string' && raw.name ? raw.name : '未命名 BUFF',
        scope: raw.scope === 'all' || Array.isArray(raw.scope) ? raw.scope : 'all',
        ...(raw.global ? { global: true } : {}),
        ...(rules ? { rules } : {}),
        ...(raw.source ? { source: raw.source } : {}),
        ...(raw.origin ? { origin: raw.origin } : {})
    }
    return { ...(base as BuffInstance), zones: normalizeZones({ ...raw, id }) }
}

/**
 * @desc 归一化生效条件（实现见 `$lib/calc/condition`，此处仅作迁移入口再导出，保持既有导入路径可用）：
 * 只保留乘区级的伤害属性 / 伤害类型；链阶已迁到 Buff 级 `rules`。
 */
export { normalizeCondition }

/** @desc 判断一个 Buff 实例是否「空」（无任何有效乘区）：迁移时用于清理默认空全局 buff */
export const isEmptyBuff = (buff: BuffInstance): boolean => {
    const zones = buff.zones ?? []
    return !zones.some((z) => z && (z.ref || z.override || (typeof z.value === 'number' && z.value !== 0)))
}

// ── 拉表计算态归一化 ──

/** @desc 归一化 CalcState：处理 [配置] 自动块、全局自动块、旧「视为效应伤害」类型名，并保留用户数据 */
export const migrateCalcState = (raw: unknown): CalcState => {
    const src = asRecord(raw)
    const rawBuffs = Array.isArray(src.buffSets)
        ? (src.buffSets.filter(isRecord) as (Partial<BuffInstance> & Record<string, unknown>)[])
        : []

    const buffs = rawBuffs
        .filter((b) => !(typeof b.name === 'string' && b.name.startsWith('[配置]')))
        // 默认三/四个空全局 buff 直接删除；非空的转为普通 buff（保留数值与绑定）
        .filter((b) => !(isLegacyAutoGlobal(String(b.id ?? '')) && isEmptyBuff(normalizeBuff(b))))
        .map((b) => {
            const normalized = normalizeBuff(b)
            if (isLegacyAutoGlobal(normalized.id)) {
                // 旧默认全局 buff 升级为普通 buff：换稳定 id、去掉 global 标记，绑定表稍后重映射
                const nextId = `buff-migrated-${normalized.id.replace(/^global-/, '')}`
                return { ...normalized, id: nextId, global: false }
            }
            return { ...normalized, global: normalized.global === true }
        })

    const globalIds = rawBuffs.filter((b) => isLegacyAutoGlobal(String(b.id ?? ''))).map((b) => String(b.id))
    const remapId = (id: string): string =>
        globalIds.includes(id) ? `buff-migrated-${id.replace(/^global-/, '')}` : id
    const keptIds = new Set(buffs.map((b) => b.id))

    const remapTable = (table: unknown): Record<string, string[]> => {
        const out: Record<string, string[]> = {}
        for (const [entryId, ids] of Object.entries(asRecord(table))) {
            if (!Array.isArray(ids)) continue
            const mapped = (ids as string[]).map(remapId).filter((id) => keptIds.has(id))
            if (mapped.length > 0) out[entryId] = [...new Set(mapped)]
        }
        return out
    }

    const types: Record<string, string[]> = {}
    for (const [entryId, list] of Object.entries(asRecord(src.damageEntryDamageTypes))) {
        if (!Array.isArray(list)) continue
        types[entryId] = (list as string[]).map((t) => (t === '视为效应伤害' ? '效应伤害' : t))
    }

    const bindings = remapTable(src.damageEntryBuffSetIds)
    const treeGlobalIds = buffs.filter((b) => b.global).map((b) => b.id)
    const rawTree = isRecord(src.buffTree) ? (src.buffTree as unknown as BuffTreeState) : undefined
    const buffTree = rawTree ? normalizeBuffTree(rawTree, buffs, treeGlobalIds) : undefined

    return {
        buffSets: buffs,
        damageEntryBuffSetIds: bindings,
        damageEntryDamageTypes: types,
        ...(buffTree ? { buffTree } : {}),
        ...(typeof src.buffTreeVersion === 'number' ? { buffTreeVersion: src.buffTreeVersion } : {})
    }
}

/**
 * @desc 拉表态的结构性归一化（与版本无关，幂等）。
 *
 * v7 起链与阶可以同时作为规则存在，因此不拆分 Buff、不改写绑定表。
 * 这里保留入口只为兼容既有调用路径（工程载入 / 导入统一走它）。
 */
export const normalizeCalcState = (state: CalcState): CalcState => state
