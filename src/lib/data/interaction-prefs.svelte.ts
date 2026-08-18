// 交互偏好（持久化到 localStorage）：删除二次确认弹窗开关等
import { browser } from '$app/environment'

const CONFIRM_DELETES_KEY = 'wuwa-afyg:interaction-prefs:confirm-deletes'

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
