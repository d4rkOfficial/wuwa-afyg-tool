/**
 * @desc 通用数据迁移器：把任意历史版本的工程 / 配置 / 拉表计算态数据升级到当前版本。
 *
 * 设计要点：
 * - 单一入口（migrateProject / migrateConfig / migrateCalcState），IndexedDB 载入、本地导入、
 *   工坊分享下载、AI 工具导入、旧导出文件全部走同一路径，避免多份升级逻辑漂移。
 * - 迁移链式执行 + 幂等：`from < CURRENT` 的迁移按序跑，已是最新版本直接返回归一化结果。
 * - 纯函数：不依赖任何 store / 浏览器 API，可在 Node 环境下直接单测。
 */

import type { BuffCondition, BuffInstance, BuffZoneValue, CalcState } from '$lib/calc/calculation.types'
import { ZONE_MAP, resolveZoneId } from '$lib/calc/calculation.consts'
import { isConditionEmpty, normalizeCondition, normalizeConditionForScope } from '$lib/calc/condition'
import { bindPaneEffectSources, entryOwnersFromTimeline } from '$lib/calc/pane-effects'
import type { ConfigState } from '$lib/calc/config.types'
import type { TimelineData } from '$lib/calc/timeline.types'
import type {
    CharSlot,
    CustomHit,
    EchoSlot,
    EncounterState,
    PhaseKey,
    Project,
    ProjectV2,
    ResultAnalysisData,
    SelectedSet
} from '$lib/types/project'
import { PROJECT_VERSION } from '$lib/types/project'

const PHASE_ORDER: PhaseKey[] = ['team', 'timeline', 'calculation', 'config']

/** @desc 一个原子迁移步骤：把 from 版本的数据升级到 to 版本 */
export interface Migration {
    from: number
    to: number
    migrate(raw: Record<string, unknown>): Record<string, unknown>
}

// ── 基础设施 ──

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const asRecord = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {})

const pickNum = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

const genId = (prefix: string): string =>
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/** @desc 深拷贝（结构化数据；含 unknown 阶段数据的快照） */
export const deepClone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)))

// ── 默认结构构造 ──

export const emptyEchoSlot = (): EchoSlot => ({ name: null, cost: 0 })

export const emptyCharSlot = (): CharSlot => ({
    character: null,
    weapon: null,
    triggerSets: [],
    echoes: [emptyEchoSlot(), emptyEchoSlot(), emptyEchoSlot(), emptyEchoSlot(), emptyEchoSlot()],
    chain: 0,
    refinement: 1
})

/** @desc 内置链/精炼档位：链阶真源是角色槽位（team[].chain / team[].refinement），不再走变量 */
const DEFAULT_SLOTS = [0, 1, 2] as const

export const emptyEncounter = (): EncounterState => ({
    teamLocked: false,
    timeline: { locked: false, data: null },
    calculation: { locked: false, data: null },
    config: { locked: false, data: null }
})

// ── 兼容视图同步：新结构 ↔ 旧字段 ──

/** @desc 由新结构派生旧字段视图（过渡期兼容，新代码请直接用 encounter / buffs） */
const syncLegacyViews = (p: ProjectV2): Project => {
    const phases = {
        team: { locked: p.encounter.teamLocked, data: null as unknown },
        timeline: { locked: p.encounter.timeline.locked, data: p.encounter.timeline.data },
        calculation: { locked: p.encounter.calculation.locked, data: p.encounter.calculation.data },
        config: { locked: p.encounter.config.locked, data: p.encounter.config.data }
    }
    return {
        ...p,
        phases,
        buffSets: p.buffs,
        conditionProfile: conditionProfileFromTeam(p.team)
    }
}

/** @desc 由角色槽位上的链/精炼档位派生条件系统读取用的 conditionProfile */
export const conditionProfileFromTeam = (
    team: [CharSlot, CharSlot, CharSlot]
): {
    chains: number[]
    refinements: number[]
} => ({
    chains: DEFAULT_SLOTS.map((i) => team[i]?.chain ?? 0),
    refinements: DEFAULT_SLOTS.map((i) => team[i]?.refinement ?? 1)
})

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

/** @desc 读取旧结构里某阶段的锁定标记（phases[phase].locked 的兼容读取） */
const lockedOf = (container: Record<string, unknown>, key: PhaseKey): boolean =>
    asRecord(container[key]).locked === true

/** @desc 读取旧结构里的队伍锁定标记（teamLocked 可能是布尔或 phases.team 对象） */
const teamLockedOf = (container: Record<string, unknown>): boolean =>
    container.teamLocked === true || asRecord(container.teamLocked).locked === true

/** @desc 链/阶对比弹窗的对比点（兼容旧字段名） */
type ComparisonPoint = { chains: number[]; refinements: number[] }

