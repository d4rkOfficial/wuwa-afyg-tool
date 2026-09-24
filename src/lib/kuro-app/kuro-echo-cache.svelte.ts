import { browser } from '$app/environment'
import type { KuroCharacterEchoes } from '$lib/kuro-app/kuro.svelte'

/**
 * @desc 角色声骸数据的本地暂存（避免反复打上游被风控）：
 *  - 同步时优先用缓存，**有缓存就不请求上游**；没缓存才请求一次并写入缓存
 *  - 刷新只能手动，且同一份数据 5 分钟内只允许刷新一次
 *  - 按绑定角色 roleId 归属：换角色/换账号时不命中（退出登录会清掉）
 */

const KEY = 'wuwa-afyg:kuro:echo-cache'

/** @desc 手动刷新的最小间隔 */
export const KURO_REFRESH_COOLDOWN_MS = 5 * 60 * 1000

export interface KuroEchoCacheEntry {
    roleId: string
    /** @desc 从上游取到这份数据的时间戳 */
    fetchedAt: number
    characters: KuroCharacterEchoes[]
}

let _cache = $state<KuroEchoCacheEntry | null>(null)
let loaded = false

/** @desc 启动时读一次本地缓存 */
export function loadKuroEchoCache(): void {
    if (!browser || loaded) return
    loaded = true
    try {
        const raw = localStorage.getItem(KEY)
        _cache = raw ? (JSON.parse(raw) as KuroEchoCacheEntry) : null
    } catch {
        _cache = null
    }
}

const persist = () => {
    if (!browser) return
    try {
        if (_cache) localStorage.setItem(KEY, JSON.stringify(_cache))
        else localStorage.removeItem(KEY)
    } catch {
        // 存不下（配额）就算了，本次会话内仍可用内存里的那份
    }
}

/** @desc 取该角色的缓存（角色不匹配视为没有） */
export const getKuroEchoCache = (roleId: string): KuroEchoCacheEntry | null =>
    _cache && _cache.roleId === roleId ? _cache : null

export const getKuroEchoCacheEntry = (): KuroEchoCacheEntry | null => _cache

export const saveKuroEchoCache = (roleId: string, characters: KuroCharacterEchoes[]): void => {
    _cache = { roleId, fetchedAt: Date.now(), characters }
    persist()
}

export const clearKuroEchoCache = (): void => {
    _cache = null
    persist()
}

/** @desc 距离下次可刷新还剩多少毫秒（0 = 可以刷新） */
export const kuroRefreshCooldownLeft = (roleId: string): number => {
    const entry = getKuroEchoCache(roleId)
    if (!entry) return 0
    return Math.max(0, KURO_REFRESH_COOLDOWN_MS - (Date.now() - entry.fetchedAt))
}
