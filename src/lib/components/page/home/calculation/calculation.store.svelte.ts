import type { BuffBlock, CalcState, DamageItem } from './calculation.types'
import type { TimelineData } from '../timeline/timeline.types'
import type { CharSlot } from '$lib/data/types'
import { parseValueString } from '$lib/consts/parse-value-string'
import { NON_DIRECT_ELEMENT } from '../timeline/timeline.consts'
import { getSkillCache, getCharElementMap } from '../timeline/timeline.store.svelte'

let _entries = $state<DamageItem[]>([])
let _blocks = $state<BuffBlock[]>([])
let _entryBlockIds = $state<Record<string, string[]>>({})
let _showBuffModal = $state(false)
let _locked = $state(false)

export function init(
    team: [CharSlot, CharSlot, CharSlot],
    timelineData: TimelineData | null,
    savedState: CalcState | null,
    locked = false
) {
    _locked = locked
    _entries = buildEntries(team, timelineData)
    if (savedState) {
        _blocks = JSON.parse(JSON.stringify(savedState.blocks ?? []))
        _entryBlockIds = JSON.parse(JSON.stringify(savedState.entryBlockIds ?? {}))
    } else {
        _blocks = []
        _entryBlockIds = {}
    }
}

function flattenDamageBlocks(tl: TimelineData, _team: [CharSlot, CharSlot, CharSlot]): DamageItem[] {
    const temp: Array<{ item: DamageItem; pos: number; order: number }> = []
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

            const pctMap = new Map<string, number>()
            let flatTotal = 0
            for (const c of comps) {
                if (c.flatValue !== undefined) {
                    flatTotal += c.flatValue
                } else {
                    pctMap.set(c.baseType, (pctMap.get(c.baseType) ?? 0) + c.ratioNum)
                }
            }

            for (const [baseType, ratioSum] of pctMap) {
                const id = `${db.id}-${hit.skillType}|${hit.hitName}#${baseType}`
                temp.push({
                    item: {
                        id,
                        character: hit.character,
                        skillType: hit.skillType,
                        hitName: hit.hitName,
                        isEffect: false,
                        isTuneBreak: false,
                        isTuneReaction: false,
                        ratioValue: ratioSum * (hit.hits ?? 1),
                        ratioUnit: '%',
                        damageBaseType: baseType,
                        damageElement: hit.element,
                        damageBlockId: db.id
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
                        isEffect: false,
                        isTuneBreak: false,
                        isTuneReaction: false,
                        ratioValue: flatTotal * (hit.hits ?? 1),
                        ratioUnit: 'fixed',
                        damageBaseType: '固定',
                        damageElement: hit.element,
                        damageBlockId: db.id
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
                                const num = parseFloat(match.ratio.replace('%', ''))
                                if (ratio === 0) ratio = num
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
                            isEffect: false,
                            isTuneBreak: false,
                            isTuneReaction: true,
                            ratioValue: ratio,
                            ratioUnit: '%',
                            damageBaseType: '偏谐系数',
                            damageElement: element,
                            damageBlockId: db.id
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
                        isEffect: false,
                        isTuneBreak: true,
                        isTuneReaction: false,
                        ratioValue: 1600,
                        ratioUnit: '%',
                        damageBaseType: '偏谐系数',
                        damageElement: '物理',
                        damageBlockId: db.id
                    },
                    pos,
                    order: order++
                })
            } else if (nd.category === '效应') {
                const id = `${db.id}-nd|${nd.name}`
                temp.push({
                    item: {
                        id,
                        character: undefined,
                        skillType: '效应结算',
                        hitName: nd.name,
                        isEffect: true,
                        isTuneBreak: false,
                        isTuneReaction: false,
                        ratioValue: nd.layers,
                        ratioUnit: '%',
                        damageBaseType: '攻击力',
                        damageElement: NON_DIRECT_ELEMENT[nd.name] ?? '',
                        damageBlockId: db.id
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

function buildEntries(_team: [CharSlot, CharSlot, CharSlot], _timelineData: TimelineData | null): DamageItem[] {
    if (!_timelineData) return []

    console.log('=== flattenDamageBlocks — DamageItem[] ===')
    const items = flattenDamageBlocks(_timelineData, _team)
    for (const [i, item] of items.entries()) {
        console.log(`damageItem[${i}]:`, JSON.parse(JSON.stringify(item)))
    }
    console.log('=== end ===')

    return items
}

export function getEntries(): DamageItem[] {
    return _entries
}

// ── Block CRUD ──

export function getBlocks(): BuffBlock[] {
    return _blocks
}

export function addBlock(name: string) {
    if (_locked) return
    _blocks = [..._blocks, { id: `block-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name, zones: [] }]
}

export function removeBlock(id: string) {
    if (_locked) return
    _blocks = _blocks.filter((b) => b.id !== id)
    const next: Record<string, string[]> = {}
    for (const [eid, ids] of Object.entries(_entryBlockIds)) {
        const filtered = ids.filter((bid) => bid !== id)
        if (filtered.length > 0) next[eid] = filtered
    }
    _entryBlockIds = next
}

export function updateBlockName(id: string, name: string) {
    if (_locked) return
    _blocks = _blocks.map((b) => (b.id === id ? { ...b, name } : b))
}

export function addZone(blockId: string, zoneId: string) {
    if (_locked) return
    _blocks = _blocks.map((b) => (b.id === blockId ? { ...b, zones: [...b.zones, { zoneId, value: 0 }] } : b))
}

export function removeZone(blockId: string, zoneId: string) {
    if (_locked) return
    _blocks = _blocks.map((b) => (b.id === blockId ? { ...b, zones: b.zones.filter((z) => z.zoneId !== zoneId) } : b))
}

export function updateZoneValue(blockId: string, zoneId: string, value: number) {
    if (_locked) return
    _blocks = _blocks.map((b) =>
        b.id === blockId ? { ...b, zones: b.zones.map((z) => (z.zoneId === zoneId ? { ...z, value } : z)) } : b
    )
}

// ── Entry-Block Assignment ──

export function getEntryBlockIds(entryId: string): string[] {
    return _entryBlockIds[entryId] ?? []
}

export function toggleEntryBlock(entryId: string, blockId: string) {
    if (_locked) return
    const current = _entryBlockIds[entryId] ?? []
    if (current.includes(blockId)) {
        _entryBlockIds = { ..._entryBlockIds, [entryId]: current.filter((id) => id !== blockId) }
    } else {
        _entryBlockIds = { ..._entryBlockIds, [entryId]: [...current, blockId] }
    }
}

// ── Buff Modal State ──

export function getShowBuffModal(): boolean {
    return _showBuffModal
}
export function setShowBuffModal(v: boolean) {
    _showBuffModal = v
}

// ── Persistence ──

export function getCalcState(): CalcState {
    return JSON.parse(JSON.stringify({ blocks: _blocks, entryBlockIds: _entryBlockIds }))
}
