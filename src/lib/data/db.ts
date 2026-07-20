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

export async function dbSet(key: string, data: unknown): Promise<void> {
    if (!browser) return
    try {
        const db = await openDB()
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite')
            tx.objectStore(STORE_NAME).put({ key, data, ts: Date.now() })
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
