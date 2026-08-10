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
    import { getUiBtnIcons, clearCacheCategory, countCacheCategory, type CacheCategory } from '$lib/data/api'
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
        getArchivedProjects,
        unarchiveProject,
        deleteProject,
        buildExportFile,
        getPhaseOrder
    } from '$lib/data/project.svelte'
    import { getShareLink } from '$lib/data/share.svelte'
    import {
        getNamingRule,
        getSystemPrompt,
        getGenPrefs,
        loadGenPrefs,
        updateGenPrefs
    } from '$lib/data/ai-prefs.svelte'
    import { GAMEPAD_BUTTONS } from '$lib/components/page/home/timeline/timeline.consts'
    import { getCalcViewMode, setCalcViewMode } from '$lib/data/calc-view.svelte'
    import {
        getGpuAccel,
        setGpuAccel,
        getReloadOnResultRefresh,
        setReloadOnResultRefresh
    } from '$lib/data/render-prefs.svelte'
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
        getAiConfig,
        getAiProfiles,
        loadAiConfig,
        setActiveProfile,
        addProfile,
        deleteProfile,
        updateProfile,
        resetAiConfig,
        type AiProfile
    } from '$lib/ai/config.svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import ConfirmDeleteModal from '$lib/components/layout/confirm-delete-modal.svelte'

    interface Props {
        open: boolean
        onclose: () => void
    }

    let { open, onclose }: Props = $props()

    let tab = $state<'theme' | 'keymap' | 'interaction' | 'performance' | 'workshop' | 'archive' | 'cache' | 'ai'>(
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
        { key: 'workshop', label: '工坊设置', icon: 'mdi:storefront-outline' },
        { key: 'archive', label: '归档管理', icon: 'mdi:archive-outline' },
        { key: 'cache', label: '缓存清理', icon: 'mdi:database-outline' },
        { key: 'ai', label: '助手设置', icon: 'mdi:robot-outline' }
    ] as const

    const COLOR_PRESETS = [
        { name: '默认', hue: null as number | 'mono' | null },
        { name: '橘红', hue: 28 as number | 'mono' | null },
        { name: '品红', hue: 330 as number | 'mono' | null },
        { name: '墨绿', hue: 150 as number | 'mono' | null },
        { name: '黑白', hue: 'mono' as const }
    ]

    let fileInput: HTMLInputElement | undefined = $state()
    let bgUrl = $state('')

    let overrides = $derived(getOverrides())
    let isDark = $derived(getActiveId() !== 'light')
    let aiProfiles = $derived(getAiProfiles())
    // AI 配置草稿：输入先改草稿，点“保存”才写入当前配置文件
    let aiDraft = $state<AiProfile>({ ...getAiConfig() })
    let aiNameDraft = $state('')
    let aiDeleteConfirm = $state<AiProfile | null>(null)
    let namingRuleDraft = $state('')
    let systemPromptDraft = $state('')

    async function saveAiConfig() {
        await updateProfile(aiDraft.id, { ...aiDraft })
        addToast('助手设置已保存', 'success')
    }

    async function saveGenPrefs() {
        await updateGenPrefs({ namingRule: namingRuleDraft, systemPrompt: systemPromptDraft })
        addToast('提示词设置已保存', 'success')
    }

    async function toggleAiEnabled() {
        await updateGenPrefs({ enabled: !getGenPrefs().enabled })
        addToast(getGenPrefs().enabled ? 'AI 助手已启用' : 'AI 助手已禁用', 'success')
    }

    function switchCalcViewMode(mode: 'dropdown' | 'spread') {
        setCalcViewMode(mode)
        addToast(mode === 'spread' ? '已切换为 buff 平铺模式' : '已切换为 buff 下拉模式', 'success')
    }

    async function handleSelectAiProfile(id: string) {
        await setActiveProfile(id)
        aiDraft = { ...getAiConfig() }
    }

    async function handleAddAiProfile() {
        const profile = await addProfile(aiNameDraft)
        aiNameDraft = ''
        aiDraft = { ...profile }
        addToast('已新建配置文件，填写 API Key 后保存', 'success')
    }

    function handleDeleteAiProfile(profile: AiProfile) {
        aiDeleteConfirm = profile
    }

    async function doResetAiConfig() {
        await resetAiConfig()
        aiDraft = { ...getAiConfig() }
        addToast('助手设置已恢复为默认 3 个', 'success')
    }

    async function doDeleteAiProfile() {
        if (!aiDeleteConfirm) return
        const ok = await deleteProfile(aiDeleteConfirm.id)
        aiDeleteConfirm = null
        if (!ok) {
            addToast('至少保留一个配置文件', 'error')
            return
        }
        aiDraft = { ...getAiConfig() }
        addToast('配置文件已删除', 'info')
    }

    function isDeepSeekBaseUrl(url: string): boolean {
        try {
            return new URL(url).host === 'api.deepseek.com'
        } catch {
            return false
        }
    }

    function isOpencodeBaseUrl(url: string): boolean {
        try {
            return new URL(url).host === 'opencode.ai'
        } catch {
            return false
        }
    }

    $effect(() => {
        if (open) {
            bgUrl = overrides.backgroundImage.startsWith('http') ? overrides.backgroundImage : ''
            refreshCacheCounts()
            loadAiConfig().then(() => {
                aiDraft = { ...getAiConfig() }
            })
            loadGenPrefs().then(() => {
                namingRuleDraft = getNamingRule()
                systemPromptDraft = getSystemPrompt()
            })
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

    function refreshCacheCounts() {
        cacheCounts = {
            list: countCacheCategory('list'),
            info: countCacheCategory('info'),
            image: countCacheCategory('image')
        }
    }

    const CACHE_LABELS: { key: CacheCategory; label: string; icon: string }[] = [
        { key: 'list', label: '列表缓存', icon: 'mdi:file-document-outline' },
        { key: 'info', label: '详情缓存', icon: 'mdi:information-outline' },
        { key: 'image', label: '图像缓存', icon: 'mdi:image-outline' }
    ]

    async function handleClearCache(kind: CacheCategory) {
        await clearCacheCategory(kind)
        refreshCacheCounts()
        addToast(`已清理${CACHE_LABELS.find((c) => c.key === kind)?.label ?? ''}`, 'success')
    }
</script>

{#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="animate-fade-in fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5))"
        onkeydown={(e) => {
            if (e.key === 'Escape') onclose()
        }}
        out:fade={{ duration: 130 }}
    >
        <div
            class="animate-pop-in theme-glass-surface relative flex h-[min(720px,92dvh)] w-[640px] max-w-[94vw] flex-col overflow-hidden rounded-xl shadow-2xl sm:h-[560px] sm:max-h-[90vh]"
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

            <div class="flex min-h-0 flex-1 flex-col sm:flex-row">
                <!-- Sidebar -->
                <div
                    class="flex w-full shrink-0 gap-1 overflow-x-auto border-b p-2 [scrollbar-width:none] sm:w-40 sm:flex-col sm:overflow-x-visible sm:border-r sm:border-b-0 sm:p-3 [&::-webkit-scrollbar]:hidden"
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
                    class="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 [scrollbar-width:none] sm:p-6 [&::-webkit-scrollbar]:hidden"
                >
                    {#if tab === 'theme'}
                        <!-- Accent color -->
                        <div class="mb-5">
                            <span class="mb-3 block text-xs font-medium text-(--theme-modal-text)/60">主色调</span>
                            <div
                                class="flex gap-1 rounded-lg border p-1"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                            >
                                {#each COLOR_PRESETS as c}
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

                            {#if overrides.backgroundImage}
                                <div
                                    class="mt-4 overflow-hidden rounded-xl border"
                                    style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-input-bg) 70%, transparent);"
                                >
                                    <div
                                        class="relative h-40 overflow-hidden border-b"
                                        style="border-color: var(--theme-divider-border);"
                                    >
                                        <!-- 背景图独立层（自身模糊，不影响上层的预览卡片） -->
                                        <div
                                            class="absolute inset-0"
                                            style="background-image: url('{overrides.backgroundImage}'); background-position: center; background-size: cover; filter: blur({overrides.bgImageBlur}px);"
                                        ></div>
                                        <!-- 背景图遮罩层（与工作区一致，由背景图遮罩控制） -->
                                        <div
                                            class="absolute inset-0"
                                            style="background: rgba(0,0,0,{(overrides.bgImageMask / 100) * 0.6});"
                                        ></div>
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
                                                        ><Icon
                                                            icon="mdi:cards-outline"
                                                            class="size-3.5"
                                                        />卡片透明度</span
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
                                            </div>

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
                                                                >{overrides.bgImageMask}%</span
                                                            >
                                                        </span>
                                                        <input
                                                            aria-label="背景图遮罩"
                                                            type="range"
                                                            min="0"
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
                                                            <span>原图</span><span>压暗</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            {/if}

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
                                style="border-color: var(--theme-divider-border);"
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
                                style="border-color: var(--theme-divider-border);"
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
                        </div>
                    {:else if tab === 'workshop'}
                        <!-- Workshop settings -->
                        <div>
                            <span class="mb-1 block text-xs font-medium text-(--theme-modal-text)/60">工坊设置</span>
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
                                仅存本机。修改后点「保存」生效
                            </p>
                            <div class="flex flex-col gap-2">
                                <!-- 启用 AI 助手（独立开关，立即保存） -->
                                <div
                                    class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                                    style="border-color: var(--theme-divider-border);"
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

                                <!-- 配置文件设置（下拉展开） -->
                                <details
                                    open
                                    class="rounded-lg border px-3 py-2"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    <summary class="cursor-pointer text-xs font-medium text-(--theme-modal-text)/70">
                                        配置文件设置
                                    </summary>
                                    <div class="mt-2 flex flex-col gap-3">
                                        <!-- 配置文件列表 -->
                                        <div>
                                            <div class="mb-1 flex items-center justify-between">
                                                <span class="block text-xs text-(--theme-modal-text)/60">配置文件</span>
                                                <button
                                                    onclick={doResetAiConfig}
                                                    class="inline-flex items-center gap-0.5 text-[10px] text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-accent-text)"
                                                >
                                                    <Icon icon="mdi:restore" class="size-3" />
                                                    恢复默认
                                                </button>
                                            </div>
                                            <div class="mb-1.5 flex flex-col gap-1">
                                                {#each aiProfiles as p}
                                                    <div
                                                        class="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors"
                                                        style="border-color: {p.id === aiDraft.id
                                                            ? 'color-mix(in srgb, var(--theme-accent-bg) 45%, transparent)'
                                                            : 'var(--theme-divider-border)'}; background: color-mix(in srgb, var(--theme-accent-bg) {p.id ===
                                                        aiDraft.id
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
                                                                <span class="truncate">{p.label}</span>
                                                                {#if p.id === aiDraft.id}
                                                                    <span
                                                                        class="shrink-0 rounded bg-(--theme-accent-bg)/20 px-1 py-px text-[9px] text-(--theme-accent-text)"
                                                                        >编辑中</span
                                                                    >
                                                                {/if}
                                                            </span>
                                                            <span
                                                                class="w-full truncate text-[10px] text-(--theme-modal-text)/40"
                                                            >
                                                                {p.model} · {p.baseUrl}
                                                            </span>
                                                        </button>
                                                        {#if p.id === aiDraft.id}
                                                            <button
                                                                onclick={() => handleDeleteAiProfile(p)}
                                                                class="shrink-0 rounded p-1 text-(--theme-modal-text)/35 transition-colors hover:text-red-400"
                                                                title="删除此配置"
                                                            >
                                                                <Icon icon="mdi:trash-can-outline" class="size-3.5" />
                                                            </button>
                                                        {/if}
                                                    </div>
                                                {/each}
                                            </div>
                                            <div class="flex items-center gap-1.5">
                                                <input
                                                    type="text"
                                                    bind:value={aiNameDraft}
                                                    placeholder="新配置名称，如 本地 Ollama"
                                                    class="min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-sm outline-none transition-colors"
                                                    style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                                                />
                                                <button
                                                    onclick={handleAddAiProfile}
                                                    class="inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all hover:brightness-110"
                                                    style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                                                >
                                                    <Icon icon="mdi:plus" class="size-3.5" />
                                                    新建
                                                </button>
                                            </div>
                                        </div>
                                        <div
                                            class="my-0.5 border-t"
                                            style="border-color: var(--theme-divider-border);"
                                        ></div>
                                        <label class="block">
                                            <span class="mb-1 block text-xs text-(--theme-modal-text)/60"
                                                >AI 服务地址</span
                                            >
                                            <input
                                                type="url"
                                                value={aiDraft.baseUrl}
                                                oninput={(e) =>
                                                    (aiDraft = {
                                                        ...aiDraft,
                                                        baseUrl: (e.currentTarget as HTMLInputElement).value
                                                    })}
                                                placeholder="https://api.deepseek.com"
                                                class="w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none transition-colors"
                                                style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                                            />
                                        </label>
                                        <label class="block">
                                            <span class="mb-1 block text-xs text-(--theme-modal-text)/60">模型名</span>
                                            <input
                                                type="text"
                                                value={aiDraft.model}
                                                oninput={(e) =>
                                                    (aiDraft = {
                                                        ...aiDraft,
                                                        model: (e.currentTarget as HTMLInputElement).value
                                                    })}
                                                placeholder="deepseek-v4-flash"
                                                class="w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none transition-colors"
                                                style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                                            />
                                        </label>
                                        <label class="block">
                                            <span class="mb-1 block text-xs text-(--theme-modal-text)/60"
                                                >AI API Key</span
                                            >
                                            <input
                                                type="password"
                                                value={aiDraft.apiKey}
                                                oninput={(e) =>
                                                    (aiDraft = {
                                                        ...aiDraft,
                                                        apiKey: (e.currentTarget as HTMLInputElement).value
                                                    })}
                                                placeholder="sk-..."
                                                class="w-full rounded-lg border px-2.5 py-1.5 text-sm outline-none transition-colors"
                                                style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                                            />
                                            {#if isDeepSeekBaseUrl(aiDraft.baseUrl)}
                                                <p class="mt-1 text-[10px] text-(--theme-modal-text)/40">
                                                    API Key 在
                                                    <a
                                                        href="https://platform.deepseek.com"
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        class="text-(--theme-accent-text) hover:underline"
                                                        >DeepSeek 开放平台</a
                                                    >
                                                    获取
                                                </p>
                                            {:else if isOpencodeBaseUrl(aiDraft.baseUrl)}
                                                <p class="mt-1 text-[10px] text-(--theme-modal-text)/40">
                                                    API Key 在
                                                    <a
                                                        href="https://opencode.ai/auth"
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        class="text-(--theme-accent-text) hover:underline"
                                                        >opencode Workspace</a
                                                    >
                                                    获取
                                                </p>
                                            {/if}
                                        </label>
                                        <div>
                                            <span class="mb-1 block text-xs text-(--theme-modal-text)/60">思考强度</span
                                            >
                                            <div class="flex flex-wrap gap-1">
                                                {#each ['low', 'medium', 'high'] as level}
                                                    <button
                                                        onclick={() =>
                                                            (aiDraft = {
                                                                ...aiDraft,
                                                                reasoningEffort: level as 'low' | 'medium' | 'high'
                                                            })}
                                                        class="rounded-md px-2 py-1 text-[10px] transition-colors {aiDraft.reasoningEffort ===
                                                        level
                                                            ? 'text-(--theme-accent-text)'
                                                            : 'text-(--theme-modal-text)/60'}"
                                                        style="background: color-mix(in srgb, var(--theme-accent-bg) {aiDraft.reasoningEffort ===
                                                        level
                                                            ? '14%'
                                                            : '0%'}, transparent);"
                                                    >
                                                        {level === 'low' ? '低' : level === 'medium' ? '中' : '高'}
                                                    </button>
                                                {/each}
                                            </div>
                                        </div>
                                        <div class="flex justify-end">
                                            <button
                                                onclick={saveAiConfig}
                                                class="inline-flex items-center gap-1 rounded-lg px-4 py-1.5 text-xs font-medium transition-all hover:brightness-110"
                                                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                                            >
                                                <Icon icon="mdi:content-save-outline" class="size-3.5" />
                                                保存配置文件
                                            </button>
                                        </div>
                                    </div>
                                </details>

                                <!-- 提示词设置（下拉展开，独立保存） -->
                                <details
                                    class="rounded-lg border px-3 py-2"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    <summary class="cursor-pointer text-xs font-medium text-(--theme-modal-text)/70">
                                        提示词设置
                                    </summary>
                                    <p class="mt-2 mb-3 text-[10px] text-(--theme-modal-text)/40">
                                        命名规则与人设提示词，与模型配置分开保存
                                    </p>
                                    <div class="flex flex-col gap-3">
                                        <div>
                                            <span class="mb-1 block text-xs text-(--theme-modal-text)/60"
                                                >Buff 命名规则</span
                                            >
                                            <textarea
                                                value={namingRuleDraft}
                                                oninput={(e) =>
                                                    (namingRuleDraft = (e.currentTarget as HTMLTextAreaElement).value)}
                                                rows="6"
                                                placeholder="生成 Buff 时按此规则命名；清空则每次生成前由 AI 询问你"
                                                class="w-full resize-y rounded-lg border px-2.5 py-1.5 text-sm outline-none transition-colors"
                                                style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                                            ></textarea>
                                            <p class="mt-1 text-[10px] text-(--theme-modal-text)/40">
                                                默认采用工坊（share）端的命名风格；可自由改成你自己的规则
                                            </p>
                                        </div>
                                        <div>
                                            <span class="mb-1 block text-xs text-(--theme-modal-text)/60"
                                                >人设提示词</span
                                            >
                                            <textarea
                                                value={systemPromptDraft}
                                                oninput={(e) =>
                                                    (systemPromptDraft = (e.currentTarget as HTMLTextAreaElement)
                                                        .value)}
                                                rows="10"
                                                class="w-full resize-y rounded-lg border px-2.5 py-1.5 text-xs leading-relaxed outline-none transition-colors"
                                                style="background: var(--theme-input-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                                            ></textarea>
                                            <p class="mt-1 text-[10px] text-(--theme-modal-text)/40">
                                                AI 助手的角色与行为规则（system prompt）；清空则使用默认人设
                                            </p>
                                        </div>
                                        <div class="flex justify-end">
                                            <button
                                                onclick={saveGenPrefs}
                                                class="inline-flex items-center gap-1 rounded-lg px-4 py-1.5 text-xs font-medium transition-all hover:brightness-110"
                                                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                                            >
                                                <Icon icon="mdi:content-save-outline" class="size-3.5" />
                                                保存提示词设置
                                            </button>
                                        </div>
                                    </div>
                                </details>
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
