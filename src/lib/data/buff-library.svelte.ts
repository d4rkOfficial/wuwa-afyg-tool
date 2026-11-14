import { browser } from '$app/environment'
import { dbGet, dbSet } from '$lib/data/db'
import { getShareBase } from './workshop.svelte'
import { ZONE_MAP, ZONE_NO_REF_IDS, resolveZoneId } from '$lib/calc/calculation.consts'
import { normalizeZoneCondition } from '$lib/calc/condition'
import { normalizeRules, rulesFromLegacyCondition } from '$lib/calc/rules'
import { sanitizeLibraryRules, sanitizeRefOwner, type LibraryRefOwner } from '$lib/calc/buff-library-condition'
import type { BuffCondition, BuffRule } from '$lib/calc/calculation.types'
import { CHAIN_MAX, REFINE_MAX } from '$lib/consts/game-terms'
import {
    buffFolderPath,
    buffLeafName,
    clampBuffPathName,
    isLeafNameValid,
    joinBuffPath,
    sanitizeLeafName
} from '$lib/calc/buff-name'

export type BuffEntityType = 'character' | 'weapon' | 'echo' | '1set' | '2set' | '3set' | '4set' | '5set'

/**
 * @desc Buff 库的作用域（**导入源语义**，与工程侧 `BuffInstance.scope` 的映射见 `mapImportedScope`）：
 * - `self` = 对自己 / `self_except` = 自己除外
 * - `team` = **通用**（三名角色 + 效应伤害，导入后是 `'all'`）
 * - `team_only` = **全队**（只有三名角色、不含效应，导入后是 `[0,1,2]`）
 * - `effect_only` = 仅效应（导入后是 `[]`）
 */
export type BuffLibraryScope = 'self' | 'self_except' | 'team' | 'team_only' | 'effect_only'

export { CHAIN_MAX, REFINE_MAX }

/**
 * @desc Buff 库（本地库 / 工坊 share）的**实例级条件**：只有链/阶硬门槛。
 *
 * 这是**导入源格式**，与工程的 `BuffInstance.rules` 不是同一层：导入工程时由
 * `rulesFromLegacyCondition` 换算为 `chain` / `refinement` 规则（见 `buff-import-target`）。
 * 库里保持这个形状：share 接口与既有 localStorage 数据都按它存。
 */
export interface BuffLibraryGateCondition {
    chains?: { charIdx: number; min: number }[]
    refinements?: { charIdx: number; min: number }[]
    /** @desc 单值链（参考角色按 0 号位） */
    chain?: number
    /** @desc 单值阶 */
    refinement?: number
}

const clampClauses = (value: unknown, max: number, minFloor: number): { charIdx: number; min: number }[] => {
    if (!Array.isArray(value)) return []
    const out: { charIdx: number; min: number }[] = []
    for (const item of value) {
        if (!item || typeof item !== 'object') continue
        const raw = item as Record<string, unknown>
        const charIdx = typeof raw.charIdx === 'number' && Number.isFinite(raw.charIdx) ? Math.floor(raw.charIdx) : 0
        const min = typeof raw.min === 'number' && Number.isFinite(raw.min) ? Math.floor(raw.min) : NaN
        if (!Number.isFinite(min) || min < minFloor || min > max) continue
        if (charIdx < 0 || charIdx > 2) continue
        if (out.some((x) => x.charIdx === charIdx && x.min === min)) continue
        out.push({ charIdx, min })
    }
    return out
}

