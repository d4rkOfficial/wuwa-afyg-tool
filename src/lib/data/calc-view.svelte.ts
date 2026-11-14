// 拉表页面交互偏好（持久化到 localStorage）：拉表视图（分类平铺 / 分段平铺）、表头详细度、不达门槛列、默认滚动方向
import { browser } from '$app/environment'

/**
 * @desc 拉表视图：两种都是「平铺」。
 * - `categorized` 分类平铺：按「角色 × 直伤/非直伤」分子表，Buff 作列、伤害作行；
 * - `segmented` 分段平铺：按时间记点（参考线）切段，每段一张表，所有伤害按时间顺序列出，
 *   只有「选中来源」的行可勾 Buff，其它行只显示左侧伤害信息（其余绝对留白）。
 *
 * 视图只有这两种；存量偏好里的 `dropdown` / `spread` 由 {@link migrateViewMode} 归到 `categorized`。
 */
export type CalcViewMode = 'categorized' | 'segmented'
export type CalcScrollAxis = 'vertical' | 'horizontal'

const STORAGE_KEY = 'wuwa-afyg:calc-view'
const SCROLL_AXIS_KEY = 'wuwa-afyg:calc-scroll-axis'
const HEADER_COMPACT_KEY = 'wuwa-afyg:calc-header-compact'
const SHOW_UNMET_COLUMNS_KEY = 'wuwa-afyg:calc-show-unmet-columns'

let _viewMode: CalcViewMode = $state('categorized')
let _scrollAxisDefault: CalcScrollAxis = $state('vertical')
/** @desc 表头是否「简略」：隐藏首行/次行（文件夹横条），只保留列名行（持久化，默认详细） */
let _headerCompact: boolean = $state(false)
/** @desc 拉表是否显示「不达门槛」的 Buff 列（默认显示；关掉后只保留至少一行真正达标的列） */
let _showUnmetColumns: boolean = $state(true)

/** @desc 存量视图值 → 当前视图值（只有 `categorized` / `segmented` 两种，其余一律按分类平铺） */
const migrateViewMode = (saved: string | null): CalcViewMode => (saved === 'segmented' ? 'segmented' : 'categorized')

// 模块加载时从 localStorage 恢复
if (browser) {
    _viewMode = migrateViewMode(localStorage.getItem(STORAGE_KEY))
    const axisSaved = localStorage.getItem(SCROLL_AXIS_KEY)
    if (axisSaved === 'vertical' || axisSaved === 'horizontal') _scrollAxisDefault = axisSaved
    _headerCompact = localStorage.getItem(HEADER_COMPACT_KEY) === '1'
    _showUnmetColumns = localStorage.getItem(SHOW_UNMET_COLUMNS_KEY) !== '0'
}

export function getCalcViewMode(): CalcViewMode {
    return _viewMode
}

export function setCalcViewMode(mode: CalcViewMode): void {
    _viewMode = mode
    if (browser) localStorage.setItem(STORAGE_KEY, mode)
}

/** @desc 旧值兼容入口：`dropdown`/`spread` 一律落到 `categorized`（AI 工具/旧链接可能还传旧值） */
export const normalizeCalcViewMode = (mode: string): CalcViewMode | null => {
    if (mode === 'categorized' || mode === 'segmented') return mode
    if (mode === 'dropdown' || mode === 'spread') return 'categorized'
    return null
}

// 平铺表默认滚动方向：↑↓/普通滚轮 的滚动轴；Shift（方向键）/Ctrl（滚轮）临时换到另一轴
export function getScrollAxisDefault(): CalcScrollAxis {
    return _scrollAxisDefault
}

export function setScrollAxisDefault(axis: CalcScrollAxis): void {
    _scrollAxisDefault = axis
    if (browser) localStorage.setItem(SCROLL_AXIS_KEY, axis)
}

/** @desc 表头是否简略（true = 隐藏文件夹横条，只留列名行）；全局偏好，两种平铺共用 */
export function getHeaderCompact(): boolean {
    return _headerCompact
}

export function setHeaderCompact(compact: boolean): void {
    _headerCompact = compact
    if (browser) localStorage.setItem(HEADER_COMPACT_KEY, compact ? '1' : '0')
}

export function toggleHeaderCompact(): boolean {
    setHeaderCompact(!_headerCompact)
    return _headerCompact
}

/** @desc 拉表是否显示「不达门槛」的 Buff 列（false = 只保留至少一行真正达标的列）；全局偏好，两种平铺共用 */
export function getShowUnmetColumns(): boolean {
    return _showUnmetColumns
}

export function setShowUnmetColumns(show: boolean): void {
    _showUnmetColumns = show
    if (browser) localStorage.setItem(SHOW_UNMET_COLUMNS_KEY, show ? '1' : '0')
}
