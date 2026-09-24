// 拉表页面交互偏好（持久化到 localStorage）：buff 下拉模式 / buff 平铺模式；平铺模式默认滚动方向
import { browser } from '$app/environment'

export type CalcViewMode = 'dropdown' | 'spread'
export type CalcScrollAxis = 'vertical' | 'horizontal'

const STORAGE_KEY = 'wuwa-afyg:calc-view'
const SCROLL_AXIS_KEY = 'wuwa-afyg:calc-scroll-axis'
const GLOBAL_BUFF_COLLAPSED_KEY = 'wuwa-afyg:calc-global-buff-collapsed'

let _viewMode: CalcViewMode = $state('dropdown')
let _scrollAxisDefault: CalcScrollAxis = $state('vertical')
/** @desc 平铺模式的「全局 BUFF」条是否收起（持久化，默认展开） */
let _globalBuffCollapsed: boolean = $state(false)

// 模块加载时从 localStorage 恢复
if (browser) {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'dropdown' || saved === 'spread') _viewMode = saved
    const axisSaved = localStorage.getItem(SCROLL_AXIS_KEY)
    if (axisSaved === 'vertical' || axisSaved === 'horizontal') _scrollAxisDefault = axisSaved
    _globalBuffCollapsed = localStorage.getItem(GLOBAL_BUFF_COLLAPSED_KEY) === '1'
}

export function getCalcViewMode(): CalcViewMode {
    return _viewMode
}

export function setCalcViewMode(mode: CalcViewMode): void {
    _viewMode = mode
    if (browser) localStorage.setItem(STORAGE_KEY, mode)
}

// 平铺表默认滚动方向：↑↓/普通滚轮 的滚动轴；Shift（方向键）/Ctrl（滚轮）临时换到另一轴
export function getScrollAxisDefault(): CalcScrollAxis {
    return _scrollAxisDefault
}

export function setScrollAxisDefault(axis: CalcScrollAxis): void {
    _scrollAxisDefault = axis
    if (browser) localStorage.setItem(SCROLL_AXIS_KEY, axis)
}

/** @desc 平铺模式「全局 BUFF」条是否收起 */
export function getGlobalBuffCollapsed(): boolean {
    return _globalBuffCollapsed
}

export function setGlobalBuffCollapsed(collapsed: boolean): void {
    _globalBuffCollapsed = collapsed
    if (browser) localStorage.setItem(GLOBAL_BUFF_COLLAPSED_KEY, collapsed ? '1' : '0')
}
