// 生成结果清洗：白名单过滤乘区/引用/scope/condition、数值归一化、去重（移植自 wuwa-afyg-share）
import {
    ZONE_MAP,
    ZONE_NO_REF_IDS,
    ZONE_NO_OVERRIDE_IDS,
    ZONE_REF_MAP,
    resolveZoneId
} from '$lib/calc/calculation.consts'
import { ELEMENTS, DAMAGE_TYPES } from '$lib/consts/game-terms'
import { CHAIN_MAX, REFINE_MAX } from '$lib/data/buff-library.svelte'
import { sanitizeLeafName } from '$lib/calc/buff-name'
import type { BuffCondition } from '$lib/calc/calculation.types'
import { normalizeRules, type LegacyGateCondition } from '$lib/calc/rules'

/** @desc 生成结果里的实例级链/阶条件（链/阶 + 可能附带的属性/类型字段） */
export type SanitizedGateCondition = LegacyGateCondition & {
    elements?: string[]
    damageTypes?: string[]
}

export const BUFF_SCOPES = ['self', 'self_except', 'team', 'team_only', 'effect_only'] as const
export type BuffScope = (typeof BUFF_SCOPES)[number]

export interface GeneratedZone {
    zoneId?: string
    value?: number
    override?: boolean
    /** @desc 乘区级生效条件（只允许伤害类型 / 伤害属性；链阶由实例级统一把关） */
    condition?: BuffCondition
    ref?: {
        targetZoneId?: string
        pct?: number
        threshold?: number
        lower?: number
        upper?: number
        discrete?: boolean
        divisor?: number
        multiplier?: number
        /** @desc 引用归属：本角色（`self`/`owner`）/ 出伤者（`active`） */
        refOwner?: 'self' | 'owner' | 'active'
    } | null
}

export interface GeneratedBuff {
    buffName?: string
    scope?: string
    exclusive?: boolean
    /** @desc 实例级链/阶硬门槛（导入时升级为 `rules`；链与阶可以并存） */
    condition?: unknown
    /** @desc 新格式：Buff 级规则列表（discriminated union，全部 AND） */
    rules?: unknown
    zones?: GeneratedZone[]
}

/**
 * @desc 只保留白名单乘区、合法数值，避免脏数据。
 * 生成名一律压成单段短名：模型若把文件夹分隔符 `\` 写进 buffName，转成正斜杠而不是建文件夹。
 * 乘区是**贡献条目列表**：同一乘区可保留多条（各自带自己的条件），仅剔除完全重复的条目；
 * 同一乘区内只保留一个覆盖条目；百分比类 / 额外倍率不支持覆盖。
 */
export function sanitizeBuffs(buffs: GeneratedBuff[]): GeneratedBuff[] {
    const out: GeneratedBuff[] = []
    const seen = new Set<string>()
    for (const b of buffs) {
        const name = sanitizeLeafName(b.buffName ?? '')
        if (!name || seen.has(name)) continue
        const zones = sanitizeZones(b.zones)
        if (!zones.length) continue
        const scope: BuffScope = b.scope && BUFF_SCOPES.includes(b.scope as BuffScope) ? (b.scope as BuffScope) : 'team'
        const exclusive = scope === 'effect_only' || !!b.exclusive
        const condition = sanitizeCondition(b.condition)
        const rules = normalizeRules(b.rules)
        seen.add(name)
        out.push({
            buffName: name,
            scope,
            exclusive,
            ...(condition ? { condition } : {}),
            ...(rules ? { rules } : {}),
            zones
        })
    }
    return out
}

