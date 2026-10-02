/**
 * @desc 设置弹窗（`settings-modal.svelte`）的 UI 状态模块 —— Phase 5.1「外壳 + 每 tab 一组件」拆分时，
 * 存放**被抽出的 tab 独占**的状态与函数（仍被其余 tab 使用的状态留在外壳里，两边都要用的搬到这里、外壳 import）。
 * 风格对齐 `src/lib/data/*.svelte.ts`：模块级 `$state` + `get*` / `set*` 访问器。
 *
 * ⚠️ 5.1 第一增量（抽出 `performance` / `config` 两个 tab）实测**没有任何状态可搬**：
 *   - `performance`：三个开关直连全局 store `$lib/data/render-prefs.svelte`（`getGpuAccel` 等），
 *     不读不写外壳的 `$state` / `$derived` / 函数 —— 若在这里再包一层只会造出重复状态。
 *   - `config`：只是一层标题 + 既有 `settings/config-section.svelte`（其状态本来就在那个组件内部）。
 *   - 外壳的 `tab`、`SETTING_TABS`、主题 / 背景图 / keymap / cache / archive / connection / ai 等状态
 *     仍被其余 tab 的 `{#if tab === …}` 分支使用，按迁移契约必须留在外壳。
 * 故第一增量只把「设置栏目」的公共类型 `SettingsTab`（原先内联在外壳的 `$state<…>` 上）落在这里。
 *
 * 5.1 第二增量（抽出 `shortcuts` / `keymap` / `cache` 三个 tab）迁入的**两边共用**状态：
 *   - `tab`：侧栏导航与仍留外壳的 tab 分支要读，keymap tab 的「界面快捷键设置」要切到 shortcuts → 共用。
 *   - `shortcutCapture`：shortcuts tab 的「记录」按钮写、外壳的 window keydown 捕获（含 Esc 取消）读 → 共用。
 *   - `uiBtnIconList` / `keyPickerFor`：keymap tab 写 `keyPickerFor`；外壳根部的「选择按键与手柄键位」弹窗
 *     （必须留在外壳：外壳的毛玻璃 / 动画会为 `fixed` 建立包含块）读写两者 → 共用。
 *   - `entryById` / `updateEntry`：keymap tab 与上述弹窗都要读写按键条目 → 共用。
 *     （真正的数据仍在 `$lib/data/keymap.svelte`，这里只做「按 id 查 / 打补丁」的薄封装。）
 *   - `cacheEntries` + `refreshCacheEntries`：cache tab 用；外壳「打开设置」的 `$effect` 也要刷新一次 → 共用。
 * 同一增量迁入的**tab 独占**状态：`cacheBusy`、`expandedCache`。
 *
 * 5.1 第三增量（抽出 `ai` / `ai-conn`、`archive`、`interaction` 三个 tab）迁入的：
 *   - `ai` 与 `ai-conn` 在外壳里**共用同一个分支与同一个根节点**（内部再按 `tab` 细分），
 *     故按「一个 tab 一个组件」合成一个 `sections/ai.svelte`；迁入的**两边共用**状态：`aiEditTarget`、
 *     `promptEditOpen`、`aiDeleteTarget`，以及共用的删除实现 `doDeleteAiProfile` ——
 *     外壳的 AI 配置编辑 / 提示词编辑 / 删除确认三个次级弹窗是 `fixed` 覆盖层，必须留在外壳
 *     （设置面板内容区的毛玻璃与入场动画会为 `fixed` 建立包含块），而 tab 侧要写这三个状态、
 *     并要「关闭二次确认时直接删除」，两边必须共用同一份（复制状态或复制删除实现都会有两个真相源）。
 *   - `archive`：同理迁入 `archiveDeleteTarget`（外壳原名 `confirmDelete`）、`closeArchiveDelete`、
 *     `doArchiveDelete`（永久删除确认弹窗留外壳）；另迁入归档卡片的三张图标表 `archiveWeaponIcons` /
 *     `archiveEchoIcons` / `archiveEchoSetIcons` —— 原外壳在**挂载时**（与是否打开设置无关）就预取它们，
 *     预取 `$effect` 与 `archiveIconsLoaded` 守卫仍留外壳以保持原时序，`archive.svelte` 只读这三份状态
 *     （若把状态留在 section：TabPanel 的 `{#key active}` 会让每次切回归档 tab 都重新预取，属行为变化）。
 *   - `interaction`：**没有任何状态迁入** —— 所有开关直连 `calc-view` / `toolbar-prefs` / `render-prefs` /
 *     `context-menu-prefs` / `interaction-prefs`，外壳也不再读它们，与第一增量的 `performance` / `config`
 *     同情形，不发明重复状态。
 *
 * 反向（刻意不搬，避免造出重复状态或把展示逻辑塞进 store）：
 *   - `keymapEntries` 只是 `$lib/data/keymap.svelte` 的 `$derived` 视图（非自有状态），留在 keymap.svelte；
 *     `iconOf` / `gamepadIconOf` 亦只被该 tab 使用。
 *   - `CACHE_LABELS` / `CACHE_ENTITY_LABELS` / `entityLabel` / `entriesOf` / `runCacheClear` 等带图标、
 *     文案与 `addToast` 的展示逻辑留在 cache.svelte；第三增量的 `TOAST_POSITION_LABELS` / `TOAST_POSITION_HINTS` /
 *     `DANGER_MODE_OPTIONS` 同理留在各自 section。store 只放状态与「跨文件唯一的写入口」。
 *   - `charIconMap`（`archive`）与 `aiProfiles` / `aiActiveId`（`ai`）只是全局 store 的 `$derived` 视图，
 *     随各自 section 留下。
 *
 * ⚠️ 唯一违反「store 不 import addToast」的例外（仅 `doDeleteAiProfile` / `doArchiveDelete` 两处）：
 * 它们同时是外壳确认弹窗的 onconfirm 与本 tab「跳过二次确认」路径的实现，搬进 store 是避免复制的唯一办法。
 *
 * 5.1 第四增量（抽出 `theme` / `connection` 两个 tab）迁入的：
 *   - `theme`：`bgEditingLight` / `bgUrl` / `surfaceKey` —— 抽取前都是外壳的 `$state`，
 *     而 `TabPanel` 的 `{#key active}` 会在切栏目时重挂载 section，留在 section 里会被重置（行为变化）。
 *     其中 `bgEditingLight` / `bgUrl` 还被外壳「打开设置」的 `$effect` 写，故由 store 提供唯一的写入口
 *     `syncThemeEditing()`（= 原外壳那两行赋值）；`editingBgKey` / `editingBg` 两个派生也留在 store，
 *     因为那个 `$effect` 的**依赖语义**建在 `editingBg` 的派生值上（理由见 `syncThemeEditing` 注释）。
 *   - `connection`：`kuroPhone` / `kuroCode` / `kuroLoginBusy` / `kuroLoginInfo` / `kuroLoginError` /
 *     `kuroCountdown`（+ 非响应式的 `kuroTimer`）与 `newWorkshopUrl` 同样因重挂载而必须上移；
 *     倒计时定时器的起停（`startKuroCountdown`）也随之进 store，否则卸载后没人能清理/复用它。
 *   - 留在各自 section 的：`COLOR_PRESETS` / `getPresetStyle` / `compressImage`（theme）与
 *     `clearKuroMessages` / 各 `handle*` 处理函数（connection）—— 都是带文案 / DOM 的展示逻辑；
 *     `fileInput`（`bind:this`）也只能留在 section。
 *   - 外壳仍保留 `loadedVersionTab` + 「进入连接配置时加载各上游版本」的 `$effect`：它的触发条件是
 *     外壳自己的 `tab`（外壳用它决定渲染哪个分支），搬进 section 会变成「我在挂载」这第二个判定来源。
 */

