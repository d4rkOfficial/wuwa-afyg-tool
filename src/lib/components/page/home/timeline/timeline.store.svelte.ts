import type { CharSlot } from '$lib/data/types'
import { updateCustomSkillHits } from '$lib/data/project.svelte'
import type { SkillEntry } from '$lib/api/types'
import {
    getCharacterInfo,
    getEchoInfo,
    getCharacterIcons,
    getElementIcons,
    getUiBtnIcons as apiGetUiBtnIcons
} from '$lib/data/api'
import type {
    RefLine,
    OpBlock,
    SkillHit,
    SkillPickerGroup,
    NonDirectEntry,
    DamageBlock,
    TimelineData,
    CustomHit
} from './timeline.types'
import {
    PPS,
    SIDE_PAD,
    RIGHT_EXTRA,
    ADD_OFFSET,
    MIN_GAP,
    SNAP_PX,
    MAX_POS,
    NON_DIRECT_CONFIGS,
    NON_DIRECT_ELEMENT,
    BUTTON_KEY_ORDER,
    BLOCK_H_PAD
} from './timeline.consts'
import { getEffectMultiplier, getEffectBurstMultiplier, getTuneDamage } from '$lib/consts/tune-data'
import { parseValueString, sumRatioNum } from '$lib/consts/parse-value-string'
import { addToast } from '$lib/data/toast.svelte'
import { setCharElements } from '$lib/data/char-elements.svelte'

// ── Core Data ──
let _refLines = $state<RefLine[]>([
    { id: 'left', time: '', pos: 0 },
    { id: 'c1', time: '临时参考线', pos: SIDE_PAD + 12.5 * PPS },
    { id: 'right', time: '结束', pos: SIDE_PAD + 150 * PPS }
])
let _opBlocks = $state<OpBlock[]>([])
let _damageBlocks = $state<DamageBlock[]>([])
let _locked = $state(false)

function assertUnlocked(): boolean {
    if (_locked) {
        addToast('本环节已锁定，请先解锁后编辑。编辑产生的副作用需您来承担。', 'info')
        return false
    }
    return true
}
let _onupdate: ((data: TimelineData) => void) | undefined = $state()
let _team = $state<[CharSlot, CharSlot, CharSlot]>([{}, {}, {}] as unknown as [CharSlot, CharSlot, CharSlot])
let _uiBtnIcons = $state<[string, string][]>([])
let _charIconMap = $state<Record<string, string>>({})
let _elementIconMap = $state<Record<string, string>>({})
let _charElementMap = $state<Record<string, string>>({})
let _charWeaponTypeMap = $state<Record<string, string>>({})

export function init(
    data: TimelineData | null,
    onupdate: (data: TimelineData) => void,
    team: [CharSlot, CharSlot, CharSlot],
    locked: boolean
) {
    _onupdate = onupdate
    _team = team
    _locked = locked
    if (data) {
        _refLines = data.refLines.map((rl) => ({
            ...rl,
            time: typeof rl.time === 'number' ? String(rl.time) : rl.time,
            pos:
                (rl as { pos?: number }).pos ?? (typeof rl.time === 'number' ? SIDE_PAD + (rl.time as number) * PPS : 0)
        }))
        _opBlocks = data.opBlocks.map((op) => {
            const b = op as OpBlock & { time?: number }
            if (b.time !== undefined && b.pos === undefined) {
                return { ...b, pos: SIDE_PAD + b.time * PPS }
            }
            return b as OpBlock
        })
        _damageBlocks = data.damageBlocks
    } else {
        _refLines = [
            { id: 'left', time: '', pos: 0 },
            { id: 'c1', time: '临时参考线', pos: SIDE_PAD + 12.5 * PPS },
            { id: 'right', time: '结束', pos: SIDE_PAD + 150 * PPS }
        ]
        _opBlocks = []
        _damageBlocks = []
    }
    _refSkillPickerCache = {}
    _skillPickerBlockId = null
    _skillPickerIsRef = false
    _contextMenu = null
    _trackMenu = null
    _blockMenu = null
    _showDamageList = false
    _dragVisualPositions = {}
    _blockWidths = {}
    loadCharElements()
}

async function loadCharElements() {
    const names = getTeamCharNames()
    if (names.length === 0) return
    const elemMap: Record<string, string> = {}
    const weapMap: Record<string, string> = {}
    const skillsMap: Record<string, SkillPickerGroup[]> = {}
    const results = await Promise.allSettled(names.map((n) => getCharacterInfo(n)))
    for (let i = 0; i < names.length; i++) {
        const r = results[i]
        if (r.status === 'fulfilled') {
            elemMap[names[i]] = r.value.element
            weapMap[names[i]] = r.value.weaponType
            skillsMap[names[i]] = buildSkillGroups(r.value.skills)
        }
    }
    _charElementMap = elemMap
    setCharElements(elemMap)
    _charWeaponTypeMap = weapMap
    Object.assign(_skillCache, skillsMap)
}

function save() {
    if (_onupdate) {
        _onupdate({ refLines: _refLines, opBlocks: _opBlocks, damageBlocks: _damageBlocks })
    }
}

// ── Getters ──
export function getRefLines() {
    return _refLines
}
export function getOpBlocks() {
    return _opBlocks
}
export function getDamageBlocks() {
    return _damageBlocks
}
export function getLocked() {
    return _locked
}
export function getTeam() {
    return _team
}
export function getUiBtnIcons() {
    return _uiBtnIcons
}
export function getCharIconMap() {
    return _charIconMap
}
export function getElementIconMap() {
    return _elementIconMap
}

export async function loadIcons() {
    const results = await Promise.allSettled([apiGetUiBtnIcons(), getCharacterIcons(), getElementIcons()])
    if (results[0].status === 'fulfilled') {
        _uiBtnIcons = (Object.entries(results[0].value) as [string, string][]).sort(([a], [b]) => {
            const order = BUTTON_KEY_ORDER as readonly string[]
            return order.indexOf(a) - order.indexOf(b)
        })
    } else {
        _uiBtnIcons = BUTTON_KEY_ORDER.map((name) => [name, ''] as [string, string])
    }
    if (results[1].status === 'fulfilled') _charIconMap = results[1].value
    if (results[2].status === 'fulfilled') _elementIconMap = results[2].value
}

export function getTeamCharNames() {
    return _team.map((s) => s.character).filter(Boolean) as string[]
}

// ── Ref Line State ──
let _editingId = $state<string | null>(null)
let _editValue = $state('')
let _contextMenu = $state<{ x: number; y: number; id: string } | null>(null)
let _draggingId = $state<string | null>(null)
let _dragVisualPositions = $state<Record<string, number>>({})

