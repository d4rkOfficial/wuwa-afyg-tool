import { browser } from '$app/environment'

/** @desc 计数式背景滚动锁（模块级，跨实例共享） */
let lockCount = 0

/**
 * @desc 锁定背景滚动，返回解锁函数。
 * 可重入：嵌套弹窗逐个关闭时，只有计数归零才真正恢复滚动，
 * 避免内层先解锁导致外层还在时背景已经能滚。
 * 用作 Svelte `$effect` 的清理函数：`$effect(() => { if (!open) return; return lockBodyScroll() })`
 */
export const lockBodyScroll = (): (() => void) => {
    if (!browser) return () => {}
    lockCount++
    if (lockCount === 1) document.body.style.overflow = 'hidden'
    return () => {
        lockCount--
        if (lockCount === 0) document.body.style.overflow = ''
    }
}
