// 渲染偏好（持久化到 localStorage）：GPU 合成加速开关（transform 定位替代 left/top，拖拽/动画走合成层）
import { browser } from '$app/environment'

const STORAGE_KEY = 'wuwa-afyg:render-prefs'
const RELOAD_KEY = 'wuwa-afyg:render-prefs:reload-result'
const RELOAD_PROFILE_KEY = 'wuwa-afyg:render-prefs:reload-profile'
const MAGNETIC_KEY = 'wuwa-afyg:render-prefs:magnetic'
const MAGNETIC_FOLLOW_KEY = 'wuwa-afyg:render-prefs:magnetic-follow'
const MAGNETIC_SENSITIVITY_KEY = 'wuwa-afyg:render-prefs:magnetic-sensitivity'
const MAGNETIC_SPIN_KEY = 'wuwa-afyg:render-prefs:magnetic-spin'
const MAGNETIC_WOBBLE_KEY = 'wuwa-afyg:render-prefs:magnetic-wobble'
const MAGNETIC_BORDER_KEY = 'wuwa-afyg:render-prefs:magnetic-border'

let _gpuAccel = $state(true)
let _reloadOnResultRefresh = $state(false)
let _reloadOnProfileChange = $state(false)
let _magneticPointer = $state(true)
let _magneticFollow = $state(200)
let _magneticSensitivity = $state(0.1)
let _magneticSpin = $state(12)
let _magneticWobble = $state(0)
let _magneticBorderWidth = $state(1)

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
    try {
        const saved = localStorage.getItem(RELOAD_PROFILE_KEY)
        if (saved === '0' || saved === '1') _reloadOnProfileChange = saved === '1'
    } catch {
        /* ignore */
    }
    try {
        const saved = localStorage.getItem(MAGNETIC_KEY)
        if (saved === '0' || saved === '1') _magneticPointer = saved === '1'
    } catch {
        /* ignore */
    }
    try {
        const saved = localStorage.getItem(MAGNETIC_FOLLOW_KEY)
        if (saved) _magneticFollow = Math.min(400, Math.max(50, Number(saved) || 200))
    } catch {
        /* ignore */
    }
    try {
        const saved = localStorage.getItem(MAGNETIC_SENSITIVITY_KEY)
        if (saved) _magneticSensitivity = Math.min(0.3, Math.max(0.05, Number(saved) || 0.1))
    } catch {
        /* ignore */
    }
    try {
        const saved = localStorage.getItem(MAGNETIC_SPIN_KEY)
        if (saved) _magneticSpin = Math.min(30, Math.max(4, Number(saved) || 12))
    } catch {
        /* ignore */
    }
    try {
        const saved = localStorage.getItem(MAGNETIC_WOBBLE_KEY)
        if (saved) _magneticWobble = Math.min(10, Math.max(0, Number(saved) || 0))
    } catch {
        /* ignore */
    }
    try {
        const saved = localStorage.getItem(MAGNETIC_BORDER_KEY)
        if (saved) _magneticBorderWidth = Math.min(3, Math.max(0.5, Number(saved) || 1))
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

export function getReloadOnProfileChange(): boolean {
    return _reloadOnProfileChange
}

export function setReloadOnProfileChange(v: boolean): void {
    _reloadOnProfileChange = v
    if (browser) localStorage.setItem(RELOAD_PROFILE_KEY, v ? '1' : '0')
}

export function getMagneticPointer(): boolean {
    return _magneticPointer
}

export function setMagneticPointer(v: boolean): void {
    _magneticPointer = v
    if (browser) localStorage.setItem(MAGNETIC_KEY, v ? '1' : '0')
}

/** 磁力光标跟手性：位移过渡时长（50-400ms，越小越跟手） */
export function getMagneticFollow(): number {
    return _magneticFollow
}

export function setMagneticFollow(v: number): void {
    _magneticFollow = Math.min(400, Math.max(50, Math.round(Number(v) || 200)))
    if (browser) localStorage.setItem(MAGNETIC_FOLLOW_KEY, String(_magneticFollow))
}

/** 磁力光标灵敏度：磁吸目标的跟手系数（0.05-0.3，越大越跟手、越小磁吸越强） */
export function getMagneticSensitivity(): number {
    return _magneticSensitivity
}

export function setMagneticSensitivity(v: number): void {
    _magneticSensitivity = Math.min(0.3, Math.max(0.05, Number(v) || 0.1))
    if (browser) localStorage.setItem(MAGNETIC_SENSITIVITY_KEY, String(_magneticSensitivity))
}

/** 磁力光标旋转速度：四角平时旋转一圈的秒数（4-30，越小越快） */
export function getMagneticSpin(): number {
    return _magneticSpin
}

export function setMagneticSpin(v: number): void {
    _magneticSpin = Math.min(30, Math.max(4, Math.round(Number(v) || 12)))
    if (browser) localStorage.setItem(MAGNETIC_SPIN_KEY, String(_magneticSpin))
}

/** 磁力光标吸附晃动强度：框选吸附时的自动晃动幅度（0-10，0=关闭） */
export function getMagneticWobble(): number {
    return _magneticWobble
}

export function setMagneticWobble(v: number): void {
    _magneticWobble = Math.min(10, Math.max(0, Math.round(Number(v) || 0)))
    if (browser) localStorage.setItem(MAGNETIC_WOBBLE_KEY, String(_magneticWobble))
}

/** 磁力光标内部元素描边粗细（0.5-3px，四角边框固定 2px 不受此设置影响） */
export function getMagneticBorderWidth(): number {
    return _magneticBorderWidth
}

export function setMagneticBorderWidth(v: number): void {
    _magneticBorderWidth = Math.min(3, Math.max(0.5, Math.round(Number(v) * 10) / 10 || 1))
    if (browser) localStorage.setItem(MAGNETIC_BORDER_KEY, String(_magneticBorderWidth))
}
