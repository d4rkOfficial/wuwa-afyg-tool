import type { CharSlot } from '$lib/types/project'
import { updateCustomSkillHits } from '$lib/data/project.svelte'
import type { SkillEntry } from '$lib/api/types'
import {
    getCharacterInfo,
    getEchoInfo,
    getCharacterIcons,
    getElementIcons,
    getUiBtnIcons as apiGetUiBtnIcons
} from '$lib/api/data-cache'
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
    MAX_TIME,
    NON_DIRECT_CONFIGS,
    NON_DIRECT_ELEMENT,
    BUTTON_KEY_ORDER,
    BLOCK_H_PAD,
    GAMEPAD_BUTTONS
} from './timeline.consts'
import { getEffectMultiplier, getEffectBurstMultiplier, getTuneDamage } from '$lib/consts/tune-data'
import { parseValueString, sumRatioNum } from '$lib/utils/parse-value-string'
import { addToast } from '$lib/data/toast.svelte'
import { setCharElements } from '$lib/data/char-elements.svelte'
import { getKeyMapEntries, getDefaultBlockKey } from '$lib/data/keymap.svelte'
import { getInputShortcutId } from '$lib/data/shortcuts.svelte'
import { registerDragCancel } from '$lib/utils/drag-guard'

// ── Core Data ──
let _refLines = $state<RefLine[]>([
    { id: 'left', time: '', pos: 0 },
    { id: 'c1', time: '临时参考线', pos: SIDE_PAD + 12.5 * PPS },
    { id: 'right', time: '结束', pos: SIDE_PAD + MAX_TIME * PPS }
])
let _opBlocks = $state<OpBlock[]>([])
let _damageBlocks = $state<DamageBlock[]>([])
let _locked = $state(false)

function assertUnlocked(): boolean {
    if (_locked) {
        addToast('本环节已锁定，请先解锁', 'info')
        return false
    }
    return true
}
let _onupdate: ((data: TimelineData) => void) | undefined = $state()
const MAX_HISTORY = 100
let _undoStack: TimelineData[] = []
let _redoStack: TimelineData[] = []
let _lastCommitted: TimelineData | null = null
let _clipboard: {
    refLines: RefLine[]
    opBlocks: OpBlock[]
    damageBlocks: DamageBlock[]
    blockWidths: Record<string, number>
} | null = null
let _lastPointerX: number | null = null
let _team = $state<[CharSlot, CharSlot, CharSlot]>([{}, {}, {}] as unknown as [CharSlot, CharSlot, CharSlot])
let _uiBtnIcons = $state<[string, string][]>([])
let _charIconMap = $state<Record<string, string>>({})
let _elementIconMap = $state<Record<string, string>>({})
let _charElementMap = $state<Record<string, string>>({})
let _charWeaponTypeMap = $state<Record<string, string>>({})

/** @desc 上次 init 的轻量键（数据/队伍/锁定未变时幂等短路，避免 save 回写触发全量重初始化） */
let _lastInitKey = ''

export function init(
    data: TimelineData | null,
    onupdate: (data: TimelineData) => void,
    team: [CharSlot, CharSlot, CharSlot],
    locked: boolean
) {
    _onupdate = onupdate
    _team = team
    _locked = locked
    // 幂等短路：数据指纹一致且队伍/锁定未变 → 跳过全量重建（不清菜单/宽度缓存/角色数据）
    const dataFp = data ? timelineFingerprint(data) : 'null'
    const teamFp = team.map((s) => `${s.character ?? ''}|${s.weapon ?? ''}`).join(',')
    const key = `${dataFp}|${teamFp}|${locked}`
    if (data && key === _lastInitKey) return
    _lastInitKey = key
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
            { id: 'right', time: '结束', pos: SIDE_PAD + MAX_TIME * PPS }
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
    _blockKeyPickerId = null
    _clipboard = null
    _lastPointerX = null
    _showDamageList = false
    _dragVisualPositions = {}
    _isGroupDrag = false
    _dragRefInitialPositions = {}
    _dragBlockInitialPositions = {}
    const snap = cloneData()
    if (!data || timelineFingerprint(data) !== timelineFingerprint(snap)) {
        _undoStack = []
        _redoStack = []
    }
    _lastCommitted = snap
    _estWidthCache.clear()
    _estHeightCache.clear()
    _estOpWidthCache.clear()
    loadCharElements()
}

function cloneData(): TimelineData {
    return JSON.parse(JSON.stringify({ refLines: _refLines, opBlocks: _opBlocks, damageBlocks: _damageBlocks }))
}

// 当前排轴状态快照（AI 工具修改后持久化用）
export function getTimelineState(): TimelineData {
    return cloneData()
}

// 轻量指纹：只取数组长度与首末元素 id，避免全量序列化（用于判断 init 传入数据与当前状态是否一致）
function timelineFingerprint(d: TimelineData): string {
    const rl = d.refLines
    const op = d.opBlocks
    const dm = d.damageBlocks
    return `${rl.length}:${rl[0]?.id ?? ''}:${rl[rl.length - 1]?.id ?? ''}|${op.length}:${op[0]?.id ?? ''}:${
        op[op.length - 1]?.id ?? ''
    }|${dm.length}`
}

function applyData(d: TimelineData) {
    _refLines = d.refLines
    _opBlocks = d.opBlocks
    _damageBlocks = d.damageBlocks
    _selectedBlockIds = {}
    _selectedRefLineIds = {}
    _multiBlockMenu = null
    _blockMenu = null
    _contextMenu = null
    _dragVisualPositions = {}
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
    const snap = cloneData()
    // 快路径：指纹不同（长度/首尾 id 变化）必为变更，跳过全量 stringify 比较；
    // 慢路径兜底：指纹相同但内容变化（如中间块位移）时精确比较，保证 undo 快照准确
    const changed =
        !_lastCommitted ||
        timelineFingerprint(_lastCommitted) !== timelineFingerprint(snap) ||
        JSON.stringify(_lastCommitted) !== JSON.stringify(snap)
    if (changed) {
        if (_lastCommitted) {
            _undoStack.push(_lastCommitted)
            if (_undoStack.length > MAX_HISTORY) _undoStack.shift()
            _redoStack = []
        }
        _lastCommitted = snap
    }
    if (_onupdate) {
        _onupdate(snap)
    }
}

export function undo() {
    if (!assertUnlocked()) return
    const prev = _undoStack.pop()
    if (!prev) {
        addToast('没有可撤销的操作', 'info')
        return
    }
    _redoStack.push(cloneData())
    _lastCommitted = prev
    applyData(prev)
    if (_onupdate) _onupdate(prev)
}

export function redo() {
    if (!assertUnlocked()) return
    const next = _redoStack.pop()
    if (!next) {
        addToast('没有可重做的操作', 'info')
        return
    }
    _undoStack.push(cloneData())
    _lastCommitted = next
    applyData(next)
    if (_onupdate) _onupdate(next)
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
    return _team.filter((s) => s.character !== null && s.weapon !== null).map((s) => s.character as string)
}

// ── Quick Input Mode ──
export function getQuickMode() {
    return _quickMode
}

export function getQuickCharIndex() {
    return _quickCharIndex
}

export function setQuickCharIndex(i: number) {
    const count = getTeamCharNames().length
    if (i >= 0 && i < count) _quickCharIndex = i
}

export function toggleQuickMode() {
    _quickMode = !_quickMode
    _quickCharIndex = 0
    if (_quickMode) {
        _quickStack = []
        _contextMenu = null
        _trackMenu = null
        _blockMenu = null
        _multiBlockMenu = null
        _blockKeyPickerId = null
    }
    addToast(_quickMode ? '快速排轴模式已开启' : '快速排轴模式已关闭', _quickMode ? 'success' : 'info')
}

// 特殊切人状态：读取最新输入的操作块（dir=1 向前循环 none→intro→switchback，dir=-1 向后）
export function getQuickSpecial(): 'none' | 'intro' | 'switchback' {
    const id = getLastQuickOpBlockId()
    const block = id ? _opBlocks.find((b) => b.id === id) : null
    if (!block) return 'none'
    return block.intro ? 'intro' : block.switchback ? 'switchback' : 'none'
}

export function cycleQuickSpecial(dir: 1 | -1 = 1) {
    const id = getLastQuickOpBlockId()
    const block = id ? _opBlocks.find((b) => b.id === id) : null
    if (!block) {
        addToast('没有操作块可设置切人模式', 'info')
        return
    }
    const order = ['none', 'intro', 'switchback'] as const
    const cur: (typeof order)[number] = block.intro ? 'intro' : block.switchback ? 'switchback' : 'none'
    const idx = order.indexOf(cur)
    const next = order[(idx + dir + order.length) % order.length]
    _opBlocks = _opBlocks.map((b) =>
        b.id === block.id ? { ...b, intro: next === 'intro', switchback: next === 'switchback' } : b
    )
    save()
    addToast(next === 'none' ? '已取消特殊切人' : next === 'intro' ? '已设置变奏入场' : '已设置为切回', 'success')
}

