import { browser } from '$app/environment'
import { SHARE_BASE } from '$lib/api/consts'
import { dbGet, dbSet } from './db'

export interface WorkshopInstance {
    id: string
    url: string
    /**
     * @desc 工坊站点 `<title>`（如「椰果工坊 · 鸣算屋转接器」）。
     * `undefined` = 尚未抓取；`''` = 已尝试抓取但失败（持久化后不再重试）。
     */
    title?: string
}

const KEY = 'workshop'

/** @desc 鸣算屋转接器：站点同时支持 http/https，默认用 https，避免 https 页面请求明文工坊被浏览器当混合内容拦截 */
const WUWACALC_CONV_BASE = 'https://wuwacalc-conv.200503.xyz'

const DEFAULT_URLS = [SHARE_BASE, WUWACALC_CONV_BASE]

const defaultInstances = (): WorkshopInstance[] => DEFAULT_URLS.map((url, i) => ({ id: `ws-${i}`, url }))

function normalizeUrl(url: string): string {
    return url.trim().replace(/\/+$/, '')
}

let instances = $state<WorkshopInstance[]>(defaultInstances())
let activeId = $state(instances[0]?.id ?? '')

/** @desc 同一 URL 的标题只抓一次（并发调用共用同一个 Promise，避免 add/switch/load 重复请求） */
const titleJobs = new Map<string, Promise<string>>()

const persist = (): Promise<void> => dbSet(KEY, { instances, activeId })

const fetchWorkshopTitle = (url: string): Promise<string> => {
    if (!browser) return Promise.resolve('')
    const existing = titleJobs.get(url)
    if (existing) return existing
    const job = (async () => {
        try {
            const res = await fetch(`/api/v1/workshop/title?url=${encodeURIComponent(url)}`)
            if (!res.ok) return ''
            const data = (await res.json()) as { title?: unknown }
            return typeof data.title === 'string' ? data.title.trim() : ''
        } catch {
            return ''
        }
    })()
    titleJobs.set(url, job)
    return job
}

const setTitle = (id: string, title: string) => {
    instances = instances.map((instance) => (instance.id === id ? { ...instance, title } : instance))
}

/** @desc 只给「尚未抓取」的实例补标题；失败也写入空串，避免每次启动都重试 */
const ensureTitle = async (id: string): Promise<void> => {
    const instance = instances.find((i) => i.id === id)
    if (!instance || instance.title !== undefined) return
    const title = await fetchWorkshopTitle(instance.url)
    setTitle(id, title)
    await persist()
}

const ensureAllTitles = async (): Promise<void> => {
    const missing = instances.filter((instance) => instance.title === undefined)
    if (missing.length === 0) return
    await Promise.all(
        missing.map(async (instance) => {
            const title = await fetchWorkshopTitle(instance.url)
            setTitle(instance.id, title)
        })
    )
    await persist()
}

export async function loadWorkshop() {
    if (!browser) return
    const saved = await dbGet<{ instances: WorkshopInstance[]; activeId: string }>(KEY)
    if (saved?.data?.instances?.length) {
        instances = saved.data.instances
        activeId = instances.some((i) => i.id === saved.data.activeId) ? saved.data.activeId : instances[0].id
    }
    await ensureAllTitles()
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
    await persist()
    await ensureTitle(id)
}

export async function addWorkshop(url: string): Promise<boolean> {
    const u = normalizeUrl(url)
    if (!u || instances.some((i) => i.url === u)) return false
    const id = `ws-${Date.now()}`
    instances = [...instances, { id, url: u }]
    await persist()
    await ensureTitle(id)
    return true
}

export async function removeWorkshop(id: string) {
    if (instances.length <= 1) return
    const next = instances.filter((i) => i.id !== id)
    if (next.length === instances.length) return
    instances = next
    if (activeId === id) activeId = next[0].id
    await persist()
}

export async function resetWorkshop() {
    instances = defaultInstances()
    activeId = instances[0].id
    await persist()
    await ensureAllTitles()
}
