import { mergeClass } from './component-style'

/** @desc 配队 picker 卡片基类；宽度由调用方给出（武器/声骸 `w-[110px]`、角色 `w-[100px]`） */
const BASE =
    'flex flex-col items-center gap-1.5 rounded-none border border-(--theme-divider-border) p-3 transition-colors cursor-pointer'

/** @desc 选中态：accent 边框 + accent 浅洗底 */
const SELECTED = 'border-(--theme-accent-bg) bg-[color-mix(in_srgb,var(--theme-accent-bg)_10%,var(--theme-input-bg))]'

/** @desc 非选中态 hover：accent 边框 + 文本色浅洗底 */
const HOVER =
    'hover:border-(--theme-accent-bg) hover:bg-[color-mix(in_srgb,var(--theme-modal-text)_6%,var(--theme-input-bg))]'

/**
 * @desc 配队 picker 卡片的 class（纯函数）。
 *
 * 原先 `weapon-picker` / `echo-picker` / `character-picker` 各写了一份 `itemClass`，
 * 三份**除宽度 token 外逐字相同**（`.tmp` 迁移脚本用穷举比对确保新实现输出与原文完全一致）。
 */
export const pickerCardClass = (selected: boolean, widthClass: string): string =>
    mergeClass([BASE, widthClass, selected ? SELECTED : HOVER])
