import { browser } from '$app/environment'
import { dbGet, dbSet } from '$lib/data/db'
import { ELEMENTS, DAMAGE_TYPES } from '$lib/consts/game-terms'
import { getShareBase } from './workshop.svelte'
import type { BuffCondition, BuffZoneValue } from '$lib/calc/calculation.types'

export type BuffEntityType = 'character' | 'weapon' | 'echo' | '1set' | '2set' | '3set' | '4set' | '5set'

export type BuffLibraryScope = 'self' | 'self_except' | 'team' | 'effect_only'

export const CHAIN_MAX = 6
export const REFINE_MAX = 5

const ELEMENT_SET = new Set<string>(ELEMENTS)
const DAMAGE_TYPE_SET = new Set<string>(DAMAGE_TYPES)

function normalizeCondition(value: unknown): BuffCondition | undefined {
    if (!value || typeof value !== 'object') return undefined
    const c = value as Record<string, unknown>
    const out: BuffCondition = {}
    // 旧格式兼容：{ type, min } / { type, elements } / { type, damageTypes }
    if (c.type === 'chain' || c.type === 'refinement') {
        const min = typeof c.min === 'number' && Number.isFinite(c.min) ? Math.floor(c.min) : 0
        const max = c.type === 'chain' ? CHAIN_MAX : REFINE_MAX
        const minOk = c.type === 'chain' ? min >= 0 : min >= 1
        if (minOk && min <= max) out[c.type as 'chain' | 'refinement'] = min
    } else if (c.type === 'element' && Array.isArray(c.elements)) {
        const elements = c.elements.filter((e): e is string => typeof e === 'string' && ELEMENT_SET.has(e))
        if (elements.length > 0) out.elements = [...new Set(elements)]
    } else if (c.type === 'damageType' && Array.isArray(c.damageTypes)) {
        const damageTypes = c.damageTypes.filter((d): d is string => typeof d === 'string' && DAMAGE_TYPE_SET.has(d))
        if (damageTypes.length > 0) out.damageTypes = [...new Set(damageTypes)]
    }
    // 新格式：独立字段
    if (typeof c.chain === 'number' && Number.isFinite(c.chain)) {
        const min = Math.floor(c.chain)
        if (min >= 0 && min <= CHAIN_MAX) out.chain = min
    }
    if (typeof c.refinement === 'number' && Number.isFinite(c.refinement)) {
        const min = Math.floor(c.refinement)
        if (min >= 1 && min <= REFINE_MAX) out.refinement = min
    }
    if (Array.isArray(c.elements)) {
        const elements = c.elements.filter((e): e is string => typeof e === 'string' && ELEMENT_SET.has(e))
        if (elements.length > 0) out.elements = [...new Set(elements)]
    }
    if (Array.isArray(c.damageTypes)) {
        const damageTypes = c.damageTypes.filter((d): d is string => typeof d === 'string' && DAMAGE_TYPE_SET.has(d))
        if (damageTypes.length > 0) out.damageTypes = [...new Set(damageTypes)]
    }
    return Object.keys(out).length > 0 ? out : undefined
}

function cloneCondition(cond: BuffCondition): BuffCondition {
    return {
        ...(cond.chain !== undefined ? { chain: cond.chain } : {}),
        ...(cond.refinement !== undefined ? { refinement: cond.refinement } : {}),
        ...(cond.elements ? { elements: [...cond.elements] } : {}),
        ...(cond.damageTypes ? { damageTypes: [...cond.damageTypes] } : {})
    }
}

// 按实体类型限制条件：角色可设共鸣链、武器可设精炼、声骸/套装均不可
function sanitizeConditionForEntity(entityType: BuffEntityType, cond: BuffCondition): BuffCondition | undefined {
    const out = cloneCondition(cond)
    if (entityType !== 'character') delete out.chain
    if (entityType !== 'weapon') delete out.refinement
    return Object.keys(out).length > 0 ? out : undefined
}

export interface BuffLibraryZoneRef {
    targetZoneId: string
    pct: number
    threshold?: number
    lower?: number
    upper?: number
    discrete?: boolean
    divisor?: number
    multiplier?: number
    refOwner?: 'self' | 'owner'
}

