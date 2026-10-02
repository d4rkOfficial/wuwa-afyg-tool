// 滚动条自动隐藏（Phase 10.2）：只在滚动时显示滚动条，且**不碰任何组件**。
//
// 为什么是「一个 window 捕获阶段监听」而不是每个容器各挂一个：
//   `scroll` 事件不冒泡（Bubble），所以在 window 上按冒泡监听收不到任何容器的滚动；
//   但它**会捕获**（Capture），`addEventListener('scroll', fn, { capture: true })`
//   在 window 捕获阶段能收到页面内**任意**可滚动元素（含弹窗、下拉、表格、时间轴）的滚动。
//   于是「所有容器统一」由一条监听覆盖，新增/删除容器都无需改动。
//   —— 键盘滚动（PageUp/Down、方向键、Home/End）、`scrollTo` / `scrollIntoView`、
//   触屏惯性滑动都只改变 scrollTop/scrollLeft，浏览器一律照发 scroll 事件，
//   故不需要任何额外处理（无 wheel / touchmove / keydown 分支）。
//
// 状态怎么表达：CSS 没有「正在滚动」这种状态，只能由 JS 在**目标元素自身**打 `data-scrolling`，
// layout.css 里以该属性作为「显示滚动条」的开关（默认透明）。每个元素各自计时，
// 最后一次滚动后 SCROLLBAR_HIDE_DELAY_MS 清除；元素移除后随监听器/计时器一并清理，不漏计时器。
import { browser } from '$app/environment'

/** @desc 滚动停止后多久隐藏滚动条（毫秒）。属交互节奏而非动效 token，故不走 --motion-*（那里是 transition/animation 时长）。 */
const SCROLLBAR_HIDE_DELAY_MS = 700

/** @desc 模块级单例标记：重复调用直接返回空 disposer，避免挂上第二条监听与第二套计时器 */
let active = false

/** @desc 该元素当下是否真的能滚动（两个方向任一溢出即可；不能滚动的元素打了标记也不会显示滚动条，纯属多余） */
const canScroll = (el: Element) => el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth

/**
 * @desc 启动全局滚动条自动隐藏监听，返回清理函数（断开监听 + 清空全部计时器）。
 *
 * 幂等：重复调用不会叠加监听（第二次起返回空清理函数）。
 * SSR：`browser` 为假时直接返回空清理函数，不触碰 window / HTMLElement。
 */
export const initScrollbarAutoHide = (): (() => void) => {
    if (!browser || active) return () => {}
    active = true

    /** @desc 元素 → 隐藏计时器；每次滚动重置该元素的计时器，卸载时统一清理，保证不泄漏 */
    const timers = new Map<Element, ReturnType<typeof setTimeout>>()

    const onScroll = (event: Event) => {
        const target = event.target
        if (!(target instanceof Element) || !canScroll(target)) return
        target.setAttribute('data-scrolling', '')
        const pending = timers.get(target)
        if (pending !== undefined) clearTimeout(pending)
        const timer = setTimeout(() => {
            timers.delete(target)
            target.removeAttribute('data-scrolling')
        }, SCROLLBAR_HIDE_DELAY_MS)
        timers.set(target, timer)
    }

    // capture: true —— scroll 不冒泡但会捕获（见文件头）；passive: true —— 只读不 preventDefault，不拖慢滚动
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })

    return () => {
        window.removeEventListener('scroll', onScroll, { capture: true })
        for (const timer of timers.values()) clearTimeout(timer)
        timers.clear()
        active = false
    }
}

/** @desc 供测试/自检引用：隐藏延迟（毫秒） */
export const SCROLLBAR_AUTOHIDE_DELAY_MS = SCROLLBAR_HIDE_DELAY_MS
