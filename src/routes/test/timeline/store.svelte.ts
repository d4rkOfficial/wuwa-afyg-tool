import {
    getCharacterList,
    getCharacterIcons,
    getElementIcons,
    getUiBtnIcons as apiGetUiBtnIcons,
    getCharacterInfo,
    getEchoList as apiGetEchoList,
    getEchoIcons,
    getEchoSetList as apiGetEchoSetList,
    getEchoSetIcons,
    getEchoInfo
} from '$lib/data/api'
import type { SkillEntry } from '$lib/api/types'
import type { RefLine, OpBlock, SkillHit, SkillPickerGroup, NonDirectEntry, DamageBlock } from './types'
import {
    ELEMENT_ORDER,
    ELEMENT_COLORS,
    NON_DIRECT_CONFIGS,
    NON_DIRECT_ELEMENT,
    PPS,
    SIDE_PAD,
    RIGHT_EXTRA,
    ADD_OFFSET,
    MIN_GAP,
    SNAP_PX,
    MIN_TIME,
    MAX_TIME,
    TRACK_COLORS,
    BUTTON_KEY_ORDER
} from './consts'
import { sortChars, isBoundary, canDelete, hideImg } from './utils'

// ── Character Select ──
let _showCharSelect = $state(true)
let _pickCharacters = $state<any[]>([])
let _charIconMap = $state<Record<string, string>>({})
let _elementIconMap = $state<Record<string, string>>({})
let _selectedCharNames = $state<string[]>(['散华', '维里奈', '秧秧'])
let _selection = $state<string[]>([])
let _pickLoading = $state(true)
let _pickSearch = $state('')
let _pickNavEl: HTMLElement | undefined = $state()
export function getPickNavEl() {
    return _pickNavEl
}
export function setPickNavEl(v: HTMLElement | undefined) {
    _pickNavEl = v
}

// ── Timeline State ──
let _refLines = $state<RefLine[]>([
    { id: 'left', time: 0 },
    { id: 'c1', time: 12.5 },
    { id: 'right', time: 150 }
])
let _editingId = $state<string | null>(null)
let _editValue = $state('')
let _contextMenu = $state<{ x: number; y: number; id: string } | null>(null)
let _draggingId = $state<string | null>(null)
let _dragVisualPositions = $state<Record<string, number>>({})
let _opBlocks = $state<OpBlock[]>([])
let _trackMenu = $state<{ x: number; y: number; trackIndex: number; time: number } | null>(null)
let _editingBlockId = $state<string | null>(null)
let _editingBlockDesc = $state('')
let _dragBlockId = $state<string | null>(null)
let _dragBlockStartTime = $state(0)
let _blockWidths = $state<Record<string, number>>({})
let _blockMenu = $state<{ x: number; y: number; blockId: string } | null>(null)
let _damageBlocks = $state<DamageBlock[]>([])
let _uiBtnIcons = $state<[string, string][]>([])
let _showDamageList = $state(false)

// ── Skill Picker State ──
let _skillPickerBlockId = $state<string | null>(null)
let _skillPickerLoading = $state(false)
let _skillPickerCharacter = $state('')
let _skillPickerGroups = $state<SkillPickerGroup[]>([])
let _skillPickerSelected = $state<Set<string>>(new Set())
let _skillPickerIsRef = $state(false)
let _refSkillPickerCache = $state<Record<string, SkillPickerGroup[]>>({})
let _skillPickerHitHits = $state<Record<string, number>>({})

// ── Non-Direct Picker State ──
let _nonDirectPickerBlockId = $state<string | null>(null)
let _nonDirectPickerData = $state<{ name: string; category: string; layers: number }[]>([])
let _nonDirectPickerSelected = $state<Set<string>>(new Set())
let _nonDirectPickerResponders = $state<Record<string, string[]>>({})

// ── Echo Select State ──
let _echoList = $state<any[]>([])
let _echoIconMap = $state<Record<string, string>>({})
let _echoSetList = $state<any[]>([])
let _echoSetIconMap = $state<Record<string, string>>({})
let _selectedCharEchos = $state<(string | null)[]>([null, null, null])
let _showEchoSelect = $state(false)
let _echoSelectCharIndex = $state<number | null>(null)
let _echoSkillCache = $state<Record<string, { values: [string, string, string][] }>>({})
let _echoLoading = $state(false)
let _echoSelectedSet = $state<string | null>(null)

