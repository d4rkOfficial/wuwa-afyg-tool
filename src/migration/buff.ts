/**
 * @desc Buff 乘区 / 条件归一化与拉表计算态（CalcState）迁移。
 */

import type { BuffCondition, BuffInstance, BuffTreeState, BuffZoneValue, CalcState } from '$lib/calc/calculation.types'
import { normalizeBuffTree } from '$lib/calc/buff-tree-state'
import { ZONE_MAP, resolveZoneId } from '$lib/calc/calculation.consts'
import { isConditionEmpty, normalizeCondition, normalizeConditionForScope } from '$lib/calc/condition'
import { asRecord, genId, isLegacyAutoGlobal, isRecord, pickNum } from './shared'

// ── Buff 归一化：乘区条目列表（含旧 variants 拍平）与乘区级条件 ──

/** @desc 归一化乘区条目列表：历史 id 重映射、保留已知乘区键、引用、覆盖标记与乘区级生效条件 */
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
        const zoneCondition = normalizeConditionForScope(asRecord(z.condition) as BuffCondition, 'zone')
        if (!isConditionEmpty(zoneCondition)) next.condition = zoneCondition
        out.push(next)
    }
    return out
}

/** @desc 旧结构里可能存在的「同名变体」（已废弃，仅在迁移时读取） */
interface LegacyVariant {
    condition?: BuffCondition
    zones?: unknown
}

/** @desc 读取旧结构里的 variants（类型上已移除，这里按宽松结构取，便于拍平迁移） */
const legacyVariantsOf = (buff: Partial<BuffInstance>): LegacyVariant[] => {
    const raw = (buff as Record<string, unknown>).variants
    return Array.isArray(raw) ? (raw.filter(isRecord) as LegacyVariant[]) : []
}

/**
 * @desc 归一化某个 Buff 的乘区条目列表。
 *
 * 旧结构 `variants[]`（同名变体）在这里**拍平成同一个 zones 列表**：变体级子条件下放到该变体的每个条目上
 * （与旧引擎「变体条件满足后其乘区才计入」等价）；Buff 级的属性/类型条件同样下放。
 * 链条件 / 阶条件保留在 Buff 实例级（它们只能作为整个 Buff 的硬性条件，会被 `pickGateCondition` 单独取出）。
 */
