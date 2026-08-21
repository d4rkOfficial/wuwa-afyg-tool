// ── 上游数据源选择（客户端持久化） ────────────────────────────────────────
// 用户在“连接配置”里选中的上游数据源。选择持久化到 localStorage，业务层
// （src/lib/data/api.ts 等）读取它，在请求 /api/v1|v2 时附加 ?provider= 传给
// server 端，server 端再据此取用对应适配器。

import { browser } from '$app/environment'
import { listProviders, getCurrentProviderId, setProvider, resetProvider, REGISTRY } from '$lib/api/provider'

export interface ProviderOption {
    id: string
    label: string
}

// 简化 store：非响应式读取为主（源切换后靠全量刷新重新拉数据）
let _activeId = $state<string>(getCurrentProviderId())
let _options = $state<ProviderOption[]>(listProviders())
// 每个上游的最新版本（badge 展示用），providerId → version
const _versions = $state<Record<string, string>>({})

export function getProviderOptions(): ProviderOption[] {
    return _options
}

/** 每个上游已加载的最新版本（可能为空串=加载中/失败）。 */
export function getProviderVersions(): Record<string, string> {
    return _versions
}

/** 拉取各上游最新版本，通过本地端点 /api/v1/version/latest?provider= 转给 server。 */
export async function loadProviderVersions(): Promise<void> {
    if (!browser) return
    const options = _options
    await Promise.all(
        options.map(async (o) => {
            try {
                const res = await fetch(`/api/v1/version/latest?provider=${encodeURIComponent(o.id)}`)
                if (res.ok) {
                    const text = (await res.text()).trim()
                    if (text && text !== '""') _versions[o.id] = JSON.parse(text)
                }
            } catch {
                /* keep empty */
            }
        })
    )
}

export function getActiveProviderId(): string {
    return _activeId
}

export function getActiveProviderLabel(): string {
    return _options.find((o) => o.id === _activeId)?.label ?? _activeId
}

/** 切换上游并持久化。返回是否成功。 */
export function setActiveProvider(id: string): boolean {
    if (!REGISTRY.some((r) => r.id === id)) return false
    setProvider(id)
    _activeId = id
    return true
}

/** 恢复默认上游（nanoka）。 */
export function resetActiveProvider(): void {
    resetProvider()
    _activeId = getCurrentProviderId()
}

/** 供页面初始加载时同步一次（从 localStorage 读到的值兜底）。 */
export function syncProviderPref(): void {
    _activeId = getCurrentProviderId()
    _options = listProviders()
}

// 供 b 端 data/api.ts 拼查询参数
export function getProviderQueryParam(): string | undefined {
    if (!browser) return undefined
    const id = getCurrentProviderId()
    return id === undefined || id === 'nanoka' ? undefined : id
}
