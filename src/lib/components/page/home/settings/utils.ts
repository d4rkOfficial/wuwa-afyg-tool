/**
 * @desc 设置弹窗内各 section 共用的**控件规格**（分段 tab / 动作按钮）与布尔换算纯函数。
 *
 * 为什么要有这个文件（实测基线，2026-10）：
 *   - 分段 tab：设置里 22 个 `ui/tabs` 调用点各自传了 4 种轨道宽度（`w-28` / `w-32` / `w-44` /
 *     不传=满宽），并把 `mb-2` / `mb-3` 这类**外边距**塞进控件的 `class`，同一份
 *     `backgroundImage` + `textColor` 两件套逐字复制 21 次（唯一不同的是主色调分段，它取当前预设
 *     自身的颜色，属有意例外）。
 *   - 动作按钮：同一个「恢复默认」有 4 种内边距 / 字号组合，且「原生 `<button>`」与「`ui/Button`」
 *     两种实现混用（视觉相同、焦点态与禁用态不同）。
 * 结果是「同一个控件」在设置里长得不一样，而差异没有任何语义。
 *
 * 归一后的口径（新增调用点请照抄这几个入口）：
 *   - 行内分段 → `class={ROW_TABS}`；满宽分段 → **不传 `class`**，上下间距交给外层容器；
 *   - 分段配色 → 一律 `{...TAB_ACCENT}`；
 *   - 行内动作按钮 → `ACTION_BTN` / `ACTION_BTN_ACCENT` / `ACTION_BTN_DANGER` 三档之一。
 */
import type { DangerMode } from '$lib/data/ai-prefs.svelte'

/**
 * @desc 行内分段控件的统一轨道宽度。
 * 必须**定宽**：`ui/tabs` 的滑动指示块按「轨道宽 ÷ 段数」算宽度、不做 DOM 测量，
 * 而收缩容器里的分段宽是各自的内容宽 —— 只有轨道定宽时 `flex-1` 的分段才必然等分，
 * 指示块才能与分段对齐（见 `ui/tabs` 顶部注释的取舍）。
 * `shrink-0` 保证窄屏时被压缩的是左侧文案列（它有 `min-w-0`）而不是控件本身。
 */
export const ROW_TABS = 'w-44 shrink-0'

/**
 * @desc 分段控件选中态的默认配色（指示块底色 + 选中项文字色）。
 * 只用于「强调色」语义；主色调页那段刻意取**当前预设自身的颜色**，不在此列。
 */
export const TAB_ACCENT = {
    backgroundImage: 'var(--theme-accent-bg)',
    textColor: 'var(--theme-accent-text-on-bg)'
} as const

/**
 * @desc 危险操作策略的三档（**单轴**，与 DSH 的「沙箱模式 × 审批策略」两轴不同 —— 本应用没有
 * 文件系统隔离的概念，硬搬文件策略那三档只会造出无对应物的档位）。
 *
 * 原先只定义在 `sections/ai.svelte` 内部；助手弹窗新增权限切换后提取到此处，
 * **设置页与弹窗共用这一份**，避免同一组档位在两处各写一遍文案。
 */
export const DANGER_MODE_OPTIONS: { value: DangerMode; label: string; desc: string }[] = [
    { value: 'ask', label: '每次都询问', desc: '每个危险操作都弹确认' },
    { value: 'ask_once', label: '批量只询问一次', desc: '一次指令内只确认一次，后续直接放行' },
    { value: 'trust', label: '无条件信任', desc: '危险操作直接执行，不再确认' }
]

/**
 * @desc 行内动作按钮的三档统一规格（原先同一个「恢复默认」在设置里有 4 种内边距 / 字号）。
 *
 * 用法：`ui/Button` 传 `variant="text" size="none" bare`（需要禁用态再传 `keepDisabled`）+
 * 本规格作为 `class`。**刻意不写 `gap-*` / `rounded-none` / `font-medium`**：那是 `ui/Button`
 * 基类已有的同权重类，重复写只会让「谁生效」取决于产物 CSS 顺序（见 `ui/tabs` 记过的 `w-fit` 坑）。
 * `focus-visible:outline-*` 是因为 `bare` 档关掉了元件自带的焦点层，而设置里手写按钮原本没有任何焦点提示。
 */
const ACTION_BTN_BASE =
    'h-7 shrink-0 rounded-none px-2.5 text-xs transition-colors focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-(--theme-accent-bg)'

/** @desc 次要动作：恢复默认 / 明细 / 导出 / 分享 / 取消 … */
export const ACTION_BTN = `${ACTION_BTN_BASE} border border-(--theme-divider-border) text-(--theme-modal-text)/60 hover:text-(--theme-modal-text)`

/** @desc 强调动作（配 `backgroundImage="var(--theme-accent-bg)"` + `textColor="var(--theme-accent-text-on-bg)"`）：新建 / 清理本类 / 保存 … */
export const ACTION_BTN_ACCENT = `${ACTION_BTN_BASE} font-medium hover:brightness-110`

/** @desc 危险动作：永久删除 / 全部清理 / 退出登录 … */
export const ACTION_BTN_DANGER = `${ACTION_BTN_BASE} border border-(--theme-divider-border) text-(--theme-modal-text)/50 hover:border-red-500/50 hover:text-red-500`

/** @desc 两段布尔项：入参是 on / off 两个分段各自的文案 */
export const pair = (on: string, off: string) => [
    { value: 'on', label: on },
    { value: 'off', label: off }
]

/** @desc boolean ⇄ 分段值的唯一换算处（`ui/tabs` 的 value 是 string） */
export const segValue = (on: boolean): string => (on ? 'on' : 'off')

export const segBool = (value: string): boolean => value === 'on'