export function getEditingId() {
    return _editingId
}
export function setEditingId(v: string | null) {
    _editingId = v
}
export function getEditValue() {
    return _editValue
}
export function setEditValue(v: string) {
    _editValue = v
}
export function getContextMenu() {
    return _contextMenu
}
export function setContextMenu(v: { x: number; y: number; id: string } | null) {
    _contextMenu = v
}
export function getDraggingId() {
    return _draggingId
}
export function setDraggingId(v: string | null) {
    _draggingId = v
}
export function getDragVisualPositions() {
    return _dragVisualPositions
}
export function setDragVisualPositions(v: Record<string, number>) {
    _dragVisualPositions = v
}

// ── Op Block State ──
let _trackMenu = $state<{ x: number; y: number; trackIndex: number; pos: number } | null>(null)
let _editingBlockId = $state<string | null>(null)
let _editingBlockDesc = $state('')
let _dragBlockId = $state<string | null>(null)
let _dragBlockStartPos = $state(0)
let _blockWidths = $state<Record<string, number>>({})
let _damageWidths = $state<Record<string, number>>({})
let _blockMenu = $state<{ x: number; y: number; blockId: string } | null>(null)

export function getTrackMenu() {
    return _trackMenu
}
export function setTrackMenu(v: { x: number; y: number; trackIndex: number; pos: number } | null) {
    _trackMenu = v
}
export function getEditingBlockId() {
    return _editingBlockId
}
export function setEditingBlockId(v: string | null) {
    _editingBlockId = v
}
export function getEditingBlockDesc() {
    return _editingBlockDesc
}
export function setEditingBlockDesc(v: string) {
    _editingBlockDesc = v
}
export function getDragBlockId() {
    return _dragBlockId
}
export function getBlockWidths() {
    return _blockWidths
}
export function setBlockWidths(v: Record<string, number>) {
    _blockWidths = v
}
export function getBlockMenu() {
    return _blockMenu
}
export function setBlockMenu(v: { x: number; y: number; blockId: string } | null) {
    _blockMenu = v
}

// ── Damage / Picker State ──
let _showDamageList = $state(false)
let _skillPickerBlockId = $state<string | null>(null)
let _skillPickerLoading = $state(false)
let _skillPickerCharacter = $state('')
let _skillPickerGroups = $state<SkillPickerGroup[]>([])
let _skillPickerSelected = $state<Set<string>>(new Set())
let _skillPickerIsRef = $state(false)
let _refSkillPickerCache = $state<Record<string, SkillPickerGroup[]>>({})
let _skillPickerHitHits = $state<Record<string, number>>({})
let _nonDirectPickerBlockId = $state<string | null>(null)
let _nonDirectPickerData = $state<{ name: string; category: string; layers: number }[]>([])
let _nonDirectPickerSelected = $state<Set<string>>(new Set())
let _nonDirectPickerResponders = $state<Record<string, string[]>>({})
let _nonDirectPickerBurstLayers = $state<Record<string, number>>({})
let _nonDirectPickerTuneTrigger = $state<string | null>(null)
let _skillCache = $state<Record<string, SkillPickerGroup[]>>({})
let _echoSkillCache = $state<Record<string, { values: [string, string, string][] }>>({})
let _customSkillHits = $state<Record<string, CustomHit[]>>({})

export function getShowDamageList() {
    return _showDamageList
}
export function setShowDamageList(v: boolean) {
    _showDamageList = v
}
export function getSkillPickerBlockId() {
    return _skillPickerBlockId
}
export function setSkillPickerBlockId(v: string | null) {
    _skillPickerBlockId = v
}
export function getSkillPickerLoading() {
    return _skillPickerLoading
}
export function getSkillPickerCharacter() {
    return _skillPickerCharacter
}
export function getSkillPickerGroups() {
    return _skillPickerGroups
}
export function getSkillPickerSelected() {
    return _skillPickerSelected
}
export function setSkillPickerSelected(v: Set<string>) {
    _skillPickerSelected = v
}
export function getSkillPickerIsRef() {
    return _skillPickerIsRef
}
export function setSkillPickerIsRef(v: boolean) {
    _skillPickerIsRef = v
}
export function getRefSkillPickerCache() {
    return _refSkillPickerCache
}
export function getSkillPickerHitHits() {
    return _skillPickerHitHits
}
export function setSkillPickerHitHits(v: Record<string, number>) {
    _skillPickerHitHits = v
}

// ── Custom Skill Hits ──

export function getCustomSkillHits(): Record<string, CustomHit[]> {
    return _customSkillHits
}

export function loadCustomHits(hits: Record<string, CustomHit[]>) {
    _customSkillHits = JSON.parse(JSON.stringify(hits))
}

export function addCustomHit(charName: string, hit: CustomHit) {
    const list = _customSkillHits[charName] ?? []
    _customSkillHits = { ..._customSkillHits, [charName]: [...list, hit] }
    updateCustomSkillHits(_customSkillHits)
    refreshSkillPickerGroups()
}

export function removeCustomHit(charName: string, hitId: string) {
    const list = _customSkillHits[charName] ?? []
    _customSkillHits = { ..._customSkillHits, [charName]: list.filter((h) => h.id !== hitId) }
    updateCustomSkillHits(_customSkillHits)
    refreshSkillPickerGroups()
}

export function getSkillCache() {
    return _skillCache
}

export function charHasTuneSkills(charName: string): boolean {
    const groups = _skillCache[charName]
    return groups?.some((g) => g.type === '谐度破坏' && g.hits.length > 0) ?? false
}

export function charHasResponseSkill(charName: string, responseName: string): boolean {
    const groups = _skillCache[charName]
    if (!groups) return false
    return groups.some((g) => g.hits.some((h) => h.name.includes(responseName)))
}

function refreshSkillPickerGroups() {
    if (!_skillPickerBlockId) return
    const base = _skillPickerGroups.filter((g) => g.type !== '自定义')
    const charName = _skillPickerCharacter
    _skillPickerGroups = appendCustomGroups(base, charName)
}
export function getNonDirectPickerBlockId() {
    return _nonDirectPickerBlockId
}
export function setNonDirectPickerBlockId(v: string | null) {
    _nonDirectPickerBlockId = v
}
export function getNonDirectPickerData() {
    return _nonDirectPickerData
}
export function setNonDirectPickerData(v: { name: string; category: string; layers: number }[]) {
    _nonDirectPickerData = v
}
export function getNonDirectPickerSelected() {
    return _nonDirectPickerSelected
}
export function setNonDirectPickerSelected(v: Set<string>) {
    _nonDirectPickerSelected = v
}
export function getNonDirectPickerResponders() {
    return _nonDirectPickerResponders
}
export function setNonDirectPickerResponders(v: Record<string, string[]>) {
    _nonDirectPickerResponders = v
}
export function getNonDirectPickerBurstLayers() {
    return _nonDirectPickerBurstLayers
}
export function setNonDirectPickerBurstLayers(v: Record<string, number>) {
    _nonDirectPickerBurstLayers = v
}
export function getNonDirectPickerTuneTrigger() {
    return _nonDirectPickerTuneTrigger
}
export function setNonDirectPickerTuneTrigger(v: string | null) {
    _nonDirectPickerTuneTrigger = v
}