function sanitizeZones(zones: GeneratedZone[] | undefined): GeneratedZone[] {
    const out: GeneratedZone[] = []
    const seen = new Set<string>()
    for (const z of Array.isArray(zones) ? zones : []) {
        if (!z) continue
        const zoneId = resolveZoneId(String(z.zoneId ?? ''))
        if (!ZONE_MAP.has(zoneId)) continue
        const num = z.value
        if (num === undefined || !Number.isFinite(num)) continue
        // 层数类乘区（集谐干涉/同奏增益等）只填固定层数，丢弃模型误输出的引用
        const ref = !ZONE_NO_REF_IDS.has(zoneId) ? sanitizeRef(z.ref) : undefined
        const override = !!z.override && !ref && !ZONE_NO_OVERRIDE_IDS.has(zoneId)
        const condition = sanitizeZoneCondition(z.condition)
        const key = `${zoneId}|${override ? 'o' : 'a'}|${condition ? JSON.stringify(condition) : ''}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
            zoneId,
            value: num,
            ...(override ? { override: true } : {}),
            ...(ref ? { ref } : {}),
            ...(condition ? { condition } : {})
        })
    }
    // 同一乘区内只保留一个覆盖条目（最后出现的生效）
    const overrideKept = new Set<string>()
    const deduped: GeneratedZone[] = []
    for (let i = out.length - 1; i >= 0; i--) {
        const zone = out[i]
        if (zone.override) {
            if (overrideKept.has(zone.zoneId as string)) continue
            overrideKept.add(zone.zoneId as string)
        }
        deduped.unshift(zone)
    }
    return deduped
}

// 只保留白名单引用乘区、合法数值
function sanitizeRef(ref: GeneratedZone['ref']): GeneratedZone['ref'] {
    if (!ref || !ZONE_REF_MAP.has(ref.targetZoneId as never)) return undefined
    /**
     * @desc pct 只对「线性转模」有意义。离散转模（discrete + divisor + multiplier）按
     * 「每 divisor 转 multiplier」取整档，本来就不带 pct —— prompts 里的转模样例
     * （暴击伤害(转模)）正是这种写法。这里曾要求 pct 必须是数字，于是这类转模在
     * 「生成 → 应用」时被整条丢掉（表现为转模写不进去），缺省按 0。
     */
    const pct = Number.isFinite(ref.pct) ? (ref.pct as number) : 0
    const clean: NonNullable<GeneratedZone['ref']> = { targetZoneId: ref.targetZoneId, pct }
    if (Number.isFinite(ref.threshold)) clean.threshold = ref.threshold
    if (Number.isFinite(ref.lower)) clean.lower = ref.lower
    if (Number.isFinite(ref.upper)) clean.upper = ref.upper
    if (ref.discrete) clean.discrete = true
    if (Number.isFinite(ref.divisor)) clean.divisor = ref.divisor
    if (Number.isFinite(ref.multiplier)) clean.multiplier = ref.multiplier
    if (ref.refOwner === 'self' || ref.refOwner === 'owner' || ref.refOwner === 'active') {
        clean.refOwner = ref.refOwner
    }
    return clean
}

const normClauses = (value: unknown, max: number, minFloor: number) => {
    if (!Array.isArray(value)) return undefined
    const out: { charIdx: number; min: number }[] = []
    for (const item of value) {
        if (!item || typeof item !== 'object') continue
        const c = item as Record<string, unknown>
        const charIdx = typeof c.charIdx === 'number' && Number.isFinite(c.charIdx) ? Math.floor(c.charIdx) : 0
        const min = typeof c.min === 'number' && Number.isFinite(c.min) ? Math.floor(c.min) : NaN
        if (!Number.isFinite(min) || min < minFloor || min > max) continue
        if (charIdx < 0 || charIdx > 2) continue
        if (out.some((x) => x.charIdx === charIdx && x.min === min)) continue
        out.push({ charIdx, min })
    }
    return out.length > 0 ? out : undefined
}

/**
 * @desc 清洗实例级生效条件（`{ type, min }` / 单值 / 数组三种形状）：白名单校验 + 数值归一化。
 * - `{ type:'chain'|'refinement', min }` 与单值 `{ chain } / { refinement }` 一律归为数组形式
 * - 链与阶**可以并存**（v7 起两者都作为规则存在）
 * - `elements` / `damageTypes` 原样回传（它们属于乘区级，由乘区条目承载）
 */
export function sanitizeCondition(cond: unknown): SanitizedGateCondition | undefined {
    if (!cond || typeof cond !== 'object') return undefined
    const c = cond as Record<string, unknown>
    const out: SanitizedGateCondition = {}

    const chains = normClauses(c.chains, CHAIN_MAX, 0)
    const refinements = normClauses(c.refinements, REFINE_MAX, 1)
    if (chains) out.chains = chains
    if (refinements) out.refinements = refinements

    // 单条形态：{ type:'chain'|'refinement', min } → 数组形式
    if (c.type === 'chain' || c.type === 'refinement') {
        const min = typeof c.min === 'number' && Number.isFinite(c.min) ? Math.floor(c.min) : NaN
        if (c.type === 'chain' && !out.chains && Number.isFinite(min) && min >= 0 && min <= CHAIN_MAX) {
            out.chains = [{ charIdx: 0, min }]
        }
        if (c.type === 'refinement' && !out.refinements && Number.isFinite(min) && min >= 1 && min <= REFINE_MAX) {
            out.refinements = [{ charIdx: 0, min }]
        }
    }
    // 单值字段：归为数组形式
    if (!out.chains && typeof c.chain === 'number' && Number.isFinite(c.chain)) {
        const min = Math.floor(c.chain)
        if (min >= 0 && min <= CHAIN_MAX) out.chains = [{ charIdx: 0, min }]
    }
    if (!out.refinements && typeof c.refinement === 'number' && Number.isFinite(c.refinement)) {
        const min = Math.floor(c.refinement)
        if (min >= 1 && min <= REFINE_MAX) out.refinements = [{ charIdx: 0, min }]
    }
    if (Array.isArray(c.elements)) {
        const elements = c.elements.filter(
            (e): e is string => typeof e === 'string' && (ELEMENTS as readonly string[]).includes(e)
        )
        if (elements.length > 0) out.elements = [...new Set(elements)]
    }
    if (Array.isArray(c.damageTypes)) {
        const damageTypes = c.damageTypes.filter(
            (d): d is string => typeof d === 'string' && (DAMAGE_TYPES as readonly string[]).includes(d)
        )
        if (damageTypes.length > 0) out.damageTypes = [...new Set(damageTypes)]
    }
    return Object.keys(out).length > 0 ? out : undefined
}

/** @desc 清洗乘区级条件：只保留伤害类型 / 伤害属性（链阶由实例级统一把关） */
export function sanitizeZoneCondition(cond: unknown): BuffCondition | undefined {
    if (!cond || typeof cond !== 'object') return undefined
    const c = cond as Record<string, unknown>
    const out: BuffCondition = {}
    if (Array.isArray(c.elements)) {
        const elements = c.elements.filter(
            (e): e is string => typeof e === 'string' && (ELEMENTS as readonly string[]).includes(e)
        )
        if (elements.length > 0) out.elements = [...new Set(elements)]
    }
    if (Array.isArray(c.damageTypes)) {
        const damageTypes = c.damageTypes.filter(
            (d): d is string => typeof d === 'string' && (DAMAGE_TYPES as readonly string[]).includes(d)
        )
        if (damageTypes.length > 0) out.damageTypes = [...new Set(damageTypes)]
    }
    return Object.keys(out).length > 0 ? out : undefined
}
