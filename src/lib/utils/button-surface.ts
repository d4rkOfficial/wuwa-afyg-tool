/**
 * @desc 通用按钮（`$lib/components/ui/button.svelte`）的「区域质感」归属判定（纯函数，无副作用）。
 *
 * 规则（只有小尺寸控件才归入「小部件」区域，避免把大按钮也变成小部件）：
 * - 显式传入 `surface` 时以调用方为准（`'widget'` 强制接入小部件区域，`'none'` 强制保持按钮自身底色）；
 * - 未传入时：`variant === 'icon'`（纯图标小按钮）默认接入小部件区域，`'text'` / `'icon-text'`（带文字的常规按钮）不接入。
 */
export type ButtonSurface = 'widget' | 'none'

/** @desc 解析按钮最终的区域归属；调用方显式指定优先于变体默认值 */
export const resolveButtonSurface = (variant: 'icon' | 'text' | 'icon-text', surface?: ButtonSurface): ButtonSurface =>
    surface ?? (variant === 'icon' ? 'widget' : 'none')