// ── Exported Getters for State ──
export function getShowCharSelect() {
    return _showCharSelect
}
export function setShowCharSelect(v: boolean) {
    _showCharSelect = v
}
export function getPickCharacters() {
    return _pickCharacters
}
export function getCharIconMap() {
    return _charIconMap
}
export function getElementIconMap() {
    return _elementIconMap
}
export function getSelectedCharNames() {
    return _selectedCharNames
}
export function getSelection() {
    return _selection
}
export function getPickLoading() {
    return _pickLoading
}
export function getPickSearch() {
    return _pickSearch
}
export function setPickSearch(v: string) {
    _pickSearch = v
}

export function getRefLines() {
    return _refLines
}
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
export function getOpBlocks() {
    return _opBlocks
}
export function getTrackMenu() {
    return _trackMenu
}
export function setTrackMenu(v: { x: number; y: number; trackIndex: number; time: number } | null) {
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
export function setDragBlockId(v: string | null) {
    _dragBlockId = v
}
export function getDragBlockStartTime() {
    return _dragBlockStartTime
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
export function getDamageBlocks() {
    return _damageBlocks
}
export function getUiBtnIcons() {
    return _uiBtnIcons
}
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

export function getEchoList() {
    return _echoList
}
export function getEchoIconMap() {
    return _echoIconMap
}
export function getEchoSetList() {
    return _echoSetList
}
export function getEchoSetIconMap() {
    return _echoSetIconMap
}
export function getSelectedCharEchos() {
    return _selectedCharEchos
}
export function getShowEchoSelect() {
    return _showEchoSelect
}
export function setShowEchoSelect(v: boolean) {
    _showEchoSelect = v
}
export function getEchoSelectCharIndex() {
    return _echoSelectCharIndex
}
export function setEchoSelectCharIndex(v: number | null) {
    _echoSelectCharIndex = v
}
export function getEchoSkillCache() {
    return _echoSkillCache
}
export function getEchoLoading() {
    return _echoLoading
}
export function getEchoSelectedSet() {
    return _echoSelectedSet
}
export function setEchoSelectedSet(v: string | null) {
    _echoSelectedSet = v
}

// ── Derived Values ──
const _charElementMap = $derived(Object.fromEntries(_pickCharacters.map((c: any) => [c.name, c.element])))
export function getCharElementMap() {
    return _charElementMap
}

export const elementColor = (name: string) => {
    const el = _charElementMap[name]
    return el ? ((ELEMENT_COLORS as Record<string, string>)[el] ?? '#71717a') : '#71717a'
}

export const btnIconUrl = (key: string) => _uiBtnIcons.find(([k]) => k === key)?.[1] ?? ''

const _imgUrl = (name: string) => _charIconMap[name] ?? ''
export function imgUrl(name: string) {
    return _imgUrl(name)
}

const _elementGroups = $derived(
    ELEMENT_ORDER.map((label) => ({
        label,
        items: _pickCharacters
            .filter((c: any) => c.element === label && c.name.toLowerCase().includes(_pickSearch.toLowerCase()))
            .sort(sortChars as any),
        icon: _elementIconMap[label] ?? ''
    })).filter((g) => g.items.length > 0)
)
export function getElementGroups() {
    return _elementGroups
}

const _TRACKS = $derived([..._selectedCharNames, '伤害'])
export function getTRACKS() {
    return _TRACKS
}

const _vx = (id: string, time: number) => _dragVisualPositions[id] ?? SIDE_PAD + (time - MIN_TIME) * PPS
export function vx(id: string, time: number) {
    return _vx(id, time)
}

const _timeToX = (t: number) => SIDE_PAD + (t - MIN_TIME) * PPS
export function timeToX(t: number) {
    return _timeToX(t)
}

const _segments = $derived(
    _refLines.slice(0, -1).map((rl, i) => ({
        from: rl,
        to: _refLines[i + 1],
        width: _vx(_refLines[i + 1].id, _refLines[i + 1].time) - _vx(rl.id, rl.time)
    }))
)
export function getSegments() {
    return _segments
}

const _tableWidth = $derived(
    80 + _vx(_refLines[_refLines.length - 1].id, _refLines[_refLines.length - 1].time) + RIGHT_EXTRA
)
export function getTableWidth() {
    return _tableWidth
}

const _skillPickerOrder = $derived(Array.from(_skillPickerSelected))
export function getSkillPickerOrder() {
    return _skillPickerOrder
}

const _echoSetGroups = $derived(
    _echoSetList
        .map((set: any) => ({
            label: set.name,
            pieces: set.pieces,
            icon: _echoSetIconMap[set.name] ?? '',
            items: _echoList
                .filter((e: any) => e.sets.includes(set.name))
                .sort((a: any, b: any) => b.cost - a.cost || a.name.localeCompare(b.name))
        }))
        .filter((g) => g.items.length > 0)
        .sort((a, b) => b.items.length - a.items.length)
)
export function getEchoSetGroups() {
    return _echoSetGroups
}

const _echoInfoMap = $derived<Record<string, { cost: number; sets: string[] }>>(
    Object.fromEntries(_echoList.map((e: any) => [e.name, { cost: e.cost, sets: e.sets }]))
)
export function getEchoInfoMap() {
    return _echoInfoMap
}

const _echoNameForChar = (charName: string) => {
    const idx = _selectedCharNames.indexOf(charName)
    return idx >= 0 ? _selectedCharEchos[idx] : null
}
export function echoNameForChar(charName: string) {
    return _echoNameForChar(charName)
}

const _damageList = $derived(
    _damageBlocks
        .flatMap((d) => {
            if (d.skillHits.length === 0 && d.nonDirectEntries.length === 0) return []
            const time =
                d.sourceType === 'ref'
                    ? (_refLines.find((r) => r.id === d.sourceId)?.time ?? 0)
                    : (_opBlocks.find((b) => b.id === d.sourceId)?.time ?? 0)
            const op = _opBlocks.find((b) => b.id === d.sourceId)
            const rl = d.sourceType === 'ref' ? _refLines.find((r) => r.id === d.sourceId) : null
            const x =
                d.sourceType === 'ref'
                    ? rl
                        ? _vx(rl.id, rl.time)
                        : 0
                    : op
                      ? _timeToX(op.time) - (_blockWidths[op.id] ?? 0) / 2
                      : 0
            const sourceChar =
                d.sourceType === 'ref' ? '无' : op && op.trackIndex < 3 ? _selectedCharNames[op.trackIndex] : '无'
            const entries: { character: string; name: string; value: string; time: number; x: number }[] = []
            for (const h of d.skillHits) {
                const echoName = h.skillType === '声骸技能' ? (_echoNameForChar(h.character) ?? '?') : null
                const character =
                    d.sourceType === 'ref' ? h.character || '无' : h.skillType === '声骸技能' ? h.character : sourceChar
                const name = h.skillType === '声骸技能' ? echoName + '·' + h.hitName.replace('伤害', '') : h.hitName
                const value = h.ratio + ((h.hits ?? 0) >= 1 ? ' ×' + h.hits : '')
                entries.push({ character, name, value, time, x })
            }
            for (const nd of d.nonDirectEntries) {
                if (nd.category === '处决') {
                    entries.push({ character: sourceChar, name: '谐度破坏', value: '—', time, x })
                } else if (nd.category === '响应') {
                    if (nd.responders?.length) {
                        for (const r of nd.responders) {
                            entries.push({ character: r, name: nd.name, value: '—', time, x })
                        }
                    } else {
                        entries.push({ character: '无', name: nd.name, value: '—', time, x })
                    }
                } else if (nd.category === '效应') {
                    entries.push({ character: sourceChar, name: nd.name, value: nd.layers + '层结算', time, x })
                }
            }
            return entries
        })
        .sort((a, b) => a.x - b.x || a.time - b.time)
)
export function getDamageList() {
    return _damageList
}

const _damageBlockLeft = (d: DamageBlock) => {
    if (d.sourceType === 'ref') {
        const rl = _refLines.find((r) => r.id === d.sourceId)
        return rl ? _vx(rl.id, rl.time) : 0
    }
    const op = _opBlocks.find((b) => b.id === d.sourceId)
    if (!op) return 0
    return _timeToX(op.time) - (_blockWidths[op.id] ?? 0) / 2
}
export function damageBlockLeft(d: DamageBlock) {
    return _damageBlockLeft(d)
}

// ── Effects ──
// These are set up in +page.svelte via $effect since DOM refs are page-local
let _editInput: HTMLInputElement | undefined
let _blockEditInput: HTMLInputElement | undefined
export function setEditInput(v: HTMLInputElement | undefined) {
    _editInput = v
}
export function setBlockEditInput(v: HTMLInputElement | undefined) {
    _blockEditInput = v
}

export async function loadCharacters() {
    _pickLoading = true
    const [list, iconMap, elMap, btnIcons] = await Promise.all([
        getCharacterList(),
        getCharacterIcons(),
        getElementIcons(),
        apiGetUiBtnIcons()
    ])
    _pickCharacters = list
    _charIconMap = iconMap
    _elementIconMap = elMap
    _uiBtnIcons = (Object.entries(btnIcons) as [string, string][]).sort(([a], [b]) => {
        const order = BUTTON_KEY_ORDER as readonly string[]
        return order.indexOf(a) - order.indexOf(b)
    })
    _pickLoading = false
}

// ── Character Select Functions ──
export function togglePick(name: string) {
    if (_selection.includes(name)) {
        _selection = _selection.filter((n) => n !== name)
    } else if (_selection.length < 3) {
        _selection = [..._selection, name]
    }
}

export function isSelected(name: string) {
    return _selection.includes(name)
}

export function confirmPick() {
    _selectedCharNames =
        _selection.length === 3
            ? _selection
            : [..._selection, ..._selectedCharNames.filter((n) => !_selection.includes(n))].slice(0, 3)
    _showCharSelect = false
    loadEchoData()
}

export async function loadEchoData() {
    _echoLoading = true
    try {
        const [list, icons, setList, setIcons] = await Promise.all([
            apiGetEchoList(),
            getEchoIcons(),
            apiGetEchoSetList(),
            getEchoSetIcons()
        ])
        _echoList = list
        _echoIconMap = icons
        _echoSetList = setList
        _echoSetIconMap = setIcons
    } catch {
        _echoList = []
        _echoIconMap = {}
        _echoSetList = []
        _echoSetIconMap = {}
    } finally {
        _echoLoading = false
        _echoSelectedSet = _echoSetList[0]?.name ?? null
        _showEchoSelect = true
    }
}

export const scrollTo = (label: string) => {
    document.getElementById(`p-${label}`)?.scrollIntoView({ behavior: 'smooth' })
    document.querySelector(`[data-sidebar="${label}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

// ── Ref Line Functions ──
export function addAfter(id: string) {
    const idx = _refLines.findIndex((r) => r.id === id)
    if (idx < 0 || idx >= _refLines.length - 1) return
    const parentX = _vx(id, _refLines[idx].time)
    const nextX = _vx(_refLines[idx + 1].id, _refLines[idx + 1].time)
    if (nextX - parentX < MIN_GAP * 2) return
    const nid = `c${Date.now()}`
    _dragVisualPositions = { ..._dragVisualPositions, [nid]: Math.min(parentX + ADD_OFFSET, (parentX + nextX) / 2) }
    _refLines = [..._refLines.slice(0, idx + 1), { id: nid, time: _refLines[idx].time }, ..._refLines.slice(idx + 1)]
    startEdit(nid, _refLines[idx].time)
}

export function addBefore(id: string) {
    const idx = _refLines.findIndex((r) => r.id === id)
    if (idx <= 0) return
    const prevX = _vx(_refLines[idx - 1].id, _refLines[idx - 1].time)
    const thisX = _vx(id, _refLines[idx].time)
    if (thisX - prevX < MIN_GAP * 2) return
    const nid = `c${Date.now()}`
    _dragVisualPositions = { ..._dragVisualPositions, [nid]: Math.max(thisX - ADD_OFFSET, (prevX + thisX) / 2) }
    _refLines = [..._refLines.slice(0, idx), { id: nid, time: _refLines[idx].time }, ..._refLines.slice(idx)]
    startEdit(nid, _refLines[idx].time)
}

export function removeLine(id: string) {
    if (!canDelete(id)) return
    _refLines = _refLines.filter((r) => r.id !== id)
    _damageBlocks = _damageBlocks.filter((d) => !(d.sourceId === id && d.sourceType === 'ref'))
    const { [id]: _, ...rest } = _dragVisualPositions
    _dragVisualPositions = rest
    _contextMenu = null
}

export function startEdit(id: string, time: number) {
    _editingId = id
    _editValue = time.toFixed(2)
}

export function confirmEdit() {
    if (!_editingId || isBoundary(_editingId)) return
    const v = parseFloat(_editValue)
    if (!isNaN(v) && v > 0) {
        const idx = _refLines.findIndex((r) => r.id === _editingId)
        if (idx > 0 && v <= _refLines[idx - 1].time) return
        if (idx < _refLines.length - 1 && v >= _refLines[idx + 1].time) return
        const currentX = _vx(_editingId, _refLines[idx].time)
        _dragVisualPositions = { ..._dragVisualPositions, [_editingId]: currentX }
        _refLines = _refLines.map((r) => (r.id === _editingId ? { ...r, time: v } : r))
    }
    _editingId = null
}

export function canAddBefore(id: string) {
    const idx = _refLines.findIndex((r) => r.id === id)
    if (idx <= 0) return false
    const prevX = _vx(_refLines[idx - 1].id, _refLines[idx - 1].time)
    const thisX = _vx(id, _refLines[idx].time)
    return thisX - prevX >= MIN_GAP * 2
}

export function canAddAfter(id: string) {
    const idx = _refLines.findIndex((r) => r.id === id)
    if (idx < 0 || idx >= _refLines.length - 1) return false
    const parentX = _vx(id, _refLines[idx].time)
    const nextX = _vx(_refLines[idx + 1].id, _refLines[idx + 1].time)
    return nextX - parentX >= MIN_GAP * 2
}

export function handleContextmenu(e: MouseEvent, id: string) {
    e.preventDefault()
    _contextMenu = { x: e.clientX, y: e.clientY, id }
}

export function handleWindowMousedown(e: MouseEvent) {
    const target = e.target as HTMLElement
    if (_contextMenu && !target.closest('[data-context-menu]')) _contextMenu = null
    if (_trackMenu && !target.closest('[data-track-menu]')) _trackMenu = null
    if (_blockMenu && !target.closest('[data-block-menu]')) _blockMenu = null
}

export function handleTrackContextmenu(e: MouseEvent, trackIndex: number) {
    if (trackIndex >= 3) return
    // timelineEl is page-local; this needs to be passed differently
    // We'll handle timelineEl via page
    _trackMenu = { x: e.clientX, y: e.clientY, trackIndex, time: 0 }
}

// ── Op Block Functions ──
export function addOpBlock(trackIndex: number, time: number, key: string) {
    _opBlocks = [..._opBlocks, { id: `b${Date.now()}`, trackIndex, time, key, desc: '', intro: false }]
    _trackMenu = null
    enforceIntro()
}

export function startBlockDrag(e: MouseEvent, blockId: string) {
    if (e.button !== 0) return
    _dragBlockId = blockId
    _dragBlockStartTime = _opBlocks.find((b) => b.id === blockId)?.time ?? 0
}

export function onBlockDrag(rawX: number) {
    if (!_dragBlockId) return
    const idx = _opBlocks.findIndex((b) => b.id === _dragBlockId)
    if (idx < 0) return
    const t = snapBlockX(rawX, _opBlocks[idx].trackIndex, _dragBlockId, _blockWidths[_dragBlockId] ?? 0)
    _opBlocks = _opBlocks.map((b) => (b.id === _dragBlockId ? { ...b, time: Math.max(0, Math.min(MAX_TIME, t)) } : b))
}

export function stopBlockDrag() {
    if (!_dragBlockId) {
        _dragBlockId = null
        return
    }
    const idx = _opBlocks.findIndex((b) => b.id === _dragBlockId)
    if (idx < 0) {
        _dragBlockId = null
        return
    }
    const dragged = _opBlocks[idx]
    if (Math.abs(dragged.time - _dragBlockStartTime) > 0.01) {
        const dw = _blockWidths[_dragBlockId] ?? 0
        const dx = _timeToX(dragged.time)
        const dLeft = dx - dw / 2
        for (const b of _opBlocks) {
            if (b.id === _dragBlockId || b.trackIndex !== dragged.trackIndex) continue
            const bw = _blockWidths[b.id] ?? 0
            const bx = _timeToX(b.time)
            const bLeft = bx - bw / 2
            const bRight = bx + bw / 2
            if (dragged.time >= b.time && dLeft > bLeft + SNAP_PX && dLeft < bRight - SNAP_PX) {
                _opBlocks = _opBlocks.map((ob) =>
                    ob.id === _dragBlockId
                        ? { ...ob, time: Math.max(0, Math.min(MAX_TIME, (bRight + dw / 2 - SIDE_PAD) / PPS)) }
                        : ob
                )
                break
            }
        }
        reflowTrack(dragged.trackIndex)
    }
    _dragBlockId = null
}

export function handleBlockContextmenu(e: MouseEvent, blockId: string) {
    e.preventDefault()
    e.stopPropagation()
    _blockMenu = { x: e.clientX, y: e.clientY, blockId }
}

export function handleBlockDblclick(blockId: string) {
    const block = _opBlocks.find((b) => b.id === blockId)
    if (!block) return
    _editingBlockId = blockId
    _editingBlockDesc = block.desc
}

export function removeBlock(blockId: string) {
    _opBlocks = _opBlocks.filter((b) => b.id !== blockId)
    _damageBlocks = _damageBlocks.filter((d) => !(d.sourceId === blockId && d.sourceType === 'op'))
    _blockMenu = null
    enforceIntro()
}

export function canSetIntro(blockId: string) {
    const block = _opBlocks.find((b) => b.id === blockId)
    if (!block || block.intro) return false
    if (block.trackIndex >= 3) return false
    const sorted = _opBlocks.filter((b) => b.trackIndex < 3).sort((a, b) => a.time - b.time)
    const idx = sorted.findIndex((b) => b.id === blockId)
    if (idx <= 0) return true
    const prev = sorted[idx - 1]
    return prev.trackIndex !== block.trackIndex
}

export function toggleIntro(blockId: string) {
    const block = _opBlocks.find((b) => b.id === blockId)
    if (!block) return
    if (block.intro) {
        _opBlocks = _opBlocks.map((b) => (b.id === blockId ? { ...b, intro: false } : b))
    } else if (canSetIntro(blockId)) {
        _opBlocks = _opBlocks.map((b) => (b.id === blockId ? { ...b, intro: true } : b))
    }
}

export function enforceIntro() {
    const sorted = _opBlocks.filter((b) => b.trackIndex < 3).sort((a, b) => a.time - b.time)
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

// ── Damage Block Functions ──
export function addDamageBlock(sourceType: 'op' | 'ref', sourceId: string) {
    const trackIndex = 3
    const exists = _damageBlocks.some((d) => d.sourceId === sourceId && d.trackIndex === trackIndex)
    if (exists) return
    _damageBlocks = [
        ..._damageBlocks,
        { id: `d${Date.now()}`, trackIndex, sourceType, sourceId, skillHits: [], nonDirectEntries: [] }
    ]
}

export function removeDamageBlock(id: string) {
    _damageBlocks = _damageBlocks.filter((d) => d.id !== id)
}

export function removeDamageBySource(sourceId: string, type: 'skillHits' | 'nonDirect' | 'all') {
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
}

// ── Skill Picker Functions ──
export function buildSkillGroups(skills: SkillEntry[]): SkillPickerGroup[] {
    const groups: SkillPickerGroup[] = []
    for (const skill of skills) {
        const hits: { name: string; ratio: string; element: string }[] = []
        for (const [name, value, element] of skill.values) {
            if (value && name.endsWith('伤害')) hits.push({ name, ratio: value, element })
        }
        if (hits.length > 0) groups.push({ type: skill.type, hits })
    }
    return groups
}

export async function openSkillPicker(blockId: string) {
    const op = _opBlocks.find((b) => b.id === blockId)
    if (!op || op.trackIndex >= 3) return
    const dmg = _damageBlocks.find((d) => d.sourceId === blockId && d.trackIndex === 3)
    if (!dmg) return
    _skillPickerBlockId = dmg.id
    _skillPickerIsRef = false
    _skillPickerCharacter = _selectedCharNames[op.trackIndex]
    _skillPickerLoading = true
    _skillPickerGroups = []
    _skillPickerHitHits = {}
    _skillPickerSelected = new Set(
        dmg.skillHits.map((h) => `${h.character ?? _selectedCharNames[op.trackIndex]}|${h.skillType}|${h.hitName}`)
    )
    for (const sel of dmg.skillHits) {
        if (sel.hits && sel.skillType === '声骸技能') {
            _skillPickerHitHits[`${sel.character}|${sel.skillType}|${sel.hitName}`] = sel.hits
        }
    }
    try {
        const info = await getCharacterInfo(_skillPickerCharacter)
        _skillPickerGroups = buildSkillGroups(info.skills)
        const echoName = _selectedCharEchos[op.trackIndex]
        if (echoName) {
            if (!_echoSkillCache[echoName]) {
                const echoInfo = await getEchoInfo(echoName)
                _echoSkillCache[echoName] = echoInfo.skill
            }
            const cached = _echoSkillCache[echoName]
            if (cached?.values?.length) {
                const echoHits = cached.values.map(([n, v, e]) => ({ name: n, ratio: v, element: e }))
                _skillPickerGroups = [..._skillPickerGroups, { type: '声骸技能', hits: echoHits }]
            }
        }
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
                const entry: SkillHit = {
                    character,
                    skillType,
                    hitName: hit.name,
                    ratio: hit.ratio,
                    element: hit.element
                }
                if (skillType === '声骸技能') {
                    entry.hits = _skillPickerHitHits[`${character}|${skillType}|${hit.name}`] ?? 1
                }
                hits.push(entry)
            }
        }
    }
    _damageBlocks = _damageBlocks
        .map((d) => (d.id === _skillPickerBlockId ? { ...d, skillHits: hits } : d))
        .filter((d) => !(d.id === _skillPickerBlockId && d.skillHits.length === 0 && d.nonDirectEntries.length === 0))
    _skillPickerBlockId = null
    _skillPickerIsRef = false
}

export async function openRefSkillPicker(blockId: string) {
    const dmg = _damageBlocks.find((d) => d.sourceId === blockId && d.trackIndex === 3)
    if (!dmg) addDamageBlock('ref', blockId)
    const block = _damageBlocks.find((d) => d.sourceId === blockId && d.trackIndex === 3)
    if (!block) return
    _skillPickerBlockId = block.id
    _skillPickerIsRef = true
    _skillPickerSelected = new Set(block.skillHits.map((h) => `${h.character}|${h.skillType}|${h.hitName}`))
    _skillPickerHitHits = {}
    for (const sel of block.skillHits) {
        if (sel.hits && sel.skillType === '声骸技能') {
            _skillPickerHitHits[`${sel.character}|${sel.skillType}|${sel.hitName}`] = sel.hits
        }
    }
    _refSkillPickerCache = {}
    _skillPickerCharacter = _selectedCharNames[0]
    _skillPickerLoading = true
    try {
        const info = await getCharacterInfo(_skillPickerCharacter)
        _refSkillPickerCache[_skillPickerCharacter] = buildSkillGroups(info.skills)
        await appendEchoSkillToRefCache(_skillPickerCharacter)
        _skillPickerGroups = _refSkillPickerCache[_skillPickerCharacter]
    } catch {
        _skillPickerGroups = []
    } finally {
        _skillPickerLoading = false
    }
}

export async function appendEchoSkillToRefCache(charName: string) {
    const idx = _selectedCharNames.indexOf(charName)
    if (idx < 0) return
    const echoName = _selectedCharEchos[idx]
    if (!echoName) return
    if (!_echoSkillCache[echoName]) {
        const echoInfo = await getEchoInfo(echoName)
        _echoSkillCache[echoName] = echoInfo.skill
    }
    const cached = _echoSkillCache[echoName]
    if (cached?.values?.length) {
        const echoHits = cached.values.map(([n, v, e]) => ({ name: n, ratio: v, element: e }))
        const existing = _refSkillPickerCache[charName] ?? []
        _refSkillPickerCache[charName] = [...existing, { type: '声骸技能', hits: echoHits }]
    }
}

export async function switchRefSkillPickerTab(charName: string) {
    _skillPickerCharacter = charName
    if (_refSkillPickerCache[charName]) {
        _skillPickerGroups = _refSkillPickerCache[charName]
        return
    }
    _skillPickerLoading = true
    try {
        const info = await getCharacterInfo(charName)
        _refSkillPickerCache[charName] = buildSkillGroups(info.skills)
        await appendEchoSkillToRefCache(charName)
        _skillPickerGroups = _refSkillPickerCache[charName]
    } catch {
        _skillPickerGroups = []
    } finally {
        _skillPickerLoading = false
    }
}

// ── Non-Direct Picker Functions ──
export function openNonDirectPicker(sourceType: 'op' | 'ref', blockId: string) {
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
                entries.push({ name: d.name, category: '处决', layers: 0 })
            }
        } else if (d.layers > 0) {
            entries.push({ name: d.name, category: d.category as '处决' | '效应' | '响应', layers: d.layers })
        }
    }
    _damageBlocks = _damageBlocks
        .map((d) => (d.id === _nonDirectPickerBlockId ? { ...d, nonDirectEntries: entries } : d))
        .filter(
            (d) => !(d.id === _nonDirectPickerBlockId && d.skillHits.length === 0 && d.nonDirectEntries.length === 0)
        )
    _nonDirectPickerBlockId = null
}

// ── Snap/Reflow Functions ──
export function snapBlockX(centerX: number, trackIndex: number, excludeId: string, width: number) {
    const left = centerX - width / 2
    const right = centerX + width / 2
    for (const b of _opBlocks) {
        if (b.id === excludeId) continue
        const bw = _blockWidths[b.id] ?? 0
        const bx = _timeToX(b.time)
        const bLeft = bx - bw / 2
        const bRight = bx + bw / 2
        if (Math.abs(left - bRight) < SNAP_PX) return (bRight + width / 2 - SIDE_PAD) / PPS
        if (Math.abs(right - bLeft) < SNAP_PX) return (bLeft - width / 2 - SIDE_PAD) / PPS
        if (centerX > bx) {
            const inL = bLeft + 18.6
            const inR = bRight - 18.6
            if (Math.abs(left - inL) < SNAP_PX) return (inL + width / 2 - SIDE_PAD) / PPS
            if (Math.abs(left - inR) < SNAP_PX) return (inR + width / 2 - SIDE_PAD) / PPS
        }
    }
    return (centerX - SIDE_PAD) / PPS
}

export function areBlocksTouching(leftBlock: OpBlock, rightBlock: OpBlock) {
    const lw = _blockWidths[leftBlock.id] ?? 0
    const rw = _blockWidths[rightBlock.id] ?? 0
    const lr = _timeToX(leftBlock.time) + lw / 2
    const rl = _timeToX(rightBlock.time) - rw / 2
    if (Math.abs(lr - rl) < SNAP_PX) return true
    const lc = _timeToX(leftBlock.time)
    const inL = lc - lw / 2 + 18.6
    const inR = lc + lw / 2 - 18.6
    if (Math.abs(rl - inL) < SNAP_PX) return true
    if (Math.abs(rl - inR) < SNAP_PX) return true
    return false
}

export function reflowTrack(trackIndex: number) {
    const sorted = _opBlocks.filter((b) => b.trackIndex < 3).sort((a, b) => a.time - b.time)
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
        if (result.length === 0) {
            result.push(...group)
        } else {
            const prev = result[result.length - 1]
            const pw = _blockWidths[prev.id] ?? 0
            const first = group[0]
            const fw = _blockWidths[first.id] ?? 0
            const prx = _timeToX(prev.time) + pw / 2
            const offset = (prx + 1 + fw / 2 - SIDE_PAD) / PPS - first.time
            for (const b of group) {
                result.push({ ...b, time: Math.max(0, Math.min(MAX_TIME, b.time + offset)) })
            }
        }
    }
    const updated = _opBlocks.map((b) => {
        const nb = result.find((r) => r.id === b.id)
        return nb ?? b
    })
    _opBlocks = updated
    enforceIntro()
}

// ── Drag Functions ──
export function clampDragPos(cx: number, id: string) {
    const idx = _refLines.findIndex((r) => r.id === id)
    if (idx > 0) cx = Math.max(cx, _vx(_refLines[idx - 1].id, _refLines[idx - 1].time) + MIN_GAP)
    if (idx < _refLines.length - 1) cx = Math.min(cx, _vx(_refLines[idx + 1].id, _refLines[idx + 1].time) - MIN_GAP)
    return cx
}

export function startDrag(e: MouseEvent, id: string) {
    if (e.button !== 0 || id === 'left') return
    _draggingId = id
}

export function onDrag(rawX: number) {
    if (!_draggingId) return
    _dragVisualPositions = { ..._dragVisualPositions, [_draggingId]: clampDragPos(rawX, _draggingId) }
}

export function stopDrag() {
    _draggingId = null
}

export function confirmBlockDesc() {
    if (_editingBlockId) {
        const oldW = _blockWidths[_editingBlockId] ?? 0
        const idx = _opBlocks.findIndex((b) => b.id === _editingBlockId)
        _opBlocks = _opBlocks.map((b) => (b.id === _editingBlockId ? { ...b, desc: _editingBlockDesc } : b))
        if (idx >= 0) {
            const edited = _opBlocks[idx]
            const newW = _blockWidths[_editingBlockId] ?? oldW
            const dw = newW - oldW
            if (Math.abs(dw) > 1) {
                const oldRight = _timeToX(edited.time) + oldW / 2
                const shift = dw / 2
                _opBlocks = _opBlocks.map((b) => {
                    if (b.id === _editingBlockId || b.trackIndex >= 3) return b
                    const bl = _timeToX(b.time) - (_blockWidths[b.id] ?? 0) / 2
                    if (bl >= oldRight) return { ...b, time: Math.max(0, Math.min(MAX_TIME, b.time + shift / PPS)) }
                    return b
                })
            }
        }
        reflowTrack(0)
    }
    _editingBlockId = null
}
