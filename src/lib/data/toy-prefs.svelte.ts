// Toy 相关持久化偏好：localStorage 一次性标记（首次访问 / 关闭磁力光标设定）。
import { browser } from '$app/environment'

const VISITED_KEY = 'wuwa-afyg:visited'
const MAGNETIC_TOY_KEY = 'wuwa-afyg:magnetic-toy-set'

/** 是否首次访问 tool（无 visited 标记） */
export function isFirstVisit(): boolean {
    if (!browser) return false
    try {
        return !localStorage.getItem(VISITED_KEY)
    } catch {
        return false
    }
}

export function markVisited(): void {
    if (!browser) return
    try {
        localStorage.setItem(VISITED_KEY, '1')
    } catch {
        /* ignore */
    }
}

/** 是否已在 Toy 手机环境执行过「关闭磁力光标」一次性设定 */
export function isMagneticToySet(): boolean {
    if (!browser) return false
    try {
        return localStorage.getItem(MAGNETIC_TOY_KEY) === '1'
    } catch {
        return false
    }
}

export function markMagneticToySet(): void {
    if (!browser) return
    try {
        localStorage.setItem(MAGNETIC_TOY_KEY, '1')
    } catch {
        /* ignore */
    }
}
