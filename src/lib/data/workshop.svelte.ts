import { browser } from '$app/environment'
import { SHARE_BASE } from '$lib/api/consts'
import { dbGet, dbSet } from './db'

export interface WorkshopInstance {
    id: string
    url: string
}

const KEY = 'workshop'

const DEFAULT_URLS = [SHARE_BASE, 'https://wuwa-standard.200503.xyz']

function normalizeUrl(url: string): string {
    return url.trim().replace(/\/+$/, '')
}

let instances = $state<WorkshopInstance[]>(DEFAULT_URLS.map((url, i) => ({ id: `ws-${i}`, url })))
let activeId = $state(instances[0]?.id ?? '')

export async function loadWorkshop() {
    if (!browser) return
    const saved = await dbGet<{ instances: WorkshopInstance[]; activeId: string }>(KEY)
    if (saved?.data?.instances?.length) {
        instances = saved.data.instances
        activeId = instances.some((i) => i.id === saved.data.activeId) ? saved.data.activeId : instances[0].id
    }
}

export function getWorkshopInstances(): WorkshopInstance[] {
    return instances
}

export function getActiveWorkshopUrl(): string {
    return instances.find((i) => i.id === activeId)?.url ?? DEFAULT_URLS[0]
}

export function getActiveWorkshopId(): string {
    return instances.some((i) => i.id === activeId) ? activeId : (instances[0]?.id ?? '')
}

export function getShareBase(): string {
    return getActiveWorkshopUrl()
}

export async function setActiveWorkshop(id: string) {
    if (!instances.some((i) => i.id === id)) return
    activeId = id
    await dbSet(KEY, { instances, activeId })
}

export async function addWorkshop(url: string): Promise<boolean> {
    const u = normalizeUrl(url)
    if (!u || instances.some((i) => i.url === u)) return false
    instances = [...instances, { id: `ws-${Date.now()}`, url: u }]
    await dbSet(KEY, { instances, activeId })
    return true
}

export async function removeWorkshop(id: string) {
    if (instances.length <= 1) return
    const next = instances.filter((i) => i.id !== id)
    if (next.length === instances.length) return
    instances = next
    if (activeId === id) activeId = next[0].id
    await dbSet(KEY, { instances, activeId })
}

export async function resetWorkshop() {
    instances = DEFAULT_URLS.map((url, i) => ({ id: `ws-${i}`, url }))
    activeId = instances[0].id
    await dbSet(KEY, { instances, activeId })
}
