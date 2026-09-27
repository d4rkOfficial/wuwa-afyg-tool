/**
 * @desc 通用数据迁移器：把任意历史版本的工程 / 配置 / 拉表计算态数据升级到当前版本。
 *
 * 设计要点：
 * - 单一入口（migrateProject / migrateConfig / migrateCalcState），IndexedDB 载入、本地导入、
 *   工坊分享下载、AI 工具导入、旧导出文件全部走同一路径，避免多份升级逻辑漂移。
 * - 迁移链式执行 + 幂等：`from < CURRENT` 的迁移按序跑，已是最新版本直接返回归一化结果。
 * - 纯函数：不依赖任何 store / 浏览器 API，可在 Node 环境下直接单测。
 */

import type {
    BuffCondition,
    BuffInstance,
    BuffOp,
    BuffVariant,
    BuffZoneValue,
    CalcState
} from '$lib/calc/calculation.types'
import { ZONE_MAP } from '$lib/calc/calculation.consts'
import { isConditionEmpty, normalizeCondition, normalizeConditionForScope } from '$lib/calc/condition'
import type { ConfigState } from '$lib/calc/config.types'
import type { TimelineData } from '$lib/calc/timeline.types'
import type {
    CharSlot,
    CounterVar,
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

/** @desc 内置链/精炼变量名：迁移生成的角色共鸣链与武器精炼档位变量（用户可改名，引用不依赖名字） */
export const BUILTIN_CHAIN_VAR = (slot: number): string => `chain_${slot + 1}`
export const BUILTIN_REFINE_VAR = (slot: number): string => `refine_${slot + 1}`

const DEFAULT_SLOTS = [0, 1, 2] as const

export const defaultVars = (): CounterVar[] => [
    ...DEFAULT_SLOTS.map((slot) => ({
        id: `var-chain-${slot + 1}`,
        name: BUILTIN_CHAIN_VAR(slot),
        type: 'number' as const,
        value: 0,
        builtin: true
    })),
    ...DEFAULT_SLOTS.map((slot) => ({
        id: `var-refine-${slot + 1}`,
        name: BUILTIN_REFINE_VAR(slot),
        type: 'number' as const,
        value: 1,
        builtin: true
    }))
]

export const emptyEncounter = (): EncounterState => ({
    teamLocked: false,
    timeline: { locked: false, data: null },
    calculation: { locked: false, data: null },
    config: { locked: false, data: null }
})

// ── 兼容视图同步：新结构 ↔ 旧字段 ──

/** @desc 由新结构派生旧字段视图（过渡期兼容，新代码请直接用 encounter / vars / buffs） */
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
        conditionProfile: conditionProfileFromVars(p.vars, p.team)
    }
}

/** @desc 由链/精炼变量派生旧版 conditionProfile 视图 */
export const conditionProfileFromVars = (
    vars: CounterVar[],
    team: [CharSlot, CharSlot, CharSlot]
): { chains: number[]; refinements: number[] } => ({
    chains: DEFAULT_SLOTS.map((i) => readChain(team, vars, i)),
    refinements: DEFAULT_SLOTS.map((i) => readRefinement(team, vars, i))
})

const varNum = (vars: CounterVar[], name: string, fallback: number): number => {
    const found = vars.find((v) => v.name === name)
    return typeof found?.value === 'number' ? found.value : fallback
}

const readChain = (team: [CharSlot, CharSlot, CharSlot], vars: CounterVar[], slot: number): number =>
    team[slot]?.chain ?? varNum(vars, BUILTIN_CHAIN_VAR(slot), 0)

const readRefinement = (team: [CharSlot, CharSlot, CharSlot], vars: CounterVar[], slot: number): number =>
    team[slot]?.refinement ?? varNum(vars, BUILTIN_REFINE_VAR(slot), 1)

// ── Buff 归一化：单变体快捷写法 ↔ variants；乘区级条件 ──

/** @desc 归一化乘区数组：保留已知乘区键、引用、覆盖标记与乘区级生效条件 */
export const normalizeZoneList = (zones: unknown): BuffZoneValue[] => {
    if (!Array.isArray(zones)) return []
    const out: BuffZoneValue[] = []
    for (const raw of zones) {
        const z = asRecord(raw)
        const zoneId = String(z.zoneId ?? '')
        if (!ZONE_MAP.has(zoneId as never)) continue
        const next: BuffZoneValue = { zoneId: zoneId as BuffZoneValue['zoneId'], value: pickNum(z.value, 0) }
        if (z.ref) next.ref = z.ref as BuffZoneValue['ref']
        if (z.override) next.override = true
        // 乘区级条件：只允许 伤害类型/属性 + 自定义变量条件（链阶是整块硬性条件，会被剥离）
        const zoneCondition = normalizeConditionForScope(asRecord(z.condition) as BuffCondition, 'zone')
        if (!isConditionEmpty(zoneCondition)) next.condition = zoneCondition
        out.push(next)
    }
    return out
}

