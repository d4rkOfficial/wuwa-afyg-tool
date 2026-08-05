import type { BuffSet, BuffZoneValue, CalcState, DamageEntry, BuffCondition } from './calculation.types'
import type { TimelineData } from '../timeline/timeline.types'
import type { CharSlot } from '$lib/data/types'
import { parseValueString } from '$lib/consts/parse-value-string'
import { NON_DIRECT_ELEMENT } from '../timeline/timeline.consts'
import { getSkillCache, getCharElementMap } from '../timeline/timeline.store.svelte'
import { getCharacterInfo } from '$lib/data/api'
import { addToast } from '$lib/data/toast.svelte'
import { ZONE_MAP, ZONE_REF_MAP } from './calculation.consts'
import type { ConditionProfile } from '../result/compute'

let _entries = $state<DamageEntry[]>([])
let _buffSets = $state<BuffSet[]>([])
let _damageEntryBuffSetIds = $state<Record<string, string[]>>({})
let _damageEntryDamageTypes = $state<Record<string, string[]>>({})
let _showBuffModal = $state(false)
let _buffDiffMode = $state(false)
let _locked = $state(false)
// 全局生效配置：各角色共鸣链 / 武器精炼阶数（结果计算与条件过滤共用）
let _conditionProfile: ConditionProfile = $state({ chains: [0, 0, 0], refinements: [1, 1, 1] })
// 默认隐藏条件不匹配（链/阶低于配置、属性/类型对不上条目）的 buff
let _hideConditionMismatch = $state(true)
function assertUnlocked(): boolean {
    if (_locked) {
        addToast('本环节已锁定，请先解锁', 'info')
        return false
    }
    return true
}
let _calcElementMap = $state<Record<string, string>>({})
let _initTeam: [CharSlot, CharSlot, CharSlot] | null = null
let _initTimelineData: TimelineData | null = null
let _globalBuffSetIds = $state<string[]>([])
let _fetchPromise: Promise<void> | null = null
let _onupdate: ((state: CalcState) => void) | undefined = $state()

export function init(
    team: [CharSlot, CharSlot, CharSlot],
    timelineData: TimelineData | null,
    savedState: CalcState | null,
    locked = false,
    onupdate?: (state: CalcState) => void
) {
    _locked = locked
    _onupdate = onupdate
    _initTeam = team
    _initTimelineData = timelineData

    const cached = getCharElementMap()
    const names = team.map((s) => s.character).filter(Boolean) as string[]
    const needsFetch = names.some((n) => !cached[n])
    if (!needsFetch && Object.keys(cached).length > 0) {
        _calcElementMap = cached
    } else {
        _calcElementMap = { ...cached }
        queueElementFetch(names)
    }

    _entries = buildDamageEntries(team, timelineData)
    if (savedState) {
        const autoIds = (savedState.buffSets ?? []).filter((bs) => bs.name.startsWith('[配置]')).map((bs) => bs.id)
        _buffSets = JSON.parse(
            JSON.stringify((savedState.buffSets ?? []).filter((bs) => !bs.name.startsWith('[配置]')))
        )
        _damageEntryBuffSetIds = JSON.parse(JSON.stringify(savedState.damageEntryBuffSetIds ?? {}))
        for (const [entryId, setIds] of Object.entries(_damageEntryBuffSetIds)) {
            _damageEntryBuffSetIds[entryId] = setIds.filter((sid) => !autoIds.includes(sid))
        }
        _damageEntryDamageTypes = JSON.parse(
            JSON.stringify(
                Object.fromEntries(
                    Object.entries(savedState.damageEntryDamageTypes ?? {}).map(([id, types]) => [
                        id,
                        types.map((t) => (t === '视为效应伤害' ? '其它类型伤害' : t))
                    ])
                )
            )
        )
    } else {
        _buffSets = []
        _damageEntryBuffSetIds = {}
        _damageEntryDamageTypes = {}
    }
    _globalBuffSetIds = _buffSets.filter((bs) => bs.global || bs.id.startsWith('global-')).map((bs) => bs.id)
    syncGlobalBuffs(team.map((s) => s.character))
    if (pruneOrphanedBindings()) {
        if (_onupdate) _onupdate(getCalcState())
    }
}

