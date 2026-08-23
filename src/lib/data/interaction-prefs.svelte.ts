// 交互偏好（持久化到 localStorage）：删除二次确认弹窗开关、侧边栏速查等
import { browser } from '$app/environment'

const CONFIRM_DELETES_KEY = 'wuwa-afyg:interaction-prefs:confirm-deletes'
const SIDEBAR_LOOKUP_KEY = 'wuwa-afyg:interaction-prefs:sidebar-lookup'

// 默认开启删除二次确认
let _confirmDeletes = $state(true)

if (browser) {
    try {
        const saved = localStorage.getItem(CONFIRM_DELETES_KEY)
        if (saved === '0' || saved === '1') _confirmDeletes = saved === '1'
    } catch {
        /* ignore */
    }
}

export function getConfirmDeletes(): boolean {
    return _confirmDeletes
}

export function setConfirmDeletes(v: boolean): void {
    _confirmDeletes = v
    if (browser) localStorage.setItem(CONFIRM_DELETES_KEY, v ? '1' : '0')
}

// 侧边栏速查：开启后底部工具栏速查按钮隐藏，速查改由侧边栏承载
let _sidebarLookup = $state(false)

if (browser) {
    try {
        const saved = localStorage.getItem(SIDEBAR_LOOKUP_KEY)
        if (saved === '0' || saved === '1') _sidebarLookup = saved === '1'
    } catch {
        /* ignore */
    }
}

export function getSidebarLookup(): boolean {
    return _sidebarLookup
}

export function setSidebarLookup(v: boolean): void {
    _sidebarLookup = v
    if (browser) localStorage.setItem(SIDEBAR_LOOKUP_KEY, v ? '1' : '0')
}
