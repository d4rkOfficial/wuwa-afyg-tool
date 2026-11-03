<script lang="ts">
    /**
     * @desc 配置同步（独立弹窗）：由原「设置 → 配置导入导出」栏目升级而来，入口在设置弹窗标题栏。
     *
     * 与旧版面（纵向堆叠：范围 → 导出 → 导入）的区别，也是「更高效」的落点：
     *   - 左栏只放**勾选范围**：大类 / 分组 / 逐条全部展开为统一列表行，整行可点，选中态用半透明底色 + 右侧对勾表达；
     *   - 右栏一次只做一件事：`导出配置` / `导入配置` 分段切换，两者不再同时占滚动空间；
     *   - 导出侧把「文件名 / 版本 / 已选条数 / 两类占比」压成一张摘要行，主按钮紧邻其下；
     *   - 导入侧改为**拖放区 → 方式卡片 → 分组级预览 chip** 三步，仍保留「确认前不写任何配置」。
     * 选择粒度与写入语义完全沿用 `$lib/data/config`（key 集合是唯一真源），此处只重排交互。
     */
    import Icon from '@iconify/svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import Tabs from '$lib/components/ui/tabs.svelte'
    import Button from '$lib/components/ui/button.svelte'
    import { addToast } from '$lib/data/toast.svelte'
    import {
        CONFIG_CATEGORIES,
        CONFIG_GROUPS,
        ConfigParseError,
        configKeysOfCategory,
        configKeysOfGroup,
        countConfigEntriesByGroup,
        exportConfig,
        groupsOfCategory,
        importConfig,
        listConfigEntries,
        parseConfigFile,
        summarizeConfig,
        sumCountsByCategory,
        type ConfigGroup,
        type ParsedConfig
    } from '$lib/data/config'
    import { mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'
    import {
        IMPORT_MODES,
        areAllSelected,
        countExportedEntries,
        countSelected,
        exportFileName,
        parseImportMode,
        selectedCountOfCategory,
        withKeyToggled,
        withKeysSelected,
        type ImportMode
    } from './config-sync.utils'
    import { TAB_ACCENT } from './utils'

    interface Props extends ComponentsProps {
        open: boolean
        onclose: () => void
    }

    let { open, onclose, class: className, style: styleProp }: Props = $props()

    /** @desc 次要动作按钮规格（与设置弹窗内的行内动作钮同档） */
    const ACTION_BTN =
        'h-7 shrink-0 gap-1 rounded-none border border-(--theme-divider-border) px-2.5 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text) focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-(--theme-accent-bg)'
    const PRIMARY_BTN = 'h-8 justify-center gap-1.5 px-3 text-xs font-medium transition-all hover:brightness-110'
    const CARD_STYLE = 'border-color: var(--theme-divider-border); background: var(--theme-input-bg);'
    const CHECKBOX = 'size-4 shrink-0 accent-(--theme-accent-bg)'
    const ACTIVE_SURFACE = 'background: color-mix(in srgb, var(--theme-accent-bg) 8%, transparent);'
    /** @desc 侧栏统一的列表行：整行可点，勾选态只靠半透明底色 + 右侧对勾表达 */
    const SCOPE_ROW =
        'flex w-full items-center gap-2 sf-radius px-2 py-1.5 text-left transition-colors hover:bg-(--theme-modal-text)/5'
    const CATEGORY_ICONS: Record<string, string> = {
        settings: 'mdi:cog-outline',
        libraries: 'mdi:database-outline'
    }
    const GROUP_ICONS: Record<ConfigGroup, string> = {
        appearance: 'mdi:palette-outline',
        interaction: 'mdi:gesture-tap',
        data: 'mdi:database-outline',
        assistant: 'mdi:robot-outline',
        library: 'mdi:layers-outline'
    }

    /** @desc 全部登记项与「分组 → 条目」静态索引（模板里不再反复 filter） */
    const ALL_ENTRIES = listConfigEntries()
    const ENTRIES_BY_GROUP = new Map(
        CONFIG_GROUPS.map((g) => [g.id, ALL_ENTRIES.filter((e) => e.group === g.id)] as const)
    )
    const MODE_TABS = [
        { value: 'export', label: '导出配置' },
        { value: 'import', label: '导入配置' }
    ]
    const SETTINGS_TOTAL = configKeysOfCategory('settings').length
    const LIBRARIES_TOTAL = configKeysOfCategory('libraries').length

    let mode = $state<'export' | 'import'>('export')
    let includeApiKey = $state(false)
    let importMode = $state<ImportMode>('merge')
    /** @desc 参与导出 / 导入的 key 集合（单条粒度；大类 / 分组 / 快捷范围都只改这个集合） */
    let selectedKeys = $state<Set<string>>(new Set(ALL_ENTRIES.map((e) => e.key)))
    let counts = $state<Record<ConfigGroup, number>>(
        Object.fromEntries(CONFIG_GROUPS.map((g) => [g.id, 0])) as Record<ConfigGroup, number>
    )
    let busy = $state(false)
    let fileInput: HTMLInputElement | undefined = $state()
    let pending = $state<ParsedConfig | null>(null)
    let pendingFileName = $state('')
    let importError = $state<string | null>(null)
    let dragActive = $state(false)

    const refreshCounts = async () => {
        counts = await countConfigEntriesByGroup()
    }

    $effect(() => {
        if (open) void refreshCounts()
    })

    const selectedTotal = $derived(selectedKeys.size)
    const categoryCounts = $derived(sumCountsByCategory(counts))
    const settingsSelected = $derived(selectedCountOfCategory('settings', selectedKeys))
    const librariesSelected = $derived(selectedCountOfCategory('libraries', selectedKeys))
    const fileName = $derived(exportFileName())
    const summary = $derived(pending ? summarizeConfig(pending) : null)
    const legacyLine = $derived(
        pending
            ? pending.legacyVersion !== undefined
                ? `旧格式 v${pending.legacyVersion} 已自动升级`
                : `v${pending.version}`
            : ''
    )
    const previewCategories = $derived(
        (summary?.categories ?? []).map((cat) => ({
            ...cat,
            groups: cat.groups
                .map((g) => {
                    const known = g.entries.filter((e) => e.known)
                    return {
                        ...g,
                        selectable: known.length,
                        selectedCount: known.filter((e) => selectedKeys.has(e.key)).length
                    }
                })
                .filter((g) => g.entries.length > 0)
        }))
    )
    /** @desc 文件里「已勾选且可导入」的条目数（确认按钮文案与禁用判定用） */
    const importableCount = $derived(
        previewCategories.reduce((n, cat) => n + cat.groups.reduce((m, g) => m + g.selectedCount, 0), 0)
    )

    const selectedCountOfGroup = (group: ConfigGroup): number => countSelected(configKeysOfGroup(group), selectedKeys)

    /** @desc 批量勾选 / 取消（当前未全选则全选，已全选则全不选） */
    const toggleKeys = (keys: readonly string[]) => {
        selectedKeys = withKeysSelected(selectedKeys, keys, !areAllSelected(keys, selectedKeys))
    }

    const pickMode = (value: string) => {
        if (value === 'export' || value === 'import') mode = value
    }

    const pickImportMode = (value: string) => {
        const next = parseImportMode(value)
        if (next) importMode = next
    }

    const handleExport = async () => {
        if (busy) return
        busy = true
        try {
            const config = await exportConfig({ includeApiKey, keys: [...selectedKeys] })
            const written = countExportedEntries(config)
            if (written === 0) {
                addToast('所选配置项当前都没有已保存的值，导出文件为空', 'info')
                return
            }
            const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url
            anchor.download = fileName
            anchor.click()
            URL.revokeObjectURL(url)
            addToast(
                `配置已导出（${written} 条${config.skipped?.length ? `，已跳过：${config.skipped.join('、')}` : ''}）`,
                'success'
            )
        } finally {
            busy = false
        }
    }

    const cancelImport = () => {
        pending = null
        pendingFileName = ''
        importError = null
        dragActive = false
    }

    /** @desc 选文件只做解析与预览，真正写入要再点「确认导入」 */
    const loadFile = async (file: File) => {
        importError = null
        try {
            pending = parseConfigFile(await file.text())
            pendingFileName = file.name
        } catch (err) {
            cancelImport()
            importError = err instanceof ConfigParseError ? err.message : '文件读取失败'
            addToast(`导入失败：${importError}`, 'error')
        }
    }

    const handleFile = async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (fileInput) fileInput.value = ''
        if (file) await loadFile(file)
    }

    const handleDrop = async (e: DragEvent) => {
        e.preventDefault()
        dragActive = false
        const file = e.dataTransfer?.files?.[0]
        if (file) await loadFile(file)
    }

    const confirmImport = async () => {
        if (!pending || busy) return
        busy = true
        try {
            const result = await importConfig(pending, { mode: importMode, keys: [...selectedKeys] })
            await refreshCounts()
            addToast(
                `已导入 ${result.applied} 条配置${
                    result.unknownKeys.length ? `（忽略未登记项 ${result.unknownKeys.length} 个）` : ''
                }，刷新页面后完全生效`,
                'success'
            )
            cancelImport()
        } finally {
            busy = false
        }
    }