// ── Derived ──
export function getSkillPickerOrder() {
    return Array.from(_skillPickerSelected)
}

export function getTableWidth() {
    const last = _refLines[_refLines.length - 1]
    return 80 + (_dragVisualPositions[last?.id] ?? last?.pos ?? SIDE_PAD + 150 * PPS) + RIGHT_EXTRA
}

export function getSegments() {
    return _refLines.slice(0, -1).map((rl, i) => ({
        from: rl,
        to: _refLines[i + 1],
        width: vx(_refLines[i + 1].id, _refLines[i + 1].pos) - vx(rl.id, rl.pos)
    }))
}

export function getTRACKS() {
    return [...getTeamCharNames(), '伤害绑定']
}

// ── Utility Functions ──
export function vx(id: string, pos: number): number {
    return _dragVisualPositions[id] ?? pos
}

export function elementColor(name: string): string {
    const char = _team.find((s) => s.character === name)
    if (!char) return '#71717a'
    const el = elementNameForChar(char)
    return el ? `var(--theme-element-${el})` : '#71717a'
}

function elementNameForChar(slot: CharSlot): string {
    return _charElementMap[slot.character ?? ''] ?? ''
}

export function getCharElementMap(): Record<string, string> {
    return _charElementMap
}

export function getCharWeaponTypeMap(): Record<string, string> {
    return _charWeaponTypeMap
}

export function damageBlockLeft(d: DamageBlock): number {
    if (d.sourceType === 'ref') {
        const rl = _refLines.find((r) => r.id === d.sourceId)
        return rl ? vx(rl.id, rl.pos) : 0
    }
    const op = _opBlocks.find((b) => b.id === d.sourceId)
    if (!op) return 0
    return op.pos - (_blockWidths[op.id] ?? 56) / 2
}

export function setDamageWidth(id: string, width: number) {
    _damageWidths[id] = width
}

function estimateDamageWidth(d: DamageBlock): number {
    const texts: string[] = []
    for (const h of d.skillHits) {
        texts.push(h.hitName.replace('伤害', '') + ((h.hits ?? 0) > 1 ? `×${h.hits}` : ''))
    }
    for (const nd of d.nonDirectEntries) {
        texts.push(nd.category === '效应' ? `${nd.name}${nd.layers}层` : nd.name)
    }
    const maxChars = Math.max(...texts.map((t) => t.length), 0)
    const singleTagW = maxChars * 5.5 + 22
    return singleTagW + 8
}

export function estimateDamageHeight(d: DamageBlock): number {
    const count = d.skillHits.length + d.nonDirectEntries.length
    const TAG_HEIGHT = 18
    const PAD = 4
    return count * TAG_HEIGHT + PAD
}

export function getDamageBlocksStacked(): { block: DamageBlock; top: number; left: number }[] {
    const blocks = _damageBlocks
        .filter((d) => d.trackIndex === 3 && (d.skillHits.length > 0 || d.nonDirectEntries.length > 0))
        .map((d) => ({ block: d, left: damageBlockLeft(d) }))
        .sort((a, b) => a.left - b.left)

    const GAP = 4
    const result: { block: DamageBlock; top: number; left: number }[] = []
    for (const item of blocks) {
        const hB = estimateDamageHeight(item.block)
        const wB = _damageWidths[item.block.id] ?? estimateDamageWidth(item.block)

        const candidateSet = new Set<number>()
        candidateSet.add(0)
        for (const placed of result) {
            const wA = _damageWidths[placed.block.id] ?? estimateDamageWidth(placed.block)
            if (Math.abs(placed.left - item.left) < (wA + wB) / 2) {
                candidateSet.add(placed.top + estimateDamageHeight(placed.block) + GAP)
            }
        }

        const candidates = [...candidateSet].sort((a, b) => a - b)
        let top = candidates[candidates.length - 1]
        for (const y of candidates) {
            let valid = true
            for (const placed of result) {
                const wA = _damageWidths[placed.block.id] ?? estimateDamageWidth(placed.block)
                if (Math.abs(placed.left - item.left) < (wA + wB) / 2) {
                    const hA = estimateDamageHeight(placed.block)
                    if (y < placed.top + hA + GAP && placed.top < y + hB + GAP) {
                        valid = false
                        break
                    }
                }
            }
            if (valid) {
                top = y
                break
            }
        }

        result.push({ block: item.block, top, left: item.left })
    }
    return result
}

// ── Ref Line Functions ──
export function isBoundary(id: string) {
    return id === 'left' || id === 'right'
}
export function canDelete(id: string) {
    return id !== 'left' && id !== 'right'
}

export function canAddBefore(id: string): boolean {
    const idx = _refLines.findIndex((r) => r.id === id)
    if (idx <= 0) return false
    const prevX = vx(_refLines[idx - 1].id, _refLines[idx - 1].pos)
    const thisX = vx(id, _refLines[idx].pos)
    return thisX - prevX >= MIN_GAP * 2
}

export function canAddAfter(id: string): boolean {
    const idx = _refLines.findIndex((r) => r.id === id)
    if (idx < 0 || idx >= _refLines.length - 1) return false
    const parentX = vx(id, _refLines[idx].pos)
    const nextX = vx(_refLines[idx + 1].id, _refLines[idx + 1].pos)
    return nextX - parentX >= MIN_GAP * 2
}

export function addBefore(id: string) {
    if (!assertUnlocked()) return
    const idx = _refLines.findIndex((r) => r.id === id)
    if (idx <= 0) return
    const prevX = vx(_refLines[idx - 1].id, _refLines[idx - 1].pos)
    const thisX = vx(id, _refLines[idx].pos)
    if (thisX - prevX < MIN_GAP * 2) return
    const nid = `c${Date.now()}`
    const midX = Math.max(thisX - ADD_OFFSET, (prevX + thisX) / 2)
    _dragVisualPositions = { ..._dragVisualPositions, [nid]: midX }
    _refLines = [..._refLines.slice(0, idx), { id: nid, time: '', pos: midX }, ..._refLines.slice(idx)]
    startEdit(nid, '')
}

