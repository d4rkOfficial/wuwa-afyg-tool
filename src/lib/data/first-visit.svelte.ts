// 首次访问标记：localStorage 一次性标记（首次访问）。
import { browser } from '$app/environment'

/** @desc 首次访问标记的 key；改十六进制特征数或版本号都等于「重置首次进入标记」（下次进入按首次处理） */
const VISITED_KEY = 'wuwa-afyg:visited_62B78000:v5'

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
