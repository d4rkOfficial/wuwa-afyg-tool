import { browser } from '$app/environment'
import { dbGet, dbSet } from '$lib/data/db'
import { getShareBase } from './workshop.svelte'
import {
    cloneSlots,
    normalizeAnyPlanSlots,
    planSubstatTotal,
    STANDARD_PLAN_NAME,
    STANDARD_SUBSTAT_TOTAL
} from '$lib/calc/standard-substats'
import type { EchoSlotConfig } from '$lib/calc/config.types'

/** @desc 一套声骸词条方案：标准14词条（每角色唯一、不可删除、唯一可同步）或用户自建方案 */
export interface SubstatPlan {
    id: string
    character: string
    name: string
    /** @desc 是否为该角色的标准14词条方案（true 时不可删除，且工坊只同步这一种） */
    standard: boolean
    /** @desc share=工坊同步（会被下次同步覆盖）；custom=本地自定义（同步时不覆盖） */
    source: 'share' | 'custom'
    note?: string
    slots: EchoSlotConfig[]
}

export interface SubstatPlanInput {
    character: string
    name: string
    standard?: boolean
    slots: EchoSlotConfig[]
    note?: string
}

const PLANS_KEY = 'substat-plans'

let _plans = $state<SubstatPlan[]>([])
let _loaded = false
let _loading = false
let _error = $state<string | null>(null)