export function addAfter(id: string) {
    if (!assertUnlocked()) return
    const idx = _refLines.findIndex((r) => r.id === id)
    if (idx < 0 || idx >= _refLines.length - 1) return
    const parentX = vx(id, _refLines[idx].pos)
    const nextX = vx(_refLines[idx + 1].id, _refLines[idx + 1].pos)
    if (nextX - parentX < MIN_GAP * 2) return
    const nid = `c${Date.now()}`
    const midX = Math.min(parentX + ADD_OFFSET, (parentX + nextX) / 2)
    _dragVisualPositions = { ..._dragVisualPositions, [nid]: midX }
    _refLines = [..._refLines.slice(0, idx + 1), { id: nid, time: '', pos: midX }, ..._refLines.slice(idx + 1)]
    startEdit(nid, '')
}

export function removeLine(id: string) {
    if (!assertUnlocked()) return
    if (!canDelete(id)) return
    _refLines = _refLines.filter((r) => r.id !== id)
    _damageBlocks = _damageBlocks.filter((d) => !(d.sourceId === id && d.sourceType === 'ref'))
    const { [id]: _, ...rest } = _dragVisualPositions
    _dragVisualPositions = rest
    _contextMenu = null
    save()
}

export function clearLeftOpBlocks(refId: string) {
    if (!assertUnlocked()) return
    const idx = _refLines.findIndex((r) => r.id === refId)
    if (idx <= 0) return
    const leftBound = _refLines[idx - 1].pos
    const rightBound = _refLines[idx].pos
    const toRemove = _opBlocks.filter((b) => b.pos > leftBound && b.pos < rightBound)
    const removeIds = new Set(toRemove.map((b) => b.id))
    _opBlocks = _opBlocks.filter((b) => !removeIds.has(b.id))
    _damageBlocks = _damageBlocks.filter((d) => !(d.sourceType === 'op' && removeIds.has(d.sourceId)))
    _contextMenu = null
    save()
}

export function resetLeftDamageBindings(refId: string) {
    if (!assertUnlocked()) return
    const idx = _refLines.findIndex((r) => r.id === refId)
    if (idx <= 0) return
    const leftBound = _refLines[idx - 1].pos
    const rightBound = _refLines[idx].pos
    const inRangeOpIds = new Set(_opBlocks.filter((b) => b.pos > leftBound && b.pos < rightBound).map((b) => b.id))
    const inRangeRefIds = new Set(_refLines.filter((r) => r.pos > leftBound && r.pos < rightBound).map((r) => r.id))
    _damageBlocks = _damageBlocks
        .map((d) => {
            if (d.trackIndex !== 3) return d
            const isInRange =
                (d.sourceType === 'op' && inRangeOpIds.has(d.sourceId)) ||
                (d.sourceType === 'ref' && inRangeRefIds.has(d.sourceId))
            if (!isInRange) return d
            return { ...d, skillHits: [], nonDirectEntries: [] }
        })
        .filter((d) => !(d.skillHits.length === 0 && d.nonDirectEntries.length === 0))
    _contextMenu = null
    save()
}

export function startEdit(id: string, time: string) {
    _editingId = id
    _editValue = time
}

export function confirmEdit() {
    if (!_editingId || isBoundary(_editingId)) return
    const idx = _refLines.findIndex((r) => r.id === _editingId)
    if (idx < 0) return
    const currentX = vx(_editingId, _refLines[idx].pos)
    _dragVisualPositions = { ..._dragVisualPositions, [_editingId]: currentX }
    _refLines = _refLines.map((r) => (r.id === _editingId ? { ...r, time: _editValue } : r))
    save()
    _editingId = null
}

// ── Drag Functions ──
export function clampDragPos(cx: number, id: string): number {
    const idx = _refLines.findIndex((r) => r.id === id)
    if (idx > 0) cx = Math.max(cx, vx(_refLines[idx - 1].id, _refLines[idx - 1].pos) + MIN_GAP)
    if (idx < _refLines.length - 1) cx = Math.min(cx, vx(_refLines[idx + 1].id, _refLines[idx + 1].pos) - MIN_GAP)
    return cx
}

export function startDrag(e: MouseEvent, id: string) {
    if (!assertUnlocked()) return
    if (e.button !== 0 || id === 'left') return
    _draggingId = id
}

export function onDrag(rawX: number) {
    if (!_draggingId) return
    _dragVisualPositions = { ..._dragVisualPositions, [_draggingId]: clampDragPos(rawX, _draggingId) }
}

export function stopDrag() {
    if (!_draggingId) {
        _draggingId = null
        return
    }
    const id = _draggingId
    const newX = _dragVisualPositions[id]
    if (newX !== undefined) {
        _refLines = _refLines.map((r) => (r.id === id ? { ...r, pos: newX } : r))
        save()
    }
    _draggingId = null
}

// ── Op Block Functions ──
export function addOpBlock(trackIndex: number, pos: number, key: string) {
    if (!assertUnlocked()) return
    _opBlocks = [..._opBlocks, { id: `b${Date.now()}`, trackIndex, pos, key, desc: '', intro: false }]
    _trackMenu = null
    enforceIntro()
    save()
}

let _dragBlockOffset = $state(0)

export function startBlockDrag(e: MouseEvent, blockId: string, mouseContentX?: number) {
    if (!assertUnlocked()) return
    if (e.button !== 0) return
    _dragBlockId = blockId
    const block = _opBlocks.find((b) => b.id === blockId)
    if (block) {
        _dragBlockStartPos = block.pos
        if (mouseContentX !== undefined) {
            _dragBlockOffset = mouseContentX - block.pos
        }
    }
}

export function onBlockDrag(rawX: number) {
    if (!_dragBlockId) return
    const idx = _opBlocks.findIndex((b) => b.id === _dragBlockId)
    if (idx < 0) return
    const centerX = rawX - _dragBlockOffset
    const pos = snapBlockX(centerX, _opBlocks[idx].trackIndex, _dragBlockId, _blockWidths[_dragBlockId] ?? 0)
    _opBlocks = _opBlocks.map((b) => (b.id === _dragBlockId ? { ...b, pos: Math.max(0, Math.min(MAX_POS, pos)) } : b))
}

