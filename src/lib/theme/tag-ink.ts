// ── 角色标签「墨水色」（纯函数 + 口径护栏） ────────────────────────────────
// 上游每个标签只给一个亮色（为深色底挑的 6 位 hex），白天近白底上直接当文字色会糊
// （实测原色 1.25 ~ 3.47:1）。这里用「色相法」：保留上游的色相与彩度，只把 OKLCh 明度
// 挪到可读区间 —— 白天固定 42%（近白底最差 5.04:1），黑夜不压、保持原色。
//
// 运行时的取色在 CSS 侧：theme.svelte.ts 把 TAG_INK_LIGHT_L 发成 --theme-tag-ink-l，
// 组件用 `oklch(from <上游原色> var(--theme-tag-ink-l, l) c h)` 现算（黑夜该变量不存在，
// 回落到 l 关键字 = 原色）。本文件的换算实现只用于单测兜底，不参与渲染。

/** @desc 白天把标签色压到的 OKLCh 明度（CSS 变量 --theme-tag-ink-l 的值） */
export const TAG_INK_LIGHT_L = '42%'

/** @desc 白天各表面的最亮/最暗端（用于护栏单测，取白天主题的弹窗/侧栏/排轴底色） */
export const LIGHT_SURFACES = ['#ffffff', '#f1f5f9', '#f8fafc'] as const

/** @desc 黑夜主底色（黑夜不压色，原色需在此之上已达标） */
export const DARK_SURFACE = '#0e0e10'

/** @desc 上游 39 个标签去重后的全部颜色取值（见 provider/nanoka 的 tag.color） */
export const UPSTREAM_TAG_COLORS = [
    '#ff8441',
    '#ff4040',
    '#77ffb7',
    '#ffde73',
    '#77adff',
    '#ff7777',
    '#dd77ff'
] as const

export interface Oklch {
    /** @desc 明度 0-1 */
    l: number
    /** @desc 彩度 */
    c: number
    /** @desc 色相角（度，可为负） */
    h: number
}

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

const linearToSrgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.cbrt(c) - 0.055)

const clamp255 = (c: number): number => Math.min(255, Math.max(0, Math.round(c)))

const EPS = 1e-4

/** @desc OKLCh → 线性 sRGB（可能越界；色域映射与裁剪都基于它） */
const oklchToLinearRgb = ({ l, c, h }: Oklch): [number, number, number] => {
    const rad = (h * Math.PI) / 180
    const okA = c * Math.cos(rad)
    const okB = c * Math.sin(rad)
    const lc = (l + 0.3963377774 * okA + 0.2158037573 * okB) ** 3
    const mc = (l - 0.1055613458 * okA - 0.0638541728 * okB) ** 3
    const sc = (l - 0.0894841775 * okA - 1.291485548 * okB) ** 3
    return [
        4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
        -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
        -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc
    ]
}

const inGamut = (rgb: [number, number, number]): boolean => rgb.every((c) => c >= -EPS && c <= 1 + EPS)

/** @desc CSS hex（#RRGGBB）→ sRGB 三元组；非法输入回落到黑 */
export const hexToRgb = (hex: string): [number, number, number] => {
    const s = hex.replace('#', '')
    if (!/^[0-9a-f]{6}$/i.test(s)) return [0, 0, 0]
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number]
}

/** @desc sRGB 三元组 → CSS hex */
export const rgbToHex = (rgb: [number, number, number]): string =>
    `#${rgb.map((c) => clamp255(c).toString(16).padStart(2, '0')).join('')}`

/** @desc sRGB hex → OKLCh（与浏览器 oklch(from ...) 的通道取值一致） */
export const hexToOklch = (hex: string): Oklch => {
    const [r, g, b] = hexToRgb(hex).map((c) => srgbToLinear(c / 255))
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    const okL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
    const okA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
    const okB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    return { l: okL, c: Math.hypot(okA, okB), h: (Math.atan2(okB, okA) * 180) / Math.PI }
}

/**
 * @desc OKLCh → sRGB hex，按 CSS Color 4 的色域映射处理越界：
 * 二分降低彩度直到落进 sRGB（**保持明度与色相**，与浏览器渲染越界 oklch 色的做法一致），
 * 而不是简单裁剪 RGB 通道 —— 后者会把色相带偏（实测橙 #ff8441 会偏红 10°）。
 */
export const oklchToHex = ({ l, c, h }: Oklch): string => {
    let chroma = c
    if (!inGamut(oklchToLinearRgb({ l, c, h }))) {
        let lo = 0
        let hi = c
        for (let i = 0; i < 24; i++) {
            const mid = (lo + hi) / 2
            if (inGamut(oklchToLinearRgb({ l, c: mid, h }))) lo = mid
            else hi = mid
        }
        chroma = lo
    }
    const [r, g, b] = oklchToLinearRgb({ l, c: chroma, h })
    return rgbToHex([linearToSrgb(r) * 255, linearToSrgb(g) * 255, linearToSrgb(b) * 255])
}

/** @desc 相对亮度（WCAG 2.x） */
export const relativeLuminance = (hex: string): number => {
    const [r, g, b] = hexToRgb(hex).map((c) => srgbToLinear(c / 255))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** @desc 两色的对比度（WCAG 2.x，1 ~ 21） */
export const contrastRatio = (a: string, b: string): number => {
    const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
}

/** @desc 色相角差（度，取 0-180 的最小夹角） */
export const hueDistance = (a: string, b: string): number => {
    const diff = Math.abs(hexToOklch(a).h - hexToOklch(b).h) % 360
    return diff > 180 ? 360 - diff : diff
}

/** @desc 白天墨水色：保留原色相/彩度，明度压到 TAG_INK_LIGHT_L（CSS 侧同一算法的参照实现） */
export const tagInkLight = (hex: string): string => {
    const { c, h } = hexToOklch(hex)
    return oklchToHex({ l: Number.parseFloat(TAG_INK_LIGHT_L) / 100, c, h })
}