/**
 * @desc 把 zones 快捷写法归一化为 variants（幂等；已有 variants 时保留并补齐 id）。
 *
 * 条件归属归一化（本工具的核心口径）：
 * - 旧版「变体级条件」与「Buff 级伤害属性/类型条件」都**下放到该 Buff 的每一个乘区**
 * - 链条件 / 阶条件保留在 Buff 实例级（它们只能作为整个 Buff 的硬性条件）
 * 因此迁移完成后，属性 / 类型 / 变量条件一律挂在具体乘区上，`zones` 是条件的唯一真源。
 */
export const normalizeBuffVariants = (buff: Partial<BuffInstance>): BuffVariant[] => {
    const zoneCondition = normalizeConditionForScope(normalizeCondition(buff.condition ?? {}, 'zone'), 'zone')
    if (Array.isArray(buff.variants) && buff.variants.length > 0) {
        return buff.variants.map((v) => ({
            ...v,
            id: v.id || genId('variant'),
            zones: liftConditionToZones(normalizeZoneList(v.zones), v.condition, zoneCondition),
            ...(v.condition ? { condition: undefined } : {})
        }))
    }
    return [
        {
            id: `${buff.id ?? genId('buff')}-v1`,
            zones: liftConditionToZones(normalizeZoneList(buff.zones), undefined, zoneCondition)
        }
    ]
}

/** @desc 把「变体级条件」与「Buff 级属性/类型条件」下放到各乘区（乘区已有条件时不覆盖） */
const liftConditionToZones = (
    zones: BuffZoneValue[],
    variantCondition: BuffCondition | undefined,
    buffLevelZoneCondition: BuffCondition
): BuffZoneValue[] => {
    const variantZoneCondition = normalizeConditionForScope(normalizeCondition(variantCondition ?? {}, 'zone'), 'zone')
    const merged = mergeZoneConditions(buffLevelZoneCondition, variantZoneCondition)
    if (isConditionEmpty(merged)) return zones
    return zones.map((z) => (z.condition ? z : { ...z, condition: merged }))
}

/** @desc 合并两个乘区级条件（同为 and 语义；子句来自「Buff 级」与「变体级」时并集） */
const mergeZoneConditions = (a: BuffCondition, b: BuffCondition): BuffCondition => {
    if (isConditionEmpty(a)) return b
    if (isConditionEmpty(b)) return a
    return {
        ...a,
        elements: dedupe([...(a.elements ?? []), ...(b.elements ?? [])]),
        damageTypes: dedupe([...(a.damageTypes ?? []), ...(b.damageTypes ?? [])]),
        bools: [...(a.bools ?? []), ...(b.bools ?? [])],
        numbers: [...(a.numbers ?? []), ...(b.numbers ?? [])]
    }
}

const dedupe = (list: string[]): string[] | undefined => (list.length ? [...new Set(list)] : undefined)