/** @desc 归一化实例级条件：只保留链/阶（旧单值字段升级为数组；链与阶可以并存） */
function normalizeGateCondition(value: unknown): BuffLibraryGateCondition | undefined {
    if (!value || typeof value !== 'object') return undefined
    const raw = value as Record<string, unknown>
    const chains = clampClauses(raw.chains, CHAIN_MAX, 0)
    const refinements = clampClauses(raw.refinements, REFINE_MAX, 1)
    if (chains.length === 0 && typeof raw.chain === 'number' && Number.isFinite(raw.chain)) {
        const min = Math.floor(raw.chain)
        if (min >= 0 && min <= CHAIN_MAX) chains.push({ charIdx: 0, min })
    }
    if (refinements.length === 0 && typeof raw.refinement === 'number' && Number.isFinite(raw.refinement)) {
        const min = Math.floor(raw.refinement)
        if (min >= 1 && min <= REFINE_MAX) refinements.push({ charIdx: 0, min })
    }
    const out: BuffLibraryGateCondition = {
        ...(chains.length > 0 ? { chains } : {}),
        ...(refinements.length > 0 ? { refinements } : {})
    }
    return Object.keys(out).length > 0 ? out : undefined
}

function cloneZoneCondition(cond: BuffCondition): BuffCondition {
    return {
        ...(cond.elements ? { elements: [...cond.elements] } : {}),
        ...(cond.damageTypes ? { damageTypes: [...cond.damageTypes] } : {})
    }
}

/**
 * @desc 库内 Buff 级条件的**唯一折算入口**：把两份表示合并成一组规则 ——
 * `condition.chains/refinements`（工坊的链阶门槛）折算成 `chain` / `refinement` 规则，
 * 与规则列表（`rules`，工坊放在 `condition.rules` 里）**并存时两者都要**，最后统一过库口径裁剪。
 *
 * 库里只保留一种表示（`rules`），避免同一条 Buff 出现两套条件语义。
 */
export const libraryRulesOf = (buff: { rules?: unknown; condition?: unknown }): BuffRule[] | undefined => {
    const cond = (buff.condition && typeof buff.condition === 'object' ? buff.condition : {}) as Record<string, unknown>
    const listed = normalizeRules(buff.rules) ?? normalizeRules(cond.rules)
    const explicit = sanitizeLibraryRules(listed) ?? []
    const legacy = sanitizeLibraryRules(rulesFromLegacyCondition(normalizeGateCondition(buff.condition), 0)) ?? []
    const merged: BuffRule[] = []
    const seen = new Set<string>()
    for (const rule of [...explicit, ...legacy]) {
        const key = JSON.stringify(rule)
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(rule)
    }
    return merged.length > 0 ? merged : undefined
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
    /**
     * @desc 引用归属（本角色 / 出伤者），导入工程时折算成 `ZoneRef.characterIdx`：
     * `active` → `-1`（出伤者 = 本条目所属角色），`self` / `owner` → 实体归属槽位。
     */
    refOwner?: LibraryRefOwner
}

/** @desc 乘区贡献条目：同一乘区可出现多次，每条各带数值 / 引用 / 覆盖 / 自己的乘区级条件 */
export interface BuffLibraryZone {
    zoneId: string
    value: number
    ref?: BuffLibraryZoneRef
    override?: boolean
    /** @desc 乘区级生效条件（伤害类型 / 伤害属性；链阶只能挂在整条 Buff 上） */
    condition?: BuffCondition
}

export interface BuffLibraryItem {
    entityType: BuffEntityType
    entityName: string
    buffName: string
    scope?: BuffLibraryScope
    exclusive?: boolean
    /** @desc Buff 级规则（库口径，见 `calc/buff-library-condition`） */
    rules?: BuffRule[]
    zones: BuffLibraryZone[]
}

export interface BuffLibraryBuff {
    buffName: string
    scope?: BuffLibraryScope
    exclusive?: boolean
    /**
     * @desc 链/阶门槛的**输入载荷通道**（工坊 `condition` jsonb、AI 生成结果用它）。
     * 读入时由 `libraryRulesOf` 折算成 `rules`，实体上不保留该字段。
     */
    condition?: BuffLibraryGateCondition
    /** @desc Buff 级规则（库口径：5 种 kind，`charIdx` 只有「本角色 0 / 出伤者 -1」两档） */
    rules?: BuffRule[]
    zones: BuffLibraryZone[]
}