function pruneOrphanedBindings(): boolean {
    const validIds = new Set(_entries.map((e) => e.id))
    let changed = false
    const prune = (table: Record<string, string[]>): Record<string, string[]> | null => {
        const entries = Object.entries(table)
        const kept = entries.filter(([id]) => validIds.has(id))
        if (kept.length !== entries.length) {
            changed = true
            return Object.fromEntries(kept)
        }
        return null
    }
    const buff = prune(_damageEntryBuffSetIds)
    const types = prune(_damageEntryDamageTypes)
    if (buff) _damageEntryBuffSetIds = buff
    if (types) _damageEntryDamageTypes = types
    return changed
}

async function queueElementFetch(names: string[]) {
    if (_fetchPromise) return _fetchPromise
    _fetchPromise = (async () => {
        const map: Record<string, string> = {}
        const results = await Promise.allSettled(names.map((n) => getCharacterInfo(n)))
        for (let i = 0; i < names.length; i++) {
            const r = results[i]
            if (r.status === 'fulfilled') map[names[i]] = r.value.element
        }
        _calcElementMap = map
        if (_initTeam && _initTimelineData) {
            _entries = buildDamageEntries(_initTeam, _initTimelineData)
        }
    })()
    await _fetchPromise
    _fetchPromise = null
}