const newId = () => `substat-plan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

function normalizeStored(data: unknown): SubstatPlan[] {
    const out: SubstatPlan[] = []
    for (const item of Array.isArray(data) ? data : []) {
        if (!item || typeof item !== 'object') continue
        const raw = item as Record<string, unknown>
        const character = typeof raw.character === 'string' ? raw.character.trim() : ''
        const name = typeof raw.name === 'string' ? raw.name.trim() : ''
        if (!character || !name) continue
        const standard = !!raw.standard
        const slots = normalizeAnyPlanSlots(raw.slots)
        if (!slots) continue
        out.push({
            id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
            character,
            name,
            standard,
            source: raw.source === 'share' ? 'share' : 'custom',
            ...(typeof raw.note === 'string' && raw.note ? { note: raw.note } : {}),
            slots
        })
    }
    return out
}

export function getSubstatPlans(): SubstatPlan[] {
    return _plans
}

export function getSubstatPlansFor(character: string): SubstatPlan[] {
    return _plans.filter((p) => p.character === character)
}

export function getStoredStandardPlan(character: string): SubstatPlan | undefined {
    return _plans.find((p) => p.character === character && p.standard)
}

export function getSubstatLibraryLoading(): boolean {
    return _loading
}

export function getSubstatLibraryError(): string | null {
    return _error
}

export async function loadSubstatLibrary(): Promise<void> {
    if (!browser || _loaded) return
    const stored = await dbGet<unknown>(PLANS_KEY)
    if (stored?.data != null) _plans = normalizeStored(stored.data)
    _loaded = true
}

async function persist(): Promise<void> {
    if (!browser) return
    await dbSet(PLANS_KEY, JSON.parse(JSON.stringify(_plans)))
}

function sortedPlans(plans: SubstatPlan[]): SubstatPlan[] {
    // 标准方案始终排最前，其余按名称自然序
    return [...plans].sort((a, b) => {
        if (a.standard !== b.standard) return a.standard ? -1 : 1
        return a.name.localeCompare(b.name, 'zh-Hans-CN')
    })
}

/** @desc 该角色的全部方案（标准方案在首位） */
export function listPlansFor(character: string): SubstatPlan[] {
    return sortedPlans(getSubstatPlansFor(character))
}

/**
 * @desc 保存方案：standard=true 时校验副词条恰为 14 条并整份覆盖该角色的标准方案（来源变为 custom，工坊同步不再覆盖它）；
 * 非标准方案为自由方案（5 个槽位、总 cost ≤12、每槽副词条 ≤5），同名方案视为覆盖更新。
 */
export async function saveSubstatPlan(input: SubstatPlanInput): Promise<string | null> {
    const character = input.character.trim()
    const name = input.name.trim()
    if (!character || !name) return null
    const slots = normalizeAnyPlanSlots(input.slots)
    if (!slots) return null
    const standard = !!input.standard
    if (standard && planSubstatTotal(slots) !== STANDARD_SUBSTAT_TOTAL) return null
    await loadSubstatLibrary()
    const next = _plans.filter((p) => !(p.character === character && (standard ? p.standard : p.name === name)))
    const target = _plans.find((p) => p.character === character && (standard ? p.standard : p.name === name))
    const id = target?.id ?? newId()
    next.push({
        id,
        character,
        name: standard ? STANDARD_PLAN_NAME : name,
        standard,
        source: 'custom',
        ...(input.note ? { note: input.note } : {}),
        slots: cloneSlots(slots)
    })
    _plans = sortedPlans(next)
    await persist()
    return id
}

/** @desc 删除方案；标准14词条方案不可删除（返回 false，由调用方提示） */
export async function deleteSubstatPlan(id: string): Promise<boolean> {
    await loadSubstatLibrary()
    const target = _plans.find((p) => p.id === id)
    if (!target || target.standard) return false
    _plans = _plans.filter((p) => p.id !== id)
    await persist()
    return true
}

export async function renameSubstatPlan(id: string, name: string): Promise<boolean> {
    const trimmed = name.trim()
    if (!trimmed) return false
    await loadSubstatLibrary()
    const target = _plans.find((p) => p.id === id)
    if (!target || target.standard) return false
    _plans = _plans.map((p) => (p.id === id ? { ...p, name: trimmed } : p))
    await persist()
    return true
}

/** @desc 重置标准方案：清掉本地/工坊存下来的标准方案，回落到「工坊同步」或「按角色数据自动生成」 */
export async function resetStandardPlan(character: string): Promise<void> {
    await loadSubstatLibrary()
    _plans = _plans.filter((p) => !(p.character === character && p.standard))
    await persist()
}

export interface FetchSubstatPlansResult {
    ok: boolean
    added: number
    error?: string
}

/**
 * @desc 从工坊同步标准词条集（只同步 14 词条方案）：
 * 工坊行整份覆盖 source='share' 的同角色标准方案；本地自定义（source='custom'）免疫；
 * 工坊已下线的 share 方案本地一并移除（与 Buff 集同步语义一致）。
 */
export async function fetchSubstatPlansFromShare(): Promise<FetchSubstatPlansResult> {
    if (_loading) return { ok: false, added: 0 }
    _loading = true
    _error = null
    try {
        await loadSubstatLibrary()
        const res = await fetch(`${getShareBase()}/api/substat-sets`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as {
            substatSets?: Array<{ character_name?: string; plan?: unknown; note?: string }>
        }
        const incoming = new Map<string, { slots: EchoSlotConfig[]; note?: string }>()
        for (const row of json.substatSets ?? []) {
            const character = (row.character_name ?? '').trim()
            if (!character) continue
            const slots = normalizeAnyPlanSlots(row.plan)
            if (!slots || planSubstatTotal(slots) !== STANDARD_SUBSTAT_TOTAL) continue
            incoming.set(character, { slots, ...(row.note ? { note: row.note } : {}) })
        }

        const next: SubstatPlan[] = []
        for (const plan of _plans) {
            if (!plan.standard || plan.source !== 'share') {
                next.push(plan)
                continue
            }
            const hit = incoming.get(plan.character)
            if (hit) next.push({ ...plan, slots: cloneSlots(hit.slots), ...(hit.note ? { note: hit.note } : {}) })
        }
        const existing = new Set(next.filter((p) => p.standard).map((p) => p.character))
        for (const [character, hit] of incoming) {
            if (existing.has(character)) continue
            next.push({
                id: newId(),
                character,
                name: STANDARD_PLAN_NAME,
                standard: true,
                source: 'share',
                ...(hit.note ? { note: hit.note } : {}),
                slots: cloneSlots(hit.slots)
            })
        }
        _plans = sortedPlans(next)
        await persist()
        return { ok: true, added: incoming.size }
    } catch (e) {
        _error = e instanceof Error ? e.message : '连接失败'
        return { ok: false, added: 0, error: _error }
    } finally {
        _loading = false
    }
}
