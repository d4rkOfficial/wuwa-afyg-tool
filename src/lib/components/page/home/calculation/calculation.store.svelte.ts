import type { BuffSet, BuffZoneValue, CalcState, DamageEntry } from './calculation.types'
import type { TimelineData } from '../timeline/timeline.types'
import type { CharSlot } from '$lib/data/types'
import { parseValueString } from '$lib/consts/parse-value-string'
import { NON_DIRECT_ELEMENT } from '../timeline/timeline.consts'
import { getSkillCache, getCharElementMap } from '../timeline/timeline.store.svelte'
import { getCharacterInfo } from '$lib/data/api'
import { addToast } from '$lib/data/toast.svelte'
import { migrateZoneId } from '$lib/data/zone-id-migration'

let _entries = $state<DamageEntry[]>([])
let _buffSets = $state<BuffSet[]>([])
let _damageEntryBuffSetIds = $state<Record<string, string[]>>({})
let _damageEntryDamageTypes = $state<Record<string, string[]>>({})
let _showBuffModal = $state(false)
let _buffDiffMode = $state(false)
let _locked = $state(false)

function assertUnlocked(): boolean {
    if (_locked) {
        addToast('本环节已锁定，请先解锁后编辑。编辑产生的副作用需您来承担。', 'info')
        return false
    }
    return true
}
let _calcElementMap = $state<Record<string, string>>({})
let _initTeam: [CharSlot, CharSlot, CharSlot] | null = null
let _initTimelineData: TimelineData | null = null
let _globalBuffSetIds = $state<string[]>([])
let _fetchPromise: Promise<void> | null = null

export function init(
    team: [CharSlot, CharSlot, CharSlot],
    timelineData: TimelineData | null,
    savedState: CalcState | null,
    locked = false
) {
    _locked = locked
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
        for (const bs of _buffSets) {
            for (const z of bs.zones) {
                z.zoneId = migrateZoneId(z.zoneId) as typeof z.zoneId
                if (z.ref) z.ref.zoneId = migrateZoneId(z.ref.zoneId) as typeof z.zoneId
            }
        }
        for (const [entryId, setIds] of Object.entries(_damageEntryBuffSetIds)) {
            _damageEntryBuffSetIds[entryId] = setIds.filter((sid) => !autoIds.includes(sid))
        }
        _damageEntryDamageTypes = JSON.parse(JSON.stringify(savedState.damageEntryDamageTypes ?? {}))
    } else {
        _buffSets = []
        _damageEntryBuffSetIds = {}
        _damageEntryDamageTypes = {}
    }
    _globalBuffSetIds = _buffSets.filter((bs) => bs.id.startsWith('global-')).map((bs) => bs.id)
    syncGlobalBuffs(team.map((s) => s.character))
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
                        hits: 1
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

export function duplicateBuffSet(id: string, customName?: string): string | undefined {
    if (!assertUnlocked()) return
    const source = _buffSets.find((s) => s.id === id)
    if (!source) return
    const newId = `buffSet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const buffSet: BuffSet = {
        ...source,
        id: newId,
        name: customName ?? source.name + ' 复制'
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
    _buffSets = _buffSets.map((s) =>
        s.id === setId
            ? {
                  ...s,
                  zones: s.zones.map((z) =>
                      z.zoneId === (zoneId as any)
                          ? { ...z, override: override || undefined, ref: override ? undefined : z.ref }
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

export function syncGlobalBuffs(charNames: (string | null)[]) {
    const validCharNames = new Set(charNames.filter(Boolean) as string[])

    const orphanIds = _globalBuffSetIds.filter((id) => {
        const charName = id.replace('global-', '')
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
                scope: [i]
            }
        ]
        if (!newGlobalIds.includes(id)) {
            newGlobalIds = [...newGlobalIds, id]
        }
    }

    for (const entry of _entries) {
        if (!entry.character) continue
        const gbsId = `global-${entry.character}`
        if (!newGlobalIds.includes(gbsId)) continue

        const current = newBindings[entry.id] ?? []
        if (!current.includes(gbsId)) {
            newBindings[entry.id] = [...current, gbsId]
        }
    }

    _buffSets = newBuffSets
    _damageEntryBuffSetIds = newBindings
    _globalBuffSetIds = newGlobalIds
}
