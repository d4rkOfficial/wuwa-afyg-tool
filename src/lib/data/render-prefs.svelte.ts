// 渲染偏好（持久化到 localStorage）：GPU 合成加速开关（transform 定位替代 left/top，拖拽/动画走合成层）
import { browser } from '$app/environment'

const STORAGE_KEY = 'wuwa-afyg:render-prefs'
const RELOAD_KEY = 'wuwa-afyg:render-prefs:reload-result'

let _gpuAccel = $state(true)
let _reloadOnResultRefresh = $state(false)

// 模块加载时从 localStorage 恢复
if (browser) {
    try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved === '0' || saved === '1') _gpuAccel = saved === '1'
    } catch {
        /* ignore */
    }
    try {
        const saved = localStorage.getItem(RELOAD_KEY)
        if (saved === '0' || saved === '1') _reloadOnResultRefresh = saved === '1'
    } catch {
        /* ignore */
    }
}

export function getGpuAccel(): boolean {
    return _gpuAccel
}

export function setGpuAccel(v: boolean): void {
    _gpuAccel = v
    if (browser) localStorage.setItem(STORAGE_KEY, v ? '1' : '0')
}

export function getReloadOnResultRefresh(): boolean {
    return _reloadOnResultRefresh
}

export function setReloadOnResultRefresh(v: boolean): void {
    _reloadOnResultRefresh = v
    if (browser) localStorage.setItem(RELOAD_KEY, v ? '1' : '0')
}
