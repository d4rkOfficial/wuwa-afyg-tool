// 生成结果清洗：白名单过滤乘区/引用/scope/condition、数值归一化、去重（移植自 wuwa-afyg-share）
import { ZONE_MAP, ZONE_REF_MAP } from '$lib/calc/calculation.consts'
import { ELEMENTS, DAMAGE_TYPES } from '$lib/consts/game-terms'
import { CHAIN_MAX, REFINE_MAX } from '$lib/data/buff-library.svelte'
import type { BuffCondition } from '$lib/calc/calculation.types'

export const BUFF_SCOPES = ['self', 'self_except', 'team', 'effect_only'] as const
export type BuffScope = (typeof BUFF_SCOPES)[number]

export interface GeneratedZone {
    zoneId?: string
    value?: number
    override?: boolean
    ref?: {
        targetZoneId?: string
        pct?: number
        threshold?: number
        lower?: number
        upper?: number
        discrete?: boolean
        divisor?: number
        multiplier?: number
        refOwner?: 'self' | 'owner'
    } | null
}

export interface GeneratedBuff {
    buffName?: string
    scope?: string
    exclusive?: boolean
    condition?: unknown
    zones?: GeneratedZone[]
}

// 只保留白名单乘区、合法数值，避免脏数据
export function sanitizeBuffs(buffs: GeneratedBuff[]): GeneratedBuff[] {
    const out: GeneratedBuff[] = []
    const seen = new Set<string>()
    for (const b of buffs) {
        const name = b.buffName?.trim()
        if (!name || seen.has(name)) continue
        const zones = (Array.isArray(b.zones) ? b.zones : [])
            .filter((z) => z && ZONE_MAP.has(z.zoneId as never) && Number.isFinite(z.value))
            .map((z) => ({
                zoneId: z.zoneId,
                value: z.value,
                ...(z.override ? { override: true } : {}),
                ...(sanitizeRef(z.ref) ? { ref: sanitizeRef(z.ref) } : {})
            }))
        if (!zones.length) continue
        const scope: BuffScope = b.scope && BUFF_SCOPES.includes(b.scope as BuffScope) ? (b.scope as BuffScope) : 'team'
        const exclusive = scope === 'effect_only' || !!b.exclusive
        const condition = sanitizeCondition(b.condition)
        seen.add(name)
        out.push({ buffName: name, scope, exclusive, ...(condition ? { condition } : {}), zones })
    }
    return out
}

// 只保留白名单引用乘区、合法数值
function sanitizeRef(ref: GeneratedZone['ref']): GeneratedZone['ref'] {
    if (!ref || !ZONE_REF_MAP.has(ref.targetZoneId as never)) return undefined
    if (!Number.isFinite(ref.pct)) return undefined
    const clean: NonNullable<GeneratedZone['ref']> = { targetZoneId: ref.targetZoneId, pct: ref.pct }
    if (Number.isFinite(ref.threshold)) clean.threshold = ref.threshold
    if (Number.isFinite(ref.lower)) clean.lower = ref.lower
    if (Number.isFinite(ref.upper)) clean.upper = ref.upper
    if (ref.discrete) clean.discrete = true
    if (Number.isFinite(ref.divisor)) clean.divisor = ref.divisor
    if (Number.isFinite(ref.multiplier)) clean.multiplier = ref.multiplier
    if (ref.refOwner === 'self' || ref.refOwner === 'owner') clean.refOwner = ref.refOwner
    return clean
}

// 清洗生效条件：白名单校验 + 数值/数组归一化；兼容旧格式 {type,min}；全空返回 undefined
export function sanitizeCondition(cond: unknown): BuffCondition | undefined {
    if (!cond || typeof cond !== 'object') return undefined
    const c = cond as Record<string, unknown>
    // 旧格式兼容：{ type: 'chain'|'refinement', min } → 多字段
    if (c.type === 'chain' || c.type === 'refinement') {
        const min = typeof c.min === 'number' && Number.isFinite(c.min) ? Math.floor(c.min) : 0
        const max = c.type === 'chain' ? CHAIN_MAX : REFINE_MAX
        const minOk = c.type === 'chain' ? min >= 0 : min >= 1
        return minOk && min <= max ? ({ [c.type]: min } as BuffCondition) : undefined
    }
    const out: BuffCondition = {}
    if (typeof c.chain === 'number' && Number.isFinite(c.chain)) {
        const min = Math.floor(c.chain)
        if (min >= 0 && min <= CHAIN_MAX) out.chain = min
    }
    if (typeof c.refinement === 'number' && Number.isFinite(c.refinement)) {
        const min = Math.floor(c.refinement)
        if (min >= 1 && min <= REFINE_MAX) out.refinement = min
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
