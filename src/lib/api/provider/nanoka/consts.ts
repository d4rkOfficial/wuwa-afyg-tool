// ── nanoka 上游常量与版本管理 ───────────────────────────────────────────
// 仅由 nanoka 适配器使用；base URL 与版本解析都封装在此，不被应用其他层感知。

import { browser } from '$app/environment'
import type { NanokaManifest } from './types'

export const NANOKA_BASE = 'https://static.nanoka.cc'
export const ZH_DATA_BASE = `${NANOKA_BASE}/ww`
export const ASSET_BASE = `${NANOKA_BASE}/assets/ww`

const VERSION_KEY = 'wuwa-afyg:ww-version'

let _wwVersion = browser ? (localStorage.getItem(VERSION_KEY) ?? '3.5') : '3.5'

export function getWWVersion() {
    return _wwVersion
}

export function getDataBase() {
    return `${NANOKA_BASE}/ww/${_wwVersion}`
}

let _versionPromise: Promise<void> | null = null

export function resetVersionPromise() {
    _versionPromise = null
}

// 本地不存在版本服务端点（/api/v1/version/latest）时直接拉 manifest 兜底。
export async function ensureVersion() {
    if (!_versionPromise) {
        _versionPromise = (async () => {
            try {
                const ctrl = new AbortController()
                const timer = setTimeout(() => ctrl.abort(), 5000)
                const res = await fetch(`${NANOKA_BASE}/manifest.json`, { signal: ctrl.signal })
                clearTimeout(timer)
                const text = await res.text()
                if (text) {
                    const parsed: NanokaManifest | string = JSON.parse(text)
                    _wwVersion = typeof parsed === 'string' ? parsed : (parsed.ww?.latest ?? _wwVersion)
                    if (browser) localStorage.setItem(VERSION_KEY, _wwVersion)
                }
            } catch {
                // keep fallback
            }
        })()
    }
    return _versionPromise
}

// ── manifest ──

export async function fetchManifest(): Promise<NanokaManifest> {
    const res = await fetch(`${NANOKA_BASE}/manifest.json`)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return res.json()
}

export async function fetchLatestVersion(): Promise<string> {
    const manifest = await fetchManifest()
    return manifest.ww?.latest ?? _wwVersion
}

export async function fetchAvailableVersions(): Promise<string[]> {
    const manifest = await fetchManifest()
    return manifest.ww?.available ?? ['3.5']
}