/** @desc 旧版自动生成的默认全局 buff（global-{角色名} / global-all）标识 */
const isLegacyAutoGlobal = (id: string): boolean => id.startsWith('global-')

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

    return {
        buffSets: split.buffs,
        damageEntryBuffSetIds: split.bindings,
        damageEntryDamageTypes: types
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

// ── 工程迁移链 ──

const normalizeTeam = (raw: unknown): [CharSlot, CharSlot, CharSlot] =>
    DEFAULT_SLOTS.map((i) => {
        const slot = asRecord(Array.isArray(raw) ? raw[i] : undefined)
        const echoes = Array.isArray(slot.echoes) ? slot.echoes : []
        return {
            character: typeof slot.character === 'string' ? slot.character : null,
            weapon: typeof slot.weapon === 'string' ? slot.weapon : null,
            triggerSets: (Array.isArray(slot.triggerSets) ? slot.triggerSets : [])
                .filter(isRecord)
                .map((s) => ({ name: String(s.name ?? ''), pieces: pickNum(s.pieces, 2) }) as SelectedSet),
            echoes: DEFAULT_SLOTS.map((j) => {
                const e = asRecord(echoes[j])
                return { name: typeof e.name === 'string' ? e.name : null, cost: pickNum(e.cost, 0) }
            }) as [EchoSlot, EchoSlot, EchoSlot, EchoSlot, EchoSlot],
            chain: Math.max(0, pickNum(slot.chain, 0)),
            refinement: pickNum(slot.refinement, 1)
        }
    }) as [CharSlot, CharSlot, CharSlot]

/** @desc 迁移 v0（无版本号的 phases[].data 结构）→ v1（显式 encounter + 链阶落到角色槽位 + variant 归一化） */
const migrateV0toV1: Migration = {
    from: 0,
    to: 1,
    migrate(raw) {
        const phases = asRecord(raw.phases)
        const phaseData = (key: PhaseKey): unknown => asRecord(phases[key]).data ?? null
        const phaseLocked = (key: PhaseKey): boolean => asRecord(phases[key]).locked === true

        const team = normalizeTeam(raw.team)
        const calcState = migrateCalcState(phaseData('calculation'))

        // 旧 conditionProfile → 角色槽位链/精炼（链阶真源是 team）
        const profile = asRecord(raw.conditionProfile)
        const chains = Array.isArray(profile.chains) ? profile.chains : []
        const refinements = Array.isArray(profile.refinements) ? profile.refinements : []
        for (const i of DEFAULT_SLOTS) {
            team[i].chain = Math.max(0, pickNum(chains[i], team[i].chain ?? 0))
            team[i].refinement = pickNum(refinements[i], team[i].refinement ?? 1)
        }

        return {
            ...raw,
            version: 1,
            team,
            encounter: {
                teamLocked: phaseLocked('team'),
                timeline: { locked: phaseLocked('timeline'), data: phaseData('timeline') as TimelineData | null },
                calculation: { locked: phaseLocked('calculation'), data: calcState },
                config: { locked: phaseLocked('config'), data: phaseData('config') as ConfigState | null }
            },
            buffs: calcState.buffSets,
            analysis:
                (raw.resultAnalysis as ResultAnalysisData | undefined) ??
                (raw.analysis as ResultAnalysisData | undefined),
            comparison: (raw.comparisonPoints ?? raw.comparison ?? undefined) as ComparisonPoint[] | undefined
        }
    }
}

/** @desc 迁移 v1 → v2（当前版本）：清理空全局 buff 残留、统一没有变体的 buff、链阶落到角色槽位 */
const migrateV1toV2: Migration = {
    from: 1,
    to: 2,
    migrate(raw) {
        const encounter = asRecord(raw.encounter)
        const calcRaw = asRecord(encounter.calculation).data ?? asRecord(raw.calc)
        const calcState = migrateCalcState(calcRaw)
        const team = normalizeTeam(raw.team)

        return {
            ...raw,
            version: 2,
            team,
            encounter: {
                teamLocked: teamLockedOf(encounter),
                timeline: {
                    locked: lockedOf(encounter, 'timeline'),
                    data: (asRecord(encounter.timeline).data ?? null) as TimelineData | null
                },
                calculation: { locked: lockedOf(encounter, 'calculation'), data: calcState },
                config: {
                    locked: lockedOf(encounter, 'config'),
                    data: (asRecord(encounter.config).data ?? null) as ConfigState | null
                }
            },
            buffs: calcState.buffSets
        }
    }
}

/** @desc 迁移 v2 → v3（当前版本）：引用语义修正 —— 把旧工程「跨角色副作用 buff」补勾到引用它们的伤害段 */
const migrateV2toV3: Migration = {
    from: 2,
    to: 3,
    migrate(raw) {
        const encounter = asRecord(raw.encounter)
        const calcContainer = asRecord(encounter.calculation)
        const calcState = migrateCalcState(calcContainer.data ?? asRecord(raw.calc))
        const team = normalizeTeam(raw.team)
        const owners = entryOwnersFromTimeline(asRecord(encounter.timeline).data)
        const bindings = bindPaneEffectSources(calcState.buffSets, calcState.damageEntryBuffSetIds, owners, team)

        return {
            ...raw,
            version: 3,
            team,
            encounter: {
                ...encounter,
                timeline: {
                    locked: lockedOf(encounter, 'timeline'),
                    data: (asRecord(encounter.timeline).data ?? null) as TimelineData | null
                },
                calculation: { ...calcContainer, data: { ...calcState, damageEntryBuffSetIds: bindings } },
                config: {
                    locked: lockedOf(encounter, 'config'),
                    data: (asRecord(encounter.config).data ?? null) as ConfigState | null
                }
            },
            buffs: calcState.buffSets
        }
    }
}

/** @desc 迁移 v3 → v4（当前版本）：乘区改名（历史 id 重映射）+ 「同名变体」拍平为单层乘区条目列表 */
const migrateV3toV4: Migration = {
    from: 3,
    to: 4,
    migrate(raw) {
        const encounter = asRecord(raw.encounter)
        const calcContainer = asRecord(encounter.calculation)
        // migrateCalcState 内部经 normalizeBuff → normalizeZones 完成：
        // ① 历史乘区 id（customFinalDmg / customFinalDmgMul）重映射为 specialFinal1 / specialFinal2
        // ② variants[] 拍平进 zones[]（变体级子条件下放到其每个条目），并丢弃已废弃的 damageEntryBuffVariantIds
        const calcState = migrateCalcState(calcContainer.data ?? asRecord(raw.calc))

        return {
            ...raw,
            version: 4,
            encounter: {
                ...encounter,
                calculation: { ...calcContainer, data: calcState }
            },
            buffs: calcState.buffSets
        }
    }
}

const PROJECT_MIGRATIONS: Migration[] = [migrateV0toV1, migrateV1toV2, migrateV2toV3, migrateV3toV4]

/** @desc 读取数据的版本号：无版本号（老导出格式 / 老 IndexedDB）视为 0 */
export const readVersion = (raw: Record<string, unknown>): number => {
    const version = raw.version
    return typeof version === 'number' && Number.isFinite(version) ? version : 0
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

/** @desc 归一化为当前工程结构（幂等，可直接用于 IndexedDB 载入 / 导入 / AI 工具） */
export const migrateProject = (raw: unknown): Project => {
    let data = isRecord(raw) ? { ...raw } : {}
    for (const migration of PROJECT_MIGRATIONS) {
        if (readVersion(data) >= PROJECT_VERSION) break
        if (readVersion(data) >= migration.to) continue
        data = migration.migrate(data)
    }

    const encounter = asRecord(data.encounter)
    const team = normalizeTeam(data.team)
    // 归一化拉表态（清理空全局 buff / [配置] 自动块 / 旧类型名）并落实「链阶条件二选一」拆分
    const normalizedCalc = migrateCalcState(asRecord(encounter.calculation).data)
    const calcState = normalizeCalcState(normalizedCalc)

    const project: ProjectV2 = {
        version: PROJECT_VERSION,
        id: typeof data.id === 'string' && data.id ? data.id : genId('project'),
        name: typeof data.name === 'string' && data.name ? data.name : '未命名工程',
        createdAt: pickNum(data.createdAt, Date.now()),
        ...(data.archived === true ? { archived: true } : {}),
        team,
        encounter: {
            teamLocked: teamLockedOf(encounter),
            timeline: {
                locked: lockedOf(encounter, 'timeline'),
                data: (asRecord(encounter.timeline).data ?? null) as TimelineData | null
            },
            calculation: { locked: lockedOf(encounter, 'calculation'), data: calcState },
            config: {
                locked: lockedOf(encounter, 'config'),
                data: (asRecord(encounter.config).data ?? null) as ConfigState | null
            }
        },
        buffs: calcState.buffSets,
        customSkillHits: isRecord(data.customSkillHits) ? (data.customSkillHits as Record<string, CustomHit[]>) : {},
        ...(isRecord(data.analysis) ? { analysis: data.analysis as unknown as ResultAnalysisData } : {}),
        ...(Array.isArray(data.comparison) ? { comparison: data.comparison as ComparisonPoint[] } : {}),
        ...(typeof data.lockedTeamKey === 'string' ? { lockedTeamKey: data.lockedTeamKey } : {}),
        ...(Array.isArray(data.lockedTeamNames) ? { lockedTeamNames: data.lockedTeamNames as string[] } : {})
    }
    return syncLegacyViews(project)
}

/** @desc 由工程派生用于保存的精简快照（不落过渡期视图字段） */
export const toPlainProject = (p: Project): ProjectV2 => {
    const { phases: _phases, conditionProfile: _profile, buffSets: _buffs, ...rest } = p
    return deepClone(rest)
}

export { PHASE_ORDER }
