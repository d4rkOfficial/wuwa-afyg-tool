/**
 * @desc Buff 级**规则**（`BuffInstance.rules`）的纯逻辑层：类型归一化、求值、依赖关系与文案。
 *
 * 设计要点（与 `.tmp/buff-modal-redesign/requirements.md` 的「已对齐的决定」一致）：
 * - 一条 Buff 可挂多条规则，**规则之间全部 AND**（没有 or 组合，也不再有任何「链阶互斥」护栏）；
 * - 规则只作用于 **Buff 级**；乘区级条件（伤害属性 / 伤害类型）仍在 `BuffZoneValue.condition`；
 * - `buffActive` 是唯一的「跨 Buff」规则：由引擎按**最小不动点**求值（见 `resolveActiveBuffIds`），
 *   创建期禁止直接自引用与间接循环（见 `cyclePathOf`）；
 * - 删除被依赖 Buff 时由 `cascadeDeleteIdsOf` 给出级联删除集合；`any` 规则在引用集合仍有存活项时保留依赖方。
 *
 * 兼容：`rulesFromLegacyCondition` 把工坊 / AI / 旧工程里的实例级链·阶条件升级为规则，其余旧字段丢弃。
 */

import type { BuffInstance, BuffRule, EnemyTypeKind, ZoneCompareId, ZoneCompareOp } from './calculation.types'
import { CHAIN_MAX, REFINE_MAX } from '$lib/consts/game-terms'

export { CHAIN_MAX, REFINE_MAX }

/** @desc 敌人类型选项（与工程敌人配置 `EnemyConfig.type` 同一套字面量，顺序即界面展示顺序） */
export const ENEMY_TYPE_OPTIONS: { value: EnemyTypeKind; label: string }[] = [
    { value: 'BOSS', label: 'BOSS' },
    { value: '精英怪', label: '精英怪' },
    { value: '小怪', label: '小怪' }
]

/** @desc 敌人类型显示名（读不到即回显「未设置」） */
export const enemyTypeLabel = (type: EnemyTypeKind | undefined): string => type ?? '未设置'

/** @desc 面板比较属性：`unit` 决定界面单位文案（与面板显示单位一致） */
export const ZONE_COMPARE_OPTIONS: { value: ZoneCompareId; label: string; unit: '%' | 'flat' }[] = [
    { value: 'atk', label: '攻击', unit: 'flat' },
    { value: 'hp', label: '生命', unit: 'flat' },
    { value: 'def', label: '防御', unit: 'flat' },
    { value: 'recharge', label: '共鸣效率', unit: '%' },
    { value: 'offTuneBuildupRate', label: '偏谐值累积效率', unit: '%' },
    { value: 'tuneBreakBoost', label: '谐度破坏增幅', unit: 'flat' },
    { value: 'unisonBoonLayer', label: '同奏增益层数', unit: 'flat' },
    { value: 'critRate', label: '暴击率', unit: '%' },
    { value: 'critDmg', label: '暴击伤害', unit: '%' }
]

/** @desc 比较运算符选项 */
export const ZONE_COMPARE_OPS: { value: ZoneCompareOp; label: string }[] = [
    { value: 'ge', label: '≥' },
    { value: 'gt', label: '>' },
    { value: 'eq', label: '=' },
    { value: 'le', label: '≤' },
    { value: 'lt', label: '<' }
]

/** @desc 规则种类选项（「创建条件」菜单用） */
export const RULE_KIND_OPTIONS: { value: BuffRule['kind']; label: string; icon: string }[] = [
    { value: 'chain', label: '角色共鸣链', icon: 'mdi:account-star-outline' },
    { value: 'refinement', label: '武器精炼阶数', icon: 'mdi:sword' },
    { value: 'damageNameRegex', label: '伤害名包含正则', icon: 'mdi:regex' },
    { value: 'damageNameEquals', label: '伤害名等于', icon: 'mdi:format-text' },
    { value: 'zoneCompare', label: '角色面板数值', icon: 'mdi:chart-bar' },
    { value: 'enemyType', label: '敌人类型', icon: 'mdi:skull-outline' },
    { value: 'buffActive', label: '其它 BUFF 生效', icon: 'mdi:link-variant' }
]

