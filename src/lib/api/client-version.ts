// ── 客户端版本助手 ────────────────────────────────────────────────────────
// 客户端展示/对比当前数据版本用。版本最终由服务端 provider 决定，客户端统一
// 通过本地端点 /api/v1/version/latest 获取，不感知具体上游。
// 若其它代码需要拿到 nanoka 的模块态版本，请通过该端点，而不要直接读上游。

import { browser } from '$app/environment'
import { providerQuery } from '$lib/api/provider'

const VERSION_KEY = 'wuwa-afyg:ww-version'

let _wwVersion = browser ? (localStorage.getItem(VERSION_KEY) ?? '3.5') : '3.5'
let _versionPromise: Promise<void> | null = null

export function getWWVersion(): string {
    return _wwVersion
}

export function resetVersionPromise(): void {
    _versionPromise = null
}

export async function ensureVersion(): Promise<void> {
    if (!_versionPromise) {
        _versionPromise = (async () => {
            try {
                const res = await fetch('/api/v1/version/latest' + providerQuery())
                if (res.ok) {
                    const v: unknown = await res.json()
                    if (typeof v === 'string' && v) {
                        _wwVersion = v
                        if (browser) localStorage.setItem(VERSION_KEY, v)
                    }
                }
            } catch {
                // keep fallback
            }
        })()
    }
    return _versionPromise
}