</script>

<Modal
    {open}
    {onclose}
    noScroll
    flush
    layer="nested"
    class={mergeClass(['h-[min(88vh,860px)] w-[min(96vw,1080px)]', className])}
    style={styleProp}
>
    {#snippet title()}
        <Icon icon="mdi:cog-sync-outline" class="size-4.5" style="color: var(--theme-accent-text);" />
        <span>配置同步</span>
    {/snippet}

    <div class="flex h-full min-h-0">
        <!-- ── 左：勾选范围（大类 / 分组 / 逐条）── -->
        <aside
            class="flex w-72 shrink-0 flex-col border-r"
            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
        >
            <div class="theme-scrollbar flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pt-3 pb-4">
                {#each CONFIG_CATEGORIES as cat (cat.id)}
                    {@const categoryKeys = configKeysOfCategory(cat.id)}
                    {@const categorySelected = countSelected(categoryKeys, selectedKeys)}
                    <div class="flex flex-col gap-1">
                        <button
                            type="button"
                            onclick={() => toggleKeys(categoryKeys)}
                            class={SCOPE_ROW}
                            style={categorySelected > 0 ? ACTIVE_SURFACE : ''}
                        >
                            <Icon
                                icon={CATEGORY_ICONS[cat.id]}
                                class="size-3.5 shrink-0 text-(--theme-modal-text)/55"
                            />
                            <span class="min-w-0 flex-1 truncate text-xs font-black tracking-tight">{cat.label}</span>
                            <span class="shrink-0 text-[10px] tabular-nums text-(--theme-modal-text)/40">
                                {categorySelected}/{categoryKeys.length}
                            </span>
                            {#if areAllSelected(categoryKeys, selectedKeys)}
                                <Icon
                                    icon="mdi:check"
                                    class="size-3.5 shrink-0"
                                    style="color: var(--theme-accent-text);"
                                />
                            {/if}
                        </button>

                        {#each groupsOfCategory(cat.id) as g (g.id)}
                            {@const groupKeys = configKeysOfGroup(g.id)}
                            {@const groupSelected = selectedCountOfGroup(g.id)}
                            <div class="ml-2 flex flex-col gap-1">
                                <button
                                    type="button"
                                    onclick={() => toggleKeys(groupKeys)}
                                    class={SCOPE_ROW}
                                    style={groupSelected > 0 ? ACTIVE_SURFACE : ''}
                                    title={`${g.desc} · 已存 ${counts[g.id]} 条`}
                                >
                                    <Icon
                                        icon={GROUP_ICONS[g.id]}
                                        class="size-3.5 shrink-0 text-(--theme-modal-text)/45"
                                    />
                                    <span class="min-w-0 flex-1 truncate text-xs text-(--theme-modal-text)/80">
                                        {g.label}
                                    </span>
                                    <span class="shrink-0 text-[10px] tabular-nums text-(--theme-modal-text)/35">
                                        {groupSelected}/{groupKeys.length}
                                    </span>
                                    {#if areAllSelected(groupKeys, selectedKeys)}
                                        <Icon
                                            icon="mdi:check"
                                            class="size-3.5 shrink-0"
                                            style="color: var(--theme-accent-text);"
                                        />
                                    {/if}
                                </button>

                                <div class="ml-4 flex flex-col gap-1">
                                    {#each ENTRIES_BY_GROUP.get(g.id) ?? [] as entry (entry.key)}
                                        <button
                                            type="button"
                                            onclick={() => (selectedKeys = withKeyToggled(selectedKeys, entry.key))}
                                            class={SCOPE_ROW}
                                            style={selectedKeys.has(entry.key) ? ACTIVE_SURFACE : ''}
                                            title={entry.key}
                                        >
                                            <span
                                                class="flex size-4 shrink-0 items-center justify-center border text-[9px] font-black text-(--theme-modal-text)/55"
                                                style="border-color: var(--theme-divider-border);"
                                                aria-hidden="true"
                                            >
                                                {entry.label.charAt(0)}
                                            </span>
                                            <span class="min-w-0 flex-1 truncate text-xs text-(--theme-modal-text)/70">
                                                {entry.label}
                                            </span>
                                            {#if selectedKeys.has(entry.key)}
                                                <Icon
                                                    icon="mdi:check"
                                                    class="size-3.5 shrink-0"
                                                    style="color: var(--theme-accent-text);"
                                                />
                                            {/if}
                                        </button>
                                    {/each}
                                </div>
                            </div>
                        {/each}
                    </div>
                {/each}
            </div>
        </aside>

        <!-- ── 右：一次只做一件事（导出 / 导入）── -->
        <section class="flex min-w-0 flex-1 flex-col">
            <div class="flex flex-wrap items-center gap-3 px-5 pt-4">
                <Tabs items={MODE_TABS} value={mode} onchange={pickMode} compact class="min-w-56" {...TAB_ACCENT} />
                <span class="min-w-0 flex-1 text-right text-[10px] tabular-nums text-(--theme-modal-text)/40">
                    设置 {settingsSelected}/{SETTINGS_TOTAL} · 本地库 {librariesSelected}/{LIBRARIES_TOTAL} · 已存 {categoryCounts.settings +
                        categoryCounts.libraries}
                </span>
            </div>

            <div class="theme-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {#if mode === 'export'}
                    <div class="flex flex-col gap-4">
                        <div class="flex items-start gap-3">
                            <div
                                class="flex size-11 shrink-0 items-center justify-center rounded-none border"
                                style={CARD_STYLE}
                            >
                                <Icon
                                    icon="mdi:file-code-outline"
                                    class="size-5"
                                    style="color: var(--theme-accent-text);"
                                />
                            </div>
                            <div class="min-w-0 flex-1">
                                <div class="truncate text-xs font-black tracking-tight">{fileName}</div>
                                <div
                                    class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-(--theme-modal-text)/45"
                                >
                                    <span>v2 JSON</span>
                                    <span class="text-(--theme-modal-text)/20">·</span>
                                    <span>已勾选 {selectedTotal}/{ALL_ENTRIES.length} 条</span>
                                    <span class="text-(--theme-modal-text)/20">·</span>
                                    <span>设置 {settingsSelected} · 本地库 {librariesSelected}</span>
                                </div>
                            </div>
                        </div>

                        <label
                            class="flex cursor-pointer items-start gap-2.5 rounded-none border px-2.5 py-2"
                            style={CARD_STYLE}
                        >
                            <input type="checkbox" bind:checked={includeApiKey} class={CHECKBOX} />
                            <span class="min-w-0 flex-1 text-xs text-(--theme-modal-text)/70">
                                包含 AI API Key
                                <span class="mt-0.5 block text-[10px] leading-4 text-(--theme-modal-text)/40">
                                    默认不导出；含密钥的文件请勿分享给他人
                                </span>
                            </span>
                        </label>

                        <div
                            class="rounded-none border px-2.5 py-2 text-[10px] leading-4 text-(--theme-modal-text)/40"
                            style={CARD_STYLE}
                        >
                            只写入<b class="font-black text-(--theme-modal-text)/60">已勾选且当前有保存值</b
                            >的条目；工程数据不在此范围，请用工程导出。
                        </div>

                        <Button
                            variant="icon-text"
                            size="none"
                            bare
                            keepDisabled
                            onclick={handleExport}
                            disabled={busy || selectedTotal === 0}
                            backgroundImage="var(--theme-accent-bg)"
                            textColor="var(--theme-accent-text-on-bg, #fff)"
                            class={mergeClass([PRIMARY_BTN, 'w-full'])}
                        >
                            <Icon icon="mdi:download-outline" class="size-3.5" />
                            导出为 JSON
                        </Button>
                    </div>
                {:else}
                    <div class="flex flex-col gap-3">
                        <input
                            type="file"
                            accept=".json,application/json"
                            class="hidden"
                            bind:this={fileInput}
                            onchange={handleFile}
                        />

                        {#if !pending}
                            <button
                                type="button"
                                onclick={() => fileInput?.click()}
                                ondragover={(e) => {
                                    e.preventDefault()
                                    dragActive = true
                                }}
                                ondragleave={() => (dragActive = false)}
                                ondrop={handleDrop}
                                class={mergeClass([
                                    'flex flex-col items-center justify-center gap-2 rounded-none border border-dashed px-4 py-8 transition-colors',
                                    dragActive
                                        ? 'border-(--theme-accent-bg)'
                                        : 'border-(--theme-divider-border) hover:border-(--theme-accent-bg)/60'
                                ])}
                                style={dragActive ? ACTIVE_SURFACE : 'background: var(--theme-input-bg);'}
                            >
                                <Icon
                                    icon="mdi:cloud-upload-outline"
                                    class="size-6"
                                    style="color: var(--theme-accent-text); opacity: 0.7;"
                                />
                                <span class="text-xs font-black">拖入 JSON 文件，或点击选择</span>
                                <span class="text-[10px] text-(--theme-modal-text)/40">
                                    选中后先预览；确认前不会写入任何配置
                                </span>
                            </button>
                        {:else}
                            <div class="flex items-center gap-2 rounded-none border px-2.5 py-2" style={CARD_STYLE}>
                                <Icon
                                    icon="mdi:file-document-outline"
                                    class="size-4 shrink-0"
                                    style="color: var(--theme-accent-text);"
                                />
                                <div class="min-w-0 flex-1">
                                    <div class="truncate text-xs font-black" title={pendingFileName}>
                                        {pendingFileName}
                                    </div>
                                    <div class="text-[10px] text-(--theme-modal-text)/40">
                                        {legacyLine} · {new Date(pending.exportedAt).toLocaleString('zh-CN', {
                                            hour12: false
                                        })} · 文件内 {summary?.count ?? 0} 项
                                    </div>
                                </div>
                                <button type="button" onclick={() => fileInput?.click()} class={ACTION_BTN}>
                                    换文件
                                </button>
                                <button type="button" onclick={cancelImport} class={ACTION_BTN}>取消</button>
                            </div>

                            <div class="grid grid-cols-2 gap-2">
                                {#each IMPORT_MODES as m (m.value)}
                                    <button
                                        type="button"
                                        onclick={() => (importMode = m.value)}
                                        class={mergeClass([
                                            'flex flex-col gap-1 rounded-none border px-2.5 py-2 text-left transition-colors',
                                            importMode === m.value
                                                ? 'border-(--theme-accent-bg)'
                                                : 'border-(--theme-divider-border) hover:border-(--theme-accent-bg)/50'
                                        ])}
                                        style={importMode === m.value
                                            ? ACTIVE_SURFACE
                                            : 'background: var(--theme-input-bg);'}
                                    >
                                        <span class="flex items-center gap-1.5 text-xs font-black">
                                            <Icon
                                                icon={m.icon}
                                                class="size-3.5"
                                                style="color: var(--theme-accent-text);"
                                            />
                                            {m.label}
                                        </span>
                                        <span class="text-[10px] leading-4 text-(--theme-modal-text)/45">{m.desc}</span>
                                    </button>
                                {/each}
                            </div>

                            <div class="rounded-none border" style={CARD_STYLE}>
                                <div
                                    class="flex flex-wrap items-center gap-x-2 border-b px-2.5 py-1.5 text-[10px] text-(--theme-modal-text)/45"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    <span class="font-black text-(--theme-modal-text)/70">
                                        将导入 {importableCount} 条
                                    </span>
                                    <span class="text-(--theme-modal-text)/20">·</span>
                                    <span>范围 = 左侧已勾选的 {selectedTotal} 条</span>
                                    {#if summary && summary.unknownKeys.length > 0}
                                        <span class="ml-auto text-amber-400/80"
                                            >忽略未登记项 {summary.unknownKeys.length} 个</span
                                        >
                                    {/if}
                                </div>
                                <div class="space-y-1.5 px-2.5 py-2">
                                    {#each previewCategories as cat (cat.id)}
                                        <div class="flex flex-wrap items-center gap-1">
                                            <span
                                                class="mr-1 w-12 shrink-0 text-[10px] font-black tracking-tight text-(--theme-modal-text)/70"
                                                >{cat.label}</span
                                            >
                                            {#each cat.groups as g (g.id)}
                                                {@const none = g.selectedCount === 0}
                                                {@const partial = !none && g.selectedCount < g.selectable}
                                                <span
                                                    class="rounded-none border px-1.5 py-0.5 text-[10px] {none
                                                        ? 'border-(--theme-divider-border) text-(--theme-modal-text)/25 line-through'
                                                        : partial
                                                          ? 'border-amber-400/30 text-amber-400/80'
                                                          : 'border-(--theme-accent-bg)/45 text-(--theme-modal-text)/70'}"
                                                    title={none ? '未勾选，不会导入' : `命中 ${g.selectedCount} 条`}
                                                >
                                                    {g.label}
                                                    <b class="ml-1 font-black tabular-nums"
                                                        >{g.selectedCount}/{g.selectable}</b
                                                    >
                                                </span>
                                            {/each}
                                        </div>
                                    {/each}
                                    {#if summary && summary.unknownKeys.length > 0}
                                        <div class="pt-1 text-[10px] leading-4 text-amber-400/70">
                                            未登记的键会忽略：{summary.unknownKeys.join('、')}
                                        </div>
                                    {/if}
                                </div>
                            </div>

                            {#if importableCount === 0}
                                <div class="text-[10px] text-amber-400/80">
                                    文件里没有落在当前勾选范围内的条目：先在左侧调整传输范围，或换一个文件。
                                </div>
                            {/if}

                            <div class="flex items-center gap-2">
                                <Button
                                    variant="icon-text"
                                    size="none"
                                    bare
                                    keepDisabled
                                    onclick={confirmImport}
                                    disabled={busy || importableCount === 0}
                                    backgroundImage="var(--theme-accent-bg)"
                                    textColor="var(--theme-accent-text-on-bg, #fff)"
                                    class={PRIMARY_BTN}
                                >
                                    <Icon icon="mdi:check" class="size-3.5" />
                                    确认导入（{importableCount} 条）
                                </Button>
                                <Button
                                    variant="text"
                                    size="none"
                                    bare
                                    keepDisabled
                                    onclick={cancelImport}
                                    disabled={busy}
                                    class={ACTION_BTN}
                                >
                                    取消
                                </Button>
                            </div>
                        {/if}

                        {#if importError}
                            <div
                                class="flex items-start gap-1.5 rounded-none border px-2.5 py-1.5 text-[10px] text-red-400"
                                style="border-color: color-mix(in srgb, red 40%, transparent); background: color-mix(in srgb, red 8%, transparent);"
                            >
                                <Icon icon="mdi:alert-circle-outline" class="mt-px size-3.5 shrink-0" />
                                <span class="min-w-0 flex-1">{importError}</span>
                            </div>
                        {/if}
                    </div>
                {/if}
            </div>
        </section>
    </div>
</Modal>