/** @desc 规则种类显示名 */
export const ruleKindLabel = (kind: BuffRule['kind']): string =>
    RULE_KIND_OPTIONS.find((item) => item.value === kind)?.label ?? kind

/** @desc 规则求值所需的面板快照（字段取「无条件部分」累计值，单位与面板显示一致） */
export interface RuleStats {
    atk: number
    hp: number
    def: number
    recharge: number
    offTuneBuildupRate: number
    tuneBreakBoost: number
    unisonBoonLayer: number
    critRate: number
    critDmg: number
}

/**
 * @desc 规则求值上下文。
 *
 * 「未知即不否定」：引擎一定提供 `damageName` / `enemyType` / `statsOf` / `activeOf`，
 * 而拉表可用性过滤这类纯界面路径可能拿不到其中某几项 —— 此时**不放行也不否定**，
 * 即该条规则不构成过滤理由（返回 true）。唯一例外是 `buffActive`：`activeOf` 缺省视为「不生效」。
 */
export interface RuleContext {
    chains: number[]
    refinements: number[]
    /** @desc 本次伤害条目的角色槽位（`zoneCompare.charIdx = -1` 时用它；-1 = 无角色上下文） */
    activeCharIdx: number
    /** @desc 本次伤害条目的显示名（`displayName`） */
    damageName?: string
    /** @desc 工程敌人类型 */
    enemyType?: EnemyTypeKind
    /** @desc 读某槽位「无条件部分」面板；undefined = 无该槽位面板（规则不构成否定） */
    statsOf?: (charIdx: number) => RuleStats | undefined
    /** @desc 某 Buff 在本次伤害是否生效（`buffActive` 用；缺省 = 不生效） */
    activeOf?: (buffId: string) => boolean
}

// ── 归一化 ──

const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** @desc 槽位合法性：-1 = 伤害条目的角色，其余必须是 0..2 */
const clampCharIdx = (v: unknown, allowActive: boolean): number | null => {
    const n = num(v, allowActive ? -1 : 0)
    if (n === -1) return allowActive ? -1 : null
    return n >= 0 && n <= 2 ? n : null
}

/** @desc 单条规则归一化（非法值返回 null，调用方据此丢弃） */
export const normalizeRule = (raw: unknown): BuffRule | null => {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as Record<string, unknown>
    const kind = str(r.kind)
    switch (kind) {
        case 'chain': {
            const charIdx = clampCharIdx(r.charIdx, false)
            const min = num(r.min, 0)
            if (charIdx === null || min < 0 || min > CHAIN_MAX) return null
            return { kind: 'chain', charIdx, min }
        }
        case 'refinement': {
            const charIdx = clampCharIdx(r.charIdx, false)
            const min = num(r.min, 1)
            if (charIdx === null || min < 1 || min > REFINE_MAX) return null
            return { kind: 'refinement', charIdx, min }
        }
        case 'damageNameRegex': {
            // 允许空 / 非法正则留在数据里（编辑器正在输入的草稿）；求值恒不满足，见 isRuleDraft
            return { kind: 'damageNameRegex', pattern: str(r.pattern) }
        }
        case 'damageNameEquals': {
            return { kind: 'damageNameEquals', value: str(r.value) }
        }
        case 'zoneCompare': {
            const charIdx = clampCharIdx(r.charIdx, true)
            const zone = str(r.zone) as ZoneCompareId
            const op = str(r.op) as ZoneCompareOp
            if (charIdx === null) return null
            if (!ZONE_COMPARE_OPTIONS.some((item) => item.value === zone)) return null
            if (!ZONE_COMPARE_OPS.some((item) => item.value === op)) return null
            const value = num(r.value, 0)
            return { kind: 'zoneCompare', charIdx, zone, op, value }
        }
        case 'enemyType': {
            const type = str(r.type) as EnemyTypeKind
            if (!ENEMY_TYPE_OPTIONS.some((item) => item.value === type)) return null
            return { kind: 'enemyType', type }
        }
        case 'buffActive': {
            const mode = str(r.mode) === 'any' ? 'any' : 'all'
            const ids = Array.isArray(r.buffIds)
                ? [...new Set(r.buffIds.filter((id): id is string => typeof id === 'string' && !!id))]
                : []
            // 空引用集合允许作为草稿（新建后还没勾引用项）
            return { kind: 'buffActive', mode, buffIds: ids }
        }
        default:
            return null
    }
}

