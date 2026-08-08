import { fade, scale } from 'svelte/transition'

/**
 * Mac 式关闭动效：快速缩小 + 淡出（与 animate-pop-in 打开动画配对）。
 * 用法：<div out:popOut>...</div>
 */
export function popOut(node: Element, { duration = 130 } = {}) {
    const f = fade(node, { duration })
    const s = scale(node, { start: 0.96, duration })
    return {
        duration,
        css: (t: number, u: number) => `${f.css?.(t, u) ?? ''} ${s.css?.(t, u) ?? ''}`
    }
}
