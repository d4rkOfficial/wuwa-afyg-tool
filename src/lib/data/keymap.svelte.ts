import { browser } from '$app/environment'
import { dbGet, dbSet } from './db'

export interface KeyMapEntry {
    id: string
    blockKey: string
    physical: string
    label: string
}

const KEY = 'keymap'

const SHARED_KEY_GROUPS: Record<string, string> = {
    attack: 'left-attack',
    heavypress: 'left-attack'
}

const DEFAULT_ENTRIES: KeyMapEntry[] = [
    { id: 'attack', blockKey: 'MouseLeft', physical: 'a', label: '普攻' },
    { id: 'heavypress', blockKey: 'MouseLeft', physical: 'z', label: '重击' },
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
            blockKey: e.blockKey || def.blockKey,
            physical: isValidShortcut(e.physical) ? e.physical : def.physical,
            label: e.label || def.label
        })
    }
    for (const d of DEFAULT_ENTRIES) {
        if (!seen.has(d.id)) normalized.push({ ...d })
    }
    for (const group of new Set(Object.values(SHARED_KEY_GROUPS))) {
        const first = normalized.find((n) => SHARED_KEY_GROUPS[n.id] === group)
        if (!first) continue
        for (const n of normalized) {
            if (SHARED_KEY_GROUPS[n.id] === group) n.blockKey = first.blockKey
        }
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
    let next = entries.map((e) => (e.id === entry.id ? { ...e, ...entry } : e))
    const group = entry.blockKey !== undefined ? SHARED_KEY_GROUPS[entry.id] : undefined
    if (group) {
        next = next.map((e) => (SHARED_KEY_GROUPS[e.id] === group ? { ...e, blockKey: entry.blockKey } : e))
    }
    entries = next
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