export interface BuffLibraryZone {
    zoneId: string
    value: number
    ref?: BuffLibraryZoneRef
    override?: boolean
}

export interface BuffLibraryItem {
    entityType: BuffEntityType
    entityName: string
    buffName: string
    scope?: BuffLibraryScope
    exclusive?: boolean
    condition?: BuffCondition
    zones: BuffLibraryZone[]
}

export interface BuffLibraryBuff {
    buffName: string
    scope?: BuffLibraryScope
    exclusive?: boolean
    condition?: BuffCondition
    zones: BuffLibraryZone[]
}

export interface BuffLibraryEntity {
    entityType: BuffEntityType
    entityName: string
    source: 'share' | 'custom'
    buffs: BuffLibraryBuff[]
}

const LIBRARY_KEY = 'buff-library'

export const ENTITY_TYPE_LABELS: Record<BuffEntityType, string> = {
    character: '角色',
    weapon: '武器',
    echo: '首位声骸',
    '1set': '套装1件',
    '2set': '套装2件',
    '3set': '套装3件',
    '4set': '套装4件',
    '5set': '套装5件'
}

export const ENTITY_TYPES: BuffEntityType[] = ['character', 'weapon', 'echo', '1set', '2set', '3set', '4set', '5set']

export type BuffCategory = 'character' | 'weapon' | 'echo' | 'set'

export const BUFF_CATEGORY_ORDER: BuffCategory[] = ['character', 'weapon', 'echo', 'set']

export const BUFF_CATEGORY_LABELS: Record<BuffCategory, string> = {
    character: '角色',
    weapon: '武器',
    echo: '首位声骸',
    set: '套装'
}

export function categoryOfType(type: BuffEntityType): BuffCategory {
    return type === 'character' || type === 'weapon' || type === 'echo' ? type : 'set'
}

export function setPiecesOf(type: BuffEntityType): number {
    const n = parseInt(type, 10)
    return Number.isFinite(n) ? n : 0
}

export const SCOPE_LABELS: Record<BuffLibraryScope, string> = {
    self: '对自己',
    self_except: '自己除外',
    team: '对全队',
    effect_only: '效应'
}

let _entities = $state<BuffLibraryEntity[]>([])
let _loaded = false
let _loading = false
let _error = $state<string | null>(null)

function entityKey(entityType: BuffEntityType, entityName: string) {
    return `${entityType}/${entityName}`
}

function buffKey(b: BuffLibraryBuff) {
    return b.buffName.trim()
}

export function getBuffEntities() {
    return _entities
}

export function getBuffLibrary(): BuffLibraryItem[] {
    const result: BuffLibraryItem[] = []
    for (const entity of _entities) {
        for (const buff of entity.buffs) {
            result.push({
                entityType: entity.entityType,
                entityName: entity.entityName,
                buffName: buff.buffName,
                scope: buff.scope,
                exclusive: buff.exclusive,
                ...(buff.condition ? { condition: buff.condition } : {}),
                zones: buff.zones
            })
        }
    }
    return result
}

export function getBuffLibraryLoading() {
    return _loading
}

export function getBuffLibraryError() {
    return _error
}

export async function loadBuffLibrary() {
    if (!browser || _loaded) return
    const stored = await dbGet<unknown>(LIBRARY_KEY)
    if (stored?.data != null) {
        _entities = normalizeStored(stored.data)
    }
    _loaded = true
}