/** @desc 正则是否可编译（界面输入与迁移共用；非法正则一律判为无效，不让脏数据进引擎） */
export const isValidRegex = (pattern: string): boolean => {
    try {
        void new RegExp(pattern)
        return true
    } catch {
        return false
    }
}

/**
 * @desc 规则是否「还没填写完整」（编辑器允许存盘的草稿）。
 *
 * 为什么允许草稿进数据：条件卡片是**就地编辑**的，新建一条「伤害名等于」时值必然是空的；
 * 若归一化直接把它丢掉，用户就永远填不进去（卡片刚创建就消失）。
 * 求值侧对草稿一律返回**不满足**（`ruleMet` 里判），因此草稿不会让 Buff 意外生效。
 */
export const isRuleDraft = (rule: BuffRule): boolean => {
    switch (rule.kind) {
        case 'damageNameRegex':
            return !rule.pattern.trim() || !isValidRegex(rule.pattern)
        case 'damageNameEquals':
            return !rule.value.trim()
        case 'buffActive':
            return rule.buffIds.length === 0
        default:
            return false
    }
}

/** @desc 一组规则里是否还有草稿（界面据此提示「未填写」） */
export const hasDraftRule = (rules: BuffRule[] | undefined): boolean => (rules ?? []).some(isRuleDraft)

/** @desc 归一化规则列表（丢弃非法项与重复项；空结果返回 undefined） */
export const normalizeRules = (raw: unknown): BuffRule[] | undefined => {
    if (!Array.isArray(raw)) return undefined
    const out: BuffRule[] = []
    const seen = new Set<string>()
    for (const item of raw) {
        const rule = normalizeRule(item)
        if (!rule) continue
        const key = JSON.stringify(rule)
        if (seen.has(key)) continue
        seen.add(key)
        out.push(rule)
    }
    return out.length > 0 ? out : undefined
}

/** @desc 旧实例级链/阶条件（工坊 share / AI 生成 / 旧工程）：仅迁移读取 */
export interface LegacyGateCondition {
    chains?: { charIdx?: number; min?: number }[]
    refinements?: { charIdx?: number; min?: number }[]
    chain?: number
    refinement?: number
}

/**
 * @desc 旧实例级条件 → 规则列表。
 * - `chains` / `refinements` 各自按原值升级（**链与阶可以并存**，不再互斥、不再拆分 Buff）
 * - 旧单值 `chain` / `refinement` 用 `owner`（该实体归属槽位）补齐 charIdx
 * - 旧 `elements` / `damageTypes` 属乘区级条件，**不转规则**（由调用方下放到乘区）
 */
