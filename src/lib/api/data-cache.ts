import { browser } from '$app/environment'
import { DATA_CDN_CACHE_NAME } from '$lib/api/consts'
import { getCurrentProviderId as getProviderId, providerQuery } from '$lib/api/provider'
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

const PREFIX = 'wuwa-afyg:v2:'
const LIST_TTL = 7 * 24 * 60 * 60 * 1000
const INFO_TTL = 7 * 24 * 60 * 60 * 1000
const ICON_TTL = 7 * 24 * 60 * 60 * 1000

const DEFAULT_PROVIDER = 'nanoka'

/** 当前上游作用域（默认 nanoka）。用于让缓存命名空间与上游绑定。 */
function providerScope(): string {
    const id = getProviderId()
    return id === DEFAULT_PROVIDER ? '' : `${id}/`
}

/** 在本地 API 路径后附加 ?provider= 查询参数（仅非默认上游时）。 */
function withProviderUrl(path: string): string {
    return path + providerQuery()
}

const memoryCache = new Map<string, unknown>()
const inFlight = new Map<string, Promise<unknown>>()

function cacheKey(cat: string, entity: string, name?: string): string {
    return `${PREFIX}${providerScope()}${cat}:${entity}${name ? `:${name}` : ''}`
}

// ── IndexedDB 持久缓存：结构化克隆（免大 JSON 反复 stringify/parse），localStorage 仅作回退/迁移 ──
const IDB_NAME = 'wuwa-afyg-cache'
const IDB_STORE = 'kv'
let _idbPromise: Promise<IDBDatabase> | null = null

function openIDB(): Promise<IDBDatabase> {
    if (_idbPromise) return _idbPromise
    _idbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB unavailable'))
            return
        }
        const req = indexedDB.open(IDB_NAME, 1)
        req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    })
    _idbPromise.catch(() => {
        _idbPromise = null
    })
    return _idbPromise
}

function idbRun<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return openIDB().then(
        (db) =>
            new Promise<T>((resolve, reject) => {
                const tx = db.transaction(IDB_STORE, mode)
                const req = fn(tx.objectStore(IDB_STORE))
                req.onsuccess = () => resolve(req.result)
                req.onerror = () => reject(req.error)
            })
    )
}

async function idbGet<T>(k: string): Promise<{ data: T; ts: number } | null> {
    try {
        return (await idbRun<{ data: T; ts: number } | undefined>('readonly', (s) => s.get(k))) ?? null
    } catch {
        return null
    }
}

async function idbSet(k: string, entry: { data: unknown; ts: number }): Promise<void> {
    await idbRun('readwrite', (s) => s.put(entry, k))
}

async function idbDelete(k: string): Promise<void> {
    try {
        await idbRun('readwrite', (s) => s.delete(k))
    } catch {}
}

async function idbKeys(): Promise<string[]> {
    try {
        return (await idbRun<IDBValidKey[]>('readonly', (s) => s.getAllKeys())).filter(
            (k): k is string => typeof k === 'string'
        )
    } catch {
        return []
    }
}

/** @desc 读持久缓存：IndexedDB 优先（结构化克隆，免 JSON.parse），localStorage 兜底并迁移到 IDB */
async function getLocal<T>(k: string, ttl: number): Promise<T | null> {
    if (!browser) return null
    const hit = await idbGet<T>(k)
    if (hit) {
        if (Date.now() - hit.ts > ttl) {
            void idbDelete(k)
            return null
        }
        return hit.data
    }
    try {
        const raw = localStorage.getItem(k)
        if (!raw) return null
        const entry = JSON.parse(raw)
        if (Date.now() - entry.ts > ttl) {
            localStorage.removeItem(k)
            return null
        }
        // 迁移到 IDB 后移除 localStorage 旧条目（避免后续重复 parse 与计数重复）
        idbSet(k, entry)
            .then(() => {
                try {
                    localStorage.removeItem(k)
                } catch {}
            })
            .catch(() => {})
        return entry.data as T
    } catch {
        return null
    }
}

/** @desc 写持久缓存：IDB 优先；IDB 不可用时回退 localStorage */
function setLocal(k: string, data: unknown): void {
    if (!browser) return
    const entry = { data, ts: Date.now() }
    idbSet(k, entry).catch(() => {
        try {
            localStorage.setItem(k, JSON.stringify(entry))
        } catch {}
    })
}

