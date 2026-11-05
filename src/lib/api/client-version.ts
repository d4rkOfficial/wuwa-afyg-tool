// ── 客户端版本助手 ────────────────────────────────────────────────────────
// 客户端展示/对比当前数据版本用。版本最终由服务端 provider 决定，客户端统一
// 通过本地端点 /api/v1/version/latest 获取，不感知具体上游。
// 无服务端的独立静态包（STANDALONE=1）由 `$lib/api/local-api` 在浏览器内解析同一路径并
// 直接问上游 manifest —— 调用方看到的仍是同一个函数。
// 若其它代码需要拿到 nanoka 的模块态版本，请通过该端点，而不要直接读上游。

import { browser } from '$app/environment'
import { fetchApiJson } from '$lib/api/local-api'
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
                const v = await fetchApiJson<unknown>(`/api/v1/version/latest${providerQuery()}`)
                if (typeof v === 'string' && v) {
                    _wwVersion = v
                    if (browser) localStorage.setItem(VERSION_KEY, v)
                }
            } catch {
                // keep fallback
            }
        })()
    }
    return _versionPromise
}