export const rulesFromLegacyCondition = (raw: LegacyGateCondition | undefined, owner = 0): BuffRule[] | undefined => {
    if (!raw) return undefined
    const out: BuffRule[] = []
    const ownerIdx = owner >= 0 && owner <= 2 ? owner : 0
    const pushClause = (kind: 'chain' | 'refinement', charIdx: unknown, min: unknown): void => {
        const idx = clampCharIdx(charIdx, false) ?? ownerIdx
        const value = num(min, kind === 'chain' ? 0 : 1)
        const rule = normalizeRule({ kind, charIdx: idx, min: value })
        if (rule) out.push(rule)
    }
    if (Array.isArray(raw.chains)) for (const c of raw.chains) pushClause('chain', c?.charIdx, c?.min)
    if (Array.isArray(raw.refinements)) for (const c of raw.refinements) pushClause('refinement', c?.charIdx, c?.min)
    if (typeof raw.chain === 'number' && !(raw.chains?.length ?? 0)) pushClause('chain', ownerIdx, raw.chain)
    if (typeof raw.refinement === 'number' && !(raw.refinements?.length ?? 0)) {
        pushClause('refinement', ownerIdx, raw.refinement)
    }
    return out.length > 0 ? normalizeRules(out) : undefined
}

// ── 求值 ──

const compareWith = (op: ZoneCompareOp, left: number, right: number): boolean => {
    switch (op) {
        case 'gt':
            return left > right
        case 'ge':
            return left >= right
        case 'lt':
            return left < right
        case 'le':
            return left <= right
        case 'eq':
            return left === right
        default:
            return false
    }
}

/** @desc 单条规则求值（`buffActive` 走 `ctx.activeOf`；未填写完整的草稿恒不满足） */
export const ruleMet = (rule: BuffRule, ctx: RuleContext): boolean => {
    if (isRuleDraft(rule)) return false
    switch (rule.kind) {
        case 'chain':
            return (ctx.chains[rule.charIdx] ?? 0) >= rule.min
        case 'refinement':
            return (ctx.refinements[rule.charIdx] ?? 1) >= rule.min
        case 'damageNameRegex':
            if (ctx.damageName === undefined) return true
            return new RegExp(rule.pattern).test(ctx.damageName)
        case 'damageNameEquals':
            if (ctx.damageName === undefined) return true
            return ctx.damageName === rule.value
        case 'zoneCompare': {
            const idx = rule.charIdx < 0 ? ctx.activeCharIdx : rule.charIdx
            if (idx < 0) return true
            const stats = ctx.statsOf?.(idx)
            if (!stats) return true
            return compareWith(rule.op, stats[rule.zone], rule.value)
        }
        case 'enemyType':
            if (ctx.enemyType === undefined) return true
            return ctx.enemyType === rule.type
        case 'buffActive':
            return ctx.activeOf ? buffActiveMet(rule, ctx.activeOf) : false
        default:
            return true
    }
}

/** @desc `buffActive` 单条规则求值（按存活集合判定 all / any） */
const buffActiveMet = (rule: Extract<BuffRule, { kind: 'buffActive' }>, activeOf: (id: string) => boolean): boolean =>
    rule.mode === 'any' ? rule.buffIds.some((id) => activeOf(id)) : rule.buffIds.every((id) => activeOf(id))

/** @desc 除 `buffActive` 之外的全部规则是否满足（用于不动点求值的静态前置判定） */
export const rulesMetExceptActive = (rules: BuffRule[] | undefined, ctx: RuleContext): boolean =>
    (rules ?? []).every((rule) => rule.kind === 'buffActive' || ruleMet(rule, ctx))

/** @desc 全部 `buffActive` 规则是否满足给定的存活集合 */
export const activeRulesMet = (rules: BuffRule[] | undefined, activeOf: (id: string) => boolean): boolean =>
    (rules ?? []).every((rule) => rule.kind !== 'buffActive' || buffActiveMet(rule, activeOf))

/** @desc 全部规则求值（AND） */
export const evaluateRules = (rules: BuffRule[] | undefined, ctx: RuleContext): boolean =>
    (rules ?? []).every((rule) => ruleMet(rule, ctx))