export interface BuffLibraryFolder {
    /** @desc 一级文件夹短名（不含反斜杠） */
    name: string
    sortOrder: number
}

export interface BuffLibraryEntity {
    entityType: BuffEntityType
    entityName: string
    source: 'share' | 'custom'
    /** @desc 一级文件夹（只负责空文件夹/排序；成员按 buffName 的 `A\短名` 前缀归属） */
    folders: BuffLibraryFolder[]
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
    team: '通用',
    team_only: '全队',
    effect_only: '效应'
}

let _entities = $state<BuffLibraryEntity[]>([])
let _loaded = false
let _loading = false
let _error = $state<string | null>(null)

function entityKey(entityType: BuffEntityType, entityName: string) {
    return `${entityType}/${entityName}`
}

/** @desc 从 Buff 全名推导一级文件夹（只取第一段；保留空文件夹由 folders 参数提供） */
export function deriveFoldersFromBuffs(buffs: readonly BuffLibraryBuff[]): BuffLibraryFolder[] {
    const names = new Set<string>()
    for (const buff of buffs) {
        const folder = buffFolderPath(buff.buffName)[0]
        if (folder) names.add(folder)
    }
    return [...names]
        .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }))
        .map((name, sortOrder) => ({ name, sortOrder }))
}

/** @desc 归一化文件夹列表：去空/去反斜杠/去重/稳定排序 */
export function normalizeFolderList(value: unknown): BuffLibraryFolder[] {
    if (!Array.isArray(value)) return []
    const map = new Map<string, BuffLibraryFolder>()
    for (const raw of value) {
        if (!raw || typeof raw !== 'object') continue
        const item = raw as Record<string, unknown>
        const name = sanitizeLeafName(String(item.name ?? ''))
        if (!name || !isLeafNameValid(name) || map.has(name)) continue
        const sortOrder = Number(item.sortOrder)
        map.set(name, { name, sortOrder: Number.isFinite(sortOrder) ? sortOrder : map.size })
    }
    return [...map.values()]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-Hans-CN'))
        .map((folder, index) => ({ ...folder, sortOrder: index }))
}

/** @desc 把「目录里已有但 Buff 前缀未覆盖」的文件夹并入列表（保留空文件夹） */
export const mergeFolders = (
    folders: readonly BuffLibraryFolder[],
    buffs: readonly BuffLibraryBuff[]
): BuffLibraryFolder[] => {
    const map = new Map<string, BuffLibraryFolder>()
    for (const folder of normalizeFolderList(folders)) map.set(folder.name, folder)
    for (const folder of deriveFoldersFromBuffs(buffs)) {
        if (!map.has(folder.name)) map.set(folder.name, { ...folder, sortOrder: map.size })
    }
    return [...map.values()]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-Hans-CN'))
        .map((folder, index) => ({ ...folder, sortOrder: index }))
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
                ...(buff.rules ? { rules: buff.rules } : {}),
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
                const name = clampBuffPathName(String(bb.buffName ?? '').trim(), 1)
                const zones = normalizeZones(bb.zones)
                if (!name) continue
                const rules = libraryRulesOf(bb)
                buffs.push({
                    buffName: name,
                    scope: (bb.scope as BuffLibraryScope) ?? undefined,
                    exclusive: !!bb.exclusive,
                    ...(rules ? { rules } : {}),
                    zones
                })
            }
            if (!buffs.length) continue
            const folders = normalizeFolderList(obj.folders)
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
                existing.folders = mergeFolders([...existing.folders, ...folders], existing.buffs)
            } else {
                map.set(key, {
                    entityType: et as BuffEntityType,
                    entityName: en,
                    source: obj.source === 'custom' ? 'custom' : 'share',
                    folders: mergeFolders(folders, buffs),
                    buffs
                })
            }
        } else {
            const name = clampBuffPathName(String(obj.buffName ?? '').trim(), 1)
            const zones = normalizeZones(obj.zones)
            if (!name) continue
            const rules = libraryRulesOf(obj)
            const buff = { buffName: name, ...(rules ? { rules } : {}), zones }
            const existing = map.get(key)
            if (existing) {
                const k = buffKey(buff)
                if (!existing.buffs.some((b) => buffKey(b) === k)) existing.buffs.push(buff)
                existing.folders = mergeFolders(existing.folders, existing.buffs)
            } else {
                map.set(key, {
                    entityType: et as BuffEntityType,
                    entityName: en,
                    source: 'share',
                    folders: deriveFoldersFromBuffs([buff]),
                    buffs: [buff]
                })
            }
        }
    }
    return [...map.values()]
}

