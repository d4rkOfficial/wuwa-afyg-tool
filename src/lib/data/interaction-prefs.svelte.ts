// 交互偏好（持久化到 localStorage）：删除二次确认弹窗开关、Toast 弹出位置、锁定水印
import { browser } from '$app/environment'

const CONFIRM_DELETES_KEY = 'wuwa-afyg:interaction-prefs:confirm-deletes'
const TOAST_POSITION_KEY = 'wuwa-afyg:interaction-prefs:toast-position'
const LOCK_WATERMARK_KEY = 'wuwa-afyg:interaction-prefs:lock-watermark'
const LOCK_WATERMARK_TEXT_KEY = 'wuwa-afyg:interaction-prefs:lock-watermark-text'
const SIDEBAR_ACTIONS_KEY = 'wuwa-afyg:interaction-prefs:sidebar-actions'
const MODAL_CLOSE_KEY = 'wuwa-afyg:interaction-prefs:modal-close-position'

/** @desc 锁定水印默认文案（文本框留空时回落到它） */
export const DEFAULT_LOCK_WATERMARK_TEXT = '已锁定'
/** @desc 锁定水印文案长度上限 */
export const LOCK_WATERMARK_TEXT_MAX = 24

/** @desc 弹窗关闭按钮位置 */
export type ModalClosePosition = 'top-left' | 'top-right'

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

// 默认开启删除二次确认；Toast 默认右上角；锁定水印默认开启并使用默认文案
let _confirmDeletes = $state(true)
let _toastPosition = $state<ToastPosition>('top-right')
let _lockWatermark = $state(true)
let _lockWatermarkText = $state(DEFAULT_LOCK_WATERMARK_TEXT)
/** @desc 侧边栏底部是否显示「新建 / 从本地导入 / 从工坊下载」操作区（默认开启） */
let _sidebarActions = $state(true)
/** @desc 弹窗关闭按钮位置（默认右上角；B 站 Toy 平台首次进入默认左上角） */
let _modalClosePosition = $state<ModalClosePosition>('top-right')

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
    try {
        const saved = localStorage.getItem(LOCK_WATERMARK_KEY)
        if (saved === '0' || saved === '1') _lockWatermark = saved === '1'
    } catch {
        /* ignore */
    }
    try {
        const saved = localStorage.getItem(LOCK_WATERMARK_TEXT_KEY)
        if (saved !== null) _lockWatermarkText = saved.slice(0, LOCK_WATERMARK_TEXT_MAX)
    } catch {
        /* ignore */
    }
    try {
        const saved = localStorage.getItem(SIDEBAR_ACTIONS_KEY)
        if (saved === '0' || saved === '1') _sidebarActions = saved === '1'
    } catch {
        /* ignore */
    }
}

/** @desc 弹窗关闭按钮位置 */
export function getModalClosePosition(): ModalClosePosition {
    return _modalClosePosition
}

export function setModalClosePosition(v: ModalClosePosition): void {
    _modalClosePosition = v
    if (browser) localStorage.setItem(MODAL_CLOSE_KEY, v)
}

/** @desc 侧边栏底部操作区（新建 / 从本地导入 / 从工坊下载）是否显示 */
export function getSidebarActions(): boolean {
    return _sidebarActions
}

export function setSidebarActions(v: boolean): void {
    _sidebarActions = v
    if (browser) localStorage.setItem(SIDEBAR_ACTIONS_KEY, v ? '1' : '0')
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

/** @desc 锁定水印是否显示（排轴页阶段锁定时铺满的平铺水印） */
export function getLockWatermark(): boolean {
    return _lockWatermark
}

export function setLockWatermark(v: boolean): void {
    _lockWatermark = v
    if (browser) localStorage.setItem(LOCK_WATERMARK_KEY, v ? '1' : '0')
}

/** @desc 锁定水印原始文案（可能为空串，渲染端用 DEFAULT_LOCK_WATERMARK_TEXT 兜底） */
export function getLockWatermarkText(): string {
    return _lockWatermarkText
}

export function setLockWatermarkText(v: string): void {
    _lockWatermarkText = v.slice(0, LOCK_WATERMARK_TEXT_MAX)
    if (browser) localStorage.setItem(LOCK_WATERMARK_TEXT_KEY, _lockWatermarkText)
}

/** @desc 实际渲染用的锁定水印文案（空串回落到默认） */
export function getEffectiveLockWatermarkText(): string {
    return _lockWatermarkText.trim() || DEFAULT_LOCK_WATERMARK_TEXT
}
