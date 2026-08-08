// 拉表页面交互偏好（持久化到 localStorage）：buff 下拉模式 / buff 平铺模式；平铺模式伤害类型编辑/仅查看、默认滚动方向
import { browser } from '$app/environment'

export type CalcViewMode = 'dropdown' | 'spread'
export type CalcScrollAxis = 'vertical' | 'horizontal'

const STORAGE_KEY = 'wuwa-afyg:calc-view'
const DT_EDIT_KEY = 'wuwa-afyg:calc-dt-edit'
const SCROLL_AXIS_KEY = 'wuwa-afyg:calc-scroll-axis'

let _viewMode: CalcViewMode = $state('dropdown')
let _damageTypeEditMode = $state(true)
let _scrollAxisDefault: CalcScrollAxis = $state('vertical')

// 模块加载时从 localStorage 恢复
if (browser) {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'dropdown' || saved === 'spread') _viewMode = saved
    const dtSaved = localStorage.getItem(DT_EDIT_KEY)
    if (dtSaved === '0' || dtSaved === '1') _damageTypeEditMode = dtSaved === '1'
    const axisSaved = localStorage.getItem(SCROLL_AXIS_KEY)
    if (axisSaved === 'vertical' || axisSaved === 'horizontal') _scrollAxisDefault = axisSaved
}

export function getCalcViewMode(): CalcViewMode {
    return _viewMode
}

export function setCalcViewMode(mode: CalcViewMode): void {
    _viewMode = mode
    if (browser) localStorage.setItem(STORAGE_KEY, mode)
}

export function getDamageTypeEditMode(): boolean {
    return _damageTypeEditMode
}

export function setDamageTypeEditMode(v: boolean): void {
    _damageTypeEditMode = v
    if (browser) localStorage.setItem(DT_EDIT_KEY, v ? '1' : '0')
}

// 平铺表默认滚动方向：↑↓/普通滚轮 的滚动轴；Shift（方向键）/Ctrl（滚轮）临时换到另一轴
export function getScrollAxisDefault(): CalcScrollAxis {
    return _scrollAxisDefault
}

export function setScrollAxisDefault(axis: CalcScrollAxis): void {
    _scrollAxisDefault = axis
    if (browser) localStorage.setItem(SCROLL_AXIS_KEY, axis)
}