/** @desc 归一化引用条目：目标乘区必填，归属档位走白名单（白名单外丢弃，避免脏值流到工程侧） */
const normalizeLibraryRef = (ref: unknown): BuffLibraryZoneRef | undefined => {
    if (!ref || typeof ref !== 'object') return undefined
    const raw = ref as Record<string, unknown>
    const targetZoneId = typeof raw.targetZoneId === 'string' ? raw.targetZoneId.trim() : ''
    if (!targetZoneId) return undefined
    const next = { ...(raw as unknown as BuffLibraryZoneRef), targetZoneId }
    const refOwner = sanitizeRefOwner(raw.refOwner)
    if (refOwner) next.refOwner = refOwner
    else delete next.refOwner
    return next
}

/**
 * @desc 归一化乘区贡献条目列表（历史乘区 id 重映射 + 白名单校验 + 引用 / 覆盖 /
 * **乘区级生效条件**保留 + 允许同乘区多条）：与工程侧 `migration.normalizeZoneList` 同口径，
 * 这里保留一份实现以免 `data → calc/migration` 的反向依赖。
 */
function normalizeZones(value: unknown): BuffLibraryZone[] {
    if (!Array.isArray(value)) return []
    const zones: BuffLibraryZone[] = []
    for (const z of value) {
        if (!z || typeof z !== 'object') continue
        const zo = z as Record<string, unknown>
        const zoneId = resolveZoneId(String(zo.zoneId ?? ''))
        if (!ZONE_MAP.has(zoneId)) continue
        const num = Number(zo.value)
        const ref = ZONE_NO_REF_IDS.has(zoneId) ? undefined : normalizeLibraryRef(zo.ref)
        const condition = normalizeZoneCondition(zo.condition as BuffCondition | undefined)
        zones.push({
            zoneId,
            value: Number.isNaN(num) ? 0 : num,
            ...(ref ? { ref } : {}),
            ...(zo.override ? { override: true } : {}),
            ...(condition ? { condition } : {})
        })
    }
    return zones
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
        const rules = libraryRulesOf(b)
        out.push({
            buffName: name,
            scope: b.scope,
            exclusive: b.exclusive,
            ...(rules ? { rules } : {}),
            zones: b.zones.map((z) => {
                const copy: BuffLibraryZone = { ...z }
                // 层数类乘区（集谐干涉/同奏增益等）只填固定层数，持久化前丢弃该类乘区上可能存在的引用
                if (ZONE_NO_REF_IDS.has(z.zoneId)) delete copy.ref
                if (copy.condition) copy.condition = cloneZoneCondition(copy.condition)
                if (copy.ref) copy.ref = { ...copy.ref }
                return copy
            })
        })
    }
    return out
}

export async function updateEntityBuffs(
    entityType: BuffEntityType,
    entityName: string,
    buffs: BuffLibraryBuff[],
    folders?: BuffLibraryFolder[]
) {
    const key = entityKey(entityType, entityName)
    const valid = cloneBuffsValid(buffs)
    const exists = _entities.some((e) => entityKey(e.entityType, e.entityName) === key)
    const nextFolders = mergeFolders(folders ?? [], valid)
    if (exists) {
        _entities = _entities.map((e) =>
            entityKey(e.entityType, e.entityName) === key
                ? { ...e, source: 'custom', buffs: valid, folders: nextFolders }
                : e
        )
    } else {
        _entities = [..._entities, { entityType, entityName, source: 'custom', folders: nextFolders, buffs: valid }]
    }
    await persist()
}