export function stopBlockDrag() {
    if (!_dragBlockId) {
        _dragBlockId = null
        return
    }
    const idx = _opBlocks.findIndex((b) => b.id === _dragBlockId)
    if (idx >= 0) {
        const dragged = _opBlocks[idx]
        if (Math.abs(dragged.pos - _dragBlockStartPos) > 1) {
            const dw = _blockWidths[_dragBlockId] ?? 0
            const dLeft = dragged.pos - dw / 2
            for (const b of _opBlocks) {
                if (b.id === _dragBlockId || b.trackIndex !== dragged.trackIndex) continue
                const bw = _blockWidths[b.id] ?? 0
                const bLeft = b.pos - bw / 2
                const bRight = b.pos + bw / 2
                if (dragged.pos >= b.pos && dLeft > bLeft + SNAP_PX && dLeft < bRight - SNAP_PX) {
                    _opBlocks = _opBlocks.map((ob) =>
                        ob.id === _dragBlockId ? { ...ob, pos: Math.max(0, Math.min(MAX_POS, bRight + dw / 2)) } : ob
                    )
                    break
                }
            }
            reflowTrack(dragged.trackIndex)
            save()
        }
    }
    _dragBlockId = null
}

export function removeBlock(blockId: string) {
    if (!assertUnlocked()) return
    _opBlocks = _opBlocks.filter((b) => b.id !== blockId)
    _damageBlocks = _damageBlocks.filter((d) => !(d.sourceId === blockId && d.sourceType === 'op'))
    _blockMenu = null
    enforceIntro()
    save()
}

export function canSetIntro(blockId: string): boolean {
    const block = _opBlocks.find((b) => b.id === blockId)
    if (!block || block.intro || block.trackIndex >= 3) return false
    const sorted = _opBlocks.filter((b) => b.trackIndex < 3).sort((a, b) => a.pos - b.pos)
    const idx = sorted.findIndex((b) => b.id === blockId)
    if (idx <= 0) return true
    const prev = sorted[idx - 1]
    return prev.trackIndex !== block.trackIndex
}

export function toggleIntro(blockId: string) {
    if (!assertUnlocked()) return
    const block = _opBlocks.find((b) => b.id === blockId)
    if (!block) return
    if (block.intro) {
        _opBlocks = _opBlocks.map((b) => (b.id === blockId ? { ...b, intro: false } : b))
    } else if (canSetIntro(blockId)) {
        _opBlocks = _opBlocks.map((b) => (b.id === blockId ? { ...b, intro: true } : b))
    }
}

function enforceIntro() {
    const sorted = _opBlocks.filter((b) => b.trackIndex < 3).sort((a, b) => a.pos - b.pos)
    let changed = false
    const updated = _opBlocks.map((b) => {
        if (!b.intro) return b
        const idx = sorted.findIndex((s) => s.id === b.id)
        if (idx <= 0) return b
        const prev = sorted[idx - 1]
        if (prev.trackIndex === b.trackIndex) {
            changed = true
            return { ...b, intro: false }
        }
        return b
    })
    if (changed) _opBlocks = updated
}

export function handleBlockDblclick(blockId: string) {
    const block = _opBlocks.find((b) => b.id === blockId)
    if (!block) return
    _editingBlockId = blockId
    _editingBlockDesc = block.desc
}

export function confirmBlockDesc() {
    if (_editingBlockId) {
        const idx = _opBlocks.findIndex((b) => b.id === _editingBlockId)
        if (idx >= 0) {
            const oldW = _blockWidths[_editingBlockId] ?? 0
            _opBlocks = _opBlocks.map((b) => (b.id === _editingBlockId ? { ...b, desc: _editingBlockDesc } : b))
            const newW = _blockWidths[_editingBlockId] ?? oldW
            const dw = newW - oldW
            if (Math.abs(dw) > 1 && idx >= 0) {
                const edited = _opBlocks[idx]
                const oldRight = edited.pos + oldW / 2
                const shift = dw / 2
                _opBlocks = _opBlocks.map((b) => {
                    if (b.id === _editingBlockId || b.trackIndex >= 3) return b
                    const bl = b.pos - (_blockWidths[b.id] ?? 0) / 2
                    if (bl >= oldRight) return { ...b, pos: Math.max(0, Math.min(MAX_POS, b.pos + shift)) }
                    return b
                })
            }
            reflowTrack(0)
            save()
        }
    }
    _editingBlockId = null
}

// ── Snap / Reflow ──
export function snapBlockX(centerX: number, trackIndex: number, excludeId: string, width: number): number {
    const left = centerX - width / 2
    const right = centerX + width / 2
    for (const b of _opBlocks) {
        if (b.id === excludeId) continue
        const bw = _blockWidths[b.id] ?? 0
        const bLeft = b.pos - bw / 2
        const bRight = b.pos + bw / 2

        if (Math.abs(left - bRight) < SNAP_PX) return bRight + width / 2
        if (Math.abs(right - bLeft) < SNAP_PX) return bLeft - width / 2
        if (centerX > b.pos) {
            const inL = bLeft + BLOCK_H_PAD
            const inR = bRight - BLOCK_H_PAD
            if (Math.abs(left - inL) < SNAP_PX) return inL + width / 2
            if (Math.abs(left - inR) < SNAP_PX) return inR + width / 2
        }
    }
    return centerX
}

function areBlocksTouching(leftBlock: OpBlock, rightBlock: OpBlock): boolean {
    const lw = _blockWidths[leftBlock.id] ?? 0
    const rw = _blockWidths[rightBlock.id] ?? 0
    const lr = leftBlock.pos + lw / 2
    const rl = rightBlock.pos - rw / 2
    if (Math.abs(lr - rl) < SNAP_PX) return true
    const inL = leftBlock.pos - lw / 2 + BLOCK_H_PAD
    const inR = leftBlock.pos + lw / 2 - BLOCK_H_PAD
    return Math.abs(rl - inL) < SNAP_PX || Math.abs(rl - inR) < SNAP_PX
}

export function reflowTrack(trackIndex: number) {
    const sorted = _opBlocks.filter((b) => b.trackIndex === trackIndex).sort((a, b) => a.pos - b.pos)
    if (sorted.length < 2) return
    const groups: OpBlock[][] = []
    let cur: OpBlock[] = [sorted[0]]
    for (let i = 1; i < sorted.length; i++) {
        if (areBlocksTouching(sorted[i - 1], sorted[i])) {
            cur.push(sorted[i])
        } else {
            groups.push(cur)
            cur = [sorted[i]]
        }
    }
    groups.push(cur)
    const result: OpBlock[] = []
    for (const group of groups) {
        result.push(group[0])
        for (let i = 1; i < group.length; i++) {
            const prev = result[result.length - 1]
            const pw = _blockWidths[prev.id] ?? 0
            const cur = group[i]
            const cw = _blockWidths[cur.id] ?? 0
            const prx = prev.pos + pw / 2
            const newPos = prx + 1 + cw / 2
            result.push({ ...cur, pos: Math.max(0, Math.min(MAX_POS, newPos)) })
        }
    }
    const updated = _opBlocks.map((b) => {
        const nb = result.find((r) => r.id === b.id)
        return nb ?? b
    })
    _opBlocks = updated
    enforceIntro()
}

