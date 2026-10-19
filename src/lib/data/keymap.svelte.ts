import { browser } from '$app/environment'
import { dbGet, dbSet } from './db'

export interface KeyMapEntry {
    id: string
    blockKey: string
    physical: string
    label: string
}

const KEY = 'keymap'

const DEFAULT_ENTRIES: KeyMapEntry[] = [
    { id: 'attack', blockKey: 'MouseLeft', physical: 'a', label: '普攻' },
    { id: 'heavypress', blockKey: 'MouseLeftHold', physical: 'z', label: '重击' },
    { id: 'dodge', blockKey: 'MouseRight', physical: 's', label: '闪避' },
    { id: 'q', blockKey: 'Q', physical: 'q', label: 'Q' },
    { id: 'e', blockKey: 'E', physical: 'e', label: 'E' },
    { id: 'r', blockKey: 'R', physical: 'r', label: 'R' },
    { id: 'f', blockKey: 'F', physical: 'f', label: 'F' },
    { id: 't', blockKey: 'T', physical: 't', label: 'T' },
    { id: 'space', blockKey: 'SpaceBar', physical: ' ', label: '跳跃' }
]

function clone(list: KeyMapEntry[]): KeyMapEntry[] {
    return JSON.parse(JSON.stringify(list))
}

function isValidShortcut(physical: string): boolean {
    return physical === ' ' || /^[a-z]$/.test(physical)
}

/** @desc 旧版「重击与普攻共用左键图标」：存量数据里的旧默认值迁到独立的重击图标，用户自定义值保持不变 */
const LEGACY_BLOCK_KEYS: Record<string, string> = {
    heavypress: 'MouseLeft'
}

const migrateBlockKey = (id: string, blockKey: string): string => {
    if (LEGACY_BLOCK_KEYS[id] !== blockKey) return blockKey
    return DEFAULT_ENTRIES.find((e) => e.id === id)?.blockKey ?? blockKey
}

let entries = $state<KeyMapEntry[]>(clone(DEFAULT_ENTRIES))

export async function loadKeyMap() {
    if (!browser) return
    const saved = await dbGet<KeyMapEntry[]>(KEY)
    if (!saved?.data?.length) return
    const byId = new Map(DEFAULT_ENTRIES.map((e) => [e.id, e]))
    const seen = new Set<string>()
    const normalized: KeyMapEntry[] = []
    for (const e of saved.data) {
        const def = byId.get(e.id)
        if (!def || seen.has(e.id)) continue
        seen.add(e.id)
        normalized.push({
            id: e.id,
            blockKey: migrateBlockKey(e.id, e.blockKey || def.blockKey),
            physical: isValidShortcut(e.physical) ? e.physical : def.physical,
            label: e.label || def.label
        })
    }
    for (const d of DEFAULT_ENTRIES) {
        if (!seen.has(d.id)) normalized.push({ ...d })
    }
    entries = normalized
    await dbSet(KEY, entries)
}

export function getKeyMapEntries(): KeyMapEntry[] {
    return entries
}

export function getDefaultBlockKey(entryId: string): string {
    return DEFAULT_ENTRIES.find((e) => e.id === entryId)?.blockKey ?? ''
}

export async function updateKeyMapEntry(entry: KeyMapEntry) {
    entries = entries.map((e) => (e.id === entry.id ? { ...e, ...entry } : e))
    await dbSet(KEY, entries)
}

export async function removeKeyMapEntry(id: string) {
    entries = entries.filter((e) => e.id !== id)
    await dbSet(KEY, entries)
}

export async function resetKeyMap() {
    entries = clone(DEFAULT_ENTRIES)
    await dbSet(KEY, entries)
}

export function normalizeKeyEvent(e: KeyboardEvent): string {
    const k = e.key
    if (k.length === 1) return k === ' ' ? ' ' : k.toLowerCase()
    switch (k) {
        case 'Escape':
            return 'escape'
        case 'Tab':
            return 'tab'
        case 'CapsLock':
            return 'capslock'
        case 'Shift':
            return e.location === 2 ? 'rightshift' : 'leftshift'
        case 'Control':
            return e.location === 2 ? 'rightctrl' : 'leftctrl'
        case 'Alt':
            return e.location === 2 ? 'rightalt' : 'leftalt'
        case 'Enter':
            return 'enter'
        case 'Backspace':
            return 'backspace'
        case 'Delete':
            return 'delete'
        case 'ArrowUp':
            return 'arrowup'
        case 'ArrowDown':
            return 'arrowdown'
        case 'ArrowLeft':
            return 'arrowleft'
        case 'ArrowRight':
            return 'arrowright'
        default:
            return k.toLowerCase()
    }
}

export function physicalLabel(physical: string): string {
    const map: Record<string, string> = {
        ' ': '空格',
        escape: 'Esc',
        tab: 'Tab',
        capslock: 'CapsLock',
        leftshift: '左Shift',
        rightshift: '右Shift',
        leftctrl: '左Ctrl',
        rightctrl: '右Ctrl',
        leftalt: '左Alt',
        rightalt: '右Alt',
        enter: 'Enter',
        backspace: 'Backspace',
        delete: 'Del',
        arrowup: '↑',
        arrowdown: '↓',
        arrowleft: '←',
        arrowright: '→'
    }
    return map[physical] ?? physical.toUpperCase()
}
