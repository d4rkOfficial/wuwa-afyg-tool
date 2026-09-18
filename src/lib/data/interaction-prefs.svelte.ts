// 交互偏好（持久化到 localStorage）：删除二次确认弹窗开关、Toast 弹出位置
import { browser } from '$app/environment'

const CONFIRM_DELETES_KEY = 'wuwa-afyg:interaction-prefs:confirm-deletes'
const TOAST_POSITION_KEY = 'wuwa-afyg:interaction-prefs:toast-position'

/** @desc Toast 弹出位置；none = 不弹出 */
export type ToastPosition =
    'top-right' | 'none' | 'top-left' | 'top-center' | 'bottom-center' | 'bottom-left' | 'bottom-right'

/** @desc 可选位置（顺序即设置面板里的按钮顺序，与默认值一致） */
export const TOAST_POSITIONS: ToastPosition[] = [
    'top-right',
    'none',
    'top-left',
    'top-center',
    'bottom-center',
    'bottom-left',
    'bottom-right'
]

// 默认开启删除二次确认；Toast 默认右上角
let _confirmDeletes = $state(true)
let _toastPosition = $state<ToastPosition>('top-right')

if (browser) {
    try {
        const saved = localStorage.getItem(CONFIRM_DELETES_KEY)
        if (saved === '0' || saved === '1') _confirmDeletes = saved === '1'
    } catch {
        /* ignore */
    }
    try {
        const saved = localStorage.getItem(TOAST_POSITION_KEY)
        if (saved && (TOAST_POSITIONS as string[]).includes(saved)) _toastPosition = saved as ToastPosition
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

export function getToastPosition(): ToastPosition {
    return _toastPosition
}

export function setToastPosition(v: ToastPosition): void {
    if (!TOAST_POSITIONS.includes(v)) return
    _toastPosition = v
    if (browser) localStorage.setItem(TOAST_POSITION_KEY, v)
}