function buildDamageEntriesFromTimeline(tl: TimelineData, _team: [CharSlot, CharSlot, CharSlot]): DamageEntry[] {
    const temp: Array<{ item: DamageEntry; pos: number; order: number }> = []
    let order = 0

    for (const db of tl.damageBlocks) {
        let pos = 0
        if (db.sourceType === 'op') {
            pos = tl.opBlocks.find((o) => o.id === db.sourceId)?.pos ?? 0
        } else {
            pos = tl.refLines.find((r) => r.id === db.sourceId)?.pos ?? 0
        }

        for (const hit of db.skillHits) {
            const comps = parseValueString(hit.ratio)

            // Determine contextual baseType: last part with an explicit suffix
            let contextBaseType = '攻击'
            for (let i = comps.length - 1; i >= 0; i--) {
                const c = comps[i]
                if (c.flatValue !== undefined) continue
                if (!c.implicitSuffix) {
                    contextBaseType = c.baseType
                    break
                }
            }

            const pctMap = new Map<string, number>()
            let flatTotal = 0
            for (const c of comps) {
                if (c.flatValue !== undefined) {
                    flatTotal += c.flatValue
                } else {
                    const resolvedType = c.implicitSuffix ? contextBaseType : c.baseType
                    const weighted = c.ratioNum * (c.mult ?? 1)
                    pctMap.set(resolvedType, (pctMap.get(resolvedType) ?? 0) + weighted)
                }
            }

            const echoName =
                hit.skillType === '声骸技能'
                    ? (_team.find((s) => s.character === hit.character)?.echoes?.[0]?.name ?? null)
                    : null
            const displayName =
                hit.skillType === '声骸技能' && echoName
                    ? echoName + '·' + hit.hitName.replace('伤害', '') + '(' + hit.skillType + ')'
                    : hit.hitName.replace('伤害', '') + '(' + hit.skillType + ')'
            for (const [baseType, ratioSum] of pctMap) {
                const id = `${db.id}-${hit.skillType}|${hit.hitName}#${baseType}`
                temp.push({
                    item: {
                        id,
                        character: hit.character,
                        skillType: hit.skillType,
                        hitName: hit.hitName,
                        displayName,
                        isEffect: false,
                        isTuneBreak: false,
                        isTuneResponse: false,
                        ratioValue: ratioSum * (hit.hits ?? 1),
                        ratioUnit: '%',
                        damageBaseType: baseType,
                        damageElement: hit.element || _calcElementMap[hit.character] || '',
                        sourceTimelineBlockId: db.sourceId,
                        hits: hit.hits ?? 1
                    },
                    pos,
                    order: order++
                })
            }

            if (flatTotal > 0) {
                const id = `${db.id}-${hit.skillType}|${hit.hitName}#固定`
                temp.push({
                    item: {
                        id,
                        character: hit.character,
                        skillType: hit.skillType,
                        hitName: hit.hitName,
                        displayName,
                        isEffect: false,
                        isTuneBreak: false,
                        isTuneResponse: false,
                        ratioValue: flatTotal * (hit.hits ?? 1),
                        ratioUnit: 'fixed',
                        damageBaseType: '固定',
                        damageElement: hit.element || _calcElementMap[hit.character] || '',
                        sourceTimelineBlockId: db.sourceId,
                        hits: hit.hits ?? 1
                    },
                    pos,
                    order: order++
                })
            }
        }

        for (const nd of db.nonDirectEntries) {
            if (nd.category === '响应') {
                for (const responder of nd.responders ?? []) {
                    let ratio = 0
                    let element = ''
                    const groups = getSkillCache()[responder]
                    if (groups) {
                        for (const group of groups) {
                            const match = group.hits.find((h) => h.name.includes('震谐') || h.name.includes('骇破'))
                            if (match) {
                                const comps = parseValueString(match.ratio)
                                const total = comps.reduce((sum, c) => {
                                    if (c.flatValue !== undefined) return sum + c.flatValue
                                    return sum + c.ratioNum * (c.mult ?? 1)
                                }, 0)
                                if (ratio === 0) ratio = total
                                if (match.element && !element) element = match.element
                            }
                        }
                    }
                    if (!element) element = getCharElementMap()[responder] ?? ''
                    const id = `${db.id}-nd|${nd.name}#${responder}`
                    temp.push({
                        item: {
                            id,
                            character: responder,
                            skillType: '偏谐响应',
                            hitName: nd.name,
                            displayName: nd.name,
                            isEffect: false,
                            isTuneBreak: false,
                            isTuneResponse: true,
                            ratioValue: ratio,
                            ratioUnit: '%',
                            damageBaseType: '偏谐系数',
                            damageElement: element,
                            sourceTimelineBlockId: db.sourceId,
                            hits: 1
                        },
                        pos,
                        order: order++
                    })
                }
            } else if (nd.category === '处决') {
                const char = nd.responders?.[0] ?? ''
                const id = `${db.id}-nd|${nd.name}`
                temp.push({
                    item: {
                        id,
                        character: char,
                        skillType: '谐度破坏',
                        hitName: '谐度破坏',
                        displayName: '谐度破坏',
                        isEffect: false,
                        isTuneBreak: true,
                        isTuneResponse: false,
                        ratioValue: 1600,
                        ratioUnit: '%',
                        damageBaseType: '偏谐系数',
                        damageElement: '物理',
                        sourceTimelineBlockId: db.sourceId,
                        hits: 1
                    },
                    pos,
                    order: order++
                })
            } else if (nd.category === '效应') {
                if (nd.name === '电磁爆发') continue
                const isDianci = nd.name === '电磁效应'
                const burstLayers = isDianci
                    ? (db.nonDirectEntries.find((n) => n.name === '电磁爆发' && n.category === '效应')?.layers ?? 0)
                    : 0
                const id = `${db.id}-nd|${nd.name}`
                temp.push({
                    item: {
                        id,
                        character: undefined,
                        skillType: '效应结算',
                        hitName: nd.name,
                        displayName:
                            isDianci && burstLayers > 0
                                ? nd.name + nd.layers + '层+爆发' + burstLayers + '层'
                                : nd.name + nd.layers + '层',
                        isEffect: true,
                        isTuneBreak: false,
                        isTuneResponse: false,
                        ratioValue: nd.layers,
                        ratioUnit: '%',
                        damageBaseType: '效应系数',
                        damageElement: NON_DIRECT_ELEMENT[nd.name] ?? '',
                        sourceTimelineBlockId: db.sourceId,
                        burstLayers: isDianci ? burstLayers : 0,
                        hits: nd.hits ?? 1
                    },
                    pos,
                    order: order++
                })
            }
        }
    }

    temp.sort((a, b) => a.pos - b.pos || a.order - b.order)
    return temp.map((t) => t.item)
}