// ── Damage Block Functions ──
export function addDamageBlock(sourceType: 'op' | 'ref', sourceId: string) {
    if (!assertUnlocked()) return
    const trackIndex = 3
    const exists = _damageBlocks.some((d) => d.sourceId === sourceId && d.trackIndex === trackIndex)
    if (exists) return
    _damageBlocks = [
        ..._damageBlocks,
        { id: `d${Date.now()}`, trackIndex, sourceType, sourceId, skillHits: [], nonDirectEntries: [] }
    ]
}

export function removeDamageBlock(id: string) {
    if (!assertUnlocked()) return
    _damageBlocks = _damageBlocks.filter((d) => d.id !== id)
    save()
}

export function removeDamageBySource(sourceId: string, type: 'skillHits' | 'nonDirect' | 'all') {
    if (!assertUnlocked()) return
    _damageBlocks = _damageBlocks
        .map((d) => {
            if (d.sourceId !== sourceId || d.trackIndex !== 3) return d
            if (type === 'all') return { ...d, skillHits: [], nonDirectEntries: [] }
            if (type === 'skillHits') return { ...d, skillHits: [] }
            return { ...d, nonDirectEntries: [] }
        })
        .filter(
            (d) =>
                !(
                    d.sourceId === sourceId &&
                    d.trackIndex === 3 &&
                    d.skillHits.length === 0 &&
                    d.nonDirectEntries.length === 0
                )
        )
    save()
}

// ── Skill Picker Functions ──
export async function loadCharSkills(charName: string): Promise<SkillPickerGroup[]> {
    if (_skillCache[charName]) return _skillCache[charName]
    const info = await getCharacterInfo(charName)
    const groups = buildSkillGroups(info.skills)
    _skillCache[charName] = groups
    return groups
}

function buildSkillGroups(skills: SkillEntry[]): SkillPickerGroup[] {
    const groups: SkillPickerGroup[] = []
    for (const skill of skills) {
        const hits: { name: string; ratio: string; element: string }[] = []
        for (const [name, value, element] of skill.values) {
            if (value && (name.endsWith('伤害') || element)) hits.push({ name, ratio: value, element })
        }
        if (hits.length > 0) groups.push({ type: skill.type, hits })
    }
    return groups
}

async function loadEchoSkill(echoName: string): Promise<{ values: [string, string, string][] } | null> {
    if (_echoSkillCache[echoName]) return _echoSkillCache[echoName]
    try {
        const info = await getEchoInfo(echoName)
        _echoSkillCache[echoName] = info.skill
        return info.skill
    } catch {
        return null
    }
}

export async function openSkillPicker(blockId: string) {
    const op = _opBlocks.find((b) => b.id === blockId)
    if (!assertUnlocked()) return
    if (!op || op.trackIndex >= 3) return
    const dmg = _damageBlocks.find((d) => d.sourceId === blockId && d.trackIndex === 3)
    if (!dmg) return
    _skillPickerBlockId = dmg.id
    _skillPickerIsRef = false
    _skillPickerCharacter = _team[op.trackIndex]?.character ?? ''
    _skillPickerLoading = true
    _skillPickerGroups = []
    _skillPickerHitHits = {}
    _skillPickerSelected = new Set()
    for (const h of dmg.skillHits) {
        const base = `${h.character ?? _skillPickerCharacter}|${h.skillType}`
        let key: string
        if (h.skillType === '自定义') {
            const ch = _customSkillHits[h.character ?? _skillPickerCharacter]?.find((c) => c.name === h.hitName)
            key = ch ? `${base}|${ch.id}` : `${base}|${h.hitName}`
        } else {
            key = `${base}|${h.hitName}`
        }
        _skillPickerSelected.add(key)
        if (h.hits) _skillPickerHitHits[key] = h.hits
    }
    try {
        const groups = await loadCharSkills(_skillPickerCharacter)
        const echoName = _team[op.trackIndex]?.echoes?.[0]?.name ?? null
        if (echoName) {
            const cached = await loadEchoSkill(echoName)
            if (cached?.values?.length) {
                const echoHits = cached.values.map(([n, v, e]) => ({ name: n, ratio: v, element: e }))
                groups.push({ type: '声骸技能', hits: echoHits })
            }
        }
        _skillPickerGroups = appendCustomGroups(groups, _skillPickerCharacter)
    } catch {
        _skillPickerGroups = []
    } finally {
        _skillPickerLoading = false
    }
}

export function applySkillHits() {
    if (!_skillPickerBlockId) return
    const hits: SkillHit[] = []
    for (const sel of _skillPickerSelected) {
        const parts = sel.split('|')
        const character = parts[0]
        const skillType = parts[1]
        const hitName = parts.slice(2).join('|')
        const groups = _skillPickerIsRef ? _refSkillPickerCache[character] : _skillPickerGroups
        if (!groups) continue
        for (const g of groups) {
            if (g.type !== skillType) continue
            const hit = g.hits.find((h) => h.name === hitName)
            if (hit) {
                let displayName = hit.name
                let ratio = hit.ratio
                if (skillType === '自定义') {
                    const ch = _customSkillHits[character]?.find((c) => c.id === hitName)
                    if (ch) {
                        displayName = ch.name
                        const parts: string[] = []
                        if (ch.flatValue > 0) parts.push(ch.flatValue.toString())
                        if (ch.pctValue > 0) {
                            const suf =
                                ch.pctUnit === '攻击百分比'
                                    ? ''
                                    : ch.pctUnit === '生命百分比'
                                      ? '生命'
                                      : ch.pctUnit === '防御百分比'
                                        ? '防御'
                                        : ch.pctUnit
                            parts.push(ch.pctValue + '%' + suf)
                        }
                        ratio = parts.join('+') || '0'
                    }
                }
                const entry: SkillHit = {
                    character,
                    skillType,
                    hitName: displayName,
                    ratio,
                    element: hit.element
                }
                entry.hits = _skillPickerHitHits[`${character}|${skillType}|${hit.name}`] ?? 1
                hits.push(entry)
            }
        }
    }
    _damageBlocks = _damageBlocks
        .map((d) => (d.id === _skillPickerBlockId ? { ...d, skillHits: hits } : d))
        .filter((d) => !(d.id === _skillPickerBlockId && d.skillHits.length === 0 && d.nonDirectEntries.length === 0))
    _skillPickerBlockId = null
    _skillPickerIsRef = false
    save()
}

