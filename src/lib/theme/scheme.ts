import { browser } from '$app/environment'
import { getActiveId } from './theme.svelte'

/**
 * @desc 当前白天/黑夜主题（供需要区分昼夜的跨组件逻辑使用，如透传给工坊 iframe）。
 * 优先取主题 store 的当前主题 id（light = 白天，其余按黑夜），store 尚未加载时回落到根元素上的
 * `--theme-layout-scheme`（由 $lib/theme 写入），两者都拿不到时按黑夜处理。
 */
export function getDayNightScheme(): 'light' | 'dark' {
    if (!browser) return 'dark'
    const activeId = getActiveId()
    if (activeId) return activeId === 'light' ? 'light' : 'dark'
    const scheme = document.documentElement.style.getPropertyValue('--theme-layout-scheme').trim()
    return scheme === 'light' ? 'light' : 'dark'
}
