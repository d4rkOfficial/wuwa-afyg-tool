/**
 * @desc 结果页 / 结果页弹窗（数据分析、链阶对比）共用的展示样式口径。
 *
 * 这些类是 Tailwind class 字符串（`StyleToken`），在使用处配合 `style` 上的主题变量
 * （`--theme-divider-border` / `--theme-input-bg` / `--theme-accent-text` …）一起用。
 * 抽出来的目的：卡片底色与边框、小标题字号/字重/字距、数值强调（主题色 + `tabular-nums`）、
 * 图标尺寸与留白节奏只在这一处定义，避免各卡片逐处硬编码副本。
 * 换行符口径：卡片默认「直角」（`rounded-none`），与全仓库卡片的现有观感保持一致。
 *
 * 注意：`font-sans` 是本仓库在 `layout.css` 的 `@layer components` 里自定义的类
 * （FangXinShu 字体，见该文件 113 行）。Tailwind 自带的同名 utility 也输出 `.font-sans`，
 * 且 utilities 层在 components 层之后，因此这里不把 `font-sans` 放进模板串，
 * 只在需要覆盖成默认无衬线字体的地方（如「×倍率」这种数字行）显式补一段 style。
 */

/** @desc 共享样式类（Tailwind class 字符串，仅允许字面量以便构建期扫描） */
export type StyleToken = string

/** @desc 结果页「×倍率」这类需要回落默认无衬线字体的数值行内联样式 */
export const NUMERIC_FONT_STYLE = 'font-family: ui-sans-serif, system-ui, sans-serif;'

// ── 卡片容器 ──────────────────────────────────────────────────────────
/** @desc 卡片外框：直角 + 分隔线边框（底色由使用处的 `style` 指定） */
export const CARD: StyleToken = 'relative overflow-hidden rounded-none border'
/** @desc 卡片内边距与留白节奏（与数据分析弹窗各卡片一致） */
export const CARD_PAD: StyleToken = 'p-4'
/** @desc 卡片标题行（图标 + 标题 + 右侧操作，可换行） */
export const CARD_HEAD: StyleToken = 'flex flex-wrap items-center gap-2'
/** @desc 卡片分区（含下边框的标题/内容行）的内边距 */
export const CARD_SECTION: StyleToken = 'px-4 py-3'

// ── 小标题 / 标签 ────────────────────────────────────────────────────
/** @desc 卡片主标题：字号/字重/字距口径 */
export const CARD_TITLE: StyleToken = 'text-base font-black tracking-tight'
/** @desc 分区小标题（灰阶）：小号 + 宽字距，透明度由使用处给 */
export const SECTION_LABEL: StyleToken = 'text-[10px] font-black tracking-[0.22em]'
/** @desc 数值下方的小字说明（灰阶） */
export const SECTION_NOTE: StyleToken = 'mt-1 text-[10px] tabular-nums'
/** @desc 数值统计行（tabular-nums 对齐） */
export const STAT_ROW: StyleToken = 'tabular-nums'

// ── 数值强调 ─────────────────────────────────────────────────────────
/** @desc 数值外发光（与主题 halo 变量配合） */
export const VALUE_GLOW: StyleToken = '[text-shadow:0_0_3px_var(--theme-halo-color)]'
/** @desc 主数值：大号黑体 + tabular-nums + 外发光（颜色由使用处给） */
export const STAT_VALUE_LG: StyleToken = `text-2xl font-black leading-none tabular-nums ${VALUE_GLOW}`
/** @desc 次数值：中号黑体 + tabular-nums + 外发光 */
export const STAT_VALUE_MD: StyleToken = `text-xl font-black leading-none tabular-nums ${VALUE_GLOW}`
/** @desc 卡片内常规强调数值：无外发光 */
export const STAT_VALUE_SM: StyleToken = 'text-lg font-black leading-none tabular-nums'
/** @desc 强调数值（表格单元格、行内统计） */
export const CELL_VALUE_STRONG: StyleToken = 'font-black tabular-nums'

// ── 图标 / 色块 ───────────────────────────────────────────────────────
/** @desc 卡片头部图标尺寸 */
export const ICON_CARD: StyleToken = 'size-4 shrink-0'
/** @desc 行内小图标尺寸 */
export const ICON_INLINE: StyleToken = 'size-3.5 shrink-0'
/** @desc 元素色点（卡片标题前） */
export const SWATCH_DOT: StyleToken = 'size-2 shrink-0 rounded-full'

// ── 卡片底色口径 ─────────────────────────────────────────────────────
/** @desc 卡片底色（一般卡片 / 分区容器） */
export const CARD_BG_STYLE = 'background: var(--theme-input-bg);'
/** @desc 卡片底色 + 分隔线边框（最常用组合） */
export const CARD_SURFACE_STYLE = `border-color: var(--theme-divider-border); ${CARD_BG_STYLE}`
/** @desc 主数值卡底纹：主题色斜向渐变 + 分隔线边框 */
export const STAT_CARD_GRADIENT_STYLE =
    'border-color: var(--theme-divider-border); background: linear-gradient(135deg, color-mix(in srgb, var(--theme-accent-bg) 16%, transparent), transparent 65%);'
/** @desc 次级数值卡底纹：主题色描边 + 更淡的斜向渐变 */
export const STAT_CARD_GRADIENT_SUBTLE_STYLE =
    'border-color: color-mix(in srgb, var(--theme-accent-bg) 35%, transparent); background: linear-gradient(135deg, color-mix(in srgb, var(--theme-accent-bg) 10%, transparent), transparent 70%);'
