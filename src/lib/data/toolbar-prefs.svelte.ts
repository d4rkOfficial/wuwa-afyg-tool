// 底部工具栏偏好（持久化到 localStorage）：简化模式开关（拖动位置为内存态，刷新回默认）
import { browser } from '$app/environment'

const STORAGE_KEY = 'wuwa-afyg:toolbar-prefs'

let _simplify = $state(false)

if (browser) {
    try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved === '0' || saved === '1') _simplify = saved === '1'
    } catch {
        /* ignore */
    }
}

export function getSimplifyToolbar(): boolean {
    return _simplify
}

export function setSimplifyToolbar(v: boolean): void {
    _simplify = v
    if (browser) localStorage.setItem(STORAGE_KEY, v ? '1' : '0')
}