function buildDamageEntries(_team: [CharSlot, CharSlot, CharSlot], _timelineData: TimelineData | null): DamageEntry[] {
    if (!_timelineData) return []

    const items = buildDamageEntriesFromTimeline(_timelineData, _team)

    return items
}

export function getAllDamageEntries(): DamageEntry[] {
    return _entries
}

// ── BuffSet CRUD ──

export function getAllBuffSets(): BuffSet[] {
    return _buffSets
}

export function createBuffSet(name: string) {
    if (!assertUnlocked()) return
    const buffSet: BuffSet = {
        id: `buffSet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        zones: [],
        scope: 'all'
    }
    _buffSets = [..._buffSets, buffSet]
}

export interface ImportBuffZone {
    zoneId: string
    value: number
    override?: boolean
    ref?: {
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
}

export interface ImportBuffInput {
    name: string
    scope?: 'self' | 'self_except' | 'team' | 'effect_only'
    ownerIdx?: number
    condition?: BuffCondition
    zones: ImportBuffZone[]
}

// share 的 scope 语义 → 工具 BuffSet.scope（'all' | number[]）
// 由导入方传入 ownerIdx（该实体归属的角色槽位，无则 -1），self_except 需要队伍总槽位数
export function mapImportedScope(
    scope: ImportBuffInput['scope'],
    ownerIdx: number,
    teamSize: number
): 'all' | number[] {
    switch (scope) {
        case 'self':
            return ownerIdx >= 0 ? [ownerIdx] : []
        case 'self_except': {
            if (ownerIdx < 0) return 'all'
            const idxs: number[] = []
            for (let i = 0; i < teamSize; i++) if (i !== ownerIdx) idxs.push(i)
            return idxs.length ? idxs : []
        }
        case 'effect_only':
        case 'team':
        default:
            return 'all'
    }
}

export function importBuffSets(items: ImportBuffInput[], ownerIdx = -1, teamSize = 3) {
    if (!assertUnlocked()) return 0
    const fresh: BuffSet[] = []
    for (const item of items) {
        const name = item.name.trim()
        if (!name) continue
        const zones: BuffZoneValue[] = []
        for (const z of item.zones ?? []) {
            const zoneId = z.zoneId as BuffZoneValue['zoneId']
            if (!ZONE_MAP.has(zoneId)) continue
            const zone: BuffZoneValue = { zoneId, value: z.value }
            if (z.ref && ZONE_REF_MAP.has(z.ref.targetZoneId as never)) {
                zone.ref = {
                    characterIdx: item.ownerIdx ?? ownerIdx,
                    zoneId: z.ref.targetZoneId as never,
                    threshold: z.ref.threshold ?? 0,
                    pct: z.ref.pct,
                    lower: z.ref.lower,
                    upper: z.ref.upper,
                    discrete: z.ref.discrete,
                    divisor: z.ref.divisor,
                    multiplier: z.ref.multiplier
                }
            }
            if (z.override) zone.override = true
            zones.push(zone)
        }
        const buffSet: BuffSet = {
            id: `buffSet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name,
            zones,
            scope: mapImportedScope(item.scope, item.ownerIdx ?? ownerIdx, teamSize),
            ...(item.condition ? { condition: { ...item.condition } } : {}),
            ...(item.condition && (item.ownerIdx ?? ownerIdx) >= 0
                ? { conditionRefCharIdx: item.ownerIdx ?? ownerIdx }
                : {})
        }
        fresh.push(buffSet)
    }
    if (!fresh.length) return 0
    // 导入前按条目名自然排序：数字段按数值（1层 < 2层 < 10层 < 11层），其余按 unicode 码点
    fresh.sort((a, b) => compareNatural(a.name, b.name))
    _buffSets = [..._buffSets, ...fresh]
    return fresh.length
}

