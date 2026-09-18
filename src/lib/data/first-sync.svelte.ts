import { browser } from '$app/environment'

const SYNC_PROMPT_KEY = 'wuwa-afyg:first-sync-prompted'

/** @desc 首次进入工具箱时是否还需要询问「从工坊同步 Buff 集与标准词条集」（一次性的持久标记） */
let _prompted = $state(browser ? localStorage.getItem(SYNC_PROMPT_KEY) === '1' : true)

export function shouldAskFirstSync(): boolean {
    return !_prompted
}

/** @desc 记录已询问过（无论用户选择同步还是跳过），之后不再自动弹窗 */
export function markFirstSyncAsked(): void {
    _prompted = true
    if (browser) localStorage.setItem(SYNC_PROMPT_KEY, '1')
}
