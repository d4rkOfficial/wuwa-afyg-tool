/**
 * @desc 工坊自动同步：**设置项持久化 + 同步执行**（Buff 集 / 标准词条集）。
 *
 * 背景：首页侧已有两个「从工坊同步」手动入口（`buff-library-modal` / `substat-library-modal`），
 * 但它们都要用户先打开面板再点按钮。本模块让「进入应用时自动向椰果工坊请求一次」成为可选项，
 * 默认**关闭**（见 `DEFAULT_PREFS`），开关与时机在「设置 → 数据 → 工坊同步」。
 *
 * 分层（AGENTS §2）：
 *   - 纯逻辑（时机判定 / 文案）→ `./workshop-sync.utils.ts`，有单测
 *   - 本文件只管「localStorage 状态 + 调两个既有 fetch + 弹 toast」
 *   - 启动时机由 `src/routes/store.svelte.ts` 的 `bootstrapRouteStores()` 触发（唯一入口）
 *
 * 语义要点：
 *   - 两类数据各自独立开关、各自记录「上次成功同步」（`at` + 当时的 `getWWVersion()`），
 *     所以「Buff 集每天一次、词条集每次进入」这种组合是成立的。
 *   - **只覆盖工坊来源的数据**：两个 fetch 内部已按 `source` 区分（本地自定义免疫），本模块不额外过滤。
 *   - 结果**无论成败都弹 toast**（需求明确要求）；「不到时机 / 没开开关」则完全不打扰。
 */

import { browser } from '$app/environment'
import { getWWVersion } from '$lib/api/client-version'
import { fetchBuffSetsFromShare } from './buff-library.svelte'
import { fetchSubstatPlansFromShare } from './substat-library.svelte'
import { addToast } from './toast.svelte'
import {
    buildSyncToast,
    emptySyncStamp,
    isWorkshopSyncDue,
    WORKSHOP_SYNC_KINDS,
    WORKSHOP_SYNC_TIMINGS,
    type WorkshopSyncKind,
    type WorkshopSyncOutcome,
    type WorkshopSyncStamp,
    type WorkshopSyncTiming
} from './workshop-sync.utils'

const STORAGE_KEY = 'wuwa-afyg:workshop-sync'

interface PersistedPrefs {
    buff: boolean
    substat: boolean
    timing: WorkshopSyncTiming
    last: Record<WorkshopSyncKind, WorkshopSyncStamp>
}

/** @desc 默认值：两个开关都关（需求要求默认关闭），时机回落「每次进入」 */
const DEFAULT_PREFS = (): PersistedPrefs => ({
    buff: false,
    substat: false,
    timing: 'enter',
    last: { buff: emptySyncStamp(), substat: emptySyncStamp() }
})

/** @desc 持久化记录容错：坏的 `at` 归零（= 从未同步），坏的 `version` 归空串 */
const normalizeStamp = (raw: unknown): WorkshopSyncStamp => {
    const rec = (raw ?? {}) as Partial<WorkshopSyncStamp>
    const at = Number(rec.at)
    return {
        at: Number.isFinite(at) && at > 0 ? at : 0,
        version: typeof rec.version === 'string' ? rec.version : ''
    }
}

const isTiming = (value: unknown): value is WorkshopSyncTiming =>
    WORKSHOP_SYNC_TIMINGS.includes(value as WorkshopSyncTiming)

/** @desc 读持久化偏好（模块加载时读一次；坏数据一律回落默认值，不让设置页打不开） */
const readPrefs = (): PersistedPrefs => {
    const base = DEFAULT_PREFS()
    if (!browser) return base
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return base
        const parsed = JSON.parse(raw) as Partial<PersistedPrefs> | null
        if (!parsed) return base
        return {
            buff: parsed.buff === true,
            substat: parsed.substat === true,
            timing: isTiming(parsed.timing) ? parsed.timing : base.timing,
            last: {
                buff: normalizeStamp(parsed.last?.buff),
                substat: normalizeStamp(parsed.last?.substat)
            }
        }
    } catch {
        return base
    }
}

const initial = readPrefs()

let _buff = $state(initial.buff)
let _substat = $state(initial.substat)
let _timing = $state<WorkshopSyncTiming>(initial.timing)
let _last = $state<Record<WorkshopSyncKind, WorkshopSyncStamp>>(initial.last)

