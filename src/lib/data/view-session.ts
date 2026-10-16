/**
 * @desc 视图会话记忆（**仅内存**：刷新 / 关闭页面即销毁，不落 localStorage、不写进工程）：
 * 按「工程 + 视图」记住打开的页签与各滚动容器的位置，让「切到别的页签或别的工程再切回来」
 * 能回到原来的视野（排轴时间轴、拉表的角色页签与表格、词条-环境配置的页签、速查的角色与正文）。
 *
 * 为什么不做持久化：这是「本次浏览到哪儿了」，不是工程数据 —— 刷新后从头看更符合直觉，
 * 也不该跟着工程导出/分享跑到别人机器上。故这里是模块级 Map，而不是 `$lib/data/*` 里常见的
 * localStorage 状态集（AGENTS §2 那条约束针对的是持久状态）。
 */

/** @desc 需要记忆视野的视图。速查虽挂在侧栏/弹窗上（不是阶段页），同样按当前工程记账 */
export type ViewSessionView = 'timeline' | 'calculation' | 'config' | 'quick-lookup'

/** @desc 滚动位置：两个方向都记（拉表要横向看宽表、时间轴本身就是横向滚动） */
export interface ViewScrollPos {
    top: number
    left: number
}

interface ViewSession {
    /** @desc 打开的页签；语义由各视图自定义（拉表 `slot-N`/`其它`、配置 `charN`/`enemy`、速查=角色名） */
    tab?: string
    /** @desc 各滚动容器的位置：同一视图可能有多个滚动区（如配置的角色区与敌人区），用 slot 区分 */
    scroll: Record<string, ViewScrollPos>
}

const sessions = new Map<string, ViewSession>()

/** @desc 记忆键：`\u0000` 分隔工程 id 与视图名，避免两者拼接产生歧义 */
const sessionKeyOf = (projectId: string, view: ViewSessionView): string => `${projectId}\u0000${view}`

const ensureSession = (projectId: string, view: ViewSessionView): ViewSession => {
    const key = sessionKeyOf(projectId, view)
    const existing = sessions.get(key)
    if (existing) return existing
    const created: ViewSession = { scroll: {} }
    sessions.set(key, created)
    return created
}

/** @desc 读该工程该视图打开的页签（没记过返回 null，调用方自行兜底默认页签） */
export const readSessionTab = (projectId: string, view: ViewSessionView): string | null =>
    sessions.get(sessionKeyOf(projectId, view))?.tab ?? null

/** @desc 记下该工程该视图打开的页签 */
export const writeSessionTab = (projectId: string, view: ViewSessionView, tab: string): void => {
    ensureSession(projectId, view).tab = tab
}

/** @desc 读某个滚动容器的位置（没记过返回 null） */
export const readSessionScroll = (projectId: string, view: ViewSessionView, slot: string): ViewScrollPos | null =>
    sessions.get(sessionKeyOf(projectId, view))?.scroll[slot] ?? null

/** @desc 记下某个滚动容器的位置 */
export const writeSessionScroll = (
    projectId: string,
    view: ViewSessionView,
    slot: string,
    pos: ViewScrollPos
): void => {
    ensureSession(projectId, view).scroll[slot] = pos
}

/** @desc 丢弃某工程的全部视野记忆（工程被删除时调用，避免同 id 的新工程继承旧位置） */
export const clearProjectSession = (projectId: string): void => {
    const prefix = `${projectId}\u0000`
    for (const key of [...sessions.keys()]) {
        if (key.startsWith(prefix)) sessions.delete(key)
    }
}

export interface AttachSessionScrollOptions {
    /**
     * @desc 是否在挂载时恢复位置（默认 true）。内容**异步加载**的容器传 false，
     * 由调用方在数据到位后自己恢复 —— 加载中容器是空的，写 scrollTop 会被夹到 0。
     */
    restore?: boolean
}

/**
 * @desc 给滚动容器挂上会话记忆：按需恢复位置 + 持续记录滚动（返回解绑函数，供 `$effect` 清理）。
 *
 * 恢复放在下一帧：挂载当帧表格/长文往往还没完成布局，scrollHeight 未定型时写 scrollTop 会被夹到 0。
 */
export const attachSessionScroll = (
    el: HTMLElement,
    projectId: string,
    view: ViewSessionView,
    slot: string,
    options: AttachSessionScrollOptions = {}
): (() => void) => {
    if (options.restore !== false) {
        requestAnimationFrame(() => {
            const pos = readSessionScroll(projectId, view, slot)
            if (!pos) return
            el.scrollTop = pos.top
            el.scrollLeft = pos.left
        })
    }
    const onScroll = () => {
        writeSessionScroll(projectId, view, slot, { top: el.scrollTop, left: el.scrollLeft })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
}