export const normalizeZones = (buff: Partial<BuffInstance>): BuffZoneValue[] => {
    const buffLevel = normalizeConditionForScope(normalizeCondition(buff.condition ?? {}, 'zone'), 'zone')
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
            const variantLevel = normalizeConditionForScope(
                normalizeCondition(variant?.condition ?? {}, 'zone'),
                'zone'
            )
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
 * Buff 实例级只保留**链条件 / 阶条件**（整个 Buff 的硬性条件）；伤害属性 / 伤害类型条件下放到每个乘区条目。
 */
export const normalizeBuff = (raw: Partial<BuffInstance>): BuffInstance => {
    const id = typeof raw.id === 'string' && raw.id ? raw.id : genId('buff')
    const fullCondition = raw.condition
        ? normalizeCondition(
              raw.condition,
              'buff',
              typeof raw.conditionRefCharIdx === 'number' ? raw.conditionRefCharIdx : 0
          )
        : undefined
    const gateCondition = fullCondition ? pickGateCondition(fullCondition) : undefined
    const base: Partial<BuffInstance> = {
        id,
        name: typeof raw.name === 'string' && raw.name ? raw.name : '未命名 BUFF',
        scope: raw.scope === 'all' || Array.isArray(raw.scope) ? raw.scope : 'all',
        ...(raw.starred ? { starred: true } : {}),
        ...(raw.global ? { global: true } : {}),
        ...(gateCondition ? { condition: gateCondition } : {}),
        ...(typeof raw.conditionRefCharIdx === 'number' ? { conditionRefCharIdx: raw.conditionRefCharIdx } : {}),
        ...(raw.source ? { source: raw.source } : {}),
        ...(raw.origin ? { origin: raw.origin } : {})
    }
    return { ...(base as BuffInstance), zones: normalizeZones({ ...raw, id }) }
}

/** @desc 只取链/阶子句（Buff 实例级的硬性条件），丢弃属性/类型等乘区级子句 */
const pickGateCondition = (cond: BuffCondition): BuffCondition | undefined => {
    const gate: BuffCondition = {
        ...(cond.chains?.length ? { chains: cond.chains } : {}),
        ...(cond.refinements?.length ? { refinements: cond.refinements } : {})
    }
    return isConditionEmpty(gate) ? undefined : gate
}
/**
 * @desc 归一化生效条件（实现见 `$lib/calc/condition`，此处仅作迁移入口再导出，保持既有导入路径可用）：
 * - 旧字段 `chain` / `refinement` 升级为 `chains` / `refinements` 数组形式（参考角色取 conditionRefCharIdx）
 * - 按层级裁剪：除 Buff 实例级外，链条件/阶条件一律剥离（它们只能作为整个 Buff 的硬性条件）
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
    const rawBuffs = Array.isArray(src.buffSets) ? (src.buffSets.filter(isRecord) as Partial<BuffInstance>[]) : []

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

    // 链/阶条件二选一：同一 Buff 同时带链与阶时拆成两个 Buff（各自只保留一个条件）
    const split = splitDualGateBuffs(buffs, remapTable(src.damageEntryBuffSetIds))
    const treeGlobalIds = split.buffs.filter((b) => b.global).map((b) => b.id)
    const rawTree = isRecord(src.buffTree) ? (src.buffTree as unknown as BuffTreeState) : undefined
    const buffTree = rawTree ? normalizeBuffTree(rawTree, split.buffs, treeGlobalIds) : undefined

    return {
        buffSets: split.buffs,
        damageEntryBuffSetIds: split.bindings,
        damageEntryDamageTypes: types,
        ...(buffTree ? { buffTree } : {}),
        ...(typeof src.buffTreeVersion === 'number' ? { buffTreeVersion: src.buffTreeVersion } : {})
    }
}

// ── 链/阶条件互斥：同一个 Buff 只允许生效其中一个 ──

/** @desc 该 Buff 的链/阶条件种类（同时含链与阶时为 'both'） */
export const gateKindsOf = (buff: BuffInstance): 'none' | 'chain' | 'refinement' | 'both' => {
    const hasChain = (buff.condition?.chains?.length ?? 0) > 0 || buff.condition?.chain !== undefined
    const hasRefine = (buff.condition?.refinements?.length ?? 0) > 0 || buff.condition?.refinement !== undefined
    if (hasChain && hasRefine) return 'both'
    if (hasChain) return 'chain'
    if (hasRefine) return 'refinement'
    return 'none'
}

/**
 * @desc ── 链/阶条件互斥归一化 ──
 * 链条件与阶条件只能生效其中一个。若同一个 Buff 同时带链与阶（旧数据常见），
 * 拆成两个 Buff：一个只保留链条件、一个只保留阶条件，名字分别加「（链N）」/「（阶N）」后缀避免重名，
 * 同步名者加序号；两条新 Buff 都继承原绑定，保证生效范围与拆分前一致。
 * 拆分结果**幂等**：每个分支的子条件唯一，再次运行不会二次拆分。
 */
export const splitDualGateBuffs = (
    buffs: BuffInstance[],
    bindings: Record<string, string[]>
): { buffs: BuffInstance[]; bindings: Record<string, string[]> } => {
    if (!buffs.some((b) => gateKindsOf(b) === 'both')) return { buffs, bindings }

    const out: BuffInstance[] = []
    const nextBindings: Record<string, string[]> = { ...bindings }
    const usedNames = new Set(buffs.filter((b) => gateKindsOf(b) !== 'both').map((b) => b.name))
    const boundEntriesOf = (id: string): string[] =>
        Object.entries(bindings)
            .filter(([, ids]) => ids.includes(id))
            .map(([entryId]) => entryId)

    /** @desc 生成不重名的分支名：基础名 + 条件后缀 + 同名序号 */
    const uniqueName = (base: string, suffix: string): string => {
        let candidate = `${base}${suffix}`
        let n = 2
        while (usedNames.has(candidate)) {
            candidate = `${base}${suffix}·${n}`
            n++
        }
        usedNames.add(candidate)
        return candidate
    }

    for (const buff of buffs) {
        if (gateKindsOf(buff) !== 'both') {
            out.push(buff)
            continue
        }
        const cond = buff.condition ?? {}
        const chainClause = cond.chains?.[0]
        const refineClause = cond.refinements?.[0]
        const chainSuffix = `（链${chainClause ? chainClause.min : ''}）`
        const refineSuffix = `（阶${refineClause ? refineClause.min : ''}）`
        // 两个分支都不带变体级条件（条件已下放到乘区）
        const shared = { ...buff }
        delete (shared as Partial<BuffInstance>).condition
        const chainBranch: BuffInstance = {
            ...shared,
            id: `${buff.id}#chain`,
            name: uniqueName(buff.name, chainSuffix),
            condition: {
                ...cond,
                chains: chainClause ? [chainClause] : cond.chains,
                refinements: undefined,
                refinement: undefined
            },
            origin: { ...(buff.origin ?? {}), kind: buff.origin?.kind ?? 'split-chain' }
        }
        const refineBranch: BuffInstance = {
            ...shared,
            id: `${buff.id}#refine`,
            name: uniqueName(buff.name, refineSuffix),
            condition: {
                ...cond,
                refinements: refineClause ? [refineClause] : cond.refinements,
                chains: undefined,
                chain: undefined
            },
            origin: { ...(buff.origin ?? {}), kind: buff.origin?.kind ?? 'split-refine' }
        }
        out.push(chainBranch, refineBranch)

        // 原绑定平移到两个分支（生效范围不变），并移除原 Buff
        for (const entryId of boundEntriesOf(buff.id)) {
            const current = nextBindings[entryId] ?? []
            const replaced = current.filter((id) => id !== buff.id)
            nextBindings[entryId] = [...new Set([...replaced, chainBranch.id, refineBranch.id])]
        }
        for (const entryId of Object.keys(nextBindings)) {
            if (nextBindings[entryId].length === 0) delete nextBindings[entryId]
        }
    }

    return { buffs: out, bindings: nextBindings }
}

/**
 * @desc 拉表态的结构性归一化（与版本无关，幂等）：
 * 落实「链/阶条件二选一」拆分，保证无论数据来自老版本、已迁移过的工程还是导入文件，
 * 进入内存前都满足新架构约束。
 */
export const normalizeCalcState = (state: CalcState): CalcState => {
    const split = splitDualGateBuffs(state.buffSets, state.damageEntryBuffSetIds)
    if (split.buffs === state.buffSets && split.bindings === state.damageEntryBuffSetIds) return state
    return { ...state, buffSets: split.buffs, damageEntryBuffSetIds: split.bindings }
}