async function fetchJSON<T>(url: string, cacheK: string, ttl: number): Promise<T> {
    if (memoryCache.has(cacheK)) return memoryCache.get(cacheK) as T
    const cached = await getLocal<T>(cacheK, ttl)
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

async function fetchBatchIcons(entity: string): Promise<Record<string, string>> {
    const k = cacheKey('batch-icons', entity)
    if (memoryCache.has(k)) return memoryCache.get(k) as Record<string, string>
    const cached = await getLocal<Record<string, string>>(k, ICON_TTL)
    if (cached) {
        memoryCache.set(k, cached)
        return cached
    }
    if (inFlight.has(k)) return inFlight.get(k) as Promise<Record<string, string>>

    const promise = (async () => {
        const url = withProviderUrl(`/api/v1/batch-icons/${entity}`)
        const res = await fetch(url)
        if (!res.ok) throw new Error(`API ${res.status}: ${url}`)
        const data: Record<string, string> = await res.json()
        memoryCache.set(k, data)
        setLocal(k, data)
        warmImageCache(Object.values(data))
        return data
    })()

    inFlight.set(k, promise)
    try {
        return await promise
    } finally {
        inFlight.delete(k)
    }
}

function warmImageCache(urls: string[]) {
    if (typeof caches === 'undefined') return
    caches.open(DATA_CDN_CACHE_NAME).then((cache) => {
        for (const url of urls) {
            cache.match(url).then((hit) => {
                if (!hit)
                    fetch(url, { mode: 'no-cors' })
                        .then((r) => cache.put(url, r))
                        .catch(() => {})
            })
        }
    })
}

// ── Static icon maps ──

const ELEMENT_ICONS: Record<string, string> = {
    物理: '/icons/element/物理.webp',
    冷凝: '/icons/element/冷凝.webp',
    热熔: '/icons/element/热熔.webp',
    导电: '/icons/element/导电.webp',
    气动: '/icons/element/气动.webp',
    衍射: '/icons/element/衍射.webp',
    湮灭: '/icons/element/湮灭.webp'
}

const WEAPON_TYPE_ICONS: Record<string, string> = {
    长刃: '/icons/weapon-type/长刃.webp',
    迅刀: '/icons/weapon-type/迅刀.webp',
    佩枪: '/icons/weapon-type/佩枪.webp',
    臂铠: '/icons/weapon-type/臂铠.webp',
    音感仪: '/icons/weapon-type/音感仪.webp'
}

const UI_BTN_ICONS: Record<string, string> = {
    MouseLeft: '/icons/btn/MouseLeft.webp',
    MouseRight: '/icons/btn/MouseRight.webp',
    MouseMiddle: '/icons/btn/MouseMiddle.webp',
    SpaceBar: '/icons/btn/SpaceBar.webp',
    Q: '/icons/btn/Q.webp',
    W: '/icons/btn/W.webp',
    E: '/icons/btn/E.webp',
    R: '/icons/btn/R.webp',
    T: '/icons/btn/T.webp',
    Y: '/icons/btn/Y.webp',
    U: '/icons/btn/U.webp',
    I: '/icons/btn/I.webp',
    O: '/icons/btn/O.webp',
    P: '/icons/btn/P.webp',
    A: '/icons/btn/A.webp',
    S: '/icons/btn/S.webp',
    D: '/icons/btn/D.webp',
    F: '/icons/btn/F.webp',
    G: '/icons/btn/G.webp',
    H: '/icons/btn/H.webp',
    J: '/icons/btn/J.webp',
    K: '/icons/btn/K.webp',
    L: '/icons/btn/L.webp',
    Z: '/icons/btn/Z.webp',
    X: '/icons/btn/X.webp',
    C: '/icons/btn/C.webp',
    V: '/icons/btn/V.webp',
    B: '/icons/btn/B.webp',
    N: '/icons/btn/N.webp',
    M: '/icons/btn/M.webp',
    '0': '/icons/btn/0.webp',
    '1': '/icons/btn/1.webp',
    '2': '/icons/btn/2.webp',
    '3': '/icons/btn/3.webp',
    '4': '/icons/btn/4.webp',
    '5': '/icons/btn/5.webp',
    '6': '/icons/btn/6.webp',
    '7': '/icons/btn/7.webp',
    '8': '/icons/btn/8.webp',
    '9': '/icons/btn/9.webp',
    Esc: '/icons/btn/Esc.webp',
    Tab: '/icons/btn/Tab.webp',
    CapsLock: '/icons/btn/CapsLock.webp',
    LeftShift: '/icons/btn/LeftShift.webp',
    RightShift: '/icons/btn/RightShift.webp',
    LeftCtrl: '/icons/btn/LeftCtrl.webp',
    RightCtrl: '/icons/btn/RightCtrl.webp',
    LeftAlt: '/icons/btn/LeftAlt.webp',
    RightAlt: '/icons/btn/RightAlt.webp',
    Enter: '/icons/btn/Enter.webp',
    Backspace: '/icons/btn/Backspace.webp',
    Delete: '/icons/btn/Delete.webp',
    Up: '/icons/btn/Up.webp',
    Down: '/icons/btn/Down.webp',
    Left: '/icons/btn/Left.webp',
    Right: '/icons/btn/Right.webp'
}

// ── Lists ──

export function getCharacterList(): Promise<Character[]> {
    return fetchJSON<Character[]>(withProviderUrl('/api/v1/list/character'), cacheKey('list', 'character'), LIST_TTL)
}

export function getWeaponList(): Promise<Weapon[]> {
    return fetchJSON<Weapon[]>(withProviderUrl('/api/v1/list/weapon'), cacheKey('list', 'weapon'), LIST_TTL)
}

export function getEchoList(): Promise<Echo[]> {
    return fetchJSON<Echo[]>(withProviderUrl('/api/v1/list/echo'), cacheKey('list', 'echo'), LIST_TTL)
}

export function getEchoSetList(): Promise<EchoSetItem[]> {
    return fetchJSON<EchoSetItem[]>(withProviderUrl('/api/v1/list/echo-set'), cacheKey('list', 'echo-set'), LIST_TTL)
}

// ── Icons ──

export function getCharacterIcons(): Promise<Record<string, string>> {
    return fetchBatchIcons('character')
}

export function getWeaponIcons(): Promise<Record<string, string>> {
    return fetchBatchIcons('weapon')
}

export function getEchoIcons(): Promise<Record<string, string>> {
    return fetchBatchIcons('echo')
}

export function getEchoSetIcons(): Promise<Record<string, string>> {
    return fetchBatchIcons('echo-set')
}

export function getElementIcons(): Promise<Record<string, string>> {
    return Promise.resolve(ELEMENT_ICONS)
}

export function getWeaponTypeIcons(): Promise<Record<string, string>> {
    return Promise.resolve(WEAPON_TYPE_ICONS)
}

export function getUiBtnIcons(): Promise<Record<string, string>> {
    return Promise.resolve(UI_BTN_ICONS)
}

// ── Info ──

export function getCharacterInfo(name: string): Promise<CharacterInfo> {
    return fetchJSON<CharacterInfo>(
        withProviderUrl(`/api/v2/info/character/${encodeURIComponent(name)}`),
        cacheKey('info', 'character-v2', name),
        INFO_TTL
    )
}

export function getWeaponInfo(name: string): Promise<WeaponInfo> {
    return fetchJSON<WeaponInfo>(
        withProviderUrl(`/api/v1/info/weapon/${encodeURIComponent(name)}`),
        cacheKey('info', 'weapon', name),
        INFO_TTL
    )
}

export function getEchoInfo(name: string): Promise<EchoInfo> {
    return fetchJSON<EchoInfo>(
        withProviderUrl(`/api/v1/info/echo/${encodeURIComponent(name)}`),
        cacheKey('info', 'echo', name),
        INFO_TTL
    )
}

export function getEchoSetInfo(name: string): Promise<EchoSetInfo> {
    return fetchJSON<EchoSetInfo>(
        withProviderUrl(`/api/v1/info/echo-set/${encodeURIComponent(name)}`),
        cacheKey('info', 'echo-set', name),
        INFO_TTL
    )
}

// ── Cache management ──

export function clearCache(category?: string, entity?: string): void {
    if (!browser) return
    const prefix = category ? cacheKey(category, entity ?? '') : PREFIX
    for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i)
        if (k?.startsWith(prefix)) localStorage.removeItem(k)
    }
    for (const k of memoryCache.keys()) {
        if (k.startsWith(prefix)) memoryCache.delete(k)
    }
    // 同步清内存/localStorage 后异步清 IDB（调用方无需等待，稍后收敛）
    void idbKeys().then((keys) => {
        for (const k of keys) {
            if (k.startsWith(prefix)) void idbDelete(k)
        }
    })
}

