// ── 数据适配器注册表与选择 ───────────────────────────────────────────────
// 应用可通过 getProvider() 获得当前选中的上游适配器，其余代码完全不必感知
// 具体上游。注册新的上游只需在 REGISTRY 增加一个 factory 即可。
//
// 说明：factory 可通过 create() 返回独立实例以隔离各上游自身的缓存态；当前
// nanoka 采用共享单例（与重构前的模块级缓存行为一致），版本缓存跨请求共享。

import { browser } from '$app/environment'
import type { DataProvider } from './types'
import { nanokaProvider } from './nanoka'

const PROVIDER_KEY = 'wuwa-afyg:data-provider'

interface ProviderFactory {
    id: string
    label: string
    create: () => DataProvider
}

// 在此注册新的上游适配器：
export const REGISTRY: ProviderFactory[] = [
    {
        id: nanokaProvider.id,
        label: nanokaProvider.label,
        create: () => nanokaProvider
    }
]

const DEFAULT_ID = 'nanoka'

let _forcedId: string | undefined

function getStoredId(): string | undefined {
    if (!browser) return undefined
    try {
        return localStorage.getItem(PROVIDER_KEY) ?? undefined
    } catch {
        return undefined
    }
}

/** 当前可用的上游（用于设置界面展示，不持久化）。 */
export function listProviders(): { id: string; label: string }[] {
    return REGISTRY.map((r) => ({ id: r.id, label: r.label }))
}

/** 获取当前选中的上游 id（浏览器优先取 localStorage 持久化值；无则默认）。 */
export function getCurrentProviderId(): string {
    return _forcedId ?? getStoredId() ?? DEFAULT_ID
}

/**
 * 从请求 URL 解析 ?provider= 查询参数。用于 server 端点把客户端选择传给适配器。
 * 无参数时返回 undefined（由 getProvider 取持久化/默认）。
 */
export function providerIdFromUrl(url: URL): string | undefined {
    const p = url.searchParams.get('provider')
    return p && REGISTRY.some((r) => r.id === p) ? p : undefined
}

/**
 * 生成附加在本地 API 路径上的 ?provider= 查询片段（客户端用）。
 * 默认上游 nanoka 返回空串（不附加），切换后才附加，保持兼容。
 */
export function providerQuery(): string {
    const id = getCurrentProviderId()
    return id === DEFAULT_ID ? '' : `?provider=${encodeURIComponent(id)}`
}

/**
 * 获取上游适配器实例。
 * @param id 可选显式指定；省略时取持久化选择（浏览器）或默认。server 端请显式传入
 *           由客户端 ?provider= 查询参数解析出的 id，否则无法感知客户端选择。
 */
export function getProvider(id?: string): DataProvider {
    const resolved = id || getCurrentProviderId()
    const factory =
        REGISTRY.find((r) => r.id === resolved) ?? (REGISTRY.find((r) => r.id === DEFAULT_ID) as ProviderFactory)
    return factory.create()
}

/** 切换上游并将选择持久化到 localStorage（仅浏览器端生效）。 */
export function setProvider(id: string): void {
    if (!REGISTRY.some((r) => r.id === id)) throw new Error(`Unknown data provider: ${id}`)
    _forcedId = id
    if (browser) {
        try {
            localStorage.setItem(PROVIDER_KEY, id)
        } catch {
            /* ignore quota/security errors */
        }
    }
}

/** 清除选择，回到默认上游（nanoka）。 */
export function resetProvider(): void {
    _forcedId = undefined
    if (browser) {
        try {
            localStorage.removeItem(PROVIDER_KEY)
        } catch {
            /* ignore */
        }
    }
}
