/**
 * @desc `src/routes/+page.svelte`（唯一页面路由 `/`）的**路由级 store 层**（AGENTS §2）：启动序列编排 + 持久状态。
 *
 * 为什么落在路由文件夹、且叫 `store.svelte.ts`：
 *   - AGENTS §2：路由的类型/常量/工具函数/store 必须放路由文件夹下的 `types.ts` / `consts.ts` / `utils.ts` / `store.svelte.ts`，
 *     **不能放 `$lib/` 下**；只有跨路由复用的东西才进 `$lib/{模块名}/`。本应用只有 `/` 一个页面路由，
 *     所以这些编排**不具备跨路由复用性**，属本路由专有。
 *   - 与仓库既有 store 层同形：`$lib/data/*.svelte.ts` 都是「模块级状态 + get/set + `browser` 守卫」，
 *     且同为 UI/store 层（`eslint.config.js` 对 `*.svelte.ts` 不做函数式约束，Runes 状态保留可变性）。
 *
 * 现状说明：本文件目前**没有 `$state`** —— 组件局部 UI 状态（约 30 组弹窗/侧栏开关）按 AGENTS §2 与
 * 「模板冻结」要求留在 `+page.svelte`（它们被主 HTML 直接读取，搬走必然改模板）。此地承载的是
 * 「不触碰组件状态的 store 编排」：启动序列、工程数据重载、阶段锁定收尾、上游版本指纹。后续若出现
 * 路由级共享的响应式状态，直接加在这里。
 *
 * `wuwa-afyg:version` 为什么不放 `$lib/data/{状态集名}.svelte.ts`：仓库既有 localStorage 状态
 * （`toy-prefs` / `calc-view` / `render-prefs` …）都是**跨路由的偏好**，故按 AGENTS §2 末条进 `$lib/data/`；
 * 而版本指纹只被本页启动序列读写、不参与任何跨路由复用，属「路由级 store 不得放 `$lib/`」的那一类。
 * 键名与读写它的 store 同文件，对齐 `$lib/data/*.svelte.ts` 各自持有 `STORAGE_KEY` 的既有做法。
 */
import { browser } from '$app/environment'
import { ensureVersion, getWWVersion } from '$lib/api/client-version'
import { clearCache, getCharacterInfo, getEchoInfo } from '$lib/api/data-cache'
import { initToyEnvironmentBridge, isToyMobile, onToyEnter } from '$lib/bilibili-toy/environment.svelte'
import { initToyProfileBridge } from '$lib/bilibili-toy/profile.svelte'
import {
    getCalcState,
    init as initCalculation,
    rebindGlobalBuffs,
    setConditionProfile,
    setShowBuffModal
} from '$lib/calc/calculation.store.svelte'
import type { CalcState } from '$lib/calc/calculation.types'
import { getConfig, init as initConfig } from '$lib/calc/config.store.svelte'
import type { ConfigState } from '$lib/calc/config.types'
import { init as initTimeline, loadIcons } from '$lib/calc/timeline.store.svelte'
import type { TimelineData } from '$lib/calc/timeline.types'
import { loadGenPrefs, updateGenPrefs } from '$lib/data/ai-prefs.svelte'
import { setCalcViewMode } from '$lib/data/calc-view.svelte'
import { setModalClosePosition } from '$lib/data/interaction-prefs.svelte'
import { loadKeyMap } from '$lib/data/keymap.svelte'
import { conditionProfileFromTeam } from '$lib/data/migration'
import {
    getActiveProject,
    getPhaseOrder,
    loadProjects,
    lockPhase,
    unlockPhase,
    updateCalculation,
    updateConfig
} from '$lib/data/project.svelte'
import { setMagneticPointer } from '$lib/data/render-prefs.svelte'
import { checkShare, refreshShareCooldown } from '$lib/data/share.svelte'
import { loadShortcuts } from '$lib/data/shortcuts.svelte'
import { fetchSubstatPlansFromShare } from '$lib/data/substat-library.svelte'
import { isFirstVisit, isMagneticToySet, markMagneticToySet, markVisited } from '$lib/data/toy-prefs.svelte'
import { loadWorkshop } from '$lib/data/workshop.svelte'
import { loadKuroEchoCache } from '$lib/kuro-app/kuro-echo-cache.svelte'
import { loadKuroPrefs, restoreKuroSession } from '$lib/kuro-app/kuro.svelte'
import { applyFirstRunAppearance } from '$lib/theme'
import type { PhaseKey } from '$lib/types/project'
import { hideSplash } from '$lib/utils/splash'

/** @desc 上游数据版本指纹的 localStorage 键（值 = 上次记录到的 `getWWVersion()`） */
const VERSION_STORAGE_KEY = 'wuwa-afyg:version'

/** @desc 上游数据版本变化则丢弃本地 IndexedDB 缓存，并记下本次版本 */
export const syncUpstreamVersionCache = (): void => {
    if (!browser) return
    const prev = localStorage.getItem(VERSION_STORAGE_KEY)
    if (prev && prev !== getWWVersion()) clearCache()
    localStorage.setItem(VERSION_STORAGE_KEY, getWWVersion())
}

/** @desc 阶段锁定后的 store 侧收尾：时间线重绑全局 buff 并把内存态写回工程，配置把内存态写回工程 */
export const syncPhaseLockSideEffects = (phase: PhaseKey): void => {
    if (phase === 'timeline') {
        rebindGlobalBuffs()
        updateCalculation(getCalcState())
    }
    if (phase === 'config') {
        updateConfig(getConfig())
    }
}