import { listCacheEntries, type CacheCategory, type CacheEntry } from '$lib/api/data-cache'
import { getActiveId, getOverrides, type SurfaceKey } from '$lib/theme'
import { deleteProfile, type AiProfile } from '$lib/ai/config.svelte'
import { deleteProject } from '$lib/data/project.svelte'
import { addToast } from '$lib/data/toast.svelte'
import { getKeyMapEntries, updateKeyMapEntry, type KeyMapEntry } from '$lib/data/keymap.svelte'

/** @desc 设置弹窗的栏目键（与外壳 `SETTING_TABS` 的 `key` 一一对应；外壳赋 `tab` 时由此类型校验） */
export type SettingsTab =
    | 'theme'
    | 'interaction'
    | 'keymap'
    | 'shortcuts'
    | 'performance'
    | 'connection'
    | 'cache'
    | 'archive'
    | 'ai'
    | 'ai-conn'
    | 'config'

// ── 栏目切换：侧栏导航 + 仍在外壳的 tab 分支 + keymap tab 的「界面快捷键设置」跳转共用 ──
let tab = $state<SettingsTab>('theme')

export const getTab = () => tab

export const setTab = (next: SettingsTab) => {
    tab = next
}

// ── 界面快捷键录制：shortcuts tab 的「记录」按钮与外壳的 window keydown 捕获共用同一个待录制 id ──
let shortcutCapture = $state<string | null>(null)

export const getShortcutCapture = () => shortcutCapture

export const setShortcutCapture = (id: string | null) => {
    shortcutCapture = id
}

// ── 按键图标：keymap tab 的图标查询与外壳「选择按键与手柄键位」弹窗共用 ──
let uiBtnIconList = $state<[string, string][]>([])

export const getUiBtnIconList = () => uiBtnIconList