/** @desc 同步进行中：设置里的「立即同步」按钮据此禁用，同时挡住自动同步与手动同步并发 */
let _syncing = $state(false)

const persist = (): void => {
    if (!browser) return
    try {
        const data: PersistedPrefs = { buff: _buff, substat: _substat, timing: _timing, last: _last }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
        /* 隐私模式 / 配额满：内存态照常工作，只是不持久化 */
    }
}

// ── 读取（设置界面与启动序列共用）────────────────────────────────────────

export function getAutoSyncBuff(): boolean {
    return _buff
}

export function getAutoSyncSubstat(): boolean {
    return _substat
}

export function getSyncTiming(): WorkshopSyncTiming {
    return _timing
}

/** @desc 某类数据上次成功同步的记录（`at: 0` = 从未同步） */
export function getLastSync(kind: WorkshopSyncKind): WorkshopSyncStamp {
    return _last[kind]
}

export function getSyncBusy(): boolean {
    return _syncing
}

// ── 写入（唯二写入口：都是立即持久化）────────────────────────────────────

export function setAutoSyncBuff(value: boolean): void {
    if (_buff === value) return
    _buff = value
    persist()
}

export function setAutoSyncSubstat(value: boolean): void {
    if (_substat === value) return
    _substat = value
    persist()
}

export function setSyncTiming(value: WorkshopSyncTiming): void {
    if (_timing === value) return
    _timing = value
    persist()
}

// ── 执行 ────────────────────────────────────────────────────────────────

const isKindEnabled = (kind: WorkshopSyncKind): boolean => (kind === 'buff' ? _buff : _substat)

/**
 * @desc 登记一次**成功**的同步（时间戳 + 当时的上游数据版本）。
 *
 * 除本模块自己的两个入口外，Buffer / 词条集面板里的「从工坊同步」也会调它：否则用户刚在面板里手动同步过，
 * 设置里仍显示「从未同步」，而且下一次以「每天一次」进入时还会白跑一次请求。
 */
export function markWorkshopSynced(kind: WorkshopSyncKind): void {
    _last = { ..._last, [kind]: { at: Date.now(), version: getWWVersion() } }
    persist()
}

/**
 * @desc 同步一类数据。成功才登记（失败下次仍会重试，否则一次离线就把时机推到明天）。
 * 两个 fetch 都自带 `_loading` 守卫与错误文案，这里只负责摊平结果。
 */
const runKind = async (kind: WorkshopSyncKind): Promise<WorkshopSyncOutcome> => {
    const result = kind === 'buff' ? await fetchBuffSetsFromShare() : await fetchSubstatPlansFromShare()
    if (result.ok) markWorkshopSynced(kind)
    return { kind, ok: result.ok, added: result.added, ...(result.error ? { error: result.error } : {}) }
}

/** @desc 串起「并发跑若干类 → 无论成败弹一条 toast」；`manual` 只影响文案前缀 */
const runKinds = async (kinds: readonly WorkshopSyncKind[], manual: boolean): Promise<void> => {
    if (!browser || _syncing || kinds.length === 0) return
    _syncing = true
    try {
        const outcomes = await Promise.all(kinds.map((kind) => runKind(kind)))
        const toast = buildSyncToast(outcomes, manual)
        addToast(toast.message, toast.type, manual ? 4000 : 5000)
    } finally {
        _syncing = false
    }
}

/**
 * @desc 进入应用时的自动同步（`bootstrapRouteStores()` 调用）。
 * 只跑「开关开着 **且** 到了时机」的那几类；一类都不跑时静默返回（不弹任何提示）。
 */
export async function runWorkshopAutoSync(): Promise<void> {
    if (!browser) return
    const now = Date.now()
    const version = getWWVersion()
    const due = WORKSHOP_SYNC_KINDS.filter(
        (kind) =>
            isKindEnabled(kind) &&
            isWorkshopSyncDue({
                timing: _timing,
                lastAt: _last[kind].at,
                lastVersion: _last[kind].version,
                now,
                version
            })
    )
    await runKinds(due, false)
}

/** @desc 设置里的「立即同步」：不看到期时间，两类都跑一次 */
export async function syncWorkshopNow(): Promise<void> {
    await runKinds(WORKSHOP_SYNC_KINDS, true)
}
