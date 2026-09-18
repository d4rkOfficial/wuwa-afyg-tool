// 右键菜单偏好（持久化到 localStorage）：排轴页操作块/参考线右键菜单简化开关
import { browser } from '$app/environment'

const SIMPLIFY_KEY = 'wuwa-afyg:context-menu-prefs'

// 默认开启简化（仅保留重命名、伤害绑定与删除）
let _simplify = $state(true)

if (browser) {
    try {
        const saved = localStorage.getItem(SIMPLIFY_KEY)
        if (saved === '0' || saved === '1') _simplify = saved === '1'
    } catch {
        /* ignore */
    }
}

export function getSimplifyContextMenu(): boolean {
    return _simplify
}

export function setSimplifyContextMenu(v: boolean): void {
    _simplify = v
    if (browser) localStorage.setItem(SIMPLIFY_KEY, v ? '1' : '0')
}