export function quickCycleChar() {
    const count = getTeamCharNames().length
    if (count === 0) return
    _quickCharIndex = (_quickCharIndex + 1) % count
}

export function quickUndoLast() {
    const item = _quickStack.pop()
    if (!item) return
    if (item.type === 'op') removeBlock(item.id)
    else removeLine(item.id)
}

function quickBlockWidth(key: string, desc: string): number {
    for (const b of _opBlocks) {
        if (b.key === key && b.desc === desc && _blockWidths[b.id]) return _blockWidths[b.id]
    }
    return estimateInnerWidth(key, desc)
}

function estimateInnerWidth(key: string, desc: string, chips = 0): number {
    const hasIcon =
        _uiBtnIcons.some(([n, url]) => n === key && url) || GAMEPAD_BUTTONS.some((b) => b.id === key && b.icon)
    let inner = hasIcon ? 40 : key.length * 8
    if (desc) inner += 4 + Math.min(desc.length * 14, 96)
    inner += chips * 28
    return Math.max(56, inner + 22)
}

/** @desc 块宽估算缓存（key+desc → width；formatTimeline 每块调用，避免 O(N²) 同款查找） */
const _estOpWidthCache = new Map<string, number>()

function estimateOpBlockWidth(block: OpBlock): number {
    if (_blockWidths[block.id]) return _blockWidths[block.id]
    const cacheKey = block.key + '\u0000' + block.desc + '\u0000' + block.intro + block.switchback
    const cached = _estOpWidthCache.get(cacheKey)
    if (cached !== undefined) return cached
    for (const b of _opBlocks) {
        if (b.id !== block.id && b.key === block.key && b.desc === block.desc && _blockWidths[b.id]) {
            _estOpWidthCache.set(cacheKey, _blockWidths[b.id])
            return _blockWidths[b.id]
        }
    }
    const chips = (block.intro ? 1 : 0) + (block.switchback ? 1 : 0)
    const result = estimateInnerWidth(block.key, block.desc, chips)
    if (_estOpWidthCache.size > 500) _estOpWidthCache.clear()
    _estOpWidthCache.set(cacheKey, result)
    return result
}

export function quickInput(rawKey: string): string | null {
    if (!_quickMode) return null
    // 输入键由快捷键配置决定（与 keymap 存储的 physical 无关）；命中后按 keymap entry 取操作块键/标签
    const entryId = getInputShortcutId(rawKey)
    const entry = entryId ? getKeyMapEntries().find((e) => e.id === entryId) : undefined
    if (!entry) return null
    const names = getTeamCharNames()
    if (names.length === 0 || _quickCharIndex >= names.length) return null
    const storedKey = getDefaultBlockKey(entry.id) || entry.blockKey
    const desc = entry.id === 'heavypress' ? entry.label : ''
    const newWidth = quickBlockWidth(storedKey, desc)
    let maxRight = 0
    for (const b of _opBlocks) {
        const bw = _blockWidths[b.id] ?? 56
        maxRight = Math.max(maxRight, b.pos + bw / 2)
    }
    const pos = maxRight > 0 ? maxRight + newWidth / 2 : SIDE_PAD + newWidth / 2
    const id = addOpBlock(_quickCharIndex, pos, storedKey, desc, 'none', true)
    if (id) _quickStack.push({ type: 'op', id })
    return id
}

// 快速添加参考线：插在当前排轴末尾（openEdit 时立即进入标签编辑）
export function quickAddRefLine(openEdit: boolean): boolean {
    if (!assertUnlocked()) return false
    let maxRight = 0
    for (const b of _opBlocks) {
        const bw = _blockWidths[b.id] ?? 56
        maxRight = Math.max(maxRight, b.pos + bw / 2)
    }
    const cx = Math.max(SIDE_PAD, Math.min(getMaxPos(), maxRight > 0 ? maxRight : SIDE_PAD))
    const i = _refLines.findIndex((r) => r.pos > cx)
    const insertIdx = i === -1 ? _refLines.length : i
    const prevX = i > 0 ? _refLines[i - 1].pos : -Infinity
    const nextX = i >= 0 ? _refLines[i].pos : Infinity
    if (cx - prevX < MIN_GAP || nextX - cx < MIN_GAP) {
        addToast('空间不足，无法创建参考线', 'error')
        return false
    }
    const nid = `c${Date.now()}`
    _dragVisualPositions = { ..._dragVisualPositions, [nid]: cx }
    _refLines = [..._refLines.slice(0, insertIdx), { id: nid, time: '', pos: cx }, ..._refLines.slice(insertIdx)]
    _quickStack.push({ type: 'ref', id: nid })
    save()
    if (openEdit) startEdit(nid, '')
    return true
}

// 最近一个快速输入的 op 块（无则回退时间轴最后一块）
export function getLastQuickOpBlockId(): string | null {
    for (let i = _quickStack.length - 1; i >= 0; i--) {
        if (_quickStack[i].type === 'op') return _quickStack[i].id
    }
    const last = _opBlocks[_opBlocks.length - 1]
    return last ? last.id : null
}

// 快速编辑最近块的备注（复用双击编辑 desc 的输入框，Enter 确认 / Esc 取消）
export function quickEditLastDesc() {
    if (_locked) return
    const id = getLastQuickOpBlockId()
    if (!id) return
    const block = _opBlocks.find((b) => b.id === id)
    if (!block) return
    _editingBlockId = id
    _editingBlockDesc = block.desc
}