/** @desc 重载当前工程全部阶段数据（不改变视图状态）；切工程 / 链阶变动 / 刷新结果共用 */
export const reloadActiveProjectStores = (): void => {
    setShowBuffModal(false)
    const p = getActiveProject()
    if (!p) return
    initTimeline(p.phases.timeline.data as TimelineData | null, () => {}, p.team, p.phases.timeline?.locked ?? false)
    // 重建伤害条目（条目由队伍与时间线派生，条件数据随后由 setConditionProfile 注入）
    initCalculation(
        p.team,
        p.phases.timeline.data as TimelineData | null,
        p.phases.calculation.data as CalcState | null,
        p.phases.calculation?.locked ?? false,
        (state) => updateCalculation(state)
    )
    initConfig(p.phases.config.data as ConfigState | null, p.phases.config?.locked ?? false)
    // 预热角色与声骸数据（IndexedDB 缓存）：减少排轴/拉表等阶段首次挂载的异步等待
    for (const slot of p.team) {
        if (slot.character) void getCharacterInfo(slot.character)
        if (slot.echoes?.[0]?.name) void getEchoInfo(slot.echoes[0].name)
    }
    // 恢复工程携带的链/阶配置（链阶真源是工程 team 槽位，此处同步到条件系统的读入口）
    setConditionProfile(conditionProfileFromTeam(p.team))
}

/**
 * @desc 重新锁定全部环节：先全部解锁，再按原锁定状态逐个重锁
 * （重锁 timeline/config 会重新同步全局 buff 并把当前内存态写回工程，修复换工程后残留旧数据的问题）。
 * 活动工程在开头取一次快照：原实现在循环里反复读组件里的 `$derived(activeProject)`，
 * 而循环内只用到 `.id`（解锁/加锁的目标 id）与开头已拍平的 `wasLocked`，取快照后语义不变。
 */
export const relockAllPhases = async (): Promise<void> => {
    const project = getActiveProject()
    if (!project) return
    const order = getPhaseOrder()
    const wasLocked = order.map((p) => project.phases[p]?.locked === true)
    for (const phase of order) await unlockPhase(project.id, phase)
    for (let i = 0; i < order.length; i++) {
        const phase = order[i]
        if (!wasLocked[i]) continue
        await lockPhase(phase)
        syncPhaseLockSideEffects(phase)
    }
}

/**
 * @desc 路由启动序列中**不触碰组件状态**的部分。
 * 组件侧仍保留两件与视图强耦合的事：AI 面板注册（`registerPanel` 表里全是组件局部状态）、
 * `#import_project` 哈希动作（成功后要跳到该工程的阶段视图）。
 * 语句顺序即语义：本地数据**不等待**上游版本检查（版本端点是网络请求，实测可能十几秒，
 * 一旦放在 await 之后，刷新后会先长时间空列表）。
 */
export const bootstrapRouteStores = async (): Promise<void> => {
    hideSplash()
    initToyProfileBridge()
    initToyEnvironmentBridge()
    // 首次进入（任意端）：拉表默认平铺模式；禁用磁力光标；禁用 AI 助手；应用默认外观（昼夜质感 + 内置背景图）；
    // 静默从工坊同步「标准词条集」（不再弹「同步工坊数据」弹窗；Buff 集不自动同步，由用户自行同步）
    if (isFirstVisit()) {
        setCalcViewMode('spread')
        setMagneticPointer(false)
        // AI 助手默认隐藏（**持久化**保存：用户可在设置里重新开启）
        void loadGenPrefs().then(() => updateGenPrefs({ enabled: false }))
        // B 站 Toy 平台首次进入：弹窗关闭按钮默认放左上角（其它平台保持右上角）
        if (isToyMobile()) setModalClosePosition('top-left')
        void applyFirstRunAppearance()
        // 同步失败静默忽略（工坊不可达等）：用户可在「词条方案」面板随时手动同步
        void fetchSubstatPlansFromShare()
        markVisited()
    }
    // 进入 Toy 环境（消息异步到达，每会话首次触发）：
    // - 关闭 AI 助手（会话级，不持久化）
    // - 首次在 Toy 手机环境进入 → 关闭磁力光标（一次性持久设定）
    onToyEnter(() => {
        void loadGenPrefs().then(() => updateGenPrefs({ enabled: false }))
        if (isToyMobile() && !isMagneticToySet()) {
            setMagneticPointer(false)
            markMagneticToySet()
        }
    })
    // 本地数据不等待上游版本检查：版本端点是网络请求（实测可能十几秒），
    // 一旦放在 await 之后，刷新后会先长时间空列表 —— 工程/按键/快捷键/工坊都先在本地恢复
    loadProjects()
    loadKeyMap()
    loadShortcuts()
    loadWorkshop()
    loadKuroPrefs()
    // 库街区：读一次本地暂存的声骸数据（有缓存就不必再打上游）
    loadKuroEchoCache()
    // 库街区：本地有登录标记就自动恢复登录态（token 在 httpOnly cookie 里，前端只能问服务端）。
    // 只读会话：不主动做任何会写游戏数据的操作。
    void restoreKuroSession()
    await ensureVersion()
    syncUpstreamVersionCache()
    loadIcons()
    checkShare()
    // 分享频率限制：恢复上次分享时间戳并启动倒计时（刷新页面后仍然生效）
    refreshShareCooldown()
}
