import { browser } from '$app/environment'

const DB_NAME = 'wuwa-afyg-cache'
const DB_VERSION = 1
const STORE_NAME = 'resources'

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
    if (!browser) return Promise.reject(new Error('IndexedDB not available in SSR'))
    if (dbPromise) return dbPromise
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)
        request.onupgradeneeded = () => {
            request.result.createObjectStore(STORE_NAME)
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
    return dbPromise
}

export async function get<T = unknown>(key: string): Promise<T | null> {
    try {
        const db = await openDB()
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly')
            const req = tx.objectStore(STORE_NAME).get(key)
            req.onsuccess = () => resolve(req.result ?? null)
            req.onerror = () => reject(req.error)
        })
    } catch {
        return null
    }
}

export async function set(key: string, value: unknown): Promise<void> {
    try {
        const db = await openDB()
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite')
            const req = tx.objectStore(STORE_NAME).put(value, key)
            req.onsuccess = () => resolve()
            req.onerror = () => reject(req.error)
        })
    } catch {
        // silently fail
    }
}

export async function remove(key: string): Promise<void> {
    try {
        const db = await openDB()
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite')
            const req = tx.objectStore(STORE_NAME).delete(key)
            req.onsuccess = () => resolve()
            req.onerror = () => reject(req.error)
        })
    } catch {
        // silently fail
    }
}

export async function clear(): Promise<void> {
    try {
        const db = await openDB()
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite')
            const req = tx.objectStore(STORE_NAME).clear()
            req.onsuccess = () => resolve()
            req.onerror = () => reject(req.error)
        })
    } catch {
        // silently fail
    }
}
