import { browser } from '$app/environment'

const DB_NAME = 'wuwa-v1'
const DB_VERSION = 1
const STORE_NAME = 'cache'

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
    if (!browser) return Promise.reject(new Error('not browser'))
    if (dbPromise) return dbPromise
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)
        request.onupgradeneeded = (e) => {
            const db = (e.target as IDBOpenDBRequest).result
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' })
                store.createIndex('ts', 'ts', { unique: false })
            }
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
    return dbPromise
}

export async function dbGet<T>(key: string): Promise<{ data: T; ts: number } | null> {
    if (!browser) return null
    try {
        const db = await openDB()
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly')
            const req = tx.objectStore(STORE_NAME).get(key)
            req.onsuccess = () => resolve((req.result as { data: T; ts: number }) ?? null)
            req.onerror = () => reject(req.error)
        })
    } catch (err) {
        console.error('[dbGet]', key, err)
        return null
    }
}

/**
 * @desc 把待落盘的数据转成**结构化克隆安全**的纯值（IndexedDB 写入的唯一闸门）。
 *
 * 为什么必须有这一层：Svelte 5 的 `$state` 读出来的对象/数组一律是 **Proxy**，而结构化克隆
 * （`indexedDB.put` 与 `structuredClone` 同一套算法）**明确拒绝 Proxy** —— `put(proxy)` 抛
 * `DataCloneError`，被 `dbSet` 的 try/catch 吞掉后只留一行 console.error。
 * 症状就是「设置改完看起来生效了，退出重进就丢」：内存里的 `$state` 是新的，盘上什么都没写。
 *
 * 实证（本仓库探针）：`let x = $state([])` 经 `svelte/compiler` 编成 `$.state($.proxy([]))`，
 * 重新赋值走 `$.set(source, v, true)`（同样代理），故 `dbSet(KEY, 任意 $state)` 必然命中；
 * 而 `structuredClone(new Proxy({}, {}))` 在 Node/浏览器都直接抛 `DataCloneError`。
 * 受影响的存量调用点：`workshop`（工坊/分享源）、`keymap`（按键图标）、`shortcuts`（快捷键位）、
 * `ai-prefs`（AI 助手偏好）——它们原先都直接传 `$state`，长期静默写入失败。
 *
 * 两条路：先试 `structuredClone`（原生、保真，Date/Map/Blob 等原样保留），失败（= Proxy / 含函数）
 * 再退回 JSON 深拷贝（各 store 存的本就是 JSON 安全结构）。收敛到落盘口而不是逐个调用点改，
 * 是为了不再有下一个 store 忘掉 `$state.snapshot`（结构化克隆不认 Proxy 这类坑在 Worker/序列化场景里反复出现过）。
 */
export const toStorable = <T>(data: T): unknown => {
    try {
        return structuredClone(data)
    } catch {
        return JSON.parse(JSON.stringify(data))
    }
}

export async function dbSet(key: string, data: unknown): Promise<void> {
    if (!browser) return
    try {
        const db = await openDB()
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite')
            tx.objectStore(STORE_NAME).put({ key, data: toStorable(data), ts: Date.now() })
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
    } catch (err) {
        console.error('[dbSet]', key, err)
    }
}

export async function dbDelete(key: string): Promise<void> {
    if (!browser) return
    try {
        const db = await openDB()
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite')
            tx.objectStore(STORE_NAME).delete(key)
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
    } catch (err) {
        console.error('[dbDelete]', key, err)
    }
}

export async function dbClear(prefix?: string): Promise<void> {
    if (!browser) return
    try {
        const db = await openDB()
        if (prefix) {
            const tx = db.transaction(STORE_NAME, 'readwrite')
            const store = tx.objectStore(STORE_NAME)
            const req = store.openCursor()
            await new Promise<void>((resolve, reject) => {
                req.onsuccess = () => {
                    const cursor = req.result
                    if (cursor) {
                        if (String(cursor.key).startsWith(prefix)) cursor.delete()
                        cursor.continue()
                    } else {
                        resolve()
                    }
                }
                req.onerror = () => reject(req.error)
            })
        } else {
            const tx = db.transaction(STORE_NAME, 'readwrite')
            tx.objectStore(STORE_NAME).clear()
        }
    } catch (err) {
        console.error('[dbClear]', prefix ?? '(all)', err)
    }
}