export const setUiBtnIconList = (list: [string, string][]) => {
    uiBtnIconList = list
}

/** @desc 正在选择按键的 keymap 条目 id（null = 弹窗关闭）；仅 keymap tab 会置位 */
let keyPickerFor = $state<string | null>(null)

export const getKeyPickerFor = () => keyPickerFor

export const setKeyPickerFor = (id: string | null) => {
    keyPickerFor = id
}

/** @desc 按 id 取按键条目（数据源 `$lib/data/keymap.svelte`；keymap tab 与外壳按键选择弹窗共用） */
export const entryById = (id: string): KeyMapEntry | undefined => getKeyMapEntries().find((e) => e.id === id)

/** @desc 局部更新按键条目（keymap tab 改名 / 外壳按键选择弹窗换图标共用） */
export const updateEntry = (id: string, patch: Partial<KeyMapEntry>) => {
    const e = entryById(id)
    if (e) updateKeyMapEntry({ ...e, ...patch })
}

// ── 缓存清理：cache tab 独占，但 `cacheEntries` 的刷新被外壳「打开设置」的 $effect 共用 ──
let cacheEntries = $state<CacheEntry[]>([])
let cacheBusy = $state(false)
/** @desc 展开查看条目明细的分类（同一时刻只展开一个，避免面板过长） */
let expandedCache = $state<CacheCategory | null>(null)

export const getCacheEntries = () => cacheEntries

export const refreshCacheEntries = async () => {
    cacheEntries = await listCacheEntries()
}

export const getCacheBusy = () => cacheBusy

export const setCacheBusy = (busy: boolean) => {
    cacheBusy = busy
}

export const getExpandedCache = () => expandedCache

export const setExpandedCache = (kind: CacheCategory | null) => {
    expandedCache = kind
}

// ── AI 助手次级弹窗：ai tab 写、外壳的三个 fixed 弹窗读并回写 ──
/** @desc 正在编辑的 AI 配置文件（AiProfileEditModal 的 profile） */
let aiEditTarget = $state<AiProfile | null>(null)
/** @desc 人设提示词编辑弹窗是否打开（AiPromptEditModal） */
let promptEditOpen = $state(false)
/** @desc 待确认删除的 AI 配置文件（外壳 ConfirmDeleteModal 渲染它） */
let aiDeleteTarget = $state<AiProfile | null>(null)

export const getAiEditTarget = () => aiEditTarget

export const setAiEditTarget = (profile: AiProfile | null) => {
    aiEditTarget = profile
}

export const getPromptEditOpen = () => promptEditOpen

export const setPromptEditOpen = (open: boolean) => {
    promptEditOpen = open
}

export const getAiDeleteTarget = () => aiDeleteTarget

export const setAiDeleteTarget = (profile: AiProfile | null) => {
    aiDeleteTarget = profile
}

/** @desc 删除已选中的 AI 配置文件（外壳确认弹窗 onconfirm 与 ai tab「跳过二次确认」共用同一实现） */
export const doDeleteAiProfile = async () => {
    const target = aiDeleteTarget
    if (!target) return
    await deleteProfile(target.id)
    aiDeleteTarget = null
    addToast('配置文件已删除', 'info')
}

// ── 归档：archive tab 触发、外壳的永久删除确认弹窗渲染与确认 ──
let archiveDeleteTarget = $state<{ id: string; name: string } | null>(null)

export const getArchiveDeleteTarget = () => archiveDeleteTarget

export const setArchiveDeleteTarget = (target: { id: string; name: string } | null) => {
    archiveDeleteTarget = target
}

export const closeArchiveDelete = () => {
    archiveDeleteTarget = null
}

/** @desc 永久删除已选中的归档工程（外壳确认弹窗 onconfirm 与 archive tab「跳过二次确认」共用同一实现） */
export const doArchiveDelete = async () => {
    const target = archiveDeleteTarget
    if (!target) return
    await deleteProject(target.id)
    addToast(`工程「${target.name}」已永久删除`, 'info')
    closeArchiveDelete()
}

// ── 归档卡片图标表：外壳挂载时预取（保持原时序），archive tab 只读 ──
let archiveWeaponIcons = $state<Record<string, string>>({})
let archiveEchoIcons = $state<Record<string, string>>({})
let archiveEchoSetIcons = $state<Record<string, string>>({})

export const getArchiveWeaponIcons = () => archiveWeaponIcons

export const setArchiveWeaponIcons = (icons: Record<string, string>) => {
    archiveWeaponIcons = icons
}

export const getArchiveEchoIcons = () => archiveEchoIcons

export const setArchiveEchoIcons = (icons: Record<string, string>) => {
    archiveEchoIcons = icons
}

export const getArchiveEchoSetIcons = () => archiveEchoSetIcons

