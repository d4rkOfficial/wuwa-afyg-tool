import { browser } from '$app/environment'
import { fade, scale } from 'svelte/transition'

/** @desc 与 src/routes/layout.css 的 --motion-* 必须一致（check-motion.mjs 会断言两者相等） */
export const MOTION_MS = { fast: 120, base: 180, slow: 260 } as const

/**
 * @desc Svelte 的 `transition:` 只吃数字（ms），读不了 `--motion-base`，故把秒数镜像到这里由脚本断言一致。
 *
 * 这里刻意是**普通模块级单例**而不是组件里的 $state：
 * 时长参数不被模板响应式读取，而是在过渡**创建的那一刻**才调用 `slideParams(...)`，
 * 因此「切换系统减弱动态效果后再展开面板」自然读到最新值，无需订阅 change 事件；
 * 同时不会给调用方组件引入 `$effect` / `$state`（本文件也会被非组件模块 import）。
 * SSR 下 `browser` 为 false → 返回毫秒值，但那时过渡根本不会跑；调用点也不必额外包 `{#if browser}`。
 */
const prefersReducedMotion = (): boolean =>
    browser && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * @desc 减弱动态效果时把时长压到 1ms（而非 0）：保留过渡钩子，避免调用方结构分支变化。
 * layout.css 的 `prefers-reduced-motion` 只管 CSS 动画与 layout.css 自己声明的过渡，Svelte 过渡是 JS 驱动的，
 * 必须在这里自行归零。
 *
 * 另外：**写在内联 `style` 里的 CSS 过渡只能靠它归零** —— 内联声明属于无层级（unlayered），
 * 级联顺序里无层级 > 任何 @layer，所以 Tailwind 的 `motion-reduce:transition-none`
 * （产出 `@layer utilities { transition-property: none }`）对内联过渡**数学上不可能生效**；
 * 组件侧要让内联过渡在 reduce 下停下，就得像 `ai-assistant.svelte` 那样把时长来源整体走 `motionDuration()`
 * （或由 layout.css 用「无层级 + 具体选择器」的归零块兜住，见 layout.css 末尾的块一）。
 */
export const motionDuration = (ms: number): number => (prefersReducedMotion() ? 1 : ms)

/** @desc 展开 / 收起面板共用的 slide 参数（自动跟随减弱动态效果） */
export const slideParams = (ms: number) => ({ duration: motionDuration(ms) })

/**
 * Mac 式关闭动效：快速缩小 + 淡出（与 animate-pop-in 打开动画配对）。
 * 用法：<div out:popOut>...</div>
 *
 * T18：默认时长改走 `motionDuration(130)` —— 裸写 `out:popOut` 的调用点（layout/modal.svelte:151）
 * 之前拿的是硬编码 130ms，reduce 下照样播；包一层后 reduce → 1ms（与 slideParams 的调用点行为一致）。
 * 显式传参的调用点（`out:popOut={slideParams(MOTION_MS.fast)}`）不受影响：实参覆盖默认值。
 * 130 这个数刻意比 --motion-fast(120) 多 10ms，与遮罩的 `out:fade={{ duration: motionDuration(130) }}`
 * （modal.svelte 的遮罩，T26 起也走 motionDuration）成对，保证「面板先收、遮罩后淡」；勿改成 token。
 */
export function popOut(node: Element, { duration = motionDuration(130) } = {}) {
    const f = fade(node, { duration })
    const s = scale(node, { start: 0.96, duration })
    return {
        duration,
        css: (t: number, u: number) => `${f.css?.(t, u) ?? ''} ${s.css?.(t, u) ?? ''}`
    }
}