export async function openRefSkillPicker(blockId: string) {
    if (!assertUnlocked()) return
    const dmg = _damageBlocks.find((d) => d.sourceId === blockId && d.trackIndex === 3)
    if (!dmg) addDamageBlock('ref', blockId)
    const block = _damageBlocks.find((d) => d.sourceId === blockId && d.trackIndex === 3)
    if (!block) return
    _skillPickerBlockId = block.id
    _skillPickerIsRef = true
    _skillPickerSelected = new Set()
    _skillPickerHitHits = {}
    for (const h of block.skillHits) {
        const base = `${h.character}|${h.skillType}`
        let key: string
        if (h.skillType === '自定义') {
            const ch = _customSkillHits[h.character]?.find((c) => c.name === h.hitName)
            key = ch ? `${base}|${ch.id}` : `${base}|${h.hitName}`
        } else {
            key = `${base}|${h.hitName}`
        }
        _skillPickerSelected.add(key)
        if (h.hits) _skillPickerHitHits[key] = h.hits
    }
    _refSkillPickerCache = {}
    _skillPickerCharacter = _team[0]?.character ?? ''
    _skillPickerLoading = true
    try {
        const groups = await loadCharSkills(_skillPickerCharacter)
        await appendEchoSkillToRefCache(_skillPickerCharacter)
        _refSkillPickerCache[_skillPickerCharacter] = groups
        _skillPickerGroups = appendCustomGroups(groups, _skillPickerCharacter)
    } catch {
        _skillPickerGroups = []
    } finally {
        _skillPickerLoading = false
    }
}

function appendCustomGroups(groups: SkillPickerGroup[], charName: string): SkillPickerGroup[] {
    const customHits = _customSkillHits[charName] ?? []
    if (customHits.length === 0) return groups
    return [
        ...groups,
        {
            type: '自定义',
            hits: customHits.map((ch) => {
                const parts: string[] = []
                if (ch.flatValue > 0) parts.push(ch.flatValue.toString())
                if (ch.pctValue > 0) {
                    const suf =
                        ch.pctUnit === '攻击百分比'
                            ? ''
                            : ch.pctUnit === '生命百分比'
                              ? '生命'
                              : ch.pctUnit === '防御百分比'
                                ? '防御'
                                : ch.pctUnit
                    parts.push(ch.pctValue + '%' + suf)
                }
                return { name: ch.id, ratio: parts.join('+') || '0', element: ch.element }
            })
        }
    ]
}

export async function appendEchoSkillToRefCache(charName: string) {
    const idx = getTeamCharNames().indexOf(charName)
    if (idx < 0) return
    const echoName = _team[idx]?.echoes?.[0]?.name ?? null
    if (!echoName) return
    const cached = await loadEchoSkill(echoName)
    if (cached?.values?.length) {
        const echoHits = cached.values.map(([n, v, e]) => ({ name: n, ratio: v, element: e }))
        const existing = _refSkillPickerCache[charName] ?? []
        _refSkillPickerCache[charName] = [...existing, { type: '声骸技能', hits: echoHits }]
    }
}

export async function switchRefSkillPickerTab(charName: string) {
    _skillPickerCharacter = charName
    if (_refSkillPickerCache[charName]) {
        _skillPickerGroups = appendCustomGroups(_refSkillPickerCache[charName], charName)
        return
    }
    _skillPickerLoading = true
    try {
        const groups = await loadCharSkills(charName)
        await appendEchoSkillToRefCache(charName)
        _refSkillPickerCache[charName] = groups
        _skillPickerGroups = appendCustomGroups(groups, charName)
    } catch {
        _skillPickerGroups = []
    } finally {
        _skillPickerLoading = false
    }
}

// ── Non-Direct Picker Functions ──
export function openNonDirectPicker(sourceType: 'op' | 'ref', blockId: string) {
    if (!assertUnlocked()) return
    const dmg = _damageBlocks.find((d) => d.sourceId === blockId && d.trackIndex === 3)
    if (!dmg) addDamageBlock(sourceType, blockId)
    const block = _damageBlocks.find((d) => d.sourceId === blockId && d.trackIndex === 3)
    if (!block) return
    _nonDirectPickerBlockId = block.id
    _nonDirectPickerData = NON_DIRECT_CONFIGS.map((cfg) => {
        const existing = block.nonDirectEntries.find((e) => e.name === cfg.name)
        return { name: cfg.name, category: cfg.category, layers: cfg.category === '响应' ? 0 : (existing?.layers ?? 0) }
    })
    _nonDirectPickerSelected = new Set<string>([
        ...block.nonDirectEntries.filter((e) => e.category === '响应').map((e) => e.name),
        ...(block.nonDirectEntries.some((e) => e.name === '谐度破坏') ? ['谐度破坏'] : [])
    ])
    _nonDirectPickerResponders = Object.fromEntries(
        block.nonDirectEntries.filter((e) => e.category === '响应').map((e) => [e.name, e.responders ?? []])
    )
    const existingTune = block.nonDirectEntries.find((e) => e.name === '谐度破坏')
    const op = _opBlocks.find((b) => b.id === blockId)
    const sourceChar = op && op.trackIndex < 3 ? (_team[op.trackIndex]?.character ?? null) : null
    _nonDirectPickerTuneTrigger = existingTune?.responders?.[0] ?? sourceChar ?? null
    const burstEntry = block.nonDirectEntries.find((e) => e.name === '电磁爆发')
    _nonDirectPickerBurstLayers = burstEntry ? { burst: burstEntry.layers } : {}
}

export function applyNonDirectEntries() {
    if (!_nonDirectPickerBlockId) return
    const entries: NonDirectEntry[] = []
    for (const d of _nonDirectPickerData) {
        if (d.category === '响应') {
            if (_nonDirectPickerSelected.has(d.name)) {
                const entry: NonDirectEntry = { name: d.name, category: '响应', layers: 0 }
                entry.responders = _nonDirectPickerResponders[d.name] ?? []
                entries.push(entry)
            }
        } else if (d.name === '谐度破坏') {
            if (_nonDirectPickerSelected.has(d.name)) {
                const entry: NonDirectEntry = { name: d.name, category: '处决', layers: 0 }
                if (_nonDirectPickerTuneTrigger) {
                    entry.responders = [_nonDirectPickerTuneTrigger]
                }
                entries.push(entry)
            }
        } else if (d.layers > 0) {
            entries.push({ name: d.name, category: d.category as '处决' | '效应' | '响应', layers: d.layers })
        }
    }
    const burstLayers = _nonDirectPickerBurstLayers['burst'] ?? 0
    if (burstLayers > 0 && entries.some((e) => e.name === '电磁效应')) {
        entries.push({ name: '电磁爆发', category: '效应', layers: burstLayers })
    }
    _damageBlocks = _damageBlocks
        .map((d) => (d.id === _nonDirectPickerBlockId ? { ...d, nonDirectEntries: entries } : d))
        .filter(
            (d) => !(d.id === _nonDirectPickerBlockId && d.skillHits.length === 0 && d.nonDirectEntries.length === 0)
        )
    _nonDirectPickerBlockId = null
    save()
}

