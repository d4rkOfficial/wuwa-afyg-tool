<script lang="ts">
    import Modal from '$lib/components/layout/modal.svelte'
    import Icon from '@iconify/svelte'
    import { getUiBtnIcons, getWeaponIcons, getEchoIcons, getEchoSetIcons } from '$lib/api/data-cache'
    import { addToast } from '$lib/data/toast.svelte'
    import { loadProviderVersions } from '$lib/data/provider-prefs.svelte'
    import { loadGenPrefs } from '$lib/data/ai-prefs.svelte'
    import { GAMEPAD_BUTTONS } from '$lib/calc/timeline.consts'
    import { consumeKuroSettingsRequest, getKuroSettingsRequest } from '$lib/kuro-app/kuro.svelte'
    import {
        applyLockedMods,
        getShortcutDef,
        normalizeShortcutEvent,
        shortcutLabel,
        updateShortcut
    } from '$lib/data/shortcuts.svelte'
    import { loadAiConfig } from '$lib/ai/config.svelte'
    import ConfirmDeleteModal from '$lib/components/ui/confirm-delete-modal.svelte'
    import TabPanel from '$lib/components/ui/tab-panel.svelte'
    import AiProfileEditModal from './ai-profile-edit-modal.svelte'
    import AiPromptEditModal from './ai-prompt-edit-modal.svelte'
    import AiSection from './sections/ai.svelte'
    import ArchiveSection from './sections/archive.svelte'
    import CacheSection from './sections/cache.svelte'
    import ConfigSection from './sections/config.svelte'
    import ConnectionSection from './sections/connection.svelte'
    import InteractionSection from './sections/interaction.svelte'
    import KeymapSection from './sections/keymap.svelte'
    import PerformanceSection from './sections/performance.svelte'
    import ShortcutsSection from './sections/shortcuts.svelte'
    import ThemeSection from './sections/theme.svelte'
    import {
        closeArchiveDelete,
        doArchiveDelete,
        doDeleteAiProfile,
        entryById,
        getAiDeleteTarget,
        getAiEditTarget,
        getArchiveDeleteTarget,
        getKeyPickerFor,
        getPromptEditOpen,
        getShortcutCapture,
        getTab,
        getUiBtnIconList,
        refreshCacheEntries,
        setAiDeleteTarget,
        setAiEditTarget,
        setArchiveEchoIcons,
        setArchiveEchoSetIcons,
        setArchiveWeaponIcons,
        setKeyPickerFor,
        setPromptEditOpen,
        setShortcutCapture,
        setTab,
        setUiBtnIconList,
        syncThemeEditing,
        updateEntry
    } from './settings-ui.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {
        open: boolean
        onclose: () => void
    }

    let { open, onclose, class: className, style: styleProp }: Props = $props()

    /** @desc 当前栏目：状态托管在 `settings-ui.svelte.ts`（keymap tab 也要切栏目），此处只读视图；赋值走 `setTab` */
    let tab = $derived(getTab())

    // ── 抽出的 tab 与外壳次级弹窗共用的状态（都在 `settings-ui.svelte.ts`，此处只读；写入走对应 setter）──
    /** @desc 待确认永久删除的归档工程（archive tab 触发；外壳的确认弹窗渲染并确认） */
    let archiveDeleteTarget = $derived(getArchiveDeleteTarget())
    /** @desc 正在编辑的 AI 配置文件（ai tab 触发；外壳的编辑弹窗渲染） */
    let aiEditTarget = $derived(getAiEditTarget())
    /** @desc 人设提示词编辑弹窗开关（ai tab 触发；外壳的提示词弹窗渲染） */
    let promptEditOpen = $derived(getPromptEditOpen())
    /** @desc 待确认删除的 AI 配置文件（ai tab 触发；外壳的确认弹窗渲染并确认） */
    let aiDeleteTarget = $derived(getAiDeleteTarget())

    /** @desc 请求打开设置时可能带「跳到连接配置」的意图（词条集同步流程在未登录时发起） */
    $effect(() => {
        if (!open) return
        if (!getKuroSettingsRequest()) return
        consumeKuroSettingsRequest()
        setTab('connection')
    })

    /** @desc 设置栏目：按「界面 / 数据 / AI助手 / 配置」分组归类（配置导入导出是独立一级栏目，不再挂在「数据」下） */
    const SETTING_TABS = [
        { group: '界面', key: 'theme', label: '外观主题', icon: 'mdi:palette-outline' },
        { group: '界面', key: 'interaction', label: '交互相关', icon: 'mdi:gesture-tap' },
        { group: '界面', key: 'keymap', label: '按键图标', icon: 'mdi:keyboard-outline' },
        { group: '界面', key: 'shortcuts', label: '快捷键位', icon: 'mdi:keyboard-settings-outline' },
        { group: '界面', key: 'performance', label: '性能相关', icon: 'mdi:speedometer' },
        { group: '数据', key: 'connection', label: '连接配置', icon: 'mdi:link-variant' },
        { group: '数据', key: 'cache', label: '缓存清理', icon: 'mdi:database-outline' },
        { group: '数据', key: 'archive', label: '归档管理', icon: 'mdi:archive-outline' },
        { group: 'AI助手', key: 'ai-conn', label: '启用 / 接入配置', icon: 'mdi:connection' },
        { group: 'AI助手', key: 'ai', label: '权限 / 提示词', icon: 'mdi:shield-account-outline' },
        { group: '配置', key: 'config', label: '配置导入导出', icon: 'mdi:cog-sync-outline' }
    ] as const

    /** @desc 按 group 聚合栏目（保持声明顺序） */
    const SETTING_GROUPS = SETTING_TABS.reduce<{ group: string; items: (typeof SETTING_TABS)[number][] }[]>(
        (acc, t) => {
            const last = acc[acc.length - 1]
            if (last && last.group === t.group) last.items.push(t)
            else acc.push({ group: t.group, items: [t] })
            return acc
        },
        []
    )

    $effect(() => {
        if (open) {
            // 背景图编辑目标对齐当前昼夜（原外壳两行赋值；状态与依赖语义都在 `settings-ui.svelte.ts`）
            syncThemeEditing()
            void refreshCacheEntries()
            loadAiConfig()
            loadGenPrefs()
        }
    })

    // ── Key mapping / 界面快捷键：跨组件共享的状态托管在 `settings-ui.svelte.ts`，
    //    外壳只保留「按键图标加载」与「待录制快捷键的 window 捕获」两段监听 ──
    let uiBtnIconList = $derived(getUiBtnIconList())
    let keyPickerFor = $derived(getKeyPickerFor())
    let shortcutCapture = $derived(getShortcutCapture())

    $effect(() => {
        if (shortcutCapture === null) return
        const onKey = (e: KeyboardEvent) => {
            e.preventDefault()
            e.stopPropagation()
            if (e.key === 'Escape') {
                setShortcutCapture(null)
                return
            }
            const key = normalizeShortcutEvent(e)
            if (!key) return
            const id = shortcutCapture
            if (id === null) return
            const def = getShortcutDef(id)
            if (!def) return
            // 锁定修饰键（如 Shift 固定）：按到被锁定的纯修饰键时继续等待主键
            if (def.lockedMods?.length && key.split('+').length === 1 && def.lockedMods.includes(key)) return
            const final = applyLockedMods(def, key)
            void updateShortcut(id, final).then((conflict) => {
                if (conflict) {
                    addToast(`「${def?.label}」与「${conflict.label}」冲突，未保存`, 'error')
                } else {
                    addToast(`「${def?.label}」已设为 ${shortcutLabel(final)}`, 'success')
                }
                setShortcutCapture(null)
            })
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
    })

    $effect(() => {
        if (open && uiBtnIconList.length === 0) {
            getUiBtnIcons().then((map) => {
                setUiBtnIconList(Object.entries(map))
            })
        }
    })

    // ── 进入「连接配置」页时加载各上游最新版本（触发条件是外壳自己的 `tab`，故留在外壳；
    //    section 只在自己被渲染时才知道「已切到该栏目」，那是第二个判定来源）──
    let loadedVersionTab = false
    $effect(() => {
        if (tab === 'connection' && !loadedVersionTab) {
            loadedVersionTab = true
            void loadProviderVersions()
        }
    })

    // ── 归档卡片图标：外壳挂载时预取一次（原时序不变），结果写进 `settings-ui.svelte.ts`，
    //    由抽出的 `sections/archive.svelte` 读取 ──
    let archiveIconsLoaded = false
    $effect(() => {
        if (archiveIconsLoaded) return
        archiveIconsLoaded = true
        void Promise.all([getWeaponIcons(), getEchoIcons(), getEchoSetIcons()]).then(([w, e, s]) => {
            setArchiveWeaponIcons(w)
            setArchiveEchoIcons(e)
            setArchiveEchoSetIcons(s)
        })
    })

    // ── Cache management ── 整块（状态 + 分类文案 + 清理处理）已随 tab 抽到
    //    `sections/cache.svelte`；外壳只保留「打开设置时刷新一次条目」所用的 `refreshCacheEntries`
    // ── Archive management ── 整块（列表 + 处理函数 + 删除确认状态）已随 tab 抽到
    //    `sections/archive.svelte`；永久删除确认弹窗留在外壳，其状态与共用实现在 `settings-ui.svelte.ts`
    // ── AI 助手（ai / ai-conn）── 整块已随两个键合成的一个 tab 抽到 `sections/ai.svelte`；
    //    三个次级弹窗留在外壳，其状态与共用实现在 `settings-ui.svelte.ts`
    // ── 交互相关 ── 整块（含 Toast 位置文案）已随 tab 抽到 `sections/interaction.svelte`，无共享状态
    // ── 外观主题 ── 整块已随 tab 抽到 `sections/theme.svelte`；外壳只保留「打开设置」时对
    //    `bgEditingLight` / `bgUrl` 的初始化（走 `settings-ui.svelte.ts` 的 `syncThemeEditing()`，
    //    状态的依赖语义也在那边，见其注释）
    // ── 连接配置 ── 整块已随 tab 抽到 `sections/connection.svelte`；「进入该栏目时加载各上游版本」的
    //    `$effect` 因触发条件是外壳自己的 `tab` 而留在外壳
</script>

<!-- @desc 设置弹窗：共享弹窗外壳 + 左侧分类导航 / 右侧内容区（内容自行滚动） -->
<Modal
    {open}
    {onclose}
    noScroll
    flush
    class={mergeClass(['h-[min(90vh,940px)] w-[min(96vw,1240px)]', className])}
    style={styleProp}
>
    {#snippet title()}
        <Icon icon="mdi:cog-outline" class="size-4.5" style="color: var(--theme-accent-text);" />
        <span>设置</span>
    {/snippet}

    <div class="flex min-h-0 flex-1 flex-row">
        <!-- Sidebar -->
        <div
            class="theme-scrollbar flex w-52 shrink-0 flex-col gap-4 overflow-y-auto border-r p-3"
            style="border-color: var(--theme-divider-border);"
        >
            {#each SETTING_GROUPS as g (g.group)}
                <div class="flex flex-col gap-0.5">
                    <span class="px-3 pb-1 text-[10px] font-black tracking-[0.3em] text-(--theme-muted-text)"
                        >{g.group}</span
                    >
                    {#each g.items as t (t.key)}
                        <button
                            onclick={() => setTab(t.key)}
                            class="flex shrink-0 items-center gap-2.5 border-l-2 px-3 py-2 text-sm font-black tracking-tight transition-colors {tab ===
                            t.key
                                ? 'text-(--theme-accent-text)'
                                : 'text-(--theme-modal-text)/55 hover:text-(--theme-modal-text)'}"
                            style={tab === t.key
                                ? 'border-color: var(--theme-accent-bg); background: color-mix(in srgb, var(--theme-accent-bg) 8%, transparent);'
                                : 'border-color: transparent;'}
                        >
                            <Icon icon={t.icon} class="size-4 shrink-0" />
                            {t.label}
                        </button>
                    {/each}
                </div>
            {/each}
        </div>

        <!-- Content -->
        <div class="min-h-0 min-w-0 flex-1 overflow-y-auto p-6">
            <TabPanel active={tab}>
                {#if tab === 'theme'}
                    <ThemeSection />
                {:else if tab === 'keymap'}
                    <KeymapSection />
                {:else if tab === 'interaction'}
                    <InteractionSection />
                {:else if tab === 'shortcuts'}
                    <ShortcutsSection />
                {:else if tab === 'performance'}
                    <PerformanceSection />
                {:else if tab === 'connection'}
                    <ConnectionSection />
                {:else if tab === 'archive'}
                    <ArchiveSection />
                {:else if tab === 'cache'}
                    <CacheSection />
                {:else if tab === 'config'}
                    <ConfigSection />
                {:else if tab === 'ai' || tab === 'ai-conn'}
                    <!-- @desc 把外壳自己的 `tab` 传给 section：它用同一个值选标题 / 内容分支，不再回读 store
                         （回读会让「当前是哪个栏目」有两个真相源，见 `sections/ai.svelte` 的 `Props.tab`） -->
                    <AiSection {tab} />
                {/if}
            </TabPanel>
        </div>
    </div>
</Modal>

<!-- @desc 设置弹窗内部的次级对话框：仅在设置打开时挂载。均为 fixed 覆盖层，不能放进外壳内部（外壳的毛玻璃/动画会为 fixed 建立包含块而使其错位） -->
{#if open}
    <!-- Archive delete confirm -->
    {#if archiveDeleteTarget}
        {@const target = archiveDeleteTarget}
        <ConfirmDeleteModal
            open
            title="永久删除归档工程"
            confirmText={`删除${target.name}`}
            onclose={closeArchiveDelete}
            onconfirm={doArchiveDelete}
        />
    {/if}

    <!-- AI profile delete confirm -->
    {#if aiDeleteTarget}
        <ConfirmDeleteModal
            open
            title="删除 AI 配置文件"
            confirmText={`删除「${aiDeleteTarget.label}」`}
            onclose={() => setAiDeleteTarget(null)}
            onconfirm={doDeleteAiProfile}
        />
    {/if}

    <!-- AI profile edit -->
    {#if aiEditTarget}
        <AiProfileEditModal
            open
            profile={aiEditTarget}
            onclose={() => setAiEditTarget(null)}
            onsaved={() => setAiEditTarget(null)}
        />
    {/if}

    <!-- AI prompt edit -->
    {#if promptEditOpen}
        <AiPromptEditModal open onclose={() => setPromptEditOpen(false)} onsaved={() => setPromptEditOpen(false)} />
    {/if}

    <!-- Key picker（键盘图标 + 手柄键位） -->
    <Modal open={keyPickerFor !== null} onclose={() => setKeyPickerFor(null)} layer="deep" class="w-[min(92vw,32rem)]">
        {#snippet title()}
            <span>选择按键与手柄键位</span>
        {/snippet}
        {#if keyPickerFor}
            <div class="mb-2 flex items-center gap-2 text-[10px] font-medium text-(--theme-modal-text)/60">
                <Icon icon="mdi:keyboard-outline" class="size-3.5" />
                键盘
            </div>
            <div class="flex flex-wrap gap-1.5">
                {#each uiBtnIconList as [name, url] (name)}
                    <button
                        onclick={() => {
                            updateEntry(keyPickerFor!, { blockKey: name })
                            setKeyPickerFor(null)
                        }}
                        class="flex size-10 items-center justify-center rounded-none border transition-colors {keyPickerFor &&
                        entryById(keyPickerFor)?.blockKey === name
                            ? 'border-(--theme-accent-bg)'
                            : 'hover:bg-(--theme-modal-text)/10'}"
                        style="border-color: {keyPickerFor && entryById(keyPickerFor)?.blockKey === name
                            ? 'var(--theme-accent-bg)'
                            : 'var(--theme-divider-border)'};"
                        title={name}
                    >
                        <img src={url} alt={name} draggable="false" class="size-6 object-contain pointer-events-none" />
                    </button>
                {/each}
            </div>
            <div class="my-3 border-t" style="border-color: var(--theme-divider-border);"></div>
            <div class="mb-2 flex items-center gap-2 text-[10px] font-medium text-(--theme-modal-text)/60">
                <Icon icon="mdi:gamepad-variant-outline" class="size-3.5" />
                手柄图标
            </div>
            <div class="flex flex-wrap gap-1.5">
                {#each GAMEPAD_BUTTONS as btn (btn.id)}
                    <button
                        onclick={() => {
                            updateEntry(keyPickerFor!, { blockKey: btn.id })
                            setKeyPickerFor(null)
                        }}
                        class="flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-none border px-2 transition-colors {keyPickerFor &&
                        entryById(keyPickerFor)?.blockKey === btn.id
                            ? 'border-(--theme-accent-bg)'
                            : 'hover:bg-(--theme-modal-text)/10'}"
                        style="border-color: {keyPickerFor && entryById(keyPickerFor)?.blockKey === btn.id
                            ? 'var(--theme-accent-bg)'
                            : 'var(--theme-divider-border)'};"
                        title={btn.label}
                    >
                        {#if btn.icon}
                            <img
                                src={btn.icon}
                                alt={btn.label}
                                draggable="false"
                                class="size-5 object-contain pointer-events-none"
                            />
                        {:else}
                            <span class="text-[10px] font-bold text-(--theme-modal-text)/80">{btn.label}</span>
                        {/if}
                    </button>
                {/each}
            </div>
        {/if}
    </Modal>
{/if}
