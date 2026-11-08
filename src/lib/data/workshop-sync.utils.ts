/**
 * @desc 工坊自动同步的**纯逻辑**（无状态、无副作用、不发请求）：同步时机判定、上次同步文案、结果 toast 文案。
 *
 * 分层：
 *   - 状态与网络调用 → `./workshop-sync.svelte.ts`（localStorage 持久化 + 两个 sync 入口）
 *   - 设置界面 → `$lib/components/page/home/settings/sections/workshop-sync.svelte`
 * 放在这里是为了能被 `test/src/lib/data/workshop-sync.utils.test.ts` 直接覆盖（时机判定是唯一有分支的部分）。
 */

/** @desc 可自动同步的两类工坊数据：Buff 集 / 标准 14 词条集 */
export type WorkshopSyncKind = 'buff' | 'substat'

/** @desc 两类数据的遍历顺序（也是界面与 toast 里的展示顺序） */
export const WORKSHOP_SYNC_KINDS: readonly WorkshopSyncKind[] = ['buff', 'substat'] as const

/** @desc 两类数据在文案里的名字 */
export const WORKSHOP_SYNC_LABELS: Record<WorkshopSyncKind, string> = {
    buff: 'Buff 集',
    substat: '词条集'
}

/**
 * @desc 同步时机：
 * - `enter`：每次进入应用都同步（默认，与「开启后在进入时自动同步」的字面语义一致）
 * - `daily` / `weekly`：距上次成功同步满 1 天 / 7 天才同步
 * - `version`：上游数据版本（`getWWVersion()`）与上次同步时不同才同步
 */
export type WorkshopSyncTiming = 'enter' | 'daily' | 'weekly' | 'version'

/** @desc 时机的取值域（设置界面的分段顺序 = 这里的顺序） */
export const WORKSHOP_SYNC_TIMINGS: readonly WorkshopSyncTiming[] = ['enter', 'daily', 'weekly', 'version'] as const

/** @desc 时间型时机的间隔（毫秒）；`enter` / `version` 不按时间判定，故不在此表 */
export const WORKSHOP_SYNC_INTERVALS: Record<'daily' | 'weekly', number> = {
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000
}

/** @desc 某类数据上次成功的同步记录：时间戳 + 当时的上游数据版本（`version` 时机用） */
export interface WorkshopSyncStamp {
    at: number
    version: string
}

/** @desc 从未同步过的记录（`at: 0` 是"无记录"的唯一标记，判定与文案都按它分支） */
export const emptySyncStamp = (): WorkshopSyncStamp => ({ at: 0, version: '' })

export interface SyncDueInput {
    timing: WorkshopSyncTiming
    /** @desc 上次成功同步的时间戳（毫秒）；0 = 从未同步 */
    lastAt: number
    /** @desc 上次成功同步时的上游数据版本 */
    lastVersion: string
    /** @desc 当前时间戳（毫秒），由调用方注入以便测试 */
    now: number
    /** @desc 当前上游数据版本（`getWWVersion()`） */
    version: string
}

/**
 * @desc 这次进入应用是否该同步该类型数据。
 * 从未同步过时**任何时机都返回 true**（否则设成「每天」后首次永远不动）。
 */
export const isWorkshopSyncDue = ({ timing, lastAt, lastVersion, now, version }: SyncDueInput): boolean => {
    if (!lastAt) return true
    if (timing === 'enter') return true
    if (timing === 'version') return lastVersion !== version
    // 系统时间倒退时 diff 为负 → 视为「还没到」，不反复重试
    return now - lastAt >= WORKSHOP_SYNC_INTERVALS[timing]
}

/** @desc 上次同步时间的相对文案（设置界面展示用；不做定时刷新，切到该栏目时重算一次） */
export const formatSyncAge = (lastAt: number, now: number): string => {
    if (!lastAt) return '从未同步'
    const diff = Math.max(0, now - lastAt)
    if (diff < 60_000) return '刚刚'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
    return `${Math.floor(diff / 86_400_000)} 天前`
}

/** @desc 单类数据的同步结果（由 `./workshop-sync.svelte.ts` 从两个 fetch 的返回值摊平而来） */
export interface WorkshopSyncOutcome {
    kind: WorkshopSyncKind
    ok: boolean
    /** @desc 该次同步写入/覆盖的条目数（成功时有意义） */
    added: number
    error?: string
}

export interface WorkshopSyncToast {
    message: string
    type: 'success' | 'error'
}

/**
 * @desc 同步结果 → toast 文案。
 * 自动同步与手动「立即同步」都**无论成败**弹一条（需求明确要求），只是前缀不同。
 * 部分成功（一类通、一类失败）按 error 弹，并在文案里带上已成功的部分。
 */
export const buildSyncToast = (outcomes: readonly WorkshopSyncOutcome[], manual = false): WorkshopSyncToast => {
    const prefix = manual ? '工坊同步' : '工坊自动同步'
    const done = outcomes.filter((o) => o.ok).map((o) => `${WORKSHOP_SYNC_LABELS[o.kind]} +${o.added}`)
    const failed = outcomes.find((o) => !o.ok)
    if (!failed) {
        return { message: done.length > 0 ? `${prefix}完成：${done.join(' · ')}` : `${prefix}完成`, type: 'success' }
    }
    const reason = failed.error ?? '无法连接工坊'
    if (done.length === 0) return { message: `${prefix}失败：${reason}`, type: 'error' }
    return {
        message: `${prefix}部分完成（${done.join(' · ')}），${WORKSHOP_SYNC_LABELS[failed.kind]}失败：${reason}`,
        type: 'error'
    }
}