// ── Damage List ──
function buildDamageList() {
    return _damageBlocks
        .flatMap((d) => {
            if (d.skillHits.length === 0 && d.nonDirectEntries.length === 0) return []
            const time =
                d.sourceType === 'ref'
                    ? (_refLines.find((r) => r.id === d.sourceId)?.pos ?? 0)
                    : (_opBlocks.find((b) => b.id === d.sourceId)?.pos ?? 0)
            const op = _opBlocks.find((b) => b.id === d.sourceId)
            const rl = d.sourceType === 'ref' ? _refLines.find((r) => r.id === d.sourceId) : null
            const x =
                d.sourceType === 'ref' ? (rl ? vx(rl.id, rl.pos) : 0) : op ? op.pos - (_blockWidths[op.id] ?? 0) / 2 : 0
            const sourceChar =
                d.sourceType === 'ref'
                    ? '无'
                    : op && op.trackIndex < 3
                      ? (_team[op.trackIndex]?.character ?? '无')
                      : '无'
            const entries: {
                character: string
                name: string
                value: string
                baseType: string
                time: number
                x: number
                element: string
            }[] = []
            for (const h of d.skillHits) {
                const echoName =
                    h.skillType === '声骸技能'
                        ? (_team.find((s) => s.character === h.character)?.echoes?.[0]?.name ?? '?')
                        : null
                const character =
                    d.sourceType === 'ref' ? h.character || '无' : h.skillType === '声骸技能' ? h.character : sourceChar
                const name =
                    h.skillType === '声骸技能' && echoName
                        ? echoName + '·' + h.hitName.replace('伤害', '') + '(' + h.skillType + ')'
                        : h.hitName.replace('伤害', '') + '(' + h.skillType + ')'
                const comps = parseValueString(h.ratio)
                const valueParts = comps.map((c) => {
                    if (c.flatValue !== undefined) return c.flatValue.toString()
                    return c.ratioNum + '%' + (c.mult && c.mult > 1 ? '*' + c.mult : '')
                })
                const value = valueParts.join('+') + ((h.hits ?? 0) > 1 ? '*' + h.hits : '')
                const baseTypes = [...new Set(comps.map((c) => c.baseType || '固定'))]
                const baseType = baseTypes.join('+')
                entries.push({ character, name, value, baseType, time, x, element: h.element })
            }
            const ndEntries = d.nonDirectEntries
            const effectNDs = ndEntries.filter((nd) => nd.category === '效应')
            const otherNDs = ndEntries.filter((nd) => nd.category !== '效应')

            const dianci = effectNDs.find((nd) => nd.name === '电磁效应')
            const baofa = effectNDs.find((nd) => nd.name === '电磁爆发')
            if (dianci || baofa) {
                const layers = dianci?.layers ?? 0
                const burstLayers = baofa?.layers ?? 0
                const mult = getEffectMultiplier('电磁效应', layers)
                const burstMult = getEffectBurstMultiplier('电磁效应', burstLayers)
                const total = mult + burstMult
                entries.push({
                    character: '无',
                    name: `电磁效应${layers}层+爆发${burstLayers}层`,
                    value:
                        burstLayers > 0
                            ? (mult * 100).toFixed(2) + '%+' + (burstMult * 100).toFixed(2) + '%'
                            : (mult * 100).toFixed(2) + '%',
                    baseType: '效应系数',
                    time,
                    x,
                    element: '导电'
                })
            }
            for (const nd of effectNDs) {
                if (nd.name === '电磁效应' || nd.name === '电磁爆发') continue
                const mult = getEffectMultiplier(nd.name, nd.layers)
                entries.push({
                    character: '无',
                    name: nd.name + nd.layers + '层',
                    value: (mult * 100).toFixed(2) + '%',
                    baseType: '效应系数',
                    time,
                    x,
                    element: NON_DIRECT_ELEMENT[nd.name] ?? ''
                })
            }
            for (const nd of otherNDs) {
                if (nd.category === '处决') {
                    const tuneChar = nd.responders?.[0] ?? sourceChar
                    entries.push({
                        character: tuneChar,
                        name: '谐度破坏',
                        value: '1600%',
                        baseType: '偏谐系数',
                        time,
                        x,
                        element: '物理'
                    })
                } else if (nd.category === '响应') {
                    if (nd.responders?.length) {
                        for (const r of nd.responders) {
                            let respValue = '—'
                            let respBase = ''
                            const respGroups = r !== '无' ? _skillCache[r] : null
                            if (respGroups) {
                                for (const group of respGroups) {
                                    const match = group.hits.find(
                                        (h) =>
                                            (h.name.includes('震谐') || h.name.includes('骇破')) &&
                                            h.name.includes('响应')
                                    )
                                    if (match) {
                                        const comps = parseValueString(match.ratio)
                                        const cleanParts = comps.map((c) => {
                                            if (c.flatValue !== undefined) return c.flatValue.toString()
                                            return c.ratioNum + '%' + (c.mult && c.mult > 1 ? '*' + c.mult : '')
                                        })
                                        respValue = cleanParts.join('+')
                                        respBase = comps.length > 0 ? (comps[0].baseType ?? '偏谐系数') : '偏谐系数'
                                        break
                                    }
                                }
                            }
                            if (!respBase) respBase = '偏谐系数'
                            entries.push({
                                character: r,
                                name: nd.name,
                                value: respValue,
                                baseType: respBase,
                                time,
                                x,
                                element: _charElementMap[r] ?? ''
                            })
                        }
                    } else {
                        entries.push({ character: '无', name: nd.name, value: '—', baseType: '', time, x, element: '' })
                    }
                }
            }
            return entries
        })
        .sort((a, b) => a.x - b.x || a.time - b.time)
}

let _damageList = $derived(buildDamageList())

export function getDamageList() {
    return _damageList
}