/**
 * @desc `buffActive` 的**最小不动点**求值：从「全部未生效」出发反复激活，直到不再变化。
 *
 * 为什么是「最小」：规则只有 AND 与正极性引用（「某个 Buff 生效」才能激活自己），
 * 因此最小不动点即语义上唯一解；任何循环引用都自然落在「永不激活」上——
 * 创建期已禁止成环，这里是对手改 JSON / 导入脏数据的运行时兜底。
 *
 * @param buffs 本条伤害的候选 Buff（已按绑定关系筛过）
 * @param scopeOk 作用域判定（本函数不关心作用域口径，由调用方注入）
 * @param ctx 规则上下文（`activeOf` 由本函数内部覆盖）
 */
export const resolveActiveBuffIds = (
    buffs: readonly BuffInstance[],
    scopeOk: (buff: BuffInstance) => boolean,
    ctx: RuleContext
): Set<string> => {
    const staticOk = buffs.filter((buff) => scopeOk(buff) && rulesMetExceptActive(buff.rules, ctx))
    const active = new Set<string>()
    let changed = staticOk.length > 0
    while (changed) {
        changed = false
        for (const buff of staticOk) {
            if (active.has(buff.id)) continue
            if (!activeRulesMet(buff.rules, (id) => active.has(id))) continue
            active.add(buff.id)
            changed = true
        }
    }
    return active
}

// ── 依赖关系（创建期校验 / 删除级联）──

/** @desc 一条规则直接引用的 Buff id（仅 `buffActive`） */
export const ruleDependencyIds = (rule: BuffRule): string[] => (rule.kind === 'buffActive' ? rule.buffIds : [])

/** @desc 一组规则引用的全部 Buff id（去重） */
export const dependencyIdsOf = (rules: BuffRule[] | undefined): string[] => [
    ...new Set((rules ?? []).flatMap(ruleDependencyIds))
]

/**
 * @desc 若把 `nextRules` 挂到 `candidateId` 上会形成（直接或间接）循环，返回环上的 Buff id 序列；
 * 否则返回 null。`candidateId` 自身被引用即「直接自引用」，同样返回 `[candidateId]`。
 */
export const cyclePathOf = (
    buffs: readonly BuffInstance[],
    candidateId: string,
    nextRules: BuffRule[] | undefined
): string[] | null => {
    const edges = new Map<string, string[]>()
    for (const buff of buffs) {
        if (buff.id === candidateId) continue
        edges.set(buff.id, dependencyIdsOf(buff.rules))
    }
    const deps = dependencyIdsOf(nextRules)
    if (deps.includes(candidateId)) return [candidateId, candidateId]

    // 从每个被引用的 Buff 出发 DFS，看是否能回到 candidateId
    const findPath = (start: string, seen: Set<string>): string[] | null => {
        if (start === candidateId) return [start]
        if (seen.has(start)) return null
        seen.add(start)
        for (const next of edges.get(start) ?? []) {
            const path = findPath(next, seen)
            if (path) return [start, ...path]
        }
        return null
    }
    for (const dep of deps) {
        const path = findPath(dep, new Set())
        if (path) return [candidateId, ...path]
    }
    return null
}

/** @desc 引用了 `id` 的 Buff（直接依赖方） */
export const dependentsOf = (buffs: readonly BuffInstance[], id: string): BuffInstance[] =>
    buffs.filter((buff) => buff.id !== id && dependencyIdsOf(buff.rules).includes(id))

/**
 * @desc 删除 `rootIds` 时**必须一并删除**的 Buff 集合（含 root 自身，按删除顺序返回）。
 *
 * 规则语义：
 * - `all` 规则引用的任一条被删 → 该 Buff 永远无法生效 → 级联删除；
 * - `any` 规则只要还有存活引用项就保留依赖方（引用集合被剪到存活项即可），全部消失才删除；
 * - 反复迭代到不动点，因此支持多级依赖。
 */
