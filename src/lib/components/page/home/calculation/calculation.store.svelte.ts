import type { BuffBlock, BuffZoneValue, CalcState, DamageEntry } from './calculation.types'
import { parseValueString, sumRatioNum } from '$lib/consts/parse-value-string'
import type { TimelineData, DamageBlock } from '../timeline/timeline.types'
import type { CharSlot } from '$lib/data/types'
import { NON_DIRECT_ELEMENT } from '../timeline/timeline.consts'
import { getCharElementMap, getCharWeaponTypeMap, getSkillCache } from '../timeline/timeline.store.svelte'
import { getEffectMultiplier, getEffectBurstMultiplier, getTuneDamage } from '$lib/consts/tune-data'

let _entries = $state<DamageEntry[]>([])
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

function buildEntries(team: [CharSlot, CharSlot, CharSlot], timelineData: TimelineData | null): DamageEntry[] {
    if (!timelineData) return []

    const { opBlocks, damageBlocks, refLines } = timelineData

    const echoNameMap = new Map<string, string | null>()
    for (const s of team) {
        if (s.character) {
            echoNameMap.set(s.character, s.echoes[0]?.name ?? null)
        }
    }

    function getBlockTime(d: DamageBlock): number {
        if (d.sourceType === 'ref') {
            return refLines.find((r) => r.id === d.sourceId)?.pos ?? 0
        }
        return opBlocks.find((b) => b.id === d.sourceId)?.time ?? 0
    }

    function getSourceChar(d: DamageBlock): string {
        if (d.sourceType === 'ref') return '无'
        const op = opBlocks.find((b) => b.id === d.sourceId)
        return op && op.trackIndex < 3 ? (team[op.trackIndex]?.character ?? '无') : '无'
    }

    const entries: DamageEntry[] = []
    let idCounter = 0

    for (const d of damageBlocks) {
        if (d.skillHits.length === 0 && d.nonDirectEntries.length === 0) continue

        const sourceChar = getSourceChar(d)
        const time = getBlockTime(d)

        for (const h of d.skillHits) {
            const echoName = h.skillType === '声骸技能' ? (echoNameMap.get(h.character) ?? null) : null
            const character =
                d.sourceType === 'ref' ? h.character || '无' : h.skillType === '声骸技能' ? h.character : sourceChar
            const hitName =
                h.skillType === '声骸技能' && echoName ? echoName + '·' + h.hitName.replace('伤害', '') : h.hitName

            entries.push({
                id: `entry-${idCounter++}`,
                character,
                hitName,
                skillType: h.skillType,
                element: h.element,
                ratio: h.ratio,
                ratioNum: sumRatioNum(parseValueString(h.ratio)),
                hits: h.hits ?? 1,
                sourceType: d.sourceType,
                time
            })
        }

        const ndEntries = d.nonDirectEntries
        const effectNDs = ndEntries.filter((nd) => nd.category === '效应')
        const otherNDs = ndEntries.filter((nd) => nd.category !== '效应')
        const charElements = getCharElementMap()

        const dianci = effectNDs.find((nd) => nd.name === '电磁效应')
        const baofa = effectNDs.find((nd) => nd.name === '电磁爆发')
        if (dianci || baofa) {
            const layers = dianci?.layers ?? 0
            const burstLayers = baofa?.layers ?? 0
            const mult = getEffectMultiplier('电磁效应', layers)
            const burstMult = getEffectBurstMultiplier('电磁效应', burstLayers)
            const total = mult + burstMult
            entries.push({
                id: `entry-${idCounter++}`,
                character: '无',
                hitName: `电磁效应${layers}层(爆发${burstLayers}层)`,
                skillType: '电磁效应',
                element: '导电',
                ratio: (total * 100).toFixed(2) + '%',
                ratioNum: total,
                hits: 1,
                sourceType: d.sourceType,
                time
            })
        }
        for (const nd of effectNDs) {
            if (nd.name === '电磁效应' || nd.name === '电磁爆发') continue
            const mult = getEffectMultiplier(nd.name, nd.layers)
            entries.push({
                id: `entry-${idCounter++}`,
                character: '无',
                hitName: nd.name + nd.layers + '层',
                skillType: nd.name,
                element: NON_DIRECT_ELEMENT[nd.name] ?? '',
                ratio: (mult * 100).toFixed(2) + '%',
                ratioNum: mult,
                hits: 1,
                sourceType: d.sourceType,
                time
            })
        }
        for (const nd of otherNDs) {
            if (nd.category === '处决') {
                const harmonyChar = nd.responders?.[0] ?? sourceChar
                const op2 = opBlocks.find((b) => b.id === d.sourceId)
                const trackIdx2 = op2?.trackIndex ?? -1
                const weapType = trackIdx2 >= 0 && trackIdx2 < 3 ? getCharWeaponTypeMap()[harmonyChar] ?? '' : ''
                const echoCost = trackIdx2 >= 0 && trackIdx2 < 3 ? (team[trackIdx2]?.echoes?.[0]?.cost ?? 4) : 4
                let tuneRatio = '—'
                let tuneRatioNum = 0
                if (weapType) {
                    const hits = getTuneDamage(weapType, echoCost)
                    if (hits.length > 0) {
                        const totalMult = hits.reduce((s, h) => s + h.multiplier, 0)
                        const totalDmg = hits.reduce((s, h) => s + h.damage, 0)
                        tuneRatio = `失谐${totalDmg} × ${(totalMult * 100).toFixed(2)}%`
                        tuneRatioNum = totalMult
                    }
                }
                entries.push({
                    id: `entry-${idCounter++}`,
                    character: harmonyChar,
                    hitName: '谐度破坏',
                    skillType: '谐度破坏',
                    element: '物理',
                    ratio: tuneRatio,
                    ratioNum: tuneRatioNum,
                    hits: 1,
                    sourceType: d.sourceType,
                    time
                })
            } else if (nd.category === '响应') {
                if (nd.responders?.length) {
                    for (const r of nd.responders) {
                        let respRatio = '—'
                        let respRatioNum = 0
                        const respGroups = r !== '无' ? getSkillCache()[r] : null
                        if (respGroups) {
                            const tuneGroup = respGroups.find((g) => g.type === '谐度破坏')
                            if (tuneGroup) {
                                const match = tuneGroup.hits.find(
                                    (h) => h.name.includes('震谐') || h.name.includes('骇破')
                                )
                                if (match) {
                                    respRatio = match.ratio
                                    respRatioNum = sumRatioNum(parseValueString(match.ratio))
                                }
                            }
                        }
                        entries.push({
                            id: `entry-${idCounter++}`,
                            character: r,
                            hitName: nd.name,
                            skillType: nd.name,
                            element: charElements[r] ?? '',
                            ratio: respRatio,
                            ratioNum: respRatioNum,
                            hits: 1,
                            sourceType: d.sourceType,
                            time
                        })
                    }
                } else {
                    entries.push({
                        id: `entry-${idCounter++}`,
                        character: '无',
                        hitName: nd.name,
                        skillType: nd.name,
                        element: '',
                        ratio: '—',
                        ratioNum: 0,
                        hits: 1,
                        sourceType: d.sourceType,
                        time
                    })
                }
            }
        }
    }

    return entries.sort((a, b) => a.time - b.time)
}

export function getEntries(): DamageEntry[] {
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
