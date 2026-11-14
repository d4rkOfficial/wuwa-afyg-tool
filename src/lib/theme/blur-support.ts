import type { SurfaceStyle } from './types'

/**
 * @desc 区域质感里「毛玻璃」那一半的**运行时兼容**：探测支持、算 backdrop 声明、不支持时抬高底色不透明度。
 *
 * 为什么要探测：极旧的 Android WebView、部分内嵌 WebView 完全没有 `backdrop-filter`，
 * 而主题里的表面默认是半透明的（表头 / 首列这种 sticky 层压在滚动内容上）。
 * 一旦 blur 静默失效，底色撑不住内容 —— 表现为「毛玻璃没了，文字糊成一片」。
 * 因此不支持时把要求毛玻璃的表面抬到可读的不透明度，并让 backdrop 声明退回 `none`。
 *
 * 注：客户端构建里 `$app/environment` 的 `browser` 恒为 `true`（Worker 里也是），
 * 所以这里用 `CSS.supports` 探测而不是 `browser`。
 */

/** @desc 无毛玻璃环境下的不透明度下限（%）：只作用于「本来就要求毛玻璃」的表面 */
export const BLUR_FALLBACK_OPACITY = 88

/** @desc 是否支持 `backdrop-filter`（含 `-webkit-` 前缀，iOS / 旧 WebKit 只有前缀版） */
export const supportsBackdropFilter = (): boolean => {
    try {
        if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false
        return CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)')
    } catch {
        return false
    }
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v))

/**
 * @desc 计算某类区域的毛玻璃/背景明暗：blur=0 且 depth=0 时返回 none（不产生合成开销）。
 * 深度同时作用在背面（昼提亮/夜压暗），让「更白/更黑」在毛玻璃上成立。
 */
export function computeSurfaceBackdrop(style: SurfaceStyle, isLight: boolean): string {
    const parts: string[] = []
    if (style.blur > 0) parts.push(`blur(${clamp(style.blur, 0, 32)}px)`, 'saturate(1.08)')
    const depth = clamp(style.depth, 0, 100)
    if (depth > 0) {
        const brightness = isLight ? 1 + (depth / 100) * 0.35 : 1 - (depth / 100) * 0.6
        parts.push(`brightness(${brightness.toFixed(3)})`)
    }
    return parts.length ? parts.join(' ') : 'none'
}

/**
 * @desc 实际发射的 backdrop 声明：环境不支持毛玻璃时一律 `none`。
 * （`brightness()` 也属于 `backdrop-filter`，不支持就同样无效，留着只会误导排查。）
 */
export const surfaceBackdrop = (style: SurfaceStyle, isLight: boolean, blurSupported: boolean): string =>
    blurSupported ? computeSurfaceBackdrop(style, isLight) : 'none'

/**
 * @desc 实际发射的表面不透明度（%）。
 *
 * 支持毛玻璃 → 原样；不支持且该表面本来要求毛玻璃 → 抬到 {@link BLUR_FALLBACK_OPACITY}，
 * 让表头 / 首列这类层在没有模糊时也能压住身后的滚动内容。没要求毛玻璃的表面不动。
 */
export const surfaceOpacity = (style: SurfaceStyle, blurSupported: boolean): number => {
    if (blurSupported) return clamp(style.opacity, 0, 100)
    return style.blur > 0 ? Math.max(clamp(style.opacity, 0, 100), BLUR_FALLBACK_OPACITY) : clamp(style.opacity, 0, 100)
}