// 打开最近块的倍率绑定选择器（Enter）
export async function quickOpenLastBind() {
    const id = getLastQuickOpBlockId()
    if (!id) {
        addToast('没有可绑定的操作块', 'info')
        return
    }
    await openSkillPicker(id)
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
let _isGroupDrag = $state(false)
let _dragRefInitialPositions = $state<Record<string, number>>({})
let _dragRefStartPos = $state(0)
let _blockWidths = $state<Record<string, number>>({})
let _damageWidths = $state<Record<string, number>>({})
let _blockMenu = $state<{ x: number; y: number; blockId: string } | null>(null)
let _selectedBlockIds = $state<Record<string, boolean>>({})
let _selectedRefLineIds = $state<Record<string, boolean>>({})
let _selectionRect = $state<{ startX: number; currentX: number } | null>(null)
let _quickMode = $state(false)
let _quickCharIndex = $state(0)
let _quickStack: { type: 'op' | 'ref'; id: string }[] = []
let _quickPendingRight: Record<string, number> = {}

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
export function getIsGroupDrag() {
    return _isGroupDrag
}
export function getBlockWidths() {
    return _blockWidths
}
export function setBlockWidths(v: Record<string, number>) {
    _blockWidths = v
    let corrected = false
    for (const id of Object.keys(_quickPendingRight)) {
        const width = v[id]
        if (!width) continue
        const right = _quickPendingRight[id]
        _opBlocks = _opBlocks.map((b) =>
            b.id === id ? { ...b, pos: Math.max(0, Math.min(getMaxPos(), right + width / 2)) } : b
        )
        delete _quickPendingRight[id]
        corrected = true
    }
    if (corrected) save()
}

// 单键写入块宽度（避免每次测量都展开整个 map）
export function setBlockWidth(id: string, width: number) {
    _blockWidths[id] = width
    const right = _quickPendingRight[id]
    if (right !== undefined) {
        delete _quickPendingRight[id]
        _opBlocks = _opBlocks.map((b) =>
            b.id === id ? { ...b, pos: Math.max(0, Math.min(getMaxPos(), right + width / 2)) } : b
        )
        save()
    }
}
export function getBlockMenu() {
    return _blockMenu
}
export function setBlockMenu(v: { x: number; y: number; blockId: string } | null) {
    _blockMenu = v
}

let _blockKeyPickerId = $state<string | null>(null)

export function getBlockKeyPickerId() {
    return _blockKeyPickerId
}
export function setBlockKeyPickerId(v: string | null) {
    _blockKeyPickerId = v
}

let _multiBlockMenu = $state<{ x: number; y: number } | null>(null)

export function getMultiBlockMenu() {
    return _multiBlockMenu
}
export function setMultiBlockMenu(v: { x: number; y: number } | null) {
    _multiBlockMenu = v
}

// ── Block / RefLine Selection ──
export function getSelectedBlockIds() {
    return _selectedBlockIds
}
export function getSelectedRefLineIds() {
    return _selectedRefLineIds
}
export function getSelectionRect() {
    return _selectionRect
}

export function toggleBlockSelection(blockId: string, ctrl: boolean) {
    if (ctrl) {
        const next = { ..._selectedBlockIds }
        if (next[blockId]) {
            delete next[blockId]
        } else {
            next[blockId] = true
        }
        _selectedBlockIds = next
    } else {
        _selectedBlockIds = { [blockId]: true }
        _selectedRefLineIds = {}
    }
}

export function toggleRefLineSelection(refId: string, ctrl: boolean) {
    if (isBoundary(refId)) return
    if (ctrl) {
        const next = { ..._selectedRefLineIds }
        if (next[refId]) {
            delete next[refId]
        } else {
            next[refId] = true
        }
        _selectedRefLineIds = next
    } else {
        _selectedRefLineIds = { [refId]: true }
        _selectedBlockIds = {}
    }
}

export function clearBlockSelection() {
    _selectedBlockIds = {}
    _selectedRefLineIds = {}
}

export function setPointerX(x: number) {
    _lastPointerX = x
}

export function hasClipboard(): boolean {
    return _clipboard !== null && (_clipboard.opBlocks.length > 0 || _clipboard.refLines.length > 0)
}

export function startSelectionRect(x: number) {
    _selectionRect = { startX: x, currentX: x }
    _selectedBlockIds = {}
    _selectedRefLineIds = {}
}

export function updateSelectionRect(x: number) {
    if (!_selectionRect) return
    _selectionRect = { ..._selectionRect, currentX: x }
}

export function endSelectionRect() {
    if (!_selectionRect) return
    const minX = Math.min(_selectionRect.startX, _selectionRect.currentX)
    const maxX = Math.max(_selectionRect.startX, _selectionRect.currentX)
    _selectionRect = null
    if (maxX - minX <= 5) {
        _selectedBlockIds = {}
        _selectedRefLineIds = {}
        return
    }
    const selected: Record<string, boolean> = {}
    for (const block of _opBlocks) {
        const bw = _blockWidths[block.id] ?? 56
        const left = block.pos - bw / 2
        const right = block.pos + bw / 2
        if (left < maxX && right > minX) {
            selected[block.id] = true
        }
    }
    _selectedBlockIds = selected
    const selectedRefs: Record<string, boolean> = {}
    for (const rl of _refLines) {
        if (isBoundary(rl.id)) continue
        if (rl.pos > minX && rl.pos < maxX) {
            selectedRefs[rl.id] = true
        }
    }
    _selectedRefLineIds = selectedRefs
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
let _opSkillPickerCache = $state<Record<string, SkillPickerGroup[]>>({})
let _skillPickerHitHits = $state<Record<string, number>>({})
let _nonDirectPickerBlockId = $state<string | null>(null)
let _nonDirectPickerData = $state<{ name: string; category: string; layers: number; hits: number }[]>([])
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
export function setNonDirectPickerData(v: { name: string; category: string; layers: number; hits: number }[]) {
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

/** @desc 当前有效编辑右边界：跟随末条参考线（结束线）位置动态扩展，永不小于左侧起始位置 */
export function getMaxPos(): number {
    const last = _refLines[_refLines.length - 1]
    const endPos = last?.pos ?? SIDE_PAD + MAX_TIME * PPS
    return Math.max(SIDE_PAD, endPos)
}

export function getTableWidth() {
    const last = _refLines[_refLines.length - 1]
    return 80 + (_dragVisualPositions[last?.id] ?? last?.pos ?? SIDE_PAD + MAX_TIME * PPS) + RIGHT_EXTRA
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

/** @desc 批量写入伤害块宽度（挂载首帧一次提交，避免逐块触发整表重排） */
export function setDamageWidths(map: Record<string, number>) {
    _damageWidths = { ..._damageWidths, ...map }
}

// 估算宽度缓存：排布内层会对同一块反复调用，按 id 缓存避免重复计算
const _estWidthCache = new Map<string, number>()

function estimateDamageWidth(d: DamageBlock): number {
    const cached = _estWidthCache.get(d.id)
    if (cached !== undefined) return cached
    const texts: string[] = []
    for (const h of d.skillHits) {
        texts.push(h.hitName.replace('伤害', '') + ((h.hits ?? 0) > 1 ? `×${h.hits}` : ''))
    }
    for (const nd of d.nonDirectEntries) {
        texts.push(
            nd.category === '效应' ? `${nd.name}${nd.layers}层${(nd.hits ?? 1) > 1 ? `×${nd.hits}段` : ''}` : nd.name
        )
    }
    const maxChars = Math.max(...texts.map((t) => t.length), 0)
    const singleTagW = maxChars * 5.5 + 22
    const result = singleTagW + 8
    // 上限防护：粘贴/频繁增删导致 id 持续增长时避免 Map 无界膨胀
    if (_estWidthCache.size > 500) _estWidthCache.clear()
    _estWidthCache.set(d.id, result)
    return result
}

export function estimateDamageHeight(d: DamageBlock): number {
    const cached = _estHeightCache.get(d.id)
    if (cached !== undefined) return cached
    const count = d.skillHits.length + d.nonDirectEntries.length
    const TAG_HEIGHT = 18
    const PAD = 4
    const result = count * TAG_HEIGHT + PAD
    if (_estHeightCache.size > 500) _estHeightCache.clear()
    _estHeightCache.set(d.id, result)
    return result
}

// 伤害块高度缓存（与宽度缓存配套；结构变更时清理）
const _estHeightCache = new Map<string, number>()

export function getDamageBlocksStacked(): { block: DamageBlock; top: number; left: number }[] {
    const lastTrackIdx = getTRACKS().length - 1
    // 一次性索引：sourceId → pos，替代每个伤害块的线性 find（拖拽帧成本 O(D×N) → O(D)）
    const opPos = new Map<string, number>()
    for (const b of _opBlocks) opPos.set(b.id, b.pos)
    const refPos = new Map<string, number>()
    for (const r of _refLines) refPos.set(r.id, r.pos)
    const blocks = _damageBlocks
        .filter((d) => d.trackIndex === lastTrackIdx && (d.skillHits.length > 0 || d.nonDirectEntries.length > 0))
        .map((d) => {
            const left =
                d.sourceType === 'ref'
                    ? (_dragVisualPositions[d.sourceId] ?? refPos.get(d.sourceId) ?? 0)
                    : (opPos.get(d.sourceId) ?? 0) - (_blockWidths[d.sourceId] ?? 56) / 2
            return { block: d, left }
        })
        .sort((a, b) => a.left - b.left)

    const GAP = 4
    const result: { block: DamageBlock; top: number; left: number }[] = []
    // 活跃已排列表（按盒右缘升序）：右缘 ≤ 当前块左缘的项永久移出，
    // 使「水平重叠 + 纵向避让」的内层循环从全量 O(N) 收敛到活跃集（平均常数级）
    const placed: { boxLeft: number; boxRight: number; top: number; height: number }[] = []
    for (const item of blocks) {
        const hB = estimateDamageHeight(item.block)
        const wB = _damageWidths[item.block.id] ?? estimateDamageWidth(item.block)
        const left = item.left
        const boxL = left - wB / 2
        const boxR = left + wB / 2
        while (placed.length > 0 && placed[0].boxRight <= boxL) placed.shift()
        const overlaps = (p: { boxLeft: number; boxRight: number }) => p.boxLeft < boxR && boxL < p.boxRight

        const candidateSet = new Set<number>()
        candidateSet.add(0)
        for (const p of placed) {
            if (overlaps(p)) candidateSet.add(p.top + p.height + GAP)
        }

        const candidates = [...candidateSet].sort((a, b) => a - b)
        let top = candidates[candidates.length - 1]
        for (const y of candidates) {
            let valid = true
            for (const p of placed) {
                if (overlaps(p) && y < p.top + p.height + GAP && p.top < y + hB + GAP) {
                    valid = false
                    break
                }
            }
            if (valid) {
                top = y
                break
            }
        }

        result.push({ block: item.block, top, left: item.left })
        placed.push({ boxLeft: boxL, boxRight: boxR, top, height: hB })
        placed.sort((a, b) => a.boxRight - b.boxRight)
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

export function addRefLineAt(x: number): boolean {
    if (!assertUnlocked()) return false
    const cx = Math.max(SIDE_PAD, Math.min(getMaxPos(), x))
    const i = _refLines.findIndex((r) => r.pos > cx)
    const insertIdx = i === -1 ? _refLines.length : i
    const prevX = i > 0 ? _refLines[i - 1].pos : -Infinity
    const nextX = i >= 0 ? _refLines[i].pos : Infinity
    if (cx - prevX < MIN_GAP || nextX - cx < MIN_GAP) {
        addToast('空间不足，无法创建参考线', 'error')
        return false
    }
    const nid = `c${Date.now()}`
    _dragVisualPositions = { ..._dragVisualPositions, [nid]: cx }
    _refLines = [..._refLines.slice(0, insertIdx), { id: nid, time: '', pos: cx }, ..._refLines.slice(insertIdx)]
    _trackMenu = null
    save()
    startEdit(nid, '')
    return true
}

export function removeLine(id: string) {
    if (!assertUnlocked()) return
    if (!canDelete(id)) return
    _refLines = _refLines.filter((r) => r.id !== id)
    _damageBlocks = _damageBlocks.filter((d) => !(d.sourceId === id && d.sourceType === 'ref'))
    const { [id]: _, ...rest } = _dragVisualPositions
    _dragVisualPositions = rest
    const { [id]: __, ...restSel } = _selectedRefLineIds
    _selectedRefLineIds = restSel
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

// 直接设置参考线位置（AI 工具用；与相邻参考线保持 MIN_GAP，不满足返回 null）
export function setRefLinePos(id: string, pos: number): number | null {
    if (!assertUnlocked()) return null
    if (isBoundary(id)) return null
    const idx = _refLines.findIndex((r) => r.id === id)
    if (idx < 0) return null
    const cx = Math.max(SIDE_PAD, Math.min(getMaxPos(), pos))
    const minX = idx > 0 ? vx(_refLines[idx - 1].id, _refLines[idx - 1].pos) + MIN_GAP : -Infinity
    const maxX = idx < _refLines.length - 1 ? vx(_refLines[idx + 1].id, _refLines[idx + 1].pos) - MIN_GAP : Infinity
    if (cx < minX || cx > maxX) return null
    _refLines = _refLines.map((r) => (r.id === id ? { ...r, pos: cx } : r))
    _dragVisualPositions = { ..._dragVisualPositions, [id]: cx }
    save()
    return cx
}

export function startDrag(e: MouseEvent, id: string) {
    if (!assertUnlocked()) return
    if (e.button !== 0 || id === 'left') return
    _draggingId = id
    const ref = _refLines.find((r) => r.id === id)
    if (!ref) return
    const totalSelected = Object.keys(_selectedBlockIds).length + Object.keys(_selectedRefLineIds).length
    if (_selectedRefLineIds[id] && totalSelected > 1) {
        _isGroupDrag = true
        _dragRefStartPos = ref.pos
        _dragRefInitialPositions = snapshotRefPositions()
        _dragBlockInitialPositions = snapshotBlockPositions()
    } else {
        _isGroupDrag = false
        _dragRefInitialPositions = {}
        _dragBlockInitialPositions = {}
    }
}

export function onDrag(rawX: number) {
    if (!_draggingId) return
    if (_isGroupDrag) {
        const delta = Math.max(0, Math.min(getMaxPos(), rawX)) - _dragRefStartPos
        applyGroupDelta(delta)
        return
    }
    _dragVisualPositions = { ..._dragVisualPositions, [_draggingId]: clampDragPos(rawX, _draggingId) }
}

export function stopDrag() {
    if (!_draggingId) {
        _draggingId = null
        resetGroupDrag()
        return
    }
    const id = _draggingId
    if (_isGroupDrag) {
        save()
    } else {
        const newX = _dragVisualPositions[id]
        if (newX !== undefined) {
            _refLines = _refLines.map((r) => (r.id === id ? { ...r, pos: newX } : r))
            save()
        }
    }
    _draggingId = null
    resetGroupDrag()
}

function snapshotBlockPositions(): Record<string, number> {
    const init: Record<string, number> = {}
    for (const id of Object.keys(_selectedBlockIds)) {
        const b = _opBlocks.find((ob) => ob.id === id)
        if (b) init[id] = b.pos
    }
    return init
}

function snapshotRefPositions(): Record<string, number> {
    const init: Record<string, number> = {}
    for (const id of Object.keys(_selectedRefLineIds)) {
        const r = _refLines.find((rr) => rr.id === id)
        if (r) init[id] = r.pos
    }
    return init
}

function applyGroupDelta(delta: number) {
    const initBlocks = _dragBlockInitialPositions
    if (Object.keys(initBlocks).length > 0) {
        _opBlocks = _opBlocks.map((b) =>
            initBlocks[b.id] !== undefined
                ? { ...b, pos: Math.max(0, Math.min(getMaxPos(), initBlocks[b.id]! + delta)) }
                : b
        )
    }
    const initRefs = _dragRefInitialPositions
    const initRefIds = Object.keys(initRefs)
    if (initRefIds.length > 0) {
        const walls = _refLines.filter((r) => initRefIds.indexOf(r.id) < 0).sort((a, b) => a.pos - b.pos)
        _refLines = _refLines
            .map((r) => {
                const initPos = initRefs[r.id]
                if (initPos === undefined) return r
                let prevWall = -Infinity
                let nextWall = Infinity
                for (const w of walls) {
                    if (w.pos < initPos) prevWall = Math.max(prevWall, w.pos)
                    else if (w.pos > initPos) {
                        nextWall = Math.min(nextWall, w.pos)
                        break
                    }
                }
                const p = initPos + delta
                const clamped = Math.max(0, prevWall + MIN_GAP, Math.min(getMaxPos(), nextWall - MIN_GAP, p))
                return { ...r, pos: clamped }
            })
            .sort((a, b) => a.pos - b.pos)
    }
}

function resetGroupDrag() {
    _isGroupDrag = false
    _dragRefInitialPositions = {}
    _dragBlockInitialPositions = {}
}

// ── Op Block Functions ──
export function addOpBlock(
    trackIndex: number,
    pos: number,
    key: string,
    desc = '',
    special: 'none' | 'intro' | 'switchback' = 'none',
    skipEnforce = false
) {
    if (!assertUnlocked()) return null
    const block = {
        id: `b${Date.now()}`,
        trackIndex,
        pos,
        key,
        desc,
        intro: special === 'intro',
        switchback: special === 'switchback'
    }
    _opBlocks = [..._opBlocks, block]
    _trackMenu = null
    if (!skipEnforce) {
        enforceIntro()
        enforceSwitchback()
    }
    save()
    return block.id
}

let _dragBlockOffset = $state(0)
let _dragBlockInitialPositions = $state<Record<string, number>>({})

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
    const totalSelected = Object.keys(_selectedBlockIds).length + Object.keys(_selectedRefLineIds).length
    if (_selectedBlockIds[blockId] && totalSelected > 1) {
        _isGroupDrag = true
        _dragBlockInitialPositions = snapshotBlockPositions()
        _dragRefInitialPositions = snapshotRefPositions()
    } else {
        _isGroupDrag = false
        _dragBlockInitialPositions = {}
        _dragRefInitialPositions = {}
    }
}

/** @desc 拖拽中块的视觉临时位置（非组拖不逐帧替换 _opBlocks，停止时一次性提交） */
let _dragBlockVisualPositions = $state<Record<string, number>>({})

export function getDragBlockVisualPositions() {
    return _dragBlockVisualPositions
}

export function onBlockDrag(rawX: number) {
    if (!_dragBlockId) return
    const idx = _opBlocks.findIndex((b) => b.id === _dragBlockId)
    if (idx < 0) return
    const centerX = rawX - _dragBlockOffset
    const pos = snapBlockX(centerX, _dragBlockId, _blockWidths[_dragBlockId] ?? 0)
    const clampedPos = Math.max(0, Math.min(getMaxPos(), pos))
    if (_isGroupDrag) {
        applyGroupDelta(clampedPos - _dragBlockStartPos)
        return
    }
    _dragBlockVisualPositions = { ..._dragBlockVisualPositions, [_dragBlockId]: clampedPos }
}

export function stopBlockDrag() {
    if (!_dragBlockId) {
        _dragBlockInitialPositions = {}
        _dragRefInitialPositions = {}
        _isGroupDrag = false
        _dragBlockId = null
        return
    }
    const idx = _opBlocks.findIndex((b) => b.id === _dragBlockId)
    if (idx >= 0) {
        // 非组拖：先把拖拽期间的临时位置一次性提交到 _opBlocks
        const visualPos = _dragBlockVisualPositions[_dragBlockId]
        if (!_isGroupDrag && visualPos !== undefined && Math.abs(visualPos - _dragBlockStartPos) > 1) {
            _opBlocks = _opBlocks.map((b) => (b.id === _dragBlockId ? { ...b, pos: visualPos } : b))
        }
        const dragged = _opBlocks[idx]
        if (_isGroupDrag) {
            save()
        } else if (Math.abs(dragged.pos - _dragBlockStartPos) > 1) {
            const dw = _blockWidths[_dragBlockId] ?? 0
            const dLeft = dragged.pos - dw / 2
            const dRight = dragged.pos + dw / 2
            for (const b of _opBlocks) {
                if (b.id === _dragBlockId || b.trackIndex !== dragged.trackIndex) continue
                const bw = _blockWidths[b.id] ?? 0
                const bLeft = b.pos - bw / 2
                const bRight = b.pos + bw / 2
                if (dLeft < bRight && dRight > bLeft) {
                    const pushRight = dragged.pos >= b.pos
                    _opBlocks = _opBlocks.map((ob) =>
                        ob.id === _dragBlockId
                            ? {
                                  ...ob,
                                  pos: Math.max(0, Math.min(getMaxPos(), pushRight ? bRight + dw / 2 : bLeft - dw / 2))
                              }
                            : ob
                    )
                    break
                }
            }
            reflowTrack(dragged.trackIndex)
            save()
        }
    }
    _dragBlockVisualPositions = {}
    _dragBlockInitialPositions = {}
    _dragRefInitialPositions = {}
    _isGroupDrag = false
    _dragBlockId = null
}

export function removeBlock(blockId: string) {
    if (!assertUnlocked()) return
    _opBlocks = _opBlocks.filter((b) => b.id !== blockId)
    _damageBlocks = _damageBlocks.filter((d) => !(d.sourceId === blockId && d.sourceType === 'op'))
    _blockMenu = null
    enforceIntro()
    enforceSwitchback()
    save()
}

export function removeBlocks(ids: string[]) {
    if (!assertUnlocked()) return
    const idSet = new Set(ids)
    const affectedTracks = new Set<number>()
    for (const b of _opBlocks) {
        if (idSet.has(b.id)) affectedTracks.add(b.trackIndex)
    }
    _opBlocks = _opBlocks.filter((b) => !idSet.has(b.id))
    _damageBlocks = _damageBlocks.filter((d) => !(d.sourceType === 'op' && idSet.has(d.sourceId)))
    _selectedBlockIds = {}
    _selectedRefLineIds = {}
    _multiBlockMenu = null
    enforceIntro()
    enforceSwitchback()
    save()
}

export function resetDamageBindingsForBlocks(ids: string[]) {
    if (!assertUnlocked()) return
    const idSet = new Set(ids)
    _damageBlocks = _damageBlocks
        .map((d) => {
            if (d.sourceType === 'op' && idSet.has(d.sourceId)) {
                return { ...d, skillHits: [], nonDirectEntries: [] }
            }
            return d
        })
        .filter((d) => !(d.skillHits.length === 0 && d.nonDirectEntries.length === 0))
    _multiBlockMenu = null
    save()
}

export function removeSelection(showToast = true) {
    if (!assertUnlocked()) return
    const blockIds = Object.keys(_selectedBlockIds)
    const refIds = Object.keys(_selectedRefLineIds)
    const blockSet = new Set(blockIds)
    const refSet = new Set(refIds)
    if (blockSet.size === 0 && refSet.size === 0) return
    _opBlocks = _opBlocks.filter((b) => !blockSet.has(b.id))
    _refLines = _refLines.filter((r) => !refSet.has(r.id))
    _damageBlocks = _damageBlocks.filter(
        (d) =>
            !(d.sourceType === 'op' && blockSet.has(d.sourceId)) && !(d.sourceType === 'ref' && refSet.has(d.sourceId))
    )
    for (const id of refIds) {
        if (!(id in _dragVisualPositions)) continue
        const { [id]: _, ...rest } = _dragVisualPositions
        _dragVisualPositions = rest
    }
    _selectedBlockIds = {}
    _selectedRefLineIds = {}
    _multiBlockMenu = null
    enforceIntro()
    enforceSwitchback()
    save()
    if (showToast) addToast(`已删除 ${blockIds.length + refIds.length} 项`, 'success')
}

export function resetSelectionDamage() {
    if (!assertUnlocked()) return
    const blockSet = new Set(Object.keys(_selectedBlockIds))
    const refSet = new Set(Object.keys(_selectedRefLineIds))
    if (blockSet.size === 0 && refSet.size === 0) return
    _damageBlocks = _damageBlocks
        .map((d) => {
            const inSelection =
                (d.sourceType === 'op' && blockSet.has(d.sourceId)) ||
                (d.sourceType === 'ref' && refSet.has(d.sourceId))
            if (!inSelection) return d
            return { ...d, skillHits: [], nonDirectEntries: [] }
        })
        .filter((d) => !(d.skillHits.length === 0 && d.nonDirectEntries.length === 0))
    _multiBlockMenu = null
    save()
}

interface InsertGroupResult {
    damageMap: Record<string, string>
    newBlockIds: string[]
    newRefIds: string[]
    count: number
}

function insertGroupAt(
    blocks: OpBlock[],
    refs: RefLine[],
    damageToCopy: DamageBlock[],
    widths: Record<string, number>,
    baseShift: number
): InsertGroupResult | null {
    if (blocks.length === 0 && refs.length === 0) return null
    let groupLeft = Infinity
    let anchor = -Infinity
    for (const b of blocks) {
        const w = widths[b.id] ?? 56
        groupLeft = Math.min(groupLeft, b.pos - w / 2)
        anchor = Math.max(anchor, b.pos + w / 2)
    }
    for (const r of refs) {
        groupLeft = Math.min(groupLeft, r.pos)
        anchor = Math.max(anchor, r.pos)
    }
    const blockOffsets = new Map(blocks.map((b) => [b.id, b.pos - (widths[b.id] ?? 56) / 2 - groupLeft]))
    const refOffsets = new Map(refs.map((r) => [r.id, r.pos - groupLeft]))
    const sortedRefs = _refLines.slice().sort((a, b) => a.pos - b.pos)

    let shift = baseShift
    for (let iter = 0; iter < 200; iter++) {
        let nextShift = shift
        for (const b of blocks) {
            const o = blockOffsets.get(b.id)!
            const w = widths[b.id] ?? 56
            for (const u of _opBlocks) {
                if (u.id === b.id || u.trackIndex !== b.trackIndex) continue
                const uw = widths[u.id] ?? 56
                if (u.pos - uw / 2 < shift + o + w && u.pos + uw / 2 > shift + o) {
                    nextShift = Math.max(nextShift, u.pos + uw / 2 - o)
                }
            }
        }
        for (const r of refs) {
            const o = refOffsets.get(r.id)!
            const copyPos = shift + o
            let idx = sortedRefs.length
            for (let i = 0; i < sortedRefs.length; i++) {
                if (sortedRefs[i].pos > copyPos) {
                    idx = i
                    break
                }
            }
            if (idx < sortedRefs.length) {
                const next = sortedRefs[idx]
                if (next.pos - copyPos < MIN_GAP) nextShift = Math.max(nextShift, next.pos + MIN_GAP - o)
            }
            if (idx > 0) {
                const prev = sortedRefs[idx - 1]
                if (copyPos - prev.pos < MIN_GAP) nextShift = Math.max(nextShift, prev.pos + MIN_GAP - o)
            }
        }
        if (nextShift === shift) break
        shift = nextShift
        if (shift > getMaxPos()) break
    }
    const groupW = anchor - groupLeft
    if (shift > getMaxPos() - groupW) {
        return null
    }

    const now = Date.now()
    let counter = 0
    const newBlocks = blocks.map((b) => {
        const w = widths[b.id] ?? 56
        const o = blockOffsets.get(b.id)!
        return { ...b, id: `b${now}-${counter++}`, pos: Math.max(0, Math.min(getMaxPos(), shift + o + w / 2)) }
    })
    const newRefs = refs.map((r) => {
        const o = refOffsets.get(r.id)!
        return { ...r, id: `c${now}-${counter++}`, pos: Math.max(0, Math.min(getMaxPos() - MIN_GAP, shift + o)) }
    })
    const newBlockIds = newBlocks.map((b) => b.id)
    const newRefIds = newRefs.map((r) => r.id)

    const oldToNew = new Map<string, string>()
    for (let i = 0; i < blocks.length; i++) oldToNew.set(blocks[i].id, newBlockIds[i])
    for (let i = 0; i < refs.length; i++) oldToNew.set(refs[i].id, newRefIds[i])

    const damageMap: Record<string, string> = {}
    const newDamageBlocks: DamageBlock[] = []
    for (const d of damageToCopy) {
        const newSourceId = oldToNew.get(d.sourceId)
        if (!newSourceId) continue
        damageMap[d.id] = `d${now}-${counter++}`
        newDamageBlocks.push({
            ...d,
            id: damageMap[d.id],
            sourceId: newSourceId,
            skillHits: d.skillHits.map((h) => ({ ...h })),
            nonDirectEntries: d.nonDirectEntries.map((n) => ({
                ...n,
                responders: n.responders ? [...n.responders] : undefined
            }))
        })
    }

    if (newBlocks.length > 0) _opBlocks = [..._opBlocks, ...newBlocks]
    if (newRefs.length > 0) _refLines = [..._refLines, ...newRefs].sort((a, b) => a.pos - b.pos)
    if (newDamageBlocks.length > 0) _damageBlocks = [..._damageBlocks, ...newDamageBlocks]
    for (let i = 0; i < newBlocks.length; i++) {
        const w = widths[blocks[i].id]
        if (w !== undefined) _blockWidths[newBlockIds[i]] = w
    }
    return { damageMap, newBlockIds, newRefIds, count: newBlockIds.length + newRefIds.length }
}

function selectInsertedGroup(result: InsertGroupResult) {
    _selectedBlockIds = Object.fromEntries(result.newBlockIds.map((id) => [id, true]))
    _selectedRefLineIds = Object.fromEntries(result.newRefIds.map((id) => [id, true]))
    _multiBlockMenu = null
    _blockMenu = null
    _contextMenu = null
    enforceIntro()
    enforceSwitchback()
}

export function copySelection(silent = false): boolean {
    if (!assertUnlocked()) return false
    const selectedBlocks = Object.keys(_selectedBlockIds)
        .map((id) => _opBlocks.find((b) => b.id === id))
        .filter((b): b is OpBlock => Boolean(b))
    const selectedRefs = Object.keys(_selectedRefLineIds)
        .map((id) => _refLines.find((r) => r.id === id))
        .filter((r): r is RefLine => Boolean(r))
    if (selectedBlocks.length === 0 && selectedRefs.length === 0) {
        if (!silent) addToast('没有可复制的选中项', 'info')
        return false
    }
    const selectedIds = new Set([...Object.keys(_selectedBlockIds), ...Object.keys(_selectedRefLineIds)])
    const blockWidths: Record<string, number> = {}
    for (const b of selectedBlocks) {
        if (_blockWidths[b.id] !== undefined) blockWidths[b.id] = _blockWidths[b.id]
    }
    _clipboard = {
        opBlocks: selectedBlocks.map((b) => ({ ...b })),
        refLines: selectedRefs.map((r) => ({ ...r })),
        damageBlocks: _damageBlocks
            .filter((d) => selectedIds.has(d.sourceId))
            .map((d) => ({
                ...d,
                skillHits: d.skillHits.map((h) => ({ ...h })),
                nonDirectEntries: d.nonDirectEntries.map((n) => ({
                    ...n,
                    responders: n.responders ? [...n.responders] : undefined
                }))
            })),
        blockWidths
    }
    if (!silent) addToast(`已复制 ${selectedBlocks.length + selectedRefs.length} 项`, 'success')
    return true
}

export function cutSelection(): boolean {
    if (!assertUnlocked()) return false
    const count = Object.keys(_selectedBlockIds).length + Object.keys(_selectedRefLineIds).length
    if (count === 0) {
        addToast('没有可剪切的选中项', 'info')
        return false
    }
    if (!copySelection(true)) return false
    removeSelection(false)
    addToast(`已剪切 ${count} 项`, 'success')
    return true
}

export function pasteSelection(): Record<string, string> {
    if (!assertUnlocked()) return {}
    if (!hasClipboard()) {
        addToast('剪贴板为空', 'info')
        return {}
    }
    const clip = _clipboard!
    let anchor = -Infinity
    for (const b of clip.opBlocks) anchor = Math.max(anchor, b.pos + (clip.blockWidths[b.id] ?? 56) / 2)
    for (const r of clip.refLines) anchor = Math.max(anchor, r.pos)
    let groupLeft = Infinity
    for (const b of clip.opBlocks) groupLeft = Math.min(groupLeft, b.pos - (clip.blockWidths[b.id] ?? 56) / 2)
    for (const r of clip.refLines) groupLeft = Math.min(groupLeft, r.pos)
    const baseShift = _lastPointerX !== null ? _lastPointerX + (anchor - groupLeft) : anchor
    const result = insertGroupAt(
        clip.opBlocks,
        clip.refLines,
        clip.damageBlocks,
        { ..._blockWidths, ...clip.blockWidths },
        baseShift
    )
    if (!result) {
        addToast('空间不足，无法粘贴在此处', 'error')
        return {}
    }
    selectInsertedGroup(result)
    save()
    addToast(`已粘贴 ${result.count} 项`, 'success')
    return result.damageMap
}

export function selectAll(): void {
    const blocks: Record<string, boolean> = {}
    const lastTrackIdx = getTRACKS().length - 1
    for (const b of _opBlocks) {
        if (b.trackIndex >= lastTrackIdx) continue
        blocks[b.id] = true
    }
    const refs: Record<string, boolean> = {}
    for (const r of _refLines) {
        if (isBoundary(r.id)) continue
        refs[r.id] = true
    }
    const total = Object.keys(blocks).length + Object.keys(refs).length
    if (total === 0) {
        addToast('没有可全选的内容', 'info')
        return
    }
    _selectedBlockIds = blocks
    _selectedRefLineIds = refs
    addToast(`已全选 ${total} 项`, 'success')
}

export function canSetIntro(blockId: string): boolean {
    const block = _opBlocks.find((b) => b.id === blockId)
    if (!block || block.intro) return false
    const lastTrackIdx = getTRACKS().length - 1
    if (block.trackIndex >= lastTrackIdx) return false
    const sorted = _opBlocks.filter((b) => b.trackIndex < lastTrackIdx).sort((a, b) => a.pos - b.pos)
    const idx = sorted.findIndex((b) => b.id === blockId)
    if (idx <= 0) return true
    const prev = sorted[idx - 1]
    return prev.trackIndex !== block.trackIndex
}

export function setBlockSpecial(blockId: string, kind: 'none' | 'intro' | 'switchback') {
    if (!assertUnlocked()) return
    const block = _opBlocks.find((b) => b.id === blockId)
    if (!block) return
    if (block.intro && kind === 'intro') kind = 'none'
    if (block.switchback && kind === 'switchback') kind = 'none'
    if (kind === 'intro' && !block.intro && !canSetIntro(blockId)) {
        addToast('当前位置不能设置变奏入场', 'info')
        return
    }
    if (kind === 'switchback' && !block.switchback && !canSetSwitchback(blockId)) {
        addToast('当前位置不能设置为切回', 'info')
        return
    }
    _opBlocks = _opBlocks.map((b) =>
        b.id === blockId ? { ...b, intro: kind === 'intro', switchback: kind === 'switchback' } : b
    )
    save()
    if (kind === 'intro') addToast('已设置变奏入场', 'success')
    if (kind === 'switchback') addToast('已设置为切回', 'success')
    if (kind === 'none') addToast('已取消特殊切人', 'success')
}

function enforceIntro() {
    const lastTrackIdx = getTRACKS().length - 1
    const sorted = _opBlocks.filter((b) => b.trackIndex < lastTrackIdx).sort((a, b) => a.pos - b.pos)
    // id → 有序索引 Map，替代每块 findIndex（快速模式每键调用，O(N²) → O(N log N)）
    const idxOf = new Map(sorted.map((s, i) => [s.id, i]))
    let changed = false
    const updated = _opBlocks.map((b) => {
        if (!b.intro) return b
        const idx = idxOf.get(b.id)
        if (idx === undefined || idx <= 0) return b
        const prev = sorted[idx - 1]
        if (prev.trackIndex === b.trackIndex) {
            changed = true
            return { ...b, intro: false }
        }
        return b
    })
    if (changed) _opBlocks = updated
}

export function canSetSwitchback(blockId: string): boolean {
    const block = _opBlocks.find((b) => b.id === blockId)
    if (!block || block.switchback) return false
    const lastTrackIdx = getTRACKS().length - 1
    if (block.trackIndex >= lastTrackIdx) return false

    const sameTrack = _opBlocks
        .filter((b) => b.trackIndex === block.trackIndex && b.trackIndex < lastTrackIdx)
        .sort((a, b) => a.pos - b.pos)
    const sameTrackIdx = sameTrack.findIndex((b) => b.id === blockId)
    if (sameTrackIdx <= 0) return false

    const sorted = _opBlocks.filter((b) => b.trackIndex < lastTrackIdx).sort((a, b) => a.pos - b.pos)
    const globalIdx = sorted.findIndex((b) => b.id === blockId)
    if (globalIdx <= 0) return false
    return sorted[globalIdx - 1].trackIndex !== block.trackIndex
}

export function setBlockKey(blockId: string, key: string) {
    if (!assertUnlocked()) return
    const block = _opBlocks.find((b) => b.id === blockId)
    if (!block || block.key === key) return
    _opBlocks = _opBlocks.map((b) => (b.id === blockId ? { ...b, key } : b))
    save()
    addToast(`已更换按键为「${key}」`, 'success')
}

// 直接设置操作块位置（AI 工具用；clamp 到有效范围并保存，返回实际位置）
export function setOpBlockPos(blockId: string, pos: number): number | null {
    if (!assertUnlocked()) return null
    const idx = _opBlocks.findIndex((b) => b.id === blockId)
    if (idx < 0) return null
    const clamped = Math.max(0, Math.min(getMaxPos(), pos))
    _opBlocks = _opBlocks.map((b) => (b.id === blockId ? { ...b, pos: clamped } : b))
    save()
    return clamped
}

function enforceSwitchback() {
    const lastTrackIdx = getTRACKS().length - 1
    const sorted = _opBlocks.filter((b) => b.trackIndex < lastTrackIdx).sort((a, b) => a.pos - b.pos)
    const globalIdxOf = new Map(sorted.map((s, i) => [s.id, i]))
    // 按轨道的有序索引（替代同轨 findIndex）
    const trackSorted = new Map<number, OpBlock[]>()
    const trackIdxOf = new Map<number, Map<string, number>>()
    for (const b of sorted) {
        let list = trackSorted.get(b.trackIndex)
        let map = trackIdxOf.get(b.trackIndex)
        if (!list || !map) {
            list = []
            map = new Map()
            trackSorted.set(b.trackIndex, list)
            trackIdxOf.set(b.trackIndex, map)
        }
        map.set(b.id, list.length)
        list.push(b)
    }
    let changed = false
    const updated = _opBlocks.map((b) => {
        if (!b.switchback || b.trackIndex >= lastTrackIdx) return b

        const sameTrackIdx = trackIdxOf.get(b.trackIndex)?.get(b.id)
        if (sameTrackIdx === undefined || sameTrackIdx <= 0) {
            changed = true
            return { ...b, switchback: false }
        }

        const globalIdx = globalIdxOf.get(b.id)
        if (globalIdx !== undefined && globalIdx > 0 && sorted[globalIdx - 1].trackIndex === b.trackIndex) {
            changed = true
            return { ...b, switchback: false }
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
                    if (b.id === _editingBlockId) return b
                    const lastTrackIdx = getTRACKS().length - 1
                    if (b.trackIndex >= lastTrackIdx) return b
                    const bl = b.pos - (_blockWidths[b.id] ?? 0) / 2
                    if (bl >= oldRight) return { ...b, pos: Math.max(0, Math.min(getMaxPos(), b.pos + shift)) }
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
export function snapBlockX(centerX: number, excludeId: string, width: number): number {
    const left = centerX - width / 2
    const right = centerX + width / 2
    for (const b of _opBlocks) {
        if (b.id === excludeId) continue
        const bw = _blockWidths[b.id] ?? 0
        const bLeft = b.pos - bw / 2
        const bRight = b.pos + bw / 2

        if (Math.abs(left - bRight) < SNAP_PX) return bRight + width / 2
        if (Math.abs(right - bLeft) < SNAP_PX) return bLeft - width / 2
    }
    for (const rl of _refLines) {
        if (Math.abs(right - rl.pos) < SNAP_PX) return rl.pos - width / 2
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
            result.push({ ...cur, pos: Math.max(0, Math.min(getMaxPos(), newPos)) })
        }
    }
    const resultById = new Map(result.map((r) => [r.id, r]))
    const updated = _opBlocks.map((b) => {
        const nb = resultById.get(b.id)
        return nb ?? b
    })
    _opBlocks = updated
    enforceIntro()
    enforceSwitchback()
}

export function formatTimeline() {
    if (!assertUnlocked()) return
    const lastTrackIdx = getTRACKS().length - 1
    const items = _opBlocks
        .filter((b) => b.trackIndex < lastTrackIdx)
        .map((b) => {
            const w = estimateOpBlockWidth(b)
            return { block: b, w, left: b.pos - w / 2, right: b.pos + w / 2 }
        })
        .sort((a, b) => a.left - b.left)
    if (items.length === 0) return

    const refInfo = _refLines.map((rl) => {
        let leftBlock: (typeof items)[number] | null = null
        let rightBlock: (typeof items)[number] | null = null
        let bestLeft = Infinity
        let bestRight = Infinity
        for (const it of items) {
            const dl = rl.pos - it.right
            if (it.right <= rl.pos && dl < bestLeft) {
                bestLeft = dl
                leftBlock = it
            }
            const dr = it.left - rl.pos
            if (it.left >= rl.pos && dr < bestRight) {
                bestRight = dr
                rightBlock = it
            }
        }
        return { rl, pos: rl.pos, leftBlock, rightBlock }
    })

    const widthById: Record<string, number> = {}
    const newPosById: Record<string, number> = {}
    let cursor = items[0].left
    for (const it of items) {
        const pos = Math.max(0, Math.min(getMaxPos(), cursor + it.w / 2))
        widthById[it.block.id] = it.w
        newPosById[it.block.id] = pos
        cursor = pos + it.w / 2
    }
    const leftOf = (id: string) => newPosById[id] - widthById[id] / 2
    const rightOf = (id: string) => newPosById[id] + widthById[id] / 2

    const placed = refInfo
        .map(({ rl, pos, leftBlock, rightBlock }) => {
            if (rl.id === 'left') return { rl, pos: 0 }
            if (leftBlock && rightBlock) {
                const origSpan = rightBlock.left - leftBlock.right
                const ratio = origSpan > 0 ? (pos - leftBlock.right) / origSpan : 0
                const newSpan = leftOf(rightBlock.block.id) - rightOf(leftBlock.block.id)
                return { rl, pos: rightOf(leftBlock.block.id) + ratio * newSpan }
            }
            if (leftBlock) return { rl, pos: rightOf(leftBlock.block.id) + (pos - leftBlock.right) }
            if (rightBlock) return { rl, pos: leftOf(rightBlock.block.id) - (rightBlock.left - pos) }
            return { rl, pos }
        })
        .sort((a, b) => a.pos - b.pos)

    const finalRefs: RefLine[] = []
    let prev = -Infinity
    for (const { rl, pos } of placed) {
        const p = rl.id === 'left' ? 0 : Math.max(prev + MIN_GAP, Math.min(getMaxPos(), pos))
        finalRefs.push({ ...rl, pos: p })
        prev = p
    }

    _opBlocks = _opBlocks.map((b) => (newPosById[b.id] !== undefined ? { ...b, pos: newPosById[b.id] } : b))
    _refLines = finalRefs
    enforceIntro()
    enforceSwitchback()
    save()
    addToast('已自动对齐：块右边界对接下一块左边界，参考线跟随', 'success')
}

// ── Damage Block Functions ──
export function addDamageBlock(sourceType: 'op' | 'ref', sourceId: string) {
    if (!assertUnlocked()) return
    const trackIndex = getTRACKS().length - 1
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

// 直接写入指定操作块绑定的技能命中列表（AI 排轴用；自动创建对应的伤害块）
export function setDamageBlockSkillHits(blockId: string, hits: SkillHit[]) {
    if (!assertUnlocked()) return
    const lastTrackIdx = getTRACKS().length - 1
    let dmg = _damageBlocks.find((d) => d.sourceId === blockId && d.trackIndex === lastTrackIdx)
    if (!dmg) {
        addDamageBlock('op', blockId)
        dmg = _damageBlocks.find((d) => d.sourceId === blockId && d.trackIndex === lastTrackIdx)
    }
    if (!dmg) return
    _damageBlocks = _damageBlocks
        .map((d) => (d.id === dmg.id ? { ...d, skillHits: hits } : d))
        .filter((d) => !(d.id === dmg.id && d.skillHits.length === 0 && d.nonDirectEntries.length === 0))
    save()
}

export function removeDamageBySource(sourceId: string, type: 'skillHits' | 'nonDirect' | 'all') {
    if (!assertUnlocked()) return
    _damageBlocks = _damageBlocks
        .map((d) => {
            if (d.sourceId !== sourceId) return d
            const lastTrackIdx = getTRACKS().length - 1
            if (d.trackIndex !== lastTrackIdx) return d
            if (type === 'all') return { ...d, skillHits: [], nonDirectEntries: [] }
            if (type === 'skillHits') return { ...d, skillHits: [] }
            return { ...d, nonDirectEntries: [] }
        })
        .filter(
            (d) =>
                !(
                    d.sourceId === sourceId &&
                    d.trackIndex === getTRACKS().length - 1 &&
                    d.skillHits.length === 0 &&
                    d.nonDirectEntries.length === 0
                )
        )
    save()
}

// 直接写入指定操作块绑定的非直伤条目（AI 排轴用；自动创建对应的伤害块）
export function setDamageBlockNonDirectEntries(blockId: string, entries: NonDirectEntry[]) {
    if (!assertUnlocked()) return
    const lastTrackIdx = getTRACKS().length - 1
    let dmg = _damageBlocks.find((d) => d.sourceId === blockId && d.trackIndex === lastTrackIdx)
    if (!dmg) {
        addDamageBlock('op', blockId)
        dmg = _damageBlocks.find((d) => d.sourceId === blockId && d.trackIndex === lastTrackIdx)
    }
    if (!dmg) return
    _damageBlocks = _damageBlocks
        .map((d) => (d.id === dmg.id ? { ...d, nonDirectEntries: entries } : d))
        .filter((d) => !(d.id === dmg.id && d.skillHits.length === 0 && d.nonDirectEntries.length === 0))
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

// 完整技能命中（AI 绑定用）：角色技能 + 装备声骸技能 + 用户自定义直伤，与 UI 选择器一致
export async function getFullSkillGroups(charName: string): Promise<SkillPickerGroup[]> {
    const groups = await loadCharSkills(charName)
    const withEcho = [...groups]
    const idx = getTeamCharNames().indexOf(charName)
    const echoName = idx >= 0 ? (_team[idx]?.echoes?.[0]?.name ?? null) : null
    if (echoName) {
        const cached = await loadEchoSkill(echoName)
        if (cached?.values?.length) {
            withEcho.push({
                type: '声骸技能',
                hits: cached.values.map(([n, v, e]) => ({ name: n, ratio: v, element: e }))
            })
        }
    }
    return appendCustomGroups(withEcho, charName)
}

function buildSkillGroups(skills: SkillEntry[]): SkillPickerGroup[] {
    const groups: SkillPickerGroup[] = []
    for (const skill of skills) {
        const hits: { name: string; ratio: string; element: string }[] = []
        for (const [name, value, element] of skill.values) {
            if (value && element) hits.push({ name, ratio: value, element })
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
    const lastTrackIdx = getTRACKS().length - 1
    if (!op || op.trackIndex >= lastTrackIdx) return
    if (!_damageBlocks.find((d) => d.sourceId === blockId && d.trackIndex === lastTrackIdx)) {
        addDamageBlock('op', blockId)
    }
    const dmg = _damageBlocks.find((d) => d.sourceId === blockId && d.trackIndex === lastTrackIdx)
    if (!dmg) return
    _skillPickerBlockId = dmg.id
    _skillPickerIsRef = false
    _skillPickerCharacter = _team[op.trackIndex]?.character ?? ''
    _skillPickerLoading = true
    _skillPickerGroups = []
    _opSkillPickerCache = {}
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
        _opSkillPickerCache[_skillPickerCharacter] = groups
        await appendEchoSkillToCache(_opSkillPickerCache, _skillPickerCharacter)
        _skillPickerGroups = appendCustomGroups(_opSkillPickerCache[_skillPickerCharacter], _skillPickerCharacter)
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
        const base = _skillPickerIsRef ? _refSkillPickerCache[character] : _opSkillPickerCache[character]
        const groups = appendCustomGroups(base ?? _skillPickerGroups.filter((g) => g.type !== '自定义'), character)
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
                        ratio = customHitRatio(ch)
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
    addToast('已应用直伤配置', 'success')
}

export async function openRefSkillPicker(blockId: string) {
    if (!assertUnlocked()) return
    const lastTrackIdx = getTRACKS().length - 1
    const dmg = _damageBlocks.find((d) => d.sourceId === blockId && d.trackIndex === lastTrackIdx)
    if (!dmg) addDamageBlock('ref', blockId)
    const block = _damageBlocks.find((d) => d.sourceId === blockId && d.trackIndex === lastTrackIdx)
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
    await loadCharGroupsToCache(_refSkillPickerCache, _skillPickerCharacter)
}

function customHitRatio(ch: CustomHit): string {
    const parts: string[] = []
    if (ch.flatValue > 0) parts.push(ch.flatValue.toString())
    if (ch.pctValue > 0) {
        const suf =
            ch.pctUnit === '攻击%' ? '' : ch.pctUnit === '生命%' ? '生命' : ch.pctUnit === '防御%' ? '防御' : ch.pctUnit
        parts.push(ch.pctValue + '%' + suf)
    }
    return parts.join('+') || '0'
}

function appendCustomGroups(groups: SkillPickerGroup[], charName: string): SkillPickerGroup[] {
    const customHits = _customSkillHits[charName] ?? []
    if (customHits.length === 0) return groups
    return [
        ...groups,
        {
            type: '自定义',
            hits: customHits.map((ch) => ({
                name: ch.id,
                ratio: customHitRatio(ch),
                element: ch.element
            }))
        }
    ]
}

async function loadCharGroupsToCache(cache: Record<string, SkillPickerGroup[]>, charName: string) {
    if (cache[charName]) {
        _skillPickerGroups = appendCustomGroups(cache[charName], charName)
        return
    }
    _skillPickerLoading = true
    try {
        const groups = await loadCharSkills(charName)
        cache[charName] = groups
        await appendEchoSkillToCache(cache, charName)
        _skillPickerGroups = appendCustomGroups(cache[charName], charName)
    } catch {
        _skillPickerGroups = []
    } finally {
        _skillPickerLoading = false
    }
}

async function appendEchoSkillToCache(cache: Record<string, SkillPickerGroup[]>, charName: string) {
    const idx = getTeamCharNames().indexOf(charName)
    if (idx < 0) return
    const echoName = _team[idx]?.echoes?.[0]?.name ?? null
    if (!echoName) return
    const cached = await loadEchoSkill(echoName)
    if (cached?.values?.length) {
        const echoHits = cached.values.map(([n, v, e]) => ({ name: n, ratio: v, element: e }))
        const existing = cache[charName] ?? []
        cache[charName] = [...existing, { type: '声骸技能', hits: echoHits }]
    }
}

export async function appendEchoSkillToRefCache(charName: string) {
    await appendEchoSkillToCache(_refSkillPickerCache, charName)
}

export async function switchRefSkillPickerTab(charName: string) {
    _skillPickerCharacter = charName
    await loadCharGroupsToCache(_refSkillPickerCache, charName)
}

export async function switchOpSkillPickerTab(charName: string) {
    _skillPickerCharacter = charName
    await loadCharGroupsToCache(_opSkillPickerCache, charName)
}

export function switchSkillPickerTab(charName: string) {
    return _skillPickerIsRef ? switchRefSkillPickerTab(charName) : switchOpSkillPickerTab(charName)
}

// ── Non-Direct Picker Functions ──
export function openNonDirectPicker(sourceType: 'op' | 'ref', blockId: string) {
    if (!assertUnlocked()) return
    const lastTrackIdx = getTRACKS().length - 1
    const dmg = _damageBlocks.find((d) => d.sourceId === blockId && d.trackIndex === lastTrackIdx)
    if (!dmg) addDamageBlock(sourceType, blockId)
    const block = _damageBlocks.find((d) => d.sourceId === blockId && d.trackIndex === lastTrackIdx)
    if (!block) return
    _nonDirectPickerBlockId = block.id
    _nonDirectPickerData = NON_DIRECT_CONFIGS.map((cfg) => {
        const existing = block.nonDirectEntries.find((e) => e.name === cfg.name)
        return {
            name: cfg.name,
            category: cfg.category,
            layers: cfg.category === '响应' ? 0 : (existing?.layers ?? 0),
            hits: cfg.category === '响应' ? 1 : (existing?.hits ?? 1)
        }
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
    const sourceChar = op && op.trackIndex < getTRACKS().length - 1 ? (_team[op.trackIndex]?.character ?? null) : null
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
            entries.push({
                name: d.name,
                category: d.category as '处决' | '效应' | '响应',
                layers: d.layers,
                hits: d.hits
            })
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
    addToast('已应用非直伤配置', 'success')
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
                    : op && op.trackIndex < getTRACKS().length - 1
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
                const character = d.sourceType === 'ref' ? h.character || '无' : h.character || sourceChar
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
                const hits = dianci?.hits ?? 1
                const mult = getEffectMultiplier('电磁效应', layers)
                const burstMult = getEffectBurstMultiplier('电磁效应', burstLayers)
                const total = mult + burstMult
                entries.push({
                    character: '无',
                    name: `电磁效应${layers}层+爆发${burstLayers}层${hits > 1 ? `×${hits}段` : ''}`,
                    value:
                        (burstLayers > 0
                            ? (mult * 100).toFixed(2) + '%+' + (burstMult * 100).toFixed(2) + '%'
                            : (mult * 100).toFixed(2) + '%') + (hits > 1 ? `*${hits}` : ''),
                    baseType: '效应系数',
                    time,
                    x,
                    element: '导电'
                })
            }
            for (const nd of effectNDs) {
                if (nd.name === '电磁效应' || nd.name === '电磁爆发') continue
                const mult = getEffectMultiplier(nd.name, nd.layers)
                const hits = nd.hits ?? 1
                entries.push({
                    character: '无',
                    name: nd.name + nd.layers + '层' + (hits > 1 ? `×${hits}段` : ''),
                    value: (mult * 100).toFixed(2) + '%' + (hits > 1 ? `*${hits}` : ''),
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

// 拖动进入 AI 悬浮窗等"禁区"时：取消进行中的框选/拖拽并还原（不保存、不触发松开副作用）
registerDragCancel(() => {
    // 框选：丢弃选区，不执行选中逻辑
    _selectionRect = null
    // 参考线拖拽：非组拖时 _refLines 未变，丢弃视觉位置即还原；组拖恢复初始快照
    if (_draggingId) {
        if (_isGroupDrag) {
            _opBlocks = _opBlocks.map((b) =>
                _dragBlockInitialPositions[b.id] !== undefined ? { ...b, pos: _dragBlockInitialPositions[b.id] } : b
            )
            _refLines = _refLines.map((r) =>
                _dragRefInitialPositions[r.id] !== undefined ? { ...r, pos: _dragRefInitialPositions[r.id] } : r
            )
        }
        _dragVisualPositions = {}
        _draggingId = null
        resetGroupDrag()
    }
    // 块拖拽：非组拖时 _opBlocks 未变（视觉位置在 _dragBlockVisualPositions），丢弃即还原；组拖恢复初始快照
    if (_dragBlockId) {
        if (_isGroupDrag) {
            _opBlocks = _opBlocks.map((b) =>
                _dragBlockInitialPositions[b.id] !== undefined ? { ...b, pos: _dragBlockInitialPositions[b.id] } : b
            )
            _refLines = _refLines.map((r) =>
                _dragRefInitialPositions[r.id] !== undefined ? { ...r, pos: _dragRefInitialPositions[r.id] } : r
            )
        }
        _dragBlockVisualPositions = {}
        _dragBlockInitialPositions = {}
        _dragRefInitialPositions = {}
        _isGroupDrag = false
        _dragBlockId = null
    }
})