export const cascadeDeleteIdsOf = (buffs: readonly BuffInstance[], rootIds: readonly string[]): string[] => {
    const removed = new Set(rootIds)
    let changed = true
    while (changed) {
        changed = false
        for (const buff of buffs) {
            if (removed.has(buff.id)) continue
            const broken = (buff.rules ?? []).some((rule) => {
                if (rule.kind !== 'buffActive') return false
                const dead = rule.buffIds.filter((id) => removed.has(id))
                if (dead.length === 0) return false
                return rule.mode === 'all' || dead.length >= rule.buffIds.length
            })
            if (!broken) continue
            removed.add(buff.id)
            changed = true
        }
    }
    return [...removed]
}

/**
 * @desc 从规则里剪掉已删除的引用项（`buffActive` 的 buffIds 过滤；剪空则丢弃该条规则）。
 * 用于「`any` 规则仍有存活项时保留依赖方」：那些已被删掉的引用项必须从数据里消失，
 * 否则引擎算出的 `any` 会因为缺项而永远不满足。
 */
export const pruneRuleDependencies = (
    rules: BuffRule[] | undefined,
    removedIds: readonly string[]
): BuffRule[] | undefined => {
    if (!rules?.length || removedIds.length === 0) return rules
    const removed = new Set(removedIds)
    const out: BuffRule[] = []
    for (const rule of rules) {
        if (rule.kind !== 'buffActive') {
            out.push(rule)
            continue
        }
        const kept = rule.buffIds.filter((id) => !removed.has(id))
        if (kept.length > 0) out.push({ ...rule, buffIds: kept })
    }
    return out.length > 0 ? out : undefined
}

// ── 文案 ──

export interface RuleDescribeDeps {
    /** @desc 槽位显示名（角色名） */
    slotName?: (charIdx: number) => string
    /** @desc Buff 显示名 */
    buffName?: (buffId: string) => string
}

/**
 * @desc 单条规则的完整文案（条件卡标题 / 摘要共用）。
 * 口径与旧 `describeCondition` 保持可读性：链条件 0 链写作「本体」，阶条件一律「≥N阶」。
 */
export const describeRule = (rule: BuffRule, deps: RuleDescribeDeps = {}): string => {
    const slotName = deps.slotName ?? ((i: number) => `角色${i + 1}`)
    const buffName = deps.buffName ?? ((id: string) => id)
    switch (rule.kind) {
        case 'chain':
            return rule.min > 0
                ? `${slotName(rule.charIdx)} 共鸣链 ≥ ${rule.min}`
                : `${slotName(rule.charIdx)} 本体（0 链）`
        case 'refinement':
            return `${slotName(rule.charIdx)} 武器精炼 ≥ ${rule.min} 阶`
        case 'damageNameRegex':
            return `伤害名匹配 /${rule.pattern}/`
        case 'damageNameEquals':
            return `伤害名 = ${rule.value}`
        case 'zoneCompare': {
            const option = ZONE_COMPARE_OPTIONS.find((item) => item.value === rule.zone)
            const op = ZONE_COMPARE_OPS.find((item) => item.value === rule.op)?.label ?? rule.op
            const who = rule.charIdx < 0 ? '当前角色' : slotName(rule.charIdx)
            const unit = option?.unit === '%' ? '%' : ''
            return `${who} ${option?.label ?? rule.zone} ${op} ${rule.value}${unit}`
        }
        case 'enemyType':
            return `敌人类型 = ${enemyTypeLabel(rule.type)}`
        case 'buffActive': {
            const names = rule.buffIds.map(buffName).join('、')
            return rule.mode === 'any' ? `以下 BUFF 至少一个生效：${names}` : `以下 BUFF 全部生效：${names}`
        }
        default:
            return ''
    }
}

/** @desc 规则列表摘要（无条件时返回空串，供列表/卡片尾部展示） */
export const describeRules = (rules: BuffRule[] | undefined, deps: RuleDescribeDeps = {}): string =>
    (rules ?? []).map((rule) => describeRule(rule, deps)).join(' 且 ')
