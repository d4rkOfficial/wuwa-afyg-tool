<script lang="ts">
    import { fade } from 'svelte/transition'
    import { popOut } from '$lib/utils/motion'
    import { getActiveId, getOverrides, setActiveTheme, getThemes, updateOverride } from '$lib/theme'
    import Icon from '@iconify/svelte'
    import {
        getKeyMapEntries,
        updateKeyMapEntry,
        resetKeyMap,
        physicalLabel,
        type KeyMapEntry
    } from '$lib/data/keymap.svelte'
    import { getUiBtnIcons, clearCacheCategory, countCacheCategory, type CacheCategory } from '$lib/api/data-cache'
    import { addToast } from '$lib/data/toast.svelte'
    import {
        getWorkshopInstances,
        getActiveWorkshopId,
        setActiveWorkshop,
        addWorkshop,
        removeWorkshop,
        resetWorkshop
    } from '$lib/data/workshop.svelte'
    import {
        getProviderOptions,
        getActiveProviderId,
        setActiveProvider,
        resetActiveProvider,
        getProviderVersions,
        loadProviderVersions
    } from '$lib/data/provider-prefs.svelte'
    import {
        getArchivedProjects,
        unarchiveProject,
        deleteProject,
        buildExportFile,
        getPhaseOrder
    } from '$lib/data/project.svelte'
    import { getShareLink } from '$lib/data/share.svelte'
    import { getGenPrefs, loadGenPrefs, updateGenPrefs, type DangerMode } from '$lib/data/ai-prefs.svelte'
    import { GAMEPAD_BUTTONS } from '$lib/calc/timeline.consts'
    import { getCalcViewMode, setCalcViewMode } from '$lib/data/calc-view.svelte'
    import {
        getGpuAccel,
        setGpuAccel,
        getReloadOnResultRefresh,
        setReloadOnResultRefresh,
        getReloadOnProfileChange,
        setReloadOnProfileChange,
        getMagneticPointer,
        setMagneticPointer
    } from '$lib/data/render-prefs.svelte'
    import { getSimplifyToolbar, setSimplifyToolbar } from '$lib/data/toolbar-prefs.svelte'
    import { getConfirmDeletes, setConfirmDeletes } from '$lib/data/interaction-prefs.svelte'
    import {
        SHORTCUT_GROUPS,
        applyLockedMods,
        getShortcutDef,
        getShortcutKey,
        getShortcuts,
        normalizeShortcutEvent,
        resetShortcuts,
        shortcutLabel,
        updateShortcut
    } from '$lib/data/shortcuts.svelte'
    import {
        getAiProfiles,
        getActiveProfileId,
        loadAiConfig,
        setActiveProfile,
        addProfile,
        deleteProfile,
        type AiProfile
    } from '$lib/ai/config.svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import ConfirmDeleteModal from '$lib/components/layout/confirm-delete-modal.svelte'
    import AiProfileEditModal from '$lib/components/layout/ai-profile-edit-modal.svelte'
    import AiPromptEditModal from '$lib/components/layout/ai-prompt-edit-modal.svelte'
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {
        open: boolean
        onclose: () => void
    }

    let { open, onclose, class: className, style: styleProp }: Props = $props()

    let tab = $state<'theme' | 'keymap' | 'interaction' | 'performance' | 'connection' | 'archive' | 'cache' | 'ai'>(
        'theme'
    )

    let currentTheme = $derived(getActiveId())

    const toggleTheme = () => {
        const next = currentTheme === 'dark' ? 'light' : 'dark'
        setActiveTheme(next).then(() => {
            const t = getThemes().find((th) => th.id === next)
            addToast(`已切换至「${t?.name ?? next}」`, 'success')
        })
    }

    const SETTING_TABS = [
        { key: 'theme', label: '外观主题', icon: 'mdi:palette-outline' },
        { key: 'keymap', label: '按键图标', icon: 'mdi:keyboard-outline' },
        { key: 'interaction', label: '交互相关', icon: 'mdi:tune-variant' },
        { key: 'performance', label: '性能相关', icon: 'mdi:speedometer' },
        { key: 'connection', label: '连接配置', icon: 'mdi:link-variant' },
        { key: 'archive', label: '归档管理', icon: 'mdi:archive-outline' },
        { key: 'cache', label: '缓存清理', icon: 'mdi:database-outline' },
        { key: 'ai', label: '助手设置', icon: 'mdi:robot-outline' }
    ] as const

    const COLOR_PRESETS = [
        { name: '默认', hue: 190 as number | 'mono' | null },
        { name: '靛蓝', hue: null as number | 'mono' | null },
        { name: '品红', hue: 345 as number | 'mono' | null },
        { name: '橘红', hue: 28 as number | 'mono' | null },
        { name: '橙黄', hue: 90 as number | 'mono' | null },
        { name: '墨绿', hue: 150 as number | 'mono' | null },
        { name: '黑白', hue: 'mono' as const }
    ]

    let fileInput: HTMLInputElement | undefined = $state()
    let bgUrl = $state('')

    let overrides = $derived(getOverrides())
    let isDark = $derived(getActiveId() !== 'light')
    let aiProfiles = $derived(getAiProfiles())
    let aiActiveId = $derived(getActiveProfileId())
    let aiEditTarget = $state<AiProfile | null>(null)
    let aiDeleteConfirm = $state<AiProfile | null>(null)
    let promptEditKind = $state<'naming' | 'persona' | 'slang' | null>(null)

    async function toggleAiEnabled() {
        await updateGenPrefs({ enabled: !getGenPrefs().enabled })
        addToast(getGenPrefs().enabled ? 'AI 助手已启用' : 'AI 助手已禁用', 'success')
    }

    const DANGER_MODE_OPTIONS: { value: DangerMode; label: string; desc: string }[] = [
        { value: 'ask', label: '每次都询问', desc: '每个危险操作都弹确认' },
        { value: 'ask_once', label: '批量只询问一次', desc: '一次指令内只确认一次，后续直接放行' },
        { value: 'trust', label: '无条件信任', desc: '危险操作直接执行，不再确认' }
    ]

    async function setDangerMode(mode: DangerMode) {
        await updateGenPrefs({ dangerMode: mode })
        addToast(
            mode === 'ask'
                ? '已设为：危险操作每次都询问'
                : mode === 'ask_once'
                  ? '已设为：批量只询问一次'
                  : '已设为：无条件信任（请谨慎使用）',
            'success'
        )
    }

    function switchCalcViewMode(mode: 'dropdown' | 'spread') {
        setCalcViewMode(mode)
        addToast(mode === 'spread' ? '已切换为 buff 平铺模式' : '已切换为 buff 下拉模式', 'success')
    }

    async function handleSelectAiProfile(id: string) {
        const ok = await setActiveProfile(id)
        if (ok) {
            const label = getAiProfiles().find((p) => p.id === id)?.label ?? ''
            addToast(`已切换到「${label}」`, 'success')
        }
    }

    async function handleAddAiProfile() {
        const profile = await addProfile('新配置')
        aiEditTarget = profile
        addToast('已新建配置文件，请填写 API Key 后保存', 'success')
    }

    function handleDeleteAiProfile(profile: AiProfile) {
        aiDeleteConfirm = profile
        if (!getConfirmDeletes()) void doDeleteAiProfile()
    }

    async function doDeleteAiProfile() {
        if (!aiDeleteConfirm) return
        await deleteProfile(aiDeleteConfirm.id)
        aiDeleteConfirm = null
        addToast('配置文件已删除', 'info')
    }

    $effect(() => {
        if (open) {
            bgUrl = overrides.backgroundImage.startsWith('http') ? overrides.backgroundImage : ''
            void refreshCacheCounts()
            loadAiConfig()
            loadGenPrefs()
        }
    })

    function getPresetStyle(hue: number | 'mono' | null): { bg: string; text: string } {
        if (hue === 'mono') {
            return isDark ? { bg: '#ffffff', text: '#000000' } : { bg: '#000000', text: '#ffffff' }
        } else if (typeof hue === 'number') {
            const l = isDark ? 55 : 42
            const c = isDark ? 0.15 : 0.18
            return { bg: `oklch(${l}% ${c} ${hue})`, text: '#ffffff' }
        }
        return { bg: '#6366f1', text: '#ffffff' }
    }

    function compressImage(file: File): Promise<string> {
        // 大图转 data URL 塞进 CSS 变量会静默失败（~9MB 就不生效），统一压缩后再存储
        const MAX_EDGE = 2560
        return new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => {
                const dataUrl = reader.result as string
                const img = new Image()
                img.onload = () => {
                    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
                    if (scale >= 1 && dataUrl.length < 1_500_000) {
                        resolve(dataUrl)
                        return
                    }
                    const canvas = document.createElement('canvas')
                    canvas.width = Math.round(img.naturalWidth * scale)
                    canvas.height = Math.round(img.naturalHeight * scale)
                    const ctx = canvas.getContext('2d')
                    if (!ctx) {
                        resolve(dataUrl)
                        return
                    }
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
                    let out = canvas.toDataURL('image/webp', 0.85)
                    if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', 0.85)
                    if (out.length >= dataUrl.length) out = dataUrl
                    resolve(out)
                }
                img.onerror = () => reject(new Error('图片解码失败'))
                img.src = dataUrl
            }
            reader.onerror = () => reject(reader.error)
            reader.readAsDataURL(file)
        })
    }

    function handleFileSelect(e: Event) {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) return
        compressImage(file)
            .then((dataUrl) => {
                updateOverride('backgroundImage', dataUrl)
                bgUrl = ''
            })
            .catch((err) => {
                console.error('[bg] 压缩失败，改用原图', err)
                const reader = new FileReader()
                reader.onload = () => {
                    updateOverride('backgroundImage', reader.result as string)
                    bgUrl = ''
                }
                reader.readAsDataURL(file)
            })
    }

    function handleUrlApply() {
        const url = bgUrl.trim()
        if (url) {
            updateOverride('backgroundImage', url)
        }
    }

    function clearBackground() {
        updateOverride('backgroundImage', '')
        if (fileInput) fileInput.value = ''
        bgUrl = ''
    }

    function handleUrlKeydown(e: KeyboardEvent) {
        if (e.key === 'Enter') handleUrlApply()
    }

    // ── Key mapping ──
    let keymapEntries = $derived(getKeyMapEntries())
    let uiBtnIconList = $state<[string, string][]>([])
    let keyPickerFor = $state<string | null>(null)

    // ── 界面快捷键 ──
    let shortcutCapture = $state<string | null>(null)

    $effect(() => {
        if (shortcutCapture === null) return
        const onKey = (e: KeyboardEvent) => {
            e.preventDefault()
            e.stopPropagation()
            if (e.key === 'Escape') {
                shortcutCapture = null
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
                shortcutCapture = null
            })
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
    })

    $effect(() => {
        if (open && uiBtnIconList.length === 0) {
            getUiBtnIcons().then((map) => {
                uiBtnIconList = Object.entries(map)
            })
        }
    })

    function iconOf(blockKey: string): string | undefined {
        return uiBtnIconList.find(([n]) => n === blockKey)?.[1]
    }

    function gamepadIconOf(blockKey: string): string | undefined {
        return GAMEPAD_BUTTONS.find((b) => b.id === blockKey)?.icon ?? undefined
    }

    function entryById(id: string): KeyMapEntry | undefined {
        return keymapEntries.find((e) => e.id === id)
    }

    function updateEntry(id: string, patch: Partial<KeyMapEntry>) {
        const e = entryById(id)
        if (e) updateKeyMapEntry({ ...e, ...patch })
    }

    // ── Workshop settings ──
    let workshopInstances = $derived(getWorkshopInstances())
    let workshopActiveId = $derived(getActiveWorkshopId())
    let newWorkshopUrl = $state('')

    async function handleAddWorkshop() {
        const ok = await addWorkshop(newWorkshopUrl)
        if (ok) {
            addToast('已添加工坊实例', 'success')
            newWorkshopUrl = ''
        } else {
            addToast('地址无效或已存在', 'error')
        }
    }

    async function handleSwitchWorkshop(id: string) {
        await setActiveWorkshop(id)
        addToast('已切换工坊实例', 'success')
    }

    async function handleRemoveWorkshop(id: string) {
        await removeWorkshop(id)
        addToast('已删除工坊实例', 'info')
    }

    async function handleResetWorkshop() {
        await resetWorkshop()
        addToast('已恢复默认工坊实例', 'success')
    }

    // ── 上游数据源（连接配置） ──
    let providerOptions = $derived(getProviderOptions())
    let activeProviderId = $derived(getActiveProviderId())
    let providerVersions = $derived(getProviderVersions())

    // 进入“连接配置”页时加载各上游最新版本
    let loadedVersionTab = false
    $effect(() => {
        if (tab === 'connection' && !loadedVersionTab) {
            loadedVersionTab = true
            void loadProviderVersions()
        }
    })

    function handleSwitchProvider(id: string) {
        if (!setActiveProvider(id)) {
            addToast('未知的数据源', 'error')
            return
        }
        addToast('已切换数据源，列表/详情缓存将按新源重新加载', 'info')
        // 数据可能随上游不同，清空本地缓存以便重新拉取
        import('$lib/api/data-cache').then((m) => m.clearCache())
    }

    function handleResetProvider() {
        resetActiveProvider()
        addToast('已恢复默认数据源（nanoka）', 'success')
        import('$lib/api/data-cache').then((m) => m.clearCache())
    }

    // ── Archive management ──
    let archivedProjects = $derived(getArchivedProjects())
    let confirmDelete = $state<{ id: string; name: string } | null>(null)

    async function handleUnarchive(id: string) {
        const p = archivedProjects.find((pr) => pr.id === id)
        if (!p) return
        await unarchiveProject(id)
        addToast(`工程「${p.name}」已取消归档`, 'success')
    }

    function openArchiveDelete(id: string) {
        const p = archivedProjects.find((pr) => pr.id === id)
        if (!p) return
        confirmDelete = { id, name: p.name }
        if (!getConfirmDeletes()) void doArchiveDelete()
    }

    function closeArchiveDelete() {
        confirmDelete = null
    }

    async function doArchiveDelete() {
        if (!confirmDelete) return
        await deleteProject(confirmDelete.id)
        addToast(`工程「${confirmDelete.name}」已永久删除`, 'info')
        closeArchiveDelete()
    }

    function handleArchiveExport(id: string) {
        const p = archivedProjects.find((pr) => pr.id === id)
        if (!p) return
        const file = buildExportFile(p, getPhaseOrder(), true)
        const blob = new Blob([JSON.stringify(file)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${p.name}.json`
        a.click()
        URL.revokeObjectURL(url)
        addToast(`工程「${p.name}」已导出`, 'success')
    }

    async function handleArchiveShare(id: string) {
        const p = archivedProjects.find((pr) => pr.id === id)
        if (!p) return
        addToast('正在生成分享链接...', 'info')
        const link = await getShareLink(p)
        if (!link) {
            addToast('分享失败', 'error')
            return
        }
        try {
            await navigator.clipboard.writeText(link)
            addToast('已分享(10分钟)，链接已复制到剪贴板', 'success')
        } catch {
            addToast('已分享(10分钟)，请在地址栏查看导入链接', 'success')
        }
    }

    async function handleArchiveDelete(id: string) {
        const p = archivedProjects.find((pr) => pr.id === id)
        if (!p) return
        await deleteProject(id)
        addToast(`工程「${p.name}」已永久删除`, 'info')
    }

    function formatArchiveDate(ts: number): string {
        return new Date(ts).toLocaleString()
    }

    // ── Cache management ──
    let cacheCounts = $state({ list: 0, info: 0, image: 0 })

    async function refreshCacheCounts() {
        cacheCounts = {
            list: await countCacheCategory('list'),
            info: await countCacheCategory('info'),
            image: await countCacheCategory('image')
        }
    }

    const CACHE_LABELS: { key: CacheCategory; label: string; icon: string }[] = [
        { key: 'list', label: '列表缓存', icon: 'mdi:file-document-outline' },
        { key: 'info', label: '详情缓存', icon: 'mdi:information-outline' },
        { key: 'image', label: '图像缓存', icon: 'mdi:image-outline' }
    ]

    async function handleClearCache(kind: CacheCategory) {
        await clearCacheCategory(kind)
        await refreshCacheCounts()
        addToast(`已清理${CACHE_LABELS.find((c) => c.key === kind)?.label ?? ''}`, 'success')
    }
</script>

{#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="animate-fade-in fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm {className}"
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5)); {styleProp || ''}"
        onkeydown={(e) => {
            if (e.key === 'Escape') onclose()
        }}
        out:fade={{ duration: 130 }}
    >
        <div
            class="animate-pop-in theme-glass-surface relative flex h-[560px] max-h-[90vh] w-[640px] max-w-[94vw] flex-col overflow-hidden rounded-xl shadow-2xl"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
            role="dialog"
            aria-modal="true"
            out:popOut
        >
            <div
                class="flex shrink-0 items-center justify-between border-b px-6 py-4"
                style="border-color: var(--theme-divider-border);"
            >
                <h3 class="text-base font-semibold">设置</h3>
                <button
                    onclick={onclose}
                    class="rounded p-1 text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)/70"
                    aria-label="关闭设置"
                >
                    <Icon icon="mdi:close" class="size-4.5" />
                </button>
            </div>

            <div class="flex min-h-0 flex-1 flex-row">
                <!-- Sidebar -->
                <div
                    class="flex w-40 shrink-0 flex-col gap-1 border-r p-3"
                    style="border-color: var(--theme-divider-border);"
                >
                    {#each SETTING_TABS as t}
                        <button
                            onclick={() => (tab = t.key)}
                            class="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors {tab ===
                            t.key
                                ? 'text-[var(--theme-accent-text-on-bg)]'
                                : 'text-(--theme-modal-text)/60 hover:text-(--theme-modal-text)'}"
                            style={tab === t.key ? 'background: var(--theme-accent-bg);' : ''}
                        >
                            <Icon icon={t.icon} class="size-4 shrink-0" />
                            {t.label}
                        </button>
                    {/each}
                </div>

                <!-- Content -->
                <div
                    class="min-h-0 min-w-0 flex-1 overflow-y-auto p-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                    {#if tab === 'theme'}
                        <!-- Accent color -->
                        <div class="mb-5">
                            <span class="mb-3 block text-xs font-medium text-(--theme-modal-text)/60">主色调</span>
                            <div
                                class="flex gap-1 rounded-lg border p-1"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                            >
                                {#each COLOR_PRESETS.slice(0, -1) as c}
                                    {@const style = getPresetStyle(c.hue)}
                                    <button
                                        onclick={() => updateOverride('accentHue', c.hue)}
                                        class="flex-1 rounded-md px-1 py-1.5 text-[11px] font-medium transition-colors"
                                        style="background: {overrides.accentHue === c.hue
                                            ? style.bg
                                            : 'transparent'}; color: {overrides.accentHue === c.hue
                                            ? style.text
                                            : 'var(--theme-modal-text)/60'};"
                                    >
                                        {c.name}
                                    </button>
                                {/each}
                                <div
                                    class="mx-1.5 my-1 w-px shrink-0"
                                    style="background: var(--theme-divider-border);"
                                ></div>
                                {#each COLOR_PRESETS.slice(-1) as c}
                                    {@const style = getPresetStyle(c.hue)}
                                    <button
                                        onclick={() => updateOverride('accentHue', c.hue)}
                                        class="flex-1 rounded-md px-1 py-1.5 text-[11px] font-medium transition-colors"
                                        style="background: {overrides.accentHue === c.hue
                                            ? style.bg
                                            : 'transparent'}; color: {overrides.accentHue === c.hue
                                            ? style.text
                                            : 'var(--theme-modal-text)/60'};"
                                    >
                                        {c.name}
                                    </button>
                                {/each}
                            </div>
                        </div>

                        <!-- 昼夜切换 -->
                        <div class="mb-5">
                            <span class="mb-3 block text-xs font-medium text-(--theme-modal-text)/60">昼夜切换</span>
                            <div
                                class="flex items-center justify-between gap-3 rounded-lg border px-2.5 py-2"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                            >
                                <div class="min-w-0">
                                    <span class="block text-[11px] text-(--theme-modal-text)/60">深色主题</span>
                                    <span class="block text-[9px] text-(--theme-modal-text)/35"
                                        >与侧边栏按钮一致，全局明暗切换</span
                                    >
                                </div>
                                <button
                                    onclick={toggleTheme}
                                    class="relative h-4.5 w-8 shrink-0 rounded-full transition-colors"
                                    style="background: {currentTheme === 'dark'
                                        ? 'var(--theme-accent-bg)'
                                        : 'color-mix(in srgb, var(--theme-modal-text) 25%, transparent)'};"
                                    title="点击切换昼夜"
                                >
                                    <span
                                        class="absolute top-0.5 size-3.5 rounded-full transition-all"
                                        style="left: {currentTheme === 'dark'
                                            ? '16px'
                                            : '2px'}; background: var(--theme-modal-bg);"
                                    ></span>
                                </button>
                            </div>
                        </div>

                        <hr class="mb-5" style="border-color: var(--theme-divider-border);" />

                        <!-- Background image -->
                        <div>
                            <div class="mb-3 flex items-center gap-2">
                                <span
                                    class="flex size-7 items-center justify-center rounded-lg bg-(--theme-accent-bg)/10 text-(--theme-accent-text)"
                                >
                                    <Icon icon="mdi:image-outline" class="size-4" />
                                </span>
                                <div>
                                    <span class="block text-xs font-medium text-(--theme-modal-text)/70">背景图</span>
                                    <span class="block text-[10px] text-(--theme-modal-text)/35"
                                        >为工作区添加专属氛围</span
                                    >
                                </div>
                            </div>

                            {#if overrides.backgroundImage}
                                <div
                                    class="mb-3 overflow-hidden rounded-lg border"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    <img
                                        src={overrides.backgroundImage}
                                        alt="背景预览"
                                        class="h-28 w-full object-cover"
                                    />
                                    <div
                                        class="flex items-center justify-end gap-2 px-3 py-2 bg-(--theme-modal-text)/5"
                                    >
                                        <button
                                            onclick={() => fileInput?.click()}
                                            class="flex items-center gap-1 text-xs text-(--theme-accent-text) transition-colors hover:brightness-125"
                                        >
                                            <Icon icon="mdi:reload" class="size-3.5" />
                                            换图
                                        </button>
                                        <button
                                            onclick={clearBackground}
                                            class="flex items-center gap-1 text-xs text-(--theme-modal-text)/50 transition-colors hover:text-red-500"
                                        >
                                            <Icon icon="mdi:delete-outline" class="size-3.5" />
                                            清除
                                        </button>
                                    </div>
                                </div>
                            {:else}
                                <!-- svelte-ignore a11y_click_events_have_key_events -->
                                <!-- svelte-ignore a11y_no_static_element_interactions -->
                                <div
                                    onclick={() => fileInput?.click()}
                                    class="mb-3 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 transition-colors hover:bg-(--theme-modal-text)/5"
                                    style="border-color: var(--theme-divider-border); color: var(--theme-modal-text);"
                                >
                                    <Icon icon="mdi:image-outline" class="size-8 text-(--theme-modal-text)/20" />
                                    <span class="text-xs text-(--theme-modal-text)/40">点击选择本地图片</span>
                                </div>
                            {/if}

                            <input
                                type="file"
                                accept="image/*"
                                bind:this={fileInput}
                                onchange={handleFileSelect}
                                class="hidden"
                            />

                            <div
                                class="flex items-center gap-2 rounded-lg border px-3 py-2"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                            >
                                <input
                                    type="text"
                                    bind:value={bgUrl}
                                    onkeydown={handleUrlKeydown}
                                    placeholder="远程图片 URL"
                                    class="flex-1 min-w-0 text-xs outline-none bg-transparent text-(--theme-modal-text) placeholder:text-(--theme-modal-text)/30"
                                />
                                <button
                                    onclick={handleUrlApply}
                                    disabled={!bgUrl.trim()}
                                    class="shrink-0 rounded px-2.5 py-1 text-xs font-medium transition-all hover:brightness-125 disabled:opacity-40"
                                    style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
                                >
                                    加载
                                </button>
                            </div>

                            <div
                                class="mt-4 overflow-hidden rounded-xl border"
                                style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-input-bg) 70%, transparent);"
                            >
                                <div
                                    class="relative h-40 overflow-hidden border-b"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    {#if overrides.backgroundImage}
                                        <!-- 背景图独立层（自身模糊，不影响上层的预览卡片） -->
                                        <div
                                            class="absolute inset-0"
                                            style="background-image: url('{overrides.backgroundImage}'); background-position: center; background-size: cover; filter: blur({overrides.bgImageBlur}px);"
                                        ></div>
                                        <!-- 背景图遮罩层（与工作区一致，由背景图遮罩控制） -->
                                        <div
                                            class="absolute inset-0"
                                            style="background: {overrides.bgImageMask < 0
                                                ? `rgba(0,0,0,${(Math.abs(overrides.bgImageMask) / 100) * 0.6})`
                                                : overrides.bgImageMask > 0
                                                  ? `rgba(255,255,255,${(overrides.bgImageMask / 100) * 0.35})`
                                                  : 'transparent'};"
                                        ></div>
                                    {:else}
                                        <!-- 无背景图时的中性预览底：玻璃卡片效果仍可实时预览 -->
                                        <div
                                            class="absolute inset-0"
                                            style="background: linear-gradient(135deg, color-mix(in srgb, var(--theme-input-bg) 92%, var(--theme-accent-bg)), color-mix(in srgb, var(--theme-input-bg) 35%, var(--theme-modal-text)));"
                                        ></div>
                                    {/if}
                                    <div
                                        class="absolute inset-y-4 left-4 flex w-40 flex-col justify-between overflow-hidden rounded-xl border p-3 shadow-xl"
                                        style="border-color: color-mix(in srgb, var(--theme-modal-text) 18%, transparent); background: color-mix(in srgb, var(--theme-modal-bg) {overrides.bgOpacity}%, transparent); backdrop-filter: blur({overrides.bgBlur}px) saturate(1.12) brightness({1 -
                                            (overrides.bgDim / 100) *
                                                0.6}); -webkit-backdrop-filter: blur({overrides.bgBlur}px) saturate(1.12) brightness({1 -
                                            (overrides.bgDim / 100) * 0.6});"
                                    >
                                        <div
                                            class="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent"
                                        ></div>
                                        <div class="flex items-center gap-2">
                                            <span
                                                class="flex size-6 items-center justify-center rounded-md bg-(--theme-accent-bg)/20 text-(--theme-accent-text)"
                                            >
                                                <Icon icon="mdi:blur" class="size-3.5" />
                                            </span>
                                            <span class="text-[11px] font-medium">玻璃质感预览</span>
                                        </div>
                                        <div class="space-y-1.5">
                                            <div class="h-1.5 w-full rounded-full bg-(--theme-modal-text)/15"></div>
                                            <div class="h-1.5 w-2/3 rounded-full bg-(--theme-modal-text)/10"></div>
                                        </div>
                                    </div>
                                    <span
                                        class="absolute bottom-3 right-3 rounded-md bg-black/30 px-2 py-1 font-mono text-[9px] tracking-wide text-white/70 backdrop-blur-sm"
                                        >LIVE</span
                                    >
                                </div>

                                <div class="p-4">
                                    <div class="mb-4 flex items-start gap-2.5">
                                        <span
                                            class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-(--theme-modal-text)/5 text-(--theme-modal-text)/45"
                                        >
                                            <Icon icon="mdi:layers-triple-outline" class="size-4" />
                                        </span>
                                        <div>
                                            <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                                >背景质感</span
                                            >
                                            <span class="block text-[10px] leading-4 text-(--theme-modal-text)/35"
                                                >预览与工作区同步更新</span
                                            >
                                        </div>
                                    </div>

                                    <div class="space-y-4">
                                        <div>
                                            <span
                                                class="mb-2 flex items-center justify-between text-[11px] text-(--theme-modal-text)/55"
                                            >
                                                <span class="flex items-center gap-1.5"
                                                    ><Icon icon="mdi:cards-outline" class="size-3.5" />卡片透明度</span
                                                >
                                                <span class="font-mono text-(--theme-accent-text)"
                                                    >{100 - overrides.bgOpacity}%</span
                                                >
                                            </span>
                                            <input
                                                aria-label="卡片透明度"
                                                type="range"
                                                min="0"
                                                max="70"
                                                value={100 - overrides.bgOpacity}
                                                oninput={(e) =>
                                                    updateOverride(
                                                        'bgOpacity',
                                                        100 - Number((e.target as HTMLInputElement).value)
                                                    )}
                                                class="h-1.5 w-full cursor-pointer touch-none appearance-none rounded-full bg-(--theme-modal-text)/10 accent-(--theme-accent-bg)"
                                            />
                                            <div
                                                class="mt-1 flex justify-between text-[9px] text-(--theme-modal-text)/25"
                                            >
                                                <span>清晰</span><span>通透</span>
                                            </div>
                                        </div>

                                        <div>
                                            <span
                                                class="mb-2 flex items-center justify-between text-[11px] text-(--theme-modal-text)/55"
                                            >
                                                <span class="flex items-center gap-1.5"
                                                    ><Icon icon="mdi:blur" class="size-3.5" />毛玻璃强度</span
                                                >
                                                <span class="font-mono text-(--theme-accent-text)"
                                                    >{overrides.bgBlur}px</span
                                                >
                                            </span>
                                            <input
                                                aria-label="毛玻璃强度"
                                                type="range"
                                                min="0"
                                                max="32"
                                                step="1"
                                                value={overrides.bgBlur}
                                                oninput={(e) =>
                                                    updateOverride(
                                                        'bgBlur',
                                                        Number((e.target as HTMLInputElement).value)
                                                    )}
                                                class="h-1.5 w-full cursor-pointer touch-none appearance-none rounded-full bg-(--theme-modal-text)/10 accent-(--theme-accent-bg)"
                                            />
                                            <div
                                                class="mt-1 flex justify-between text-[9px] text-(--theme-modal-text)/25"
                                            >
                                                <span>柔和</span><span>朦胧</span>
                                            </div>
                                        </div>

                                        <div>
                                            <span
                                                class="mb-2 flex items-center justify-between text-[11px] text-(--theme-modal-text)/55"
                                            >
                                                <span class="flex items-center gap-1.5"
                                                    ><Icon icon="mdi:brightness-4" class="size-3.5" />背景暗度</span
                                                >
                                                <span class="font-mono text-(--theme-accent-text)"
                                                    >{overrides.bgDim}%</span
                                                >
                                            </span>
                                            <input
                                                aria-label="背景暗度"
                                                type="range"
                                                min="0"
                                                max="100"
                                                step="1"
                                                value={overrides.bgDim}
                                                oninput={(e) =>
                                                    updateOverride(
                                                        'bgDim',
                                                        Number((e.target as HTMLInputElement).value)
                                                    )}
                                                class="h-1.5 w-full cursor-pointer touch-none appearance-none rounded-full bg-(--theme-modal-text)/10 accent-(--theme-accent-bg)"
                                            />
                                            <div
                                                class="mt-1 flex justify-between text-[9px] text-(--theme-modal-text)/25"
                                            >
                                                <span>原图</span><span>沉浸</span>
                                            </div>
                                            {#if !overrides.backgroundImage}
                                                <p class="mt-1.5 text-[9px] text-(--theme-modal-text)/30">
                                                    设置背景图后生效（当前未设置背景图）
                                                </p>
                                            {/if}
                                        </div>

                                        {#if overrides.backgroundImage}
                                            <div
                                                class="border-t pt-4"
                                                style="border-color: var(--theme-divider-border);"
                                            >
                                                <div class="mb-3 flex items-start gap-2.5">
                                                    <span
                                                        class="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-(--theme-modal-text)/5 text-(--theme-modal-text)/45"
                                                    >
                                                        <Icon icon="mdi:image-outline" class="size-4" />
                                                    </span>
                                                    <div>
                                                        <span
                                                            class="block text-xs font-medium text-(--theme-modal-text)/70"
                                                            >背景图效果</span
                                                        >
                                                        <span
                                                            class="block text-[10px] leading-4 text-(--theme-modal-text)/35"
                                                            >仅作用于背景图本身，与玻璃表面互不影响</span
                                                        >
                                                    </div>
                                                </div>
                                                <div class="space-y-4">
                                                    <div>
                                                        <span
                                                            class="mb-2 flex items-center justify-between text-[11px] text-(--theme-modal-text)/55"
                                                        >
                                                            <span class="flex items-center gap-1.5"
                                                                ><Icon
                                                                    icon="mdi:blur"
                                                                    class="size-3.5"
                                                                />背景图模糊</span
                                                            >
                                                            <span class="font-mono text-(--theme-accent-text)"
                                                                >{overrides.bgImageBlur}px</span
                                                            >
                                                        </span>
                                                        <input
                                                            aria-label="背景图模糊"
                                                            type="range"
                                                            min="0"
                                                            max="32"
                                                            step="1"
                                                            value={overrides.bgImageBlur}
                                                            oninput={(e) =>
                                                                updateOverride(
                                                                    'bgImageBlur',
                                                                    Number((e.target as HTMLInputElement).value)
                                                                )}
                                                            class="h-1.5 w-full cursor-pointer touch-none appearance-none rounded-full bg-(--theme-modal-text)/10 accent-(--theme-accent-bg)"
                                                        />
                                                        <div
                                                            class="mt-1 flex justify-between text-[9px] text-(--theme-modal-text)/25"
                                                        >
                                                            <span>清晰</span><span>朦胧</span>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <span
                                                            class="mb-2 flex items-center justify-between text-[11px] text-(--theme-modal-text)/55"
                                                        >
                                                            <span class="flex items-center gap-1.5"
                                                                ><Icon
                                                                    icon="mdi:brightness-4"
                                                                    class="size-3.5"
                                                                />背景图遮罩</span
                                                            >
                                                            <span class="font-mono text-(--theme-accent-text)"
                                                                >{overrides.bgImageMask === 0
                                                                    ? '原图'
                                                                    : overrides.bgImageMask > 0
                                                                      ? `明亮 ${overrides.bgImageMask}%`
                                                                      : `压暗 ${Math.abs(overrides.bgImageMask)}%`}</span
                                                            >
                                                        </span>
                                                        <input
                                                            aria-label="背景图遮罩"
                                                            type="range"
                                                            min="-100"
                                                            max="100"
                                                            step="1"
                                                            value={overrides.bgImageMask}
                                                            oninput={(e) =>
                                                                updateOverride(
                                                                    'bgImageMask',
                                                                    Number((e.target as HTMLInputElement).value)
                                                                )}
                                                            class="h-1.5 w-full cursor-pointer touch-none appearance-none rounded-full bg-(--theme-modal-text)/10 accent-(--theme-accent-bg)"
                                                        />
                                                        <div
                                                            class="mt-1 flex justify-between text-[9px] text-(--theme-modal-text)/25"
                                                        >
                                                            <span>压暗</span><span>原图</span><span>明亮</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        {/if}
                                    </div>
                                </div>
                            </div>

                            <div class="mt-4">
                                <div class="mb-3 flex items-center gap-2">
                                    <span
                                        class="flex size-7 items-center justify-center rounded-lg bg-(--theme-accent-bg)/10 text-(--theme-accent-text)"
                                    >
                                        <Icon icon="mdi:monitor" class="size-4" />
                                    </span>
                                    <div>
                                        <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                            >标题栏颜色</span
                                        >
                                        <span class="block text-[10px] text-(--theme-modal-text)/35"
                                            >跟随主题自动适配（昼夜 / 黑白特例），同步 PWA theme-color</span
                                        >
                                    </div>
                                </div>
                                <div
                                    class="flex items-center gap-2 rounded-lg border p-1.5 px-2.5"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    <span
                                        class="size-5 shrink-0 rounded border"
                                        style="background: var(--theme-titlebar-bg); border-color: var(--theme-divider-border);"
                                    ></span>
                                    <span class="text-[11px] font-medium text-(--theme-modal-text)/60"
                                        >跟随当前主题（{getActiveId() === 'light' ? '浅色' : '深色'}）</span
                                    >
                                </div>
                            </div>

                            <div class="mt-4">
                                <div class="mb-3 flex items-center gap-2">
                                    <span
                                        class="flex size-7 items-center justify-center rounded-lg bg-(--theme-accent-bg)/10 text-(--theme-accent-text)"
                                    >
                                        <Icon icon="mdi:star" class="size-4" />
                                    </span>
                                    <div>
                                        <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                            >霓虹灯字体</span
                                        >
                                        <span class="block text-[10px] text-(--theme-modal-text)/35"
                                            >所有文本与图标以当前颜色发光</span
                                        >
                                    </div>
                                </div>
                                <div
                                    class="rounded-lg border p-3"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    <div>
                                        <span
                                            class="mb-2 flex items-center justify-between text-[11px] text-(--theme-modal-text)/55"
                                        >
                                            <span>发光强度</span>
                                            <span class="font-mono text-(--theme-accent-text)"
                                                >{overrides.neonText}%</span
                                            >
                                        </span>
                                        <input
                                            aria-label="霓虹灯强度"
                                            type="range"
                                            min="0"
                                            max="100"
                                            step="1"
                                            value={overrides.neonText}
                                            oninput={(e) =>
                                                updateOverride(
                                                    'neonText',
                                                    Number((e.target as HTMLInputElement).value)
                                                )}
                                            class="h-1.5 w-full cursor-pointer touch-none appearance-none rounded-full bg-(--theme-modal-text)/10 accent-(--theme-accent-bg)"
                                        />
                                        <div class="mt-1 flex justify-between text-[9px] text-(--theme-modal-text)/25">
                                            <span>关</span><span>强烈</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    {:else if tab === 'keymap'}
                        <!-- Key mapping -->
                        <div>
                            <span class="mb-1 block text-xs font-medium text-(--theme-modal-text)/60">按键图标</span>
                            <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">
                                每行决定排轴时操作块显示的按键图标（键盘或手柄）；快速排轴输入键与界面快捷键可在「交互相关」中配置
                            </p>
                            <div class="flex flex-col gap-2">
                                {#each keymapEntries as entry}
                                    <div
                                        class="flex items-center gap-2 rounded-lg border px-2.5 py-2"
                                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                    >
                                        <span class="flex size-9 shrink-0 items-center justify-center">
                                            {#if iconOf(entry.blockKey)}
                                                <img
                                                    src={iconOf(entry.blockKey)}
                                                    alt={entry.blockKey}
                                                    draggable="false"
                                                    class="size-8 object-contain"
                                                />
                                            {:else}
                                                {@const gIcon = gamepadIconOf(entry.blockKey)}
                                                {#if gIcon}
                                                    <img
                                                        src={gIcon}
                                                        alt={entry.blockKey}
                                                        draggable="false"
                                                        class="size-7 object-contain"
                                                    />
                                                {:else}
                                                    <span class="text-[10px] font-bold text-(--theme-modal-text)/60"
                                                        >{entry.blockKey}</span
                                                    >
                                                {/if}
                                            {/if}
                                        </span>
                                        <input
                                            value={entry.label}
                                            onchange={(e) =>
                                                updateEntry(entry.id, { label: (e.target as HTMLInputElement).value })}
                                            class="min-w-0 flex-1 bg-transparent text-xs text-(--theme-modal-text) outline-none placeholder:text-(--theme-modal-text)/30"
                                        />
                                        <span
                                            class="shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] text-(--theme-modal-text)/60"
                                            style="border-color: var(--theme-divider-border);"
                                            title="快捷键"
                                        >
                                            {physicalLabel(entry.physical)}
                                        </span>
                                        <button
                                            onclick={() => (keyPickerFor = entry.id)}
                                            class="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium transition-all hover:brightness-125"
                                            style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
                                        >
                                            选择自定义key
                                        </button>
                                    </div>
                                {/each}
                            </div>
                            <div class="mt-3 flex items-center gap-2">
                                <button
                                    onclick={() => (tab = 'interaction')}
                                    class="flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-(--theme-accent-text) transition-colors hover:brightness-125"
                                    style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-accent-bg) 12%, transparent);"
                                    title="跳转到「交互相关」页配置快速排轴输入键与界面快捷键"
                                >
                                    <Icon icon="mdi:tune-variant" class="size-3.5" />
                                    界面快捷键设置
                                    <Icon icon="mdi:arrow-right" class="size-3" />
                                </button>
                                <button
                                    onclick={() => resetKeyMap()}
                                    class="flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    <Icon icon="mdi:restore" class="size-3.5" />
                                    恢复默认
                                </button>
                            </div>
                        </div>
                    {:else if tab === 'interaction'}
                        <div>
                            <span class="mb-1 block text-xs font-medium text-(--theme-modal-text)/60">拉表视图</span>
                            <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">
                                选择拉表页面的 Buff 编辑方式；后续拉表/排轴等快捷键设置也将集中在此区域
                            </p>
                            <div
                                class="flex gap-1 rounded-lg border p-1"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                role="tablist"
                            >
                                <button
                                    role="tab"
                                    aria-selected={getCalcViewMode() === 'dropdown'}
                                    onclick={() => switchCalcViewMode('dropdown')}
                                    class="flex-1 rounded-md px-1 py-1.5 text-xs font-medium transition-colors"
                                    style={getCalcViewMode() === 'dropdown'
                                        ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);'
                                        : 'color: var(--theme-modal-text)/60;'}
                                >
                                    buff 下拉模式
                                </button>
                                <button
                                    role="tab"
                                    aria-selected={getCalcViewMode() === 'spread'}
                                    onclick={() => switchCalcViewMode('spread')}
                                    class="flex-1 rounded-md px-1 py-1.5 text-xs font-medium transition-colors"
                                    style={getCalcViewMode() === 'spread'
                                        ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);'
                                        : 'color: var(--theme-modal-text)/60;'}
                                >
                                    buff 平铺模式
                                </button>
                            </div>

                            <div class="mt-5">
                                <span class="mb-1 block text-xs font-medium text-(--theme-modal-text)/60">工具栏</span>
                                <div
                                    class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    <div class="min-w-0">
                                        <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                            >简化底部工具栏</span
                                        >
                                        <span class="mt-0.5 block text-[10px] leading-4 text-(--theme-modal-text)/40">
                                            开启后底部工具栏变为可拖动的圆角胶囊（仅图标按钮），拖动时可吸附到侧栏右侧或屏幕右缘
                                        </span>
                                    </div>
                                    <button
                                        onclick={() => setSimplifyToolbar(!getSimplifyToolbar())}
                                        class="relative h-5 w-9 shrink-0 rounded-full transition-colors"
                                        style="background: {getSimplifyToolbar()
                                            ? 'var(--theme-accent-bg)'
                                            : 'color-mix(in srgb, var(--theme-modal-text) 25%, transparent)'};"
                                        title="点击切换"
                                    >
                                        <span
                                            class="absolute top-0.5 size-4 rounded-full transition-all"
                                            style="left: {getSimplifyToolbar()
                                                ? '18px'
                                                : '2px'}; background: var(--theme-modal-bg);"
                                        ></span>
                                    </button>
                                </div>
                            </div>

                            <div class="mt-5">
                                <span class="mb-1 block text-xs font-medium text-(--theme-modal-text)/60">交互效果</span
                                >
                                <div
                                    class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    <div class="min-w-0">
                                        <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                            >磁力光标</span
                                        >
                                        <span class="mt-0.5 block text-[10px] leading-4 text-(--theme-modal-text)/40">
                                            开启后鼠标移至按钮/链接等可点击元素上时，光标变形框住元素并带磁力吸附
                                        </span>
                                    </div>
                                    <button
                                        onclick={() => setMagneticPointer(!getMagneticPointer())}
                                        class="relative h-5 w-9 shrink-0 rounded-full transition-colors"
                                        style="background: {getMagneticPointer()
                                            ? 'var(--theme-accent-bg)'
                                            : 'color-mix(in srgb, var(--theme-modal-text) 25%, transparent)'};"
                                        title="点击切换"
                                    >
                                        <span
                                            class="absolute top-0.5 size-4 rounded-full transition-all"
                                            style="left: {getMagneticPointer()
                                                ? '18px'
                                                : '2px'}; background: var(--theme-modal-bg);"
                                        ></span>
                                    </button>
                                </div>
                            </div>

                            <div class="mt-5">
                                <span class="mb-1 block text-xs font-medium text-(--theme-modal-text)/60">删除行为</span
                                >
                                <div
                                    class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    <div class="min-w-0">
                                        <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                            >删除前二次确认</span
                                        >
                                        <span class="mt-0.5 block text-[10px] leading-4 text-(--theme-modal-text)/40">
                                            关闭后删除工程、Buff、排轴等对象时跳过二次确认弹窗，直接删除；默认开启
                                        </span>
                                    </div>
                                    <button
                                        onclick={() => setConfirmDeletes(!getConfirmDeletes())}
                                        class="relative h-5 w-9 shrink-0 rounded-full transition-colors"
                                        style="background: {getConfirmDeletes()
                                            ? 'var(--theme-accent-bg)'
                                            : 'color-mix(in srgb, var(--theme-modal-text) 25%, transparent)'};"
                                        title="点击切换"
                                    >
                                        <span
                                            class="absolute top-0.5 size-4 rounded-full transition-all"
                                            style="left: {getConfirmDeletes()
                                                ? '18px'
                                                : '2px'}; background: var(--theme-modal-bg);"
                                        ></span>
                                    </button>
                                </div>
                            </div>

                            <div class="mt-5">
                                <span class="mb-1 block text-xs font-medium text-(--theme-modal-text)/60"
                                    >界面快捷键</span
                                >
                                <p class="mb-3 text-[10px] leading-4 text-(--theme-modal-text)/40">
                                    点击「记录」后按下新键即时绑定（ESC 取消）；同组冲突会被拒绝。弹窗关闭与 Ctrl+A/Z/Y
                                    等固定不可改
                                </p>
                                {#each SHORTCUT_GROUPS as g}
                                    <div class="mt-3">
                                        <span class="text-[11px] font-medium text-(--theme-modal-text)/45"
                                            >{g.label}</span
                                        >
                                        <div class="mt-1 flex flex-col gap-1.5">
                                            {#each getShortcuts().filter((s) => s.group === g.key) as s}
                                                <div
                                                    class="flex items-center gap-2 rounded-lg border px-2.5 py-1.5"
                                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                                >
                                                    <div class="min-w-0 flex-1">
                                                        <span class="block text-xs text-(--theme-modal-text)"
                                                            >{s.label}</span
                                                        >
                                                        <span
                                                            class="block truncate text-[10px] leading-4 text-(--theme-modal-text)/35"
                                                            title={s.desc}>{s.desc}</span
                                                        >
                                                    </div>
                                                    <span
                                                        class="shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[10px] text-(--theme-modal-text)/70"
                                                        style="border-color: var(--theme-divider-border);"
                                                        >{shortcutLabel(getShortcutKey(s.id))}</span
                                                    >
                                                    <button
                                                        onclick={() =>
                                                            (shortcutCapture = shortcutCapture === s.id ? null : s.id)}
                                                        class="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium transition-all"
                                                        style={shortcutCapture === s.id
                                                            ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);'
                                                            : 'background: var(--theme-modal-text)/8; color: var(--theme-modal-text)/70;'}
                                                        >{shortcutCapture === s.id
                                                            ? s.lockedMods?.length
                                                                ? `按下新键…（${s.lockedMods
                                                                      .map(shortcutLabel)
                                                                      .join('+')} 固定）`
                                                                : '按下新键…'
                                                            : '记录'}</button
                                                    >
                                                </div>
                                            {/each}
                                        </div>
                                    </div>
                                {/each}
                                <div class="mt-3 flex items-center gap-2">
                                    <button
                                        onclick={() => resetShortcuts()}
                                        class="flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                                        style="border-color: var(--theme-divider-border);"
                                    >
                                        <Icon icon="mdi:restore" class="size-3.5" />
                                        恢复默认
                                    </button>
                                </div>
                            </div>
                        </div>
                    {:else if tab === 'performance'}
                        <!-- 性能相关 -->
                        <div>
                            <span class="mb-1 block text-xs font-medium text-(--theme-modal-text)/60">性能设置</span>
                            <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">
                                控制交互渲染方式与刷新结果时的数据加载行为
                            </p>
                            <!-- 渲染加速（GPU）：拖拽/动画走合成层 -->
                            <div
                                class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                            >
                                <div class="min-w-0">
                                    <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                        >渲染加速（GPU）</span
                                    >
                                    <span class="mt-0.5 block text-[10px] leading-4 text-(--theme-modal-text)/40">
                                        开启后排轴拖拽/框选/悬浮窗使用 GPU 合成（transform
                                        定位），帧率更高；关闭回退传统布局定位
                                    </span>
                                </div>
                                <button
                                    onclick={() => setGpuAccel(!getGpuAccel())}
                                    class="relative h-5 w-9 shrink-0 rounded-full transition-colors"
                                    style="background: {getGpuAccel()
                                        ? 'var(--theme-accent-bg)'
                                        : 'color-mix(in srgb, var(--theme-modal-text) 25%, transparent)'};"
                                    title="点击切换"
                                >
                                    <span
                                        class="absolute top-0.5 size-4 rounded-full transition-all"
                                        style="left: {getGpuAccel()
                                            ? '18px'
                                            : '2px'}; background: var(--theme-modal-bg);"
                                    ></span>
                                </button>
                            </div>
                            <!-- 刷新结果重载数据：开启后刷新结果时重新加载本工程全部阶段数据 -->
                            <div
                                class="mt-2 flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                            >
                                <div class="min-w-0">
                                    <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                        >刷新结果重载数据</span
                                    >
                                    <span class="mt-0.5 block text-[10px] leading-4 text-(--theme-modal-text)/40">
                                        开启后点击「刷新结果」会重新加载本工程全部阶段数据及角色/声骸信息（更准确，耗时更长）；关闭仅重算结果（更快）
                                    </span>
                                </div>
                                <button
                                    onclick={() => setReloadOnResultRefresh(!getReloadOnResultRefresh())}
                                    class="relative h-5 w-9 shrink-0 rounded-full transition-colors"
                                    style="background: {getReloadOnResultRefresh()
                                        ? 'var(--theme-accent-bg)'
                                        : 'color-mix(in srgb, var(--theme-modal-text) 25%, transparent)'};"
                                    title="点击切换"
                                >
                                    <span
                                        class="absolute top-0.5 size-4 rounded-full transition-all"
                                        style="left: {getReloadOnResultRefresh()
                                            ? '18px'
                                            : '2px'}; background: var(--theme-modal-bg);"
                                    ></span>
                                </button>
                            </div>
                            <!-- 链/阶变动重载数据：开启后调整共鸣链/精炼档位时自动重载本工程全部阶段数据 -->
                            <div
                                class="mt-2 flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                            >
                                <div class="min-w-0">
                                    <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                        >链/阶变动重载数据</span
                                    >
                                    <span class="mt-0.5 block text-[10px] leading-4 text-(--theme-modal-text)/40">
                                        开启后调整角色共鸣链/武器精炼档位时，自动重载本工程全部阶段数据并重新锁定（更准确，耗时更长）；关闭仅更新档位配置
                                    </span>
                                </div>
                                <button
                                    onclick={() => setReloadOnProfileChange(!getReloadOnProfileChange())}
                                    class="relative h-5 w-9 shrink-0 rounded-full transition-colors"
                                    style="background: {getReloadOnProfileChange()
                                        ? 'var(--theme-accent-bg)'
                                        : 'color-mix(in srgb, var(--theme-modal-text) 25%, transparent)'};"
                                    title="点击切换"
                                >
                                    <span
                                        class="absolute top-0.5 size-4 rounded-full transition-all"
                                        style="left: {getReloadOnProfileChange()
                                            ? '18px'
                                            : '2px'}; background: var(--theme-modal-bg);"
                                    ></span>
                                </button>
                            </div>
                        </div>
                    {:else if tab === 'connection'}
                        <!-- Connection settings: 上游数据源 + 工坊/分享源 -->
                        <div>
                            <span class="mb-1 block text-xs font-medium text-(--theme-modal-text)/60">上游数据源</span>
                            <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">
                                选择角色/武器/声骸等数据的来源；切换后列表与详情缓存会按新源重新加载
                            </p>
                            <div class="flex flex-col gap-2">
                                {#each providerOptions as opt}
                                    <div
                                        class={[
                                            'flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors',
                                            opt.id === activeProviderId
                                                ? 'border-(--theme-accent-bg) bg-(--theme-accent-bg)/10'
                                                : 'border-(--theme-divider-border) bg-(--theme-input-bg) hover:bg-(--theme-modal-text)/5'
                                        ].join(' ')}
                                        onclick={() => handleSwitchProvider(opt.id)}
                                        title="点击切换该数据源"
                                    >
                                        <Icon
                                            icon={opt.id === activeProviderId
                                                ? 'mdi:radiobox-marked'
                                                : 'mdi:radiobox-blank'}
                                            class="size-4 shrink-0 text-(--theme-accent-text)"
                                        />
                                        <span class="min-w-0 flex-1 truncate text-xs text-(--theme-modal-text)"
                                            >{opt.label}</span
                                        >
                                        <span
                                            class="shrink-0 rounded bg-(--theme-accent-bg)/10 px-1.5 py-0.5 text-[10px] text-(--theme-accent-text)"
                                            title="最新数据版本"
                                        >
                                            {providerVersions[opt.id] || opt.id}
                                        </span>
                                    </div>
                                {/each}
                            </div>
                            <div class="mt-3">
                                <button
                                    onclick={handleResetProvider}
                                    class="flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    <Icon icon="mdi:restore" class="size-3.5" />
                                    恢复默认
                                </button>
                            </div>

                            <div class="my-4 border-t" style="border-color: var(--theme-divider-border);"></div>

                            <span class="mb-1 block text-xs font-medium text-(--theme-modal-text)/60"
                                >工坊 / 分享源</span
                            >
                            <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">
                                配置椰果工坊实例；单选使用，可删除或新增，分享与工坊列表将使用当前选中实例
                            </p>
                            <div class="flex flex-col gap-2">
                                {#each workshopInstances as inst}
                                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                                    <div
                                        class={[
                                            'flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors',
                                            inst.id === workshopActiveId
                                                ? 'border-(--theme-accent-bg) bg-(--theme-accent-bg)/10'
                                                : 'border-(--theme-divider-border) bg-(--theme-input-bg) hover:bg-(--theme-modal-text)/5'
                                        ].join(' ')}
                                        onclick={() => handleSwitchWorkshop(inst.id)}
                                        title="点击选中该实例"
                                    >
                                        <Icon
                                            icon={inst.id === workshopActiveId
                                                ? 'mdi:radiobox-marked'
                                                : 'mdi:radiobox-blank'}
                                            class="size-4 shrink-0 text-(--theme-accent-text)"
                                        />
                                        <span class="min-w-0 flex-1 truncate text-xs text-(--theme-modal-text)"
                                            >{inst.url}</span
                                        >
                                        {#if workshopInstances.length > 1}
                                            <button
                                                onclick={(e) => {
                                                    e.stopPropagation()
                                                    handleRemoveWorkshop(inst.id)
                                                }}
                                                class="shrink-0 rounded p-1 text-(--theme-modal-text)/40 transition-colors hover:text-red-500"
                                                title="删除"
                                            >
                                                <Icon icon="mdi:close" class="size-3.5" />
                                            </button>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                            <div class="mt-3 flex gap-2">
                                <input
                                    bind:value={newWorkshopUrl}
                                    onkeydown={(e) => e.key === 'Enter' && handleAddWorkshop()}
                                    placeholder="https://example.com 工坊地址"
                                    class="min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-xs text-(--theme-modal-text) outline-none placeholder:text-(--theme-modal-text)/30"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                />
                                <button
                                    onclick={handleAddWorkshop}
                                    class="flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all hover:brightness-125"
                                    style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
                                >
                                    <Icon icon="mdi:plus" class="size-3.5" />
                                    添加
                                </button>
                            </div>
                            <div class="mt-3">
                                <button
                                    onclick={handleResetWorkshop}
                                    class="flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    <Icon icon="mdi:restore" class="size-3.5" />
                                    恢复默认
                                </button>
                            </div>
                        </div>
                    {:else if tab === 'archive'}
                        <!-- Archive management -->
                        <div>
                            <span class="mb-1 block text-xs font-medium text-(--theme-modal-text)/60">归档管理</span>
                            <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">
                                已归档的工程不会出现在侧边栏，可取消归档恢复、全量导出、分享或永久删除
                            </p>
                            {#if archivedProjects.length === 0}
                                <div
                                    class="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-10"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    <Icon icon="mdi:archive-outline" class="size-8 text-(--theme-modal-text)/20" />
                                    <span class="text-xs text-(--theme-modal-text)/40">暂无归档的工程</span>
                                </div>
                            {:else}
                                <div class="flex flex-col gap-2">
                                    {#each archivedProjects as p}
                                        <div
                                            class="rounded-lg border px-2.5 py-2"
                                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                        >
                                            <div class="flex items-center gap-2">
                                                <span
                                                    class="min-w-0 flex-1 truncate text-xs font-medium text-(--theme-modal-text)"
                                                    >{p.name}</span
                                                >
                                                <span class="shrink-0 text-[10px] text-(--theme-modal-text)/40"
                                                    >{formatArchiveDate(p.createdAt)}</span
                                                >
                                            </div>
                                            <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
                                                <button
                                                    onclick={() => handleUnarchive(p.id)}
                                                    class="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] transition-colors text-(--theme-accent-text) hover:brightness-125"
                                                    style="background: color-mix(in srgb, var(--theme-accent-bg) 14%, transparent);"
                                                >
                                                    <Icon icon="mdi:archive-arrow-up-outline" class="size-3" />
                                                    取消归档
                                                </button>
                                                <button
                                                    onclick={() => handleArchiveExport(p.id)}
                                                    class="flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                                                    style="border-color: var(--theme-divider-border);"
                                                >
                                                    <Icon icon="mdi:file-export" class="size-3" />
                                                    导出
                                                </button>
                                                <button
                                                    onclick={() => handleArchiveShare(p.id)}
                                                    class="flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                                                    style="border-color: var(--theme-divider-border);"
                                                >
                                                    <Icon icon="mdi:share-variant" class="size-3" />
                                                    分享(10分钟)
                                                </button>
                                                <button
                                                    onclick={() => openArchiveDelete(p.id)}
                                                    class="flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] text-(--theme-modal-text)/40 transition-colors hover:border-red-500/50 hover:text-red-500"
                                                    style="border-color: var(--theme-divider-border);"
                                                    title="永久删除，不可恢复"
                                                >
                                                    <Icon icon="mdi:delete-outline" class="size-3" />
                                                    永久删除
                                                </button>
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    {:else if tab === 'cache'}
                        <!-- Cache management -->
                        <div>
                            <span class="mb-1 block text-xs font-medium text-(--theme-modal-text)/60">缓存清理</span>
                            <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">
                                仅清理接口数据缓存（列表 / 详情 / 图像），不影响你的工程与本地数据
                            </p>
                            <div class="flex flex-col gap-2">
                                {#each CACHE_LABELS as item}
                                    <div
                                        class="flex items-center gap-2.5 rounded-lg border px-3 py-2.5"
                                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                    >
                                        <Icon icon={item.icon} class="size-4 shrink-0 text-(--theme-accent-text)" />
                                        <span class="min-w-0 flex-1 truncate text-xs text-(--theme-modal-text)"
                                            >{item.label}</span
                                        >
                                        <span class="shrink-0 text-[10px] text-(--theme-modal-text)/40"
                                            >{cacheCounts[item.key]} 条</span
                                        >
                                        <button
                                            onclick={() => handleClearCache(item.key)}
                                            class="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-all hover:brightness-125"
                                            style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
                                        >
                                            <Icon icon="mdi:delete-sweep-outline" class="size-3" />
                                            清理
                                        </button>
                                    </div>
                                {/each}
                            </div>
                        </div>
                    {:else if tab === 'ai'}
                        <!-- 助手设置 -->
                        <div>
                            <span class="mb-1 block text-xs font-medium text-(--theme-modal-text)/60">助手设置</span>
                            <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">
                                可配置多组「提供商 / 模型 / API Key」并一键切换，每组独立保存；API Key
                                仅存本机。点击配置文件即可切换，点「编辑」打开独立弹窗修改
                            </p>
                            <div class="flex flex-col gap-2">
                                <!-- 启用 AI 助手（独立开关，立即保存） -->
                                <div
                                    class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    <div class="min-w-0">
                                        <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                            >启用 AI 助手</span
                                        >
                                        <span class="mt-0.5 block text-[10px] text-(--theme-modal-text)/40">
                                            开启后页面右下角显示 AI 助手悬浮窗；关闭后悬浮窗隐藏，所有 AI 功能不可用
                                        </span>
                                    </div>
                                    <button
                                        onclick={() => toggleAiEnabled()}
                                        class="relative h-5 w-9 shrink-0 rounded-full transition-colors"
                                        style="background: {getGenPrefs().enabled
                                            ? 'var(--theme-accent-bg)'
                                            : 'color-mix(in srgb, var(--theme-modal-text) 25%, transparent)'};"
                                        title="点击切换"
                                    >
                                        <span
                                            class="absolute top-0.5 size-4 rounded-full transition-all"
                                            style="left: {getGenPrefs().enabled
                                                ? '18px'
                                                : '2px'}; background: var(--theme-modal-bg);"
                                        ></span>
                                    </button>
                                </div>

                                <!-- 危险操作权限（独立设置，立即保存） -->
                                <div
                                    class="rounded-lg border px-3 py-2.5"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                        >危险操作权限</span
                                    >
                                    <p class="mt-1 mb-2 text-[10px] text-(--theme-modal-text)/40">
                                        AI 执行危险操作（删除工程、清空数据等）时的确认策略；「批量」=
                                        一次指令内的多次调用只询问一次
                                    </p>
                                    <div class="flex flex-col gap-1">
                                        {#each DANGER_MODE_OPTIONS as opt}
                                            {@const active = getGenPrefs().dangerMode === opt.value}
                                            <button
                                                onclick={() => setDangerMode(opt.value)}
                                                class={[
                                                    'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors',
                                                    active
                                                        ? 'border-(--theme-accent-bg)'
                                                        : 'hover:bg-(--theme-modal-text)/5'
                                                ].join(' ')}
                                                style={active
                                                    ? 'background: color-mix(in srgb, var(--theme-accent-bg) 12%, transparent);'
                                                    : 'border-color: var(--theme-divider-border);'}
                                            >
                                                <Icon
                                                    icon={active ? 'mdi:radiobox-marked' : 'mdi:radiobox-blank'}
                                                    class={active
                                                        ? 'size-3.5 shrink-0 text-(--theme-accent-text)'
                                                        : 'size-3.5 shrink-0 text-(--theme-modal-text)/30'}
                                                />
                                                <span class="min-w-0 flex-1">
                                                    <span class="block text-xs font-medium text-(--theme-modal-text)/80"
                                                        >{opt.label}</span
                                                    >
                                                    <span class="block text-[10px] text-(--theme-modal-text)/40"
                                                        >{opt.desc}</span
                                                    >
                                                </span>
                                            </button>
                                        {/each}
                                    </div>
                                </div>

                                <!-- 配置文件设置 -->
                                <div
                                    class="rounded-lg border px-3 py-2.5"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    <div class="mb-2 flex items-center justify-between">
                                        <span class="text-xs font-medium text-(--theme-modal-text)/70"
                                            >配置文件设置</span
                                        >
                                        <button
                                            onclick={handleAddAiProfile}
                                            class="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-medium transition-all hover:brightness-110"
                                            style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                                        >
                                            <Icon icon="mdi:plus" class="size-3" />
                                            新建
                                        </button>
                                    </div>
                                    <p class="mb-2 text-[10px] text-(--theme-modal-text)/40">
                                        点击配置文件即可切换；编辑、删除请使用右侧按钮
                                    </p>
                                    <div class="mb-1.5 flex flex-col gap-1">
                                        {#each aiProfiles as p}
                                            {@const isActive = p.id === aiActiveId}
                                            <div
                                                class="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors"
                                                style="border-color: {isActive
                                                    ? 'color-mix(in srgb, var(--theme-accent-bg) 45%, transparent)'
                                                    : 'var(--theme-divider-border)'}; background: color-mix(in srgb, var(--theme-accent-bg) {isActive
                                                    ? '10%'
                                                    : '0%'}, transparent);"
                                            >
                                                <button
                                                    onclick={() => handleSelectAiProfile(p.id)}
                                                    class="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                                                    title="切换到该配置"
                                                >
                                                    <span
                                                        class="flex w-full items-center gap-1.5 text-xs font-medium text-(--theme-modal-text)"
                                                    >
                                                        <Icon
                                                            icon={isActive
                                                                ? 'mdi:radiobox-marked'
                                                                : 'mdi:radiobox-blank'}
                                                            class={isActive
                                                                ? 'size-3.5 shrink-0 text-(--theme-accent-text)'
                                                                : 'size-3.5 shrink-0 text-(--theme-modal-text)/30'}
                                                        />
                                                        <span class="truncate">{p.label}</span>
                                                        {#if isActive}
                                                            <span
                                                                class="shrink-0 rounded bg-(--theme-accent-bg)/20 px-1 py-px text-[9px] text-(--theme-accent-text)"
                                                                >当前</span
                                                            >
                                                        {/if}
                                                    </span>
                                                    <span
                                                        class="w-full truncate pl-5 text-[10px] text-(--theme-modal-text)/40"
                                                    >
                                                        {p.model} · {p.baseUrl}
                                                    </span>
                                                </button>
                                                <div class="flex shrink-0 items-center gap-0.5">
                                                    <button
                                                        onclick={() => (aiEditTarget = p)}
                                                        class="rounded p-1 text-(--theme-modal-text)/35 transition-colors hover:text-(--theme-accent-text)"
                                                        title="编辑此配置"
                                                    >
                                                        <Icon icon="mdi:pencil-outline" class="size-3.5" />
                                                    </button>
                                                    <button
                                                        onclick={() => handleDeleteAiProfile(p)}
                                                        class="rounded p-1 text-(--theme-modal-text)/35 transition-colors hover:text-red-400"
                                                        title="删除此配置"
                                                    >
                                                        <Icon icon="mdi:trash-can-outline" class="size-3.5" />
                                                    </button>
                                                </div>
                                            </div>
                                        {/each}
                                    </div>
                                </div>

                                <!-- 提示词设置 -->
                                <div
                                    class="rounded-lg border px-3 py-2.5"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    <span class="text-xs font-medium text-(--theme-modal-text)/70">提示词设置</span>
                                    <p class="mb-2 mt-1 text-[10px] text-(--theme-modal-text)/40">
                                        命名规则与人设提示词，与模型配置分开保存
                                    </p>
                                    <div class="flex flex-col gap-1">
                                        <div
                                            class="flex items-center gap-2 rounded-lg border px-2.5 py-1.5"
                                            style="border-color: var(--theme-divider-border);"
                                        >
                                            <div class="min-w-0 flex-1">
                                                <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                                    >Buff 命名规则</span
                                                >
                                                <span
                                                    class="mt-0.5 block truncate text-[10px] text-(--theme-modal-text)/40"
                                                >
                                                    生成 Buff 时的命名规范；清空则每次由 AI 询问
                                                </span>
                                            </div>
                                            <button
                                                onclick={() => (promptEditKind = 'naming')}
                                                class="inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-medium transition-all hover:brightness-110"
                                                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                                            >
                                                <Icon icon="mdi:pencil-outline" class="size-3" />
                                                编辑
                                            </button>
                                        </div>
                                        <div
                                            class="flex items-center gap-2 rounded-lg border px-2.5 py-1.5"
                                            style="border-color: var(--theme-divider-border);"
                                        >
                                            <div class="min-w-0 flex-1">
                                                <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                                    >黑话词典</span
                                                >
                                                <span
                                                    class="mt-0.5 block truncate text-[10px] text-(--theme-modal-text)/40"
                                                >
                                                    官方/生僻叫法 → 玩家黑话；生成 Buff 时用于命名优化
                                                </span>
                                            </div>
                                            <button
                                                onclick={() => (promptEditKind = 'slang')}
                                                class="inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-medium transition-all hover:brightness-110"
                                                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                                            >
                                                <Icon icon="mdi:pencil-outline" class="size-3" />
                                                编辑
                                            </button>
                                        </div>
                                        <div
                                            class="flex items-center gap-2 rounded-lg border px-2.5 py-1.5"
                                            style="border-color: var(--theme-divider-border);"
                                        >
                                            <div class="min-w-0 flex-1">
                                                <span class="block text-xs font-medium text-(--theme-modal-text)/70"
                                                    >人设提示词</span
                                                >
                                                <span
                                                    class="mt-0.5 block truncate text-[10px] text-(--theme-modal-text)/40"
                                                >
                                                    AI 助手的角色与行为规则（system prompt）
                                                </span>
                                            </div>
                                            <button
                                                onclick={() => (promptEditKind = 'persona')}
                                                class="inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-[10px] font-medium transition-all hover:brightness-110"
                                                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                                            >
                                                <Icon icon="mdi:pencil-outline" class="size-3" />
                                                编辑
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    {/if}
                </div>
            </div>
        </div>
    </div>

    <!-- Archive delete confirm -->
    {#if confirmDelete}
        {@const target = confirmDelete}
        <ConfirmDeleteModal
            open
            title="永久删除归档工程"
            confirmText={`删除${target.name}`}
            onclose={closeArchiveDelete}
            onconfirm={doArchiveDelete}
        />
    {/if}

    <!-- AI profile delete confirm -->
    {#if aiDeleteConfirm}
        <ConfirmDeleteModal
            open
            title="删除 AI 配置文件"
            confirmText={`删除「${aiDeleteConfirm.label}」`}
            onclose={() => (aiDeleteConfirm = null)}
            onconfirm={doDeleteAiProfile}
        />
    {/if}

    <!-- AI profile edit -->
    {#if aiEditTarget}
        <AiProfileEditModal
            open
            profile={aiEditTarget}
            onclose={() => (aiEditTarget = null)}
            onsaved={() => (aiEditTarget = null)}
        />
    {/if}

    <!-- AI prompt edit -->
    {#if promptEditKind}
        <AiPromptEditModal
            open
            kind={promptEditKind}
            onclose={() => (promptEditKind = null)}
            onsaved={() => (promptEditKind = null)}
        />
    {/if}

    <!-- Key picker（键盘图标 + 手柄键位） -->
    {#if keyPickerFor}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="animate-fade-in fixed inset-0 z-[70] flex items-center justify-center backdrop-blur-sm"
            style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        >
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
                class="theme-scrollbar animate-pop-in max-h-[75vh] w-[92vw] max-w-lg overflow-y-auto rounded-xl border p-4"
                style="background: var(--theme-modal-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                onclick={(e) => e.stopPropagation()}
            >
                <div class="mb-3 flex items-center justify-between">
                    <span class="text-sm font-semibold">选择按键与手柄键位</span>
                    <button
                        onclick={() => (keyPickerFor = null)}
                        class="rounded p-1 text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)/70"
                    >
                        <Icon icon="mdi:close" class="size-4.5" />
                    </button>
                </div>
                <div class="mb-2 flex items-center gap-2 text-[10px] font-medium text-(--theme-modal-text)/60">
                    <Icon icon="mdi:keyboard-outline" class="size-3.5" />
                    键盘
                </div>
                <div class="flex flex-wrap gap-1.5">
                    {#each uiBtnIconList as [name, url]}
                        <button
                            onclick={() => {
                                updateEntry(keyPickerFor!, { blockKey: name })
                                keyPickerFor = null
                            }}
                            class="flex size-10 items-center justify-center rounded-md border transition-colors {keyPickerFor &&
                            entryById(keyPickerFor)?.blockKey === name
                                ? 'border-(--theme-accent-bg)'
                                : 'hover:bg-(--theme-modal-text)/10'}"
                            style="border-color: {keyPickerFor && entryById(keyPickerFor)?.blockKey === name
                                ? 'var(--theme-accent-bg)'
                                : 'var(--theme-divider-border)'};"
                            title={name}
                        >
                            <img
                                src={url}
                                alt={name}
                                draggable="false"
                                class="size-6 object-contain pointer-events-none"
                            />
                        </button>
                    {/each}
                </div>
                <div class="my-3 border-t" style="border-color: var(--theme-divider-border);"></div>
                <div class="mb-2 flex items-center gap-2 text-[10px] font-medium text-(--theme-modal-text)/60">
                    <Icon icon="mdi:gamepad-variant-outline" class="size-3.5" />
                    手柄图标
                </div>
                <div class="flex flex-wrap gap-1.5">
                    {#each GAMEPAD_BUTTONS as btn}
                        <button
                            onclick={() => {
                                updateEntry(keyPickerFor!, { blockKey: btn.id })
                                keyPickerFor = null
                            }}
                            class="flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-md border px-2 transition-colors {keyPickerFor &&
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
            </div>
        </div>
    {/if}
{/if}
