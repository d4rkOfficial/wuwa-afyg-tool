/**
 * @desc `src/routes/+page.svelte` 的**路由级常量表**（AGENTS §2）。
 *
 * 只放「本路由自己拥有」的字面量：跨路由复用的常量留在 `$lib/consts/`（如 `PHASE_LABELS`）。
 * 注：页面模板里另有若干结构性字面量（拖拽阈值 `144`、收起宽度 `52`、加载反馈下限 `200`ms）**故意不搬**——
 * 它们同时出现在被冻结的模板属性里（如 `sidebarWidth === 52`），搬走只会造成「常量与字面量两份真源」。
 */
import type { PhaseSelectionMap } from './types'

/** @desc 侧栏「展开」的两个档位宽度（px）：较短（常规工程目录）与最长（600，速查舒适浏览） */
export const SIDEBAR_SHORT_EXPANDED = 240
export const SIDEBAR_MAX_EXPANDED = 600

/** @desc 克隆工程弹窗「阶段勾选」的初值（队伍阶段默认勾选，其余不勾） */
export const CLONE_SELECTION_DEFAULTS: PhaseSelectionMap = {
    team: true,
    timeline: false,
    calculation: false,
    config: false
}

/** @desc 阶段勾选的全不选基线：`cloneSelectionsUpTo()` 按阶段顺序累加之前的起点 */
export const CLONE_SELECTION_NONE: PhaseSelectionMap = {
    team: false,
    timeline: false,
    calculation: false,
    config: false
}