export const setArchiveEchoSetIcons = (icons: Record<string, string>) => {
    archiveEchoSetIcons = icons
}

// ── 外观主题：theme tab 的状态；`bgEditingLight` / `bgUrl` 另被外壳「打开设置」的 $effect 写 ──
let bgEditingLight = $state(false)
let bgUrl = $state('')
/** @desc 正在手动调节的区域（六类之一；与「当前昼夜」无关） */
let surfaceKey = $state<SurfaceKey>('card')

export const getBgEditingLight = () => bgEditingLight

export const setBgEditingLight = (light: boolean) => {
    bgEditingLight = light
}

export const getBgUrl = () => bgUrl

export const setBgUrl = (url: string) => {
    bgUrl = url
}

export const getSurfaceKey = () => surfaceKey

export const setSurfaceKey = (key: SurfaceKey) => {
    surfaceKey = key
}

/** @desc 正在编辑哪一张背景图（黑夜=`backgroundImage` / 白天=`backgroundImageLight`） */
const editingBgKey = $derived(bgEditingLight ? ('backgroundImageLight' as const) : ('backgroundImage' as const))

export const getEditingBgKey = () => editingBgKey

/**
 * @desc 正在编辑的那张背景图（原外壳的 `editingBg` 派生）。
 * 放在 store 而不是两侧各算一份：外壳 `$effect` 的依赖语义建在它的**派生值**上，见下。
 */
const editingBg = $derived(getOverrides()[editingBgKey])

export const getEditingBg = () => editingBg

/**
 * @desc 外壳「打开设置」时把编辑目标对齐到当前昼夜（原外壳 `$effect` 里的两行赋值）。
 * 这里必须沿用「读派生 `editingBg`」而不是直接读 `bgEditingLight`：外壳 `$effect` 的依赖语义建在派生的
 * **值**上（`$derived` 的值不变就不通知下游），而直接读 `bgEditingLight` 会在用户点「白天 / 黑夜」时
 * 让外壳 effect 重跑、把选择弹回当前主题。
 * 实测（把「原内联写法 / 本函数写法 / 直接读 `bgEditingLight` 的反例」分别用 `svelte/compiler` 编成
 * runes 模块，在真实 svelte 运行时里 `effect_root` + `flush` 逐步观测 `light` / effect 运行次数 / `bgUrl`）：
 *   · 原写法与本函数写法四步观测**完全一致**；
 *   · 反例在「点白天」后 `light` 被弹回 false、effect 由 1 次变 3 次；
 *   · 改「正在编辑的那张背景图」时原写法与本写法都会让 effect 重跑 —— 即函数调用内的读取确实
 *     注册到了调用方 `$effect` 的依赖上。
 */
export const syncThemeEditing = () => {
    bgEditingLight = getActiveId() === 'light'
    const bg = editingBg
    bgUrl = bg.startsWith('http') ? bg : ''
}

// ── 连接配置：connection tab 的状态（库街区登录表单 + 工坊实例输入）──
let kuroPhone = $state('')
let kuroCode = $state('')
let kuroLoginBusy = $state(false)
let kuroLoginInfo = $state<string | null>(null)
let kuroLoginError = $state<string | null>(null)
let kuroCountdown = $state(0)
/** @desc 倒计时定时器句柄（非响应式：只被 `startKuroCountdown` 读写） */
let kuroTimer: ReturnType<typeof setInterval> | null = null
let newWorkshopUrl = $state('')

export const getKuroPhone = () => kuroPhone

export const setKuroPhone = (phone: string) => {
    kuroPhone = phone
}

export const getKuroCode = () => kuroCode

export const setKuroCode = (code: string) => {
    kuroCode = code
}

export const getKuroLoginBusy = () => kuroLoginBusy

export const setKuroLoginBusy = (busy: boolean) => {
    kuroLoginBusy = busy
}

export const getKuroLoginInfo = () => kuroLoginInfo

export const setKuroLoginInfo = (info: string | null) => {
    kuroLoginInfo = info
}

export const getKuroLoginError = () => kuroLoginError

export const setKuroLoginError = (error: string | null) => {
    kuroLoginError = error
}

export const getKuroCountdown = () => kuroCountdown

const stopKuroTimer = () => {
    if (kuroTimer) {
        clearInterval(kuroTimer)
        kuroTimer = null
    }
}

/** @desc 发验证码后的 60s 重发倒计时（原外壳实现；句柄在 store，卸载 section 后仍能续跑/停止） */
export const startKuroCountdown = () => {
    stopKuroTimer()
    kuroCountdown = 60
    kuroTimer = setInterval(() => {
        kuroCountdown -= 1
        if (kuroCountdown <= 0) stopKuroTimer()
    }, 1000)
}

export const getNewWorkshopUrl = () => newWorkshopUrl

export const setNewWorkshopUrl = (url: string) => {
    newWorkshopUrl = url
}