function normalizeStored(data: unknown): BuffLibraryEntity[] {
    if (!Array.isArray(data)) return []
    const map = new Map<string, BuffLibraryEntity>()
    for (const raw of data) {
        if (!raw || typeof raw !== 'object') continue
        const obj = raw as Record<string, unknown>
        const et = String(obj.entityType ?? '')
        const en = String(obj.entityName ?? '').trim()
        if (!ENTITY_TYPES.includes(et as BuffEntityType) || !en) continue
        const key = entityKey(et as BuffEntityType, en)
        if (Array.isArray(obj.buffs) && typeof obj.source === 'string') {
            const buffs: BuffLibraryBuff[] = []
            for (const b of obj.buffs) {
                if (!b || typeof b !== 'object') continue
                const bb = b as Record<string, unknown>
                const name = String(bb.buffName ?? '').trim()
                const zones = normalizeZones(bb.zones)
                if (!name) continue
                buffs.push({
                    buffName: name,
                    scope: (bb.scope as BuffLibraryScope) ?? undefined,
                    exclusive: !!bb.exclusive,
                    ...(normalizeCondition(bb.condition) ? { condition: normalizeCondition(bb.condition) } : {}),
                    zones
                })
            }
            if (!buffs.length) continue
            const existing = map.get(key)
            if (existing) {
                const seen = new Set(existing.buffs.map(buffKey))
                for (const bb of buffs) {
                    const k = buffKey(bb)
                    if (!seen.has(k)) {
                        existing.buffs.push(bb)
                        seen.add(k)
                    }
                }
            } else {
                map.set(key, {
                    entityType: et as BuffEntityType,
                    entityName: en,
                    source: obj.source === 'custom' ? 'custom' : 'share',
                    buffs
                })
            }
        } else {
            const name = String(obj.buffName ?? '').trim()
            const zones = normalizeZones(obj.zones)
            if (!name) continue
            const buff = { buffName: name, zones }
            const existing = map.get(key)
            if (existing) {
                const k = buffKey(buff)
                if (!existing.buffs.some((b) => buffKey(b) === k)) existing.buffs.push(buff)
            } else {
                map.set(key, {
                    entityType: et as BuffEntityType,
                    entityName: en,
                    source: 'share',
                    buffs: [buff]
                })
            }
        }
    }
    return [...map.values()]
}

function normalizeZones(value: unknown): BuffLibraryZone[] {
    if (!Array.isArray(value)) return []
    const zones: BuffLibraryZone[] = []
    for (const z of value) {
        if (!z || typeof z !== 'object') continue
        const zo = z as Record<string, unknown>
        const zoneId = String(zo.zoneId ?? '')
        const num = Number(zo.value)
        if (!zoneId || Number.isNaN(num)) continue
        zones.push({
            zoneId,
            value: num,
            ...(normalizeRef(zo.ref) ? { ref: normalizeRef(zo.ref) } : {}),
            ...(zo.override ? { override: true } : {})
        })
    }
    return zones
}

function normalizeRef(value: unknown): BuffLibraryZoneRef | undefined {
    if (!value || typeof value !== 'object') return undefined
    const ro = value as Record<string, unknown>
    const targetZoneId = String(ro.targetZoneId ?? '')
    const pct = Number(ro.pct)
    if (!targetZoneId || Number.isNaN(pct)) return undefined
    const out: BuffLibraryZoneRef = { targetZoneId, pct }
    if (Number.isFinite(ro.threshold)) out.threshold = Number(ro.threshold)
    if (Number.isFinite(ro.lower)) out.lower = Number(ro.lower)
    if (Number.isFinite(ro.upper)) out.upper = Number(ro.upper)
    if (ro.discrete) out.discrete = true
    if (Number.isFinite(ro.divisor)) out.divisor = Number(ro.divisor)
    if (Number.isFinite(ro.multiplier)) out.multiplier = Number(ro.multiplier)
    if (ro.refOwner === 'self' || ro.refOwner === 'owner') out.refOwner = ro.refOwner
    return out
}

async function persist() {
    if (!browser) return
    await dbSet(LIBRARY_KEY, JSON.parse(JSON.stringify(_entities)))
}

function cloneBuffsValid(buffs: BuffLibraryBuff[]): BuffLibraryBuff[] {
    const out: BuffLibraryBuff[] = []
    const seen = new Set<string>()
    for (const b of buffs) {
        const name = b.buffName.trim()
        if (!name || seen.has(name)) continue
        seen.add(name)
        out.push({
            buffName: name,
            scope: b.scope,
            exclusive: b.exclusive,
            ...(b.condition ? { condition: cloneCondition(b.condition) } : {}),
            zones: b.zones.map((z) => ({ ...z }))
        })
    }
    return out
}

export async function updateEntityBuffs(entityType: BuffEntityType, entityName: string, buffs: BuffLibraryBuff[]) {
    const key = entityKey(entityType, entityName)
    const valid = cloneBuffsValid(buffs).map((b) => ({
        ...b,
        ...(b.condition ? { condition: sanitizeConditionForEntity(entityType, b.condition) } : {})
    }))
    const exists = _entities.some((e) => entityKey(e.entityType, e.entityName) === key)
    if (exists) {
        _entities = _entities.map((e) =>
            entityKey(e.entityType, e.entityName) === key ? { ...e, source: 'custom', buffs: valid } : e
        )
    } else {
        _entities = [..._entities, { entityType, entityName, source: 'custom', buffs: valid }]
    }
    await persist()
}