// 自然排序：数字段按数值比较，非数字段按码点比较（字符数字从小到大，小在先大在后）
function compareNatural(a: string, b: string): number {
    let i = 0
    let j = 0
    while (i < a.length && j < b.length) {
        const ad = /\d/.test(a[i])
        const bd = /\d/.test(b[j])
        if (ad && bd) {
            let x = i
            let y = j
            while (x < a.length && /\d/.test(a[x])) x++
            while (y < b.length && /\d/.test(b[y])) y++
            const na = BigInt(a.slice(i, x))
            const nb = BigInt(b.slice(j, y))
            if (na !== nb) return na < nb ? -1 : 1
            i = x
            j = y
        } else {
            if (a[i] !== b[j]) return a[i] < b[j] ? -1 : 1
            i++
            j++
        }
    }
    return a.length - b.length
}

export function duplicateBuffSet(id: string, customName?: string): string | undefined {
    if (!assertUnlocked()) return
    const source = _buffSets.find((s) => s.id === id)
    if (!source) return
    const newId = `buffSet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const buffSet: BuffSet = {
        ...source,
        id: newId,
        name: customName ?? source.name + ' 复制',
        global: false
    }
    const idx = _buffSets.findIndex((s) => s.id === id)
    const next = [..._buffSets]
    next.splice(idx + 1, 0, buffSet)
    _buffSets = next
    return newId
}

export function setBuffSetScope(setId: string, scope: 'all' | number[]) {
    if (!assertUnlocked()) return
    if (_globalBuffSetIds.includes(setId)) return
    _buffSets = _buffSets.map((s) => (s.id === setId ? { ...s, scope } : s))
}

export function setBuffSetCondition(setId: string, condition: BuffCondition | null) {
    if (!assertUnlocked()) return
    // 默认全局 buff 不允许设置共鸣链/精炼条件
    if (setId.startsWith('global-')) return
    _buffSets = _buffSets.map((s) =>
        s.id === setId ? { ...s, ...(condition ? { condition } : { condition: undefined }) } : s
    )
}

export function setBuffSetConditionRef(setId: string, charIdx: number | null) {
    if (!assertUnlocked()) return
    // 默认全局 buff 不允许设置共鸣链/精炼条件
    if (setId.startsWith('global-')) return
    _buffSets = _buffSets.map((s) =>
        s.id === setId
            ? { ...s, ...(charIdx !== null ? { conditionRefCharIdx: charIdx } : { conditionRefCharIdx: undefined }) }
            : s
    )
}

export function setBuffSetZoneRef(setId: string, zoneId: string, ref: import('./calculation.types').ZoneRef | null) {
    if (!assertUnlocked()) return
    _buffSets = _buffSets.map((s) =>
        s.id === setId
            ? {
                  ...s,
                  zones: s.zones.map((z) =>
                      z.zoneId === zoneId ? { ...z, ref: ref ?? undefined, override: ref ? undefined : z.override } : z
                  )
              }
            : s
    )
}

export function setBuffSetZoneOverride(setId: string, zoneId: string, override: boolean) {
    if (!assertUnlocked()) return
    const nextOverride = zoneId === 'extraRatio' ? false : override
    _buffSets = _buffSets.map((s) =>
        s.id === setId
            ? {
                  ...s,
                  zones: s.zones.map((z) =>
                      z.zoneId === (zoneId as any)
                          ? { ...z, override: nextOverride || undefined, ref: nextOverride ? undefined : z.ref }
                          : z
                  )
              }
            : s
    )
}

export function toggleBuffSetStarred(id: string) {
    if (!assertUnlocked()) return
    _buffSets = _buffSets.map((s) => (s.id === id ? { ...s, starred: !s.starred } : s))
}

export function setBuffSetGlobal(id: string, global: boolean): boolean {
    if (!assertUnlocked()) return false
    // 默认全队/个人全局 buff 不可移出全局
    if (id.startsWith('global-')) return false
    const bs = _buffSets.find((s) => s.id === id)
    if (!bs) return false
    _buffSets = _buffSets.map((s) => (s.id === id ? { ...s, global } : s))
    _globalBuffSetIds = global
        ? [..._globalBuffSetIds.filter((sid) => sid !== id), id]
        : _globalBuffSetIds.filter((sid) => sid !== id)

    if (global) {
        const next: Record<string, string[]> = {}
        for (const [entryId, setIds] of Object.entries(_damageEntryBuffSetIds)) {
            const filtered = setIds.filter((sid) => sid !== id)
            if (filtered.length > 0) next[entryId] = filtered
        }
        _damageEntryBuffSetIds = next
    }

    syncGlobalBuffs((_initTeam ?? []).map((s) => s.character))
    if (_onupdate) _onupdate(getCalcState())
    return true
}

export function deleteBuffSet(id: string) {
    if (!assertUnlocked()) return
    if (_globalBuffSetIds.includes(id)) return
    _buffSets = _buffSets.filter((s) => s.id !== id)
    const next: Record<string, string[]> = {}
    for (const [entryId, setIds] of Object.entries(_damageEntryBuffSetIds)) {
        const filtered = setIds.filter((sid) => sid !== id)
        if (filtered.length > 0) next[entryId] = filtered
    }
    _damageEntryBuffSetIds = next
}

export function renameBuffSet(id: string, name: string) {
    if (!assertUnlocked()) return
    _buffSets = _buffSets.map((s) => (s.id === id ? { ...s, name } : s))
}

export function addZoneToBuffSet(setId: string, zoneId: string) {
    if (!assertUnlocked()) return
    _buffSets = _buffSets.map((s) =>
        s.id === setId ? { ...s, zones: [...s.zones, { zoneId: zoneId as any, value: 0 } as BuffZoneValue] } : s
    )
}

export function removeZoneFromBuffSet(setId: string, zoneId: string) {
    if (!assertUnlocked()) return
    _buffSets = _buffSets.map((s) =>
        s.id === setId ? { ...s, zones: s.zones.filter((z) => z.zoneId !== (zoneId as any)) } : s
    )
}

export function setBuffSetZoneValue(setId: string, zoneId: string, value: number) {
    if (!assertUnlocked()) return
    _buffSets = _buffSets.map((s) =>
        s.id === setId ? { ...s, zones: s.zones.map((z) => (z.zoneId === (zoneId as any) ? { ...z, value } : z)) } : s
    )
}

// ── Entry-BuffSet Assignment ──

export function getBuffSetIdsForEntry(entryId: string): string[] {
    return _damageEntryBuffSetIds[entryId] ?? []
}

export function setBuffSetIdsForEntry(entryId: string, setIds: string[]): boolean {
    if (!assertUnlocked()) return false
    _damageEntryBuffSetIds = { ..._damageEntryBuffSetIds, [entryId]: [...setIds] }
    return true
}

export function toggleBuffSetForEntry(entryId: string, setId: string) {
    if (!assertUnlocked()) return
    const current = _damageEntryBuffSetIds[entryId] ?? []
    if (current.includes(setId)) {
        _damageEntryBuffSetIds = { ..._damageEntryBuffSetIds, [entryId]: current.filter((id) => id !== setId) }
    } else {
        _damageEntryBuffSetIds = { ..._damageEntryBuffSetIds, [entryId]: [...current, setId] }
    }
}

// ── Entry Damage Types ──

export function getDamageTypesForEntry(entryId: string): string[] {
    return _damageEntryDamageTypes[entryId] ?? []
}

export function toggleDamageTypeForEntry(entryId: string, damageType: string) {
    if (!assertUnlocked()) return
    const current = _damageEntryDamageTypes[entryId] ?? []
    if (current.includes(damageType)) {
        _damageEntryDamageTypes = { ..._damageEntryDamageTypes, [entryId]: current.filter((t) => t !== damageType) }
    } else {
        _damageEntryDamageTypes = { ..._damageEntryDamageTypes, [entryId]: [...current, damageType] }
    }
}

export function setDamageTypesForEntry(entryId: string, types: string[]) {
    _damageEntryDamageTypes = { ..._damageEntryDamageTypes, [entryId]: types }
}

// ── Buff Modal State ──

export function getShowBuffModal(): boolean {
    return _showBuffModal
}
export function setShowBuffModal(v: boolean) {
    _showBuffModal = v
}

// ── Buff Diff Mode ──

export function getBuffDiffMode(): boolean {
    return _buffDiffMode
}
export function toggleBuffDiffMode() {
    _buffDiffMode = !_buffDiffMode
}

// ── 生效配置（链/阶）与条件不符隐藏 ──

export function getConditionProfile(): ConditionProfile {
    return _conditionProfile
}

// 从工程文件恢复链/阶配置（导入/加载工程时调用）
export function setConditionProfile(profile: ConditionProfile | undefined) {
    if (profile && Array.isArray(profile.chains) && Array.isArray(profile.refinements)) {
        _conditionProfile = { chains: profile.chains, refinements: profile.refinements }
    }
}

export function setConditionProfileChains(idx: number, value: number) {
    _conditionProfile = {
        ..._conditionProfile,
        chains: _conditionProfile.chains.map((c, j) => (j === idx ? value : c))
    }
}

export function setConditionProfileRefinements(idx: number, value: number) {
    _conditionProfile = {
        ..._conditionProfile,
        refinements: _conditionProfile.refinements.map((r, j) => (j === idx ? value : r))
    }
}

export function getHideConditionMismatch(): boolean {
    return _hideConditionMismatch
}

export function toggleHideConditionMismatch() {
    _hideConditionMismatch = !_hideConditionMismatch
}

export function reorderNonGlobalBuffSets(orderedIds: string[]) {
    if (!assertUnlocked()) return
    const global = _buffSets.filter((bs) => _globalBuffSetIds.includes(bs.id))
    const nonGlobalMap = new Map(_buffSets.filter((bs) => !_globalBuffSetIds.includes(bs.id)).map((bs) => [bs.id, bs]))
    const reordered = orderedIds.map((id) => nonGlobalMap.get(id)).filter(Boolean) as BuffSet[]
    const remaining = _buffSets.filter((bs) => !_globalBuffSetIds.includes(bs.id) && !orderedIds.includes(bs.id))
    _buffSets = [...global, ...reordered, ...remaining]
}

// ── Persistence ──

export function getCalcElementMap() {
    return _calcElementMap
}

export function getGlobalBuffSetIds(): string[] {
    return _globalBuffSetIds
}

export function getCalcState(): CalcState {
    return JSON.parse(
        JSON.stringify({
            buffSets: _buffSets,
            damageEntryBuffSetIds: _damageEntryBuffSetIds,
            damageEntryDamageTypes: _damageEntryDamageTypes
        })
    )
}

export function remapDuplicatedDamageBuffs(damageMap: Record<string, string>) {
    const pairs = Object.entries(damageMap).filter(([, newId]) => Boolean(newId))
    if (pairs.length === 0) return

    const remapTable = (table: Record<string, string[]>): Record<string, string[]> => {
        const next: Record<string, string[]> = { ...table }
        for (const [oldId, newId] of pairs) {
            for (const [key, value] of Object.entries(table)) {
                if (!key.startsWith(oldId + '-')) continue
                const newKey = newId + key.slice(oldId.length)
                const existing = next[newKey]
                next[newKey] = existing ? [...new Set([...existing, ...value])] : [...value]
            }
        }
        return next
    }

    _damageEntryBuffSetIds = remapTable(_damageEntryBuffSetIds)
    _damageEntryDamageTypes = remapTable(_damageEntryDamageTypes)
    syncGlobalBuffs((_initTeam ?? []).map((s) => s.character))
    if (_onupdate) _onupdate(getCalcState())
}

export function syncGlobalBuffs(charNames: (string | null)[]) {
    const validCharNames = new Set(charNames.filter(Boolean) as string[])

    const orphanIds = _globalBuffSetIds.filter((id) => {
        if (id === 'global-all') return false
        if (!id.startsWith('global-')) return false
        const charName = id.slice('global-'.length)
        return !validCharNames.has(charName)
    })
    let newBuffSets = _buffSets.slice()
    let newBindings = { ..._damageEntryBuffSetIds }
    let newGlobalIds = _globalBuffSetIds.slice()

    if (orphanIds.length > 0) {
        newBuffSets = newBuffSets.filter((bs) => !orphanIds.includes(bs.id))
        const nextBindings: Record<string, string[]> = {}
        for (const [entryId, setIds] of Object.entries(newBindings)) {
            const filtered = setIds.filter((sid) => !orphanIds.includes(sid))
            if (filtered.length > 0) nextBindings[entryId] = filtered
        }
        newBindings = nextBindings
        newGlobalIds = newGlobalIds.filter((id) => !orphanIds.includes(id))
    }

    for (let i = 0; i < 3; i++) {
        const charName = charNames[i]
        if (!charName) continue
        const id = `global-${charName}`

        if (newBuffSets.some((bs) => bs.id === id)) {
            if (!newGlobalIds.includes(id)) {
                newGlobalIds = [...newGlobalIds, id]
            }
            continue
        }

        newBuffSets = [
            ...newBuffSets,
            {
                id,
                name: `${charName}·全局`,
                zones: [],
                scope: [i],
                global: true
            }
        ]
        if (!newGlobalIds.includes(id)) {
            newGlobalIds = [...newGlobalIds, id]
        }
    }

    const TEAM_GLOBAL_ID = 'global-all'
    if (validCharNames.size > 0) {
        if (!newBuffSets.some((bs) => bs.id === TEAM_GLOBAL_ID)) {
            newBuffSets = [
                ...newBuffSets,
                { id: TEAM_GLOBAL_ID, name: '全队·全局', zones: [], scope: 'all', global: true }
            ]
        }
        if (!newGlobalIds.includes(TEAM_GLOBAL_ID)) {
            newGlobalIds = [...newGlobalIds, TEAM_GLOBAL_ID]
        }
    }

    // 先清空所有全局 buff 的旧绑定，再按适用规则重建
    const globalIdSet = new Set(newGlobalIds)
    for (const entryId of Object.keys(newBindings)) {
        newBindings[entryId] = newBindings[entryId].filter((sid) => !globalIdSet.has(sid))
    }
    const charIdxByName = new Map<string, number>()
    for (const [i, s] of (_initTeam ?? []).entries()) {
        if (s.character) charIdxByName.set(s.character, i)
    }
    const mergedGlobalBuffs = _buffSets.filter((bs) => newGlobalIds.includes(bs.id) && !bs.id.startsWith('global-'))
    for (const entry of _entries) {
        const entryCharIdx = entry.character ? charIdxByName.get(entry.character) : undefined
        const applicable: string[] = []
        if (entry.character) {
            if (newGlobalIds.includes(`global-${entry.character}`)) applicable.push(`global-${entry.character}`)
            if (newGlobalIds.includes(TEAM_GLOBAL_ID)) applicable.push(TEAM_GLOBAL_ID)
        }
        for (const mg of mergedGlobalBuffs) {
            if (mg.scope === 'all') {
                applicable.push(mg.id)
            } else if (Array.isArray(mg.scope)) {
                if (mg.scope.length === 0) {
                    if (entry.isEffect) applicable.push(mg.id)
                } else if (entryCharIdx !== undefined && mg.scope.includes(entryCharIdx)) {
                    applicable.push(mg.id)
                }
            }
        }
        for (const gid of applicable) {
            const current = newBindings[entry.id] ?? []
            if (!current.includes(gid)) newBindings[entry.id] = [...current, gid]
        }
    }

    _buffSets = newBuffSets
    _damageEntryBuffSetIds = newBindings
    _globalBuffSetIds = newGlobalIds
}
