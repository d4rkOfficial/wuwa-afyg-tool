import { browser } from '$app/environment'
import { dbGet, dbSet, dbClear } from './db'
import type {
    Character,
    Weapon,
    Echo,
    EchoSetItem,
    CharacterInfo,
    WeaponInfo,
    EchoInfo,
    EchoSetInfo
} from '$lib/api/types'

const PREFIX = 'wuwa-v1:'
const LIST_TTL = 24 * 60 * 60 * 1000
const INFO_TTL = 24 * 60 * 60 * 1000
const ICON_TTL = 7 * 24 * 60 * 60 * 1000

const memoryCache = new Map<string, unknown>()
const inFlight = new Map<string, Promise<unknown>>()

function cacheKey(cat: string, entity: string, name?: string): string {
    return `${PREFIX}${cat}:${entity}${name ? ':' + name : ''}`
}

function getLocal<T>(k: string, ttl: number): T | null {
    if (!browser) return null
    try {
        const raw = localStorage.getItem(k)
        if (!raw) return null
        const entry = JSON.parse(raw)
        if (Date.now() - entry.ts > ttl) {
            localStorage.removeItem(k)
            return null
        }
        return entry.data as T
    } catch {
        return null
    }
}

function setLocal(k: string, data: unknown): void {
    if (!browser) return
    try {
        localStorage.setItem(k, JSON.stringify({ data, ts: Date.now() }))
    } catch {
        /* silently ignore quota errors; list/info data is small */
    }
}

async function fetchJSON<T>(url: string, cacheK: string, ttl: number): Promise<T> {
    if (memoryCache.has(cacheK)) return memoryCache.get(cacheK) as T
    const cached = getLocal<T>(cacheK, ttl)
    if (cached) {
        memoryCache.set(cacheK, cached)
        return cached
    }
    if (inFlight.has(cacheK)) return inFlight.get(cacheK) as Promise<T>

    const promise = (async () => {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`API ${res.status}: ${url}`)
        const data: T = await res.json()
        memoryCache.set(cacheK, data)
        setLocal(cacheK, data)
        return data
    })()

    inFlight.set(cacheK, promise)
    try {
        return await promise
    } finally {
        inFlight.delete(cacheK)
    }
}

async function fetchIcons(entity: string): Promise<Record<string, string>> {
    const k = cacheKey('icons', entity)
    if (memoryCache.has(k)) return memoryCache.get(k) as Record<string, string>

    // Check IndexedDB first
    const idbEntry = await dbGet<Record<string, string>>(k)
    if (idbEntry && Date.now() - idbEntry.ts <= ICON_TTL) {
        memoryCache.set(k, idbEntry.data)
        return idbEntry.data
    }

    // Migration: check localStorage for old cached data
    const lsCached = getLocal<Record<string, string>>(k, ICON_TTL)
    if (lsCached) {
        memoryCache.set(k, lsCached)
        dbSet(k, lsCached)
        localStorage.removeItem(k)
        return lsCached
    }

    if (inFlight.has(k)) return inFlight.get(k) as Promise<Record<string, string>>

    const promise = (async () => {
        const res = await fetch(`/api/v1/icons/${entity}`)
        if (!res.ok) throw new Error(`API ${res.status}: /api/v1/icons/${entity}`)
        const pairs: [string, string][] = await res.json()

        const map: Record<string, string> = {}
        await Promise.all(
            pairs.map(async ([name, url]) => {
                try {
                    const imgRes = await fetch(url)
                    if (!imgRes.ok) return
                    const blob = await imgRes.blob()
                    const base64 = await new Promise<string>((resolve, reject) => {
                        const reader = new FileReader()
                        reader.onloadend = () => resolve(reader.result as string)
                        reader.onerror = reject
                        reader.readAsDataURL(blob)
                    })
                    map[name] = base64
                } catch {
                    map[name] = url
                }
            })
        )

        memoryCache.set(k, map)
        await dbSet(k, map)
        return map
    })()

    inFlight.set(k, promise)
    try {
        return await promise
    } finally {
        inFlight.delete(k)
    }
}

// ── Lists ──

export function getCharacterList(): Promise<Character[]> {
    return fetchJSON<Character[]>('/api/v1/list/character', cacheKey('list', 'character'), LIST_TTL)
}

export function getWeaponList(): Promise<Weapon[]> {
    return fetchJSON<Weapon[]>('/api/v1/list/weapon', cacheKey('list', 'weapon'), LIST_TTL)
}

export function getEchoList(): Promise<Echo[]> {
    return fetchJSON<Echo[]>('/api/v1/list/echo', cacheKey('list', 'echo'), LIST_TTL)
}

export function getEchoSetList(): Promise<EchoSetItem[]> {
    return fetchJSON<EchoSetItem[]>('/api/v1/list/echo-set', cacheKey('list', 'echo-set'), LIST_TTL)
}

// ── Icons ──

export function getCharacterIcons(): Promise<Record<string, string>> {
    return fetchIcons('character')
}

export function getWeaponIcons(): Promise<Record<string, string>> {
    return fetchIcons('weapon')
}

export function getEchoIcons(): Promise<Record<string, string>> {
    return fetchIcons('echo')
}

export function getElementIcons(): Promise<Record<string, string>> {
    return fetchIcons('element')
}

export function getWeaponTypeIcons(): Promise<Record<string, string>> {
    return fetchIcons('weapon-type')
}

export function getEchoSetIcons(): Promise<Record<string, string>> {
    return fetchIcons('echo-set')
}

export function getUiBtnIcons(): Promise<Record<string, string>> {
    return fetchIcons('ui-btn')
}

// ── Info ──

export function getCharacterInfo(name: string): Promise<CharacterInfo> {
    return fetchJSON<CharacterInfo>(
        `/api/v1/info/character/${encodeURIComponent(name)}`,
        cacheKey('info', 'character', name),
        INFO_TTL
    )
}

export function getWeaponInfo(name: string): Promise<WeaponInfo> {
    return fetchJSON<WeaponInfo>(
        `/api/v1/info/weapon/${encodeURIComponent(name)}`,
        cacheKey('info', 'weapon', name),
        INFO_TTL
    )
}

export function getEchoInfo(name: string): Promise<EchoInfo> {
    return fetchJSON<EchoInfo>(
        `/api/v1/info/echo/${encodeURIComponent(name)}`,
        cacheKey('info', 'echo', name),
        INFO_TTL
    )
}

export function getEchoSetInfo(name: string): Promise<EchoSetInfo> {
    return fetchJSON<EchoSetInfo>(
        `/api/v1/info/echo-set/${encodeURIComponent(name)}`,
        cacheKey('info', 'echo-set', name),
        INFO_TTL
    )
}

// ── Cache management ──

export function clearCache(category?: string, entity?: string): void {
    if (!browser) return
    if (!category) {
        dbClear(PREFIX)
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i)
            if (k?.startsWith(PREFIX)) localStorage.removeItem(k)
        }
        memoryCache.clear()
        return
    }
    const prefix = cacheKey(category, entity ?? '')
    dbClear(prefix)
    for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i)
        if (k?.startsWith(prefix)) localStorage.removeItem(k)
    }
    for (const k of memoryCache.keys()) {
        if (k.startsWith(prefix)) memoryCache.delete(k)
    }
}