export type CacheCategory = 'list' | 'info' | 'image'

/** 分类清理接口数据缓存（仅清理 wuwa-afyg:v2: 命名空间，不影响用户工程/预设） */
export async function clearCacheCategory(kind: CacheCategory): Promise<void> {
    const lsPrefix =
        kind === 'list' ? cacheKey('list', '') : kind === 'info' ? cacheKey('info', '') : cacheKey('batch-icons', '')
    if (kind === 'list') {
        clearCache('list')
    } else if (kind === 'info') {
        clearCache('info')
    } else {
        clearCache('batch-icons')
        if (typeof caches !== 'undefined') {
            await caches.delete(DATA_CDN_CACHE_NAME).catch(() => {})
        }
    }
    // 等待 IDB 侧清理完成（settings 面板随后刷新计数）
    const keys = await idbKeys()
    for (const k of keys) {
        if (k.startsWith(lsPrefix)) await idbDelete(k)
    }
}

/** 统计某类缓存的 IDB + localStorage 条目数 */
export async function countCacheCategory(kind: CacheCategory): Promise<number> {
    if (!browser) return 0
    const prefix =
        kind === 'list' ? cacheKey('list', '') : kind === 'info' ? cacheKey('info', '') : cacheKey('batch-icons', '')
    const idbCount = (await idbKeys()).filter((k) => k.startsWith(prefix)).length
    let lsCount = 0
    for (let i = 0; i < localStorage.length; i++) {
        if (localStorage.key(i)?.startsWith(prefix)) lsCount++
    }
    return idbCount + lsCount
}