/** @desc 归一化单个 Buff 实例（补齐 id/scope/variants，并保持 zones 单变体兼容视图可用） */
/**
 * @desc 归一化单个 Buff 实例。
 * Buff 实例级只保留**链条件 / 阶条件**（整个 Buff 的硬性条件）；伤害属性 / 伤害类型 / 变量条件
 * 由 `normalizeBuffVariants` 统一下放到每个乘区。
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
        ...(raw.ops?.length ? { ops: raw.ops } : {}),
        ...(raw.source ? { source: raw.source } : {}),
        ...(raw.origin ? { origin: raw.origin } : {})
    }
    const variants = normalizeBuffVariants({ ...raw, id })
    return { ...(base as BuffInstance), variants, zones: variants[0]?.zones ?? [] }
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

/** @desc 判断一个 Buff 实例是否「空」（无任何有效乘区与变量写入）：迁移时用于清理默认空全局 buff */
export const isEmptyBuff = (buff: BuffInstance): boolean => {
    if (buff.ops?.length) return false
    const zones = buff.variants?.flatMap((v) => v.zones ?? []) ?? buff.zones ?? []
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

    const conditions: Record<string, BuffCondition> = {}
    for (const [entryId, cond] of Object.entries(asRecord(src.damageEntryConditions))) {
        if (isRecord(cond)) conditions[entryId] = normalizeCondition(cond as BuffCondition)
    }

    const ops: Record<string, BuffOp[]> = {}
    for (const [entryId, list] of Object.entries(asRecord(src.damageEntryOps))) {
        if (Array.isArray(list) && list.length > 0) ops[entryId] = list as BuffOp[]
    }

    const variantIds: Record<string, Record<string, string[]>> = {}
    for (const [entryId, map] of Object.entries(asRecord(src.damageEntryBuffVariantIds))) {
        if (isRecord(map)) variantIds[entryId] = map as Record<string, string[]>
    }

    // 链/阶条件二选一：同一 Buff 同时带链与阶时拆成两个 Buff（各自只保留一个条件）
    const split = splitDualGateBuffs(buffs, remapTable(src.damageEntryBuffSetIds))

    return {
        buffSets: split.buffs,
        damageEntryBuffSetIds: split.bindings,
        damageEntryDamageTypes: types,
        ...(Object.keys(conditions).length ? { damageEntryConditions: conditions } : {}),
        ...(Object.keys(ops).length ? { damageEntryOps: ops } : {}),
        ...(Object.keys(variantIds).length ? { damageEntryBuffVariantIds: variantIds } : {})
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

/** @desc 迁移 v0（无版本号的 phases[].data 结构）→ v1（显式 encounter + 变量 + variant 归一化） */
const migrateV0toV1: Migration = {
    from: 0,
    to: 1,
    migrate(raw) {
        const phases = asRecord(raw.phases)
        const phaseData = (key: PhaseKey): unknown => asRecord(phases[key]).data ?? null
        const phaseLocked = (key: PhaseKey): boolean => asRecord(phases[key]).locked === true

        const team = normalizeTeam(raw.team)
        const calcState = migrateCalcState(phaseData('calculation'))

        // 旧 conditionProfile → 工程变量 + 角色槽位链/精炼
        const profile = asRecord(raw.conditionProfile)
        const chains = Array.isArray(profile.chains) ? profile.chains : []
        const refinements = Array.isArray(profile.refinements) ? profile.refinements : []
        for (const i of DEFAULT_SLOTS) {
            team[i].chain = Math.max(0, pickNum(chains[i], team[i].chain ?? 0))
            team[i].refinement = pickNum(refinements[i], team[i].refinement ?? 1)
        }

        const vars = defaultVars().map((v) => {
            const i = /(\d+)$/.exec(v.name)?.[1]
            const slot = i ? Number(i) - 1 : -1
            if (slot < 0 || slot > 2) return v
            if (v.name.startsWith('chain_')) return { ...v, value: team[slot].chain ?? 0 }
            return { ...v, value: team[slot].refinement ?? 1 }
        })

        return {
            ...raw,
            version: 1,
            vars: Array.isArray(raw.vars) && raw.vars.length > 0 ? (raw.vars as CounterVar[]) : vars,
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

/** @desc 迁移 v1 → v2（当前版本）：清理空全局 buff 残留、统一没有变体的 buff、补齐变量表 */
const migrateV1toV2: Migration = {
    from: 1,
    to: 2,
    migrate(raw) {
        const encounter = asRecord(raw.encounter)
        const calcRaw = asRecord(encounter.calculation).data ?? asRecord(raw.calc)
        const calcState = migrateCalcState(calcRaw)
        const team = normalizeTeam(raw.team)
        const varsRaw = Array.isArray(raw.vars) ? (raw.vars as CounterVar[]) : []
        const vars = varsRaw.length > 0 ? varsRaw : defaultVars()

        return {
            ...raw,
            version: 2,
            vars,
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

const PROJECT_MIGRATIONS: Migration[] = [migrateV0toV1, migrateV1toV2]

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
    const vars = Array.isArray(data.vars) && data.vars.length > 0 ? (data.vars as CounterVar[]) : defaultVars()

    const project: ProjectV2 = {
        version: PROJECT_VERSION,
        id: typeof data.id === 'string' && data.id ? data.id : genId('project'),
        name: typeof data.name === 'string' && data.name ? data.name : '未命名工程',
        createdAt: pickNum(data.createdAt, Date.now()),
        ...(data.archived === true ? { archived: true } : {}),
        vars,
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