/** @desc 只更新自定义实体的文件夹结构（空文件夹/排序） */
export async function updateEntityFolders(
    entityType: BuffEntityType,
    entityName: string,
    folders: BuffLibraryFolder[]
) {
    const key = entityKey(entityType, entityName)
    _entities = _entities.map((e) =>
        entityKey(e.entityType, e.entityName) === key && e.source === 'custom'
            ? { ...e, folders: mergeFolders(folders, e.buffs) }
            : e
    )
    await persist()
}

/** @desc 把 Buff 移入/移出一级文件夹（只改全名前缀；短名保持不变） */
export const buffNameInFolder = (name: string, folder: string | null): string =>
    joinBuffPath(folder, buffLeafName(name))

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
                /** @desc 工坊侧的实例级条件（链/阶），读入后折算为 `rules` */
                condition?: BuffLibraryGateCondition
                /** @desc 工坊侧的 Buff 级规则（与工具箱同一套判据） */
                rules?: unknown
                buff_set?: BuffLibraryZone[]
            }>
            folders?: Array<{
                entity_type?: string
                entity_name?: string
                name?: string
                sort_order?: number
            }>
        }
        const foldersByKey = new Map<string, BuffLibraryFolder[]>()
        for (const raw of json.folders ?? []) {
            const et = raw.entity_type as BuffEntityType
            const en = (raw.entity_name ?? '').trim()
            const name = sanitizeLeafName(raw.name ?? '')
            if (!ENTITY_TYPES.includes(et) || !en || !name) continue
            const key = entityKey(et, en)
            const list = foldersByKey.get(key) ?? []
            list.push({ name, sortOrder: Number(raw.sort_order) || list.length })
            foldersByKey.set(key, list)
        }
        const rows: BuffLibraryItem[] = (json.buffSets ?? [])
            .map((r) => {
                const rules = libraryRulesOf({ rules: r.rules, condition: r.condition })
                return {
                    entityType: (r.entity_type ?? '') as BuffEntityType,
                    entityName: (r.entity_name ?? '').trim(),
                    buffName: clampBuffPathName((r.buff_name ?? '').trim(), 1),
                    scope: r.scope,
                    exclusive: !!r.exclusive,
                    ...(rules ? { rules } : {}),
                    zones: normalizeZones(r.buff_set)
                }
            })
            .filter((row) => ENTITY_TYPES.includes(row.entityType) && !!row.entityName && !!row.buffName)
        mergeShareRows(rows, foldersByKey)
        await persist()
        return { ok: true, added: rows.length }
    } catch (e) {
        _error = e instanceof Error ? e.message : '连接失败'
        return { ok: false, added: 0, error: _error }
    } finally {
        _loading = false
    }
}

function mergeShareRows(rows: BuffLibraryItem[], foldersByKey: ReadonlyMap<string, BuffLibraryFolder[]>) {
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
            ...(row.rules ? { rules: row.rules } : {}),
            zones
        })
    }

    const next: (BuffLibraryEntity | null)[] = [..._entities]
    const coveredKeys = new Set<string>()

    for (const key of order) {
        const group = byKey.get(key)!
        const [et, en] = key.split('/') as [BuffEntityType, string]
        const folders = mergeFolders(foldersByKey.get(key) ?? [], group.buffs)
        const idx = next.findIndex((e) => e !== null && entityKey(e.entityType, e.entityName) === key)
        if (idx >= 0) {
            const e = next[idx] as BuffLibraryEntity
            if (e.source === 'share') {
                next[idx] = { ...e, buffs: group.buffs, folders }
                coveredKeys.add(key)
            }
        } else {
            next.push({ entityType: et, entityName: en, source: 'share', buffs: group.buffs, folders })
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
