// Bilibili Toy 环境桥：识别宿主是否为 Toy 壳（含未授权用户），并管理首次访问标记。
// 壳页无条件发送 { type: 'toy-environment' }（与认证结果无关），收到即标记 isToy。
// 首次访问 / Toy 手机一次性设定 用于首页初始化策略（拉表平铺 / 磁力光标）。
import { browser } from '$app/environment'

const env = $state<{ isToy: boolean }>({ isToy: false })

const VISITED_KEY = 'wuwa-afyg:visited'
const MAGNETIC_TOY_KEY = 'wuwa-afyg:magnetic-toy-set'

let entered = false
const enterListeners = new Set<() => void>()

function isTrustedOrigin(origin: string): boolean {
    if (!origin) return false
    if (origin === 'http://localhost' || /^http:\/\/localhost:\d+$/.test(origin)) return true
    // Toy 壳页真实域为 www.bilibilitoy.com（B站 Toy 独立内容域），同认 bilibili.com
    return /^https:\/\/([\w-]+\.)*(bilibili|bilibilitoy)\.com$/.test(origin)
}

/** 监听宿主页 toy-environment 消息；无宿主时静默无操作 */
export function initToyEnvironmentBridge() {
    if (!browser) return
    window.addEventListener('message', (e) => {
        const msg = e.data as { type?: string } | null
        if (!msg || msg.type !== 'toy-environment' || !isTrustedOrigin(e.origin)) return
        env.isToy = true
        if (!entered) {
            entered = true
            for (const fn of enterListeners) fn()
        }
    })
}

export function getToyEnv() {
    return env
}

/** 注册「进入 Toy 环境」回调（每会话首次收到环境消息时执行一次） */
export function onToyEnter(fn: () => void): void {
    enterListeners.add(fn)
}

/** 当前是否 Toy 手机（Toy 壳 + 触摸粗指针设备） */
export function isToyMobile(): boolean {
    return env.isToy && (browser ? window.matchMedia('(pointer: coarse)').matches : false)
}

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