export async function setEntitySource(entityType: BuffEntityType, entityName: string, source: 'share' | 'custom') {
    const key = entityKey(entityType, entityName)
    _entities = _entities.map((e) => (entityKey(e.entityType, e.entityName) === key ? { ...e, source } : e))
    await persist()
}

export async function deleteBuffEntity(entityType: BuffEntityType, entityName: string) {
    const key = entityKey(entityType, entityName)
    _entities = _entities.filter((e) => entityKey(e.entityType, e.entityName) !== key)
    await persist()
}

export function clearBuffLibrary() {
    _entities = []
    persist()
}

export interface FetchBuffSetsResult {
    ok: boolean
    added: number
    error?: string
}

export async function fetchBuffSetsFromShare(): Promise<FetchBuffSetsResult> {
    if (_loading) return { ok: false, added: 0 }
    _loading = true
    _error = null
    try {
        const res = await fetch(`${getShareBase()}/api/buff-sets`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as {
            buffSets?: Array<{
                entity_type?: string
                entity_name?: string
                buff_name?: string
                scope?: BuffLibraryScope
                exclusive?: boolean
                condition?: BuffCondition
                buff_set?: BuffLibraryZone[]
            }>
        }
        const rows: BuffLibraryItem[] = (json.buffSets ?? [])
            .map((r) => ({
                entityType: (r.entity_type ?? '') as BuffEntityType,
                entityName: (r.entity_name ?? '').trim(),
                buffName: (r.buff_name ?? '').trim(),
                scope: r.scope,
                exclusive: !!r.exclusive,
                ...(normalizeCondition(r.condition) ? { condition: normalizeCondition(r.condition) } : {}),
                zones: Array.isArray(r.buff_set) ? r.buff_set : []
            }))
            .filter((row) => ENTITY_TYPES.includes(row.entityType) && !!row.entityName && !!row.buffName)
        mergeShareRows(rows)
        await persist()
        return { ok: true, added: rows.length }
    } catch (e) {
        _error = e instanceof Error ? e.message : '连接失败'
        return { ok: false, added: 0, error: _error }
    } finally {
        _loading = false
    }
}

function mergeShareRows(rows: BuffLibraryItem[]) {
    const byKey = new Map<string, { buffs: BuffLibraryBuff[] }>()
    const order: string[] = []
    for (const row of rows) {
        if (!row.entityType || !row.entityName) continue
        const key = entityKey(row.entityType, row.entityName)
        const zones = normalizeZones(row.zones)
        if (!zones.length) continue
        if (!byKey.has(key)) {
            byKey.set(key, { buffs: [] })
            order.push(key)
        }
        byKey.get(key)!.buffs.push({
            buffName: row.buffName.trim(),
            scope: row.scope,
            exclusive: row.exclusive,
            ...(row.condition ? { condition: row.condition } : {}),
            zones
        })
    }

    const next: (BuffLibraryEntity | null)[] = [..._entities]
    const coveredKeys = new Set<string>()

    for (const key of order) {
        const group = byKey.get(key)!
        const [et, en] = key.split('/') as [BuffEntityType, string]
        const idx = next.findIndex((e) => e !== null && entityKey(e.entityType, e.entityName) === key)
        if (idx >= 0) {
            const e = next[idx] as BuffLibraryEntity
            if (e.source === 'share') {
                next[idx] = { ...e, buffs: group.buffs }
                coveredKeys.add(key)
            }
        } else {
            next.push({ entityType: et, entityName: en, source: 'share', buffs: group.buffs })
            coveredKeys.add(key)
        }
    }

    for (let i = 0; i < next.length; i++) {
        const e = next[i]
        if (e !== null && e.source === 'share' && !coveredKeys.has(entityKey(e.entityType, e.entityName))) {
            next[i] = null
        }
    }
    _entities = next.filter((e): e is BuffLibraryEntity => e !== null)
}
