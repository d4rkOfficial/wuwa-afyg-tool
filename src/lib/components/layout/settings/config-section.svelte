<script lang="ts">
    /** @desc 设置 → 配置：把全部配置导出为 JSON / 从 JSON 导入（一切皆「配置」）。
     *  配置文件分「设置」（外观 / 交互 / 数据 / AI 助手偏好）与「本地库」（Buff 集 / 词条方案 / 自定义技能）
     *  两大类，两类下都可逐分组勾选；导入前先预览「文件里有什么」，再选「合并」或「覆盖」确认导入。 */
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import {
        CONFIG_CATEGORIES,
        CONFIG_GROUPS,
        ConfigParseError,
        countConfigEntriesByGroup,
        exportConfig,
        groupsOfCategory,
        importConfig,
        listConfigEntries,
        parseConfigFile,
        readConfigEntry,
        summarizeConfig,
        sumCountsByCategory,
        writeConfigEntry,
        type ConfigCategory,
        type ConfigGroup,
        type ParsedConfig
    } from '$lib/data/config'
    import { addToast } from '$lib/data/toast.svelte'

    interface Props extends ComponentsProps {}
    let { class: className, style: styleProp }: Props = $props()

    let includeApiKey = $state(false)
    let importMode = $state<'merge' | 'replace'>('merge')
    /** @desc 参与导出 / 导入的分组（缺省=全部；两大类只是展示上的归类） */
    let selectedGroups = $state<Set<ConfigGroup>>(new Set(CONFIG_GROUPS.map((g) => g.id)))
    let counts = $state<Record<ConfigGroup, number>>(
        Object.fromEntries(CONFIG_GROUPS.map((g) => [g.id, 0])) as Record<ConfigGroup, number>
    )
    let busy = $state(false)
    let fileInput: HTMLInputElement | undefined = $state()
    /** @desc 已解析、待确认的导入文件（确认前不写入任何配置） */
    let pending = $state<ParsedConfig | null>(null)
    let pendingFileName = $state('')
    let importError = $state<string | null>(null)

    const refreshCounts = async () => {
        counts = await countConfigEntriesByGroup()
    }
    refreshCounts()

    const selectedList = $derived([...selectedGroups])
    const categoryCounts = $derived(sumCountsByCategory(counts))
    const summary = $derived(pending ? summarizeConfig(pending) : null)
    /** @desc 预览用：文件里各类别/分组的条目 + 该分组是否被勾选（未勾选则不会导入） */
    const previewCategories = $derived(
        (summary?.categories ?? []).map((cat) => ({
            ...cat,
            groups: cat.groups.map((g) => ({ ...g, selected: selectedGroups.has(g.id as ConfigGroup) }))
        }))
    )

    const categoryGroupIds = (id: ConfigCategory): ConfigGroup[] => groupsOfCategory(id).map((g) => g.id)
    const isCategorySelected = (id: ConfigCategory): boolean => categoryGroupIds(id).every((g) => selectedGroups.has(g))
    const selectedOfCategory = (id: ConfigCategory): number =>
        categoryGroupIds(id).filter((g) => selectedGroups.has(g)).length

    const toggleGroup = (id: ConfigGroup) => {
        const next = new Set(selectedGroups)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        selectedGroups = next
    }

    /** @desc 整类全选 / 全不选（两类各自一档，避免逐分组点） */
    const toggleCategory = (id: ConfigCategory) => {
        const ids = categoryGroupIds(id)
        const next = new Set(selectedGroups)
        if (ids.every((g) => next.has(g))) ids.forEach((g) => next.delete(g))
        else ids.forEach((g) => next.add(g))
        selectedGroups = next
    }

    const handleExport = async () => {
        if (busy) return
        busy = true
        try {
            const config = await exportConfig({ includeApiKey, groups: selectedList })
            const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `椰果工具箱-配置-${new Date().toISOString().slice(0, 10)}.json`
            a.click()
            URL.revokeObjectURL(url)
            addToast(
                `配置已导出（${selectedList.length} 个分组${
                    config.skipped?.length ? `，已跳过：${config.skipped.join('、')}` : ''
                }）`,
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
    }

    /** @desc 选文件只做解析与预览，真正写入要再点「确认导入」 */
    const handleFile = async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (fileInput) fileInput.value = ''
        if (!file) return
        importError = null
        try {
            const config = parseConfigFile(await file.text())
            pending = config
            pendingFileName = file.name
        } catch (err) {
            cancelImport()
            importError = err instanceof ConfigParseError ? err.message : '文件读取失败'
            addToast(`导入失败：${importError}`, 'error')
        }
    }

    const confirmImport = async () => {
        if (!pending || busy) return
        busy = true
        try {
            const result = await importConfig(pending, { mode: importMode, groups: selectedList })
            await refreshCounts()
            addToast(
                `已导入 ${result.applied} 项配置${
                    result.unknownKeys.length ? `（忽略未登记项 ${result.unknownKeys.length} 个）` : ''
                }，刷新页面后完全生效`,
                'success'
            )
            cancelImport()
        } finally {
            busy = false
        }
    }

    /** @desc 分组内逐项重置为默认（删除存储键） */
    const resetGroup = async (group: ConfigGroup) => {
        for (const entry of listConfigEntries()) {
            if (entry.group !== group) continue
            await writeConfigEntry(entry, undefined)
        }
        await refreshCounts()
        addToast(`已重置「${CONFIG_GROUPS.find((g) => g.id === group)?.label}」分组，刷新后生效`, 'info')
    }

    /** @desc 列出某分组下当前有值的配置项（供展开查看） */
    let expandedGroup = $state<ConfigGroup | null>(null)
    let groupEntries = $state<{ key: string; label: string }[]>([])
    const toggleGroupDetail = async (group: ConfigGroup) => {
        if (expandedGroup === group) {
            expandedGroup = null
            return
        }
        const found: { key: string; label: string }[] = []
        for (const entry of listConfigEntries()) {
            if (entry.group !== group) continue
            const value = await readConfigEntry(entry)
            if (value !== undefined) found.push({ key: entry.key, label: entry.label })
        }
        groupEntries = found
        expandedGroup = group
    }
</script>

<div class={['space-y-3', className].join(' ')} style={styleProp}>
    <div class="flex items-start gap-2">
        <Icon icon="mdi:cog-sync-outline" class="mt-0.5 size-4 shrink-0" style="color: var(--theme-accent-text);" />
        <div class="text-xs leading-relaxed text-(--theme-modal-text)/60">
            全部配置分成「<span class="font-black">设置</span>」（外观 / 交互 / 数据 / AI 助手偏好）与「<span
                class="font-black">本地库</span
            >」（Buff 集 / 词条方案与标准词条集 / 自定义技能）两大类，可导出为 JSON 备份或跨设备搬运，也可以从 JSON
            导入回来；旧版导出文件同样可以导入。工程数据不在配置范围内（请用工程导出）。
        </div>
    </div>

    <!-- 两大类 → 分组勾选 -->
    <div class="space-y-4">
        {#each CONFIG_CATEGORIES as cat (cat.id)}
            <div class="space-y-1.5">
                <div class="flex items-center gap-2 border-b pb-1.5" style="border-color: var(--theme-divider-border);">
                    <input
                        type="checkbox"
                        checked={isCategorySelected(cat.id)}
                        onchange={() => toggleCategory(cat.id)}
                        class="size-4 shrink-0"
                        style="accent-color: var(--theme-accent-bg, #6366f1)"
                    />
                    <div class="min-w-0 flex-1">
                        <span class="text-xs font-black tracking-tight">{cat.label}</span>
                        <span class="ml-2 text-[10px] text-(--theme-modal-text)/40">{cat.desc}</span>
                    </div>
                    <span class="shrink-0 text-[10px] tabular-nums text-(--theme-modal-text)/40">
                        {selectedOfCategory(cat.id)}/{categoryGroupIds(cat.id).length} 组 · {categoryCounts[cat.id]} 项
                    </span>
                </div>
                {#each groupsOfCategory(cat.id) as g (g.id)}
                    <div
                        class="border"
                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                    >
                        <div class="flex items-center gap-2 px-2.5 py-2">
                            <input
                                type="checkbox"
                                checked={selectedGroups.has(g.id)}
                                onchange={() => toggleGroup(g.id)}
                                class="size-4 shrink-0"
                                style="accent-color: var(--theme-accent-bg, #6366f1)"
                            />
                            <div class="min-w-0 flex-1">
                                <div class="text-xs font-black tracking-tight">{g.label}</div>
                                <div class="text-[10px] text-(--theme-modal-text)/40">{g.desc}</div>
                            </div>
                            <span class="shrink-0 text-[10px] tabular-nums text-(--theme-modal-text)/40"
                                >{counts[g.id]} 项</span
                            >
                            <button
                                onclick={() => toggleGroupDetail(g.id)}
                                class="shrink-0 rounded-none p-1 text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)"
                                title="查看该分组当前的配置项"
                            >
                                <Icon
                                    icon={expandedGroup === g.id ? 'mdi:chevron-up' : 'mdi:chevron-down'}
                                    class="size-3.5"
                                />
                            </button>
                            <button
                                onclick={() => resetGroup(g.id)}
                                class="shrink-0 rounded-none px-1.5 py-0.5 text-[10px] text-(--theme-modal-text)/45 transition-colors hover:text-red-400"
                                title="清空该分组的全部配置项（回到默认）"
                            >
                                重置
                            </button>
                        </div>
                        {#if expandedGroup === g.id}
                            <div
                                class="space-y-0.5 border-t px-2.5 py-1.5 text-[10px] text-(--theme-modal-text)/50"
                                style="border-color: var(--theme-divider-border);"
                            >
                                {#each groupEntries as e (e.key)}
                                    <div class="truncate">· {e.label} <span class="opacity-40">{e.key}</span></div>
                                {/each}
                                {#if groupEntries.length === 0}
                                    <div class="text-(--theme-modal-text)/30">该分组暂无已保存的配置项</div>
                                {/if}
                            </div>
                        {/if}
                    </div>
                {/each}
            </div>
        {/each}
    </div>

    <!-- 导出 -->
    <div class="space-y-2 border p-2.5" style="border-color: var(--theme-divider-border);">
        <div class="text-xs font-black tracking-tight">导出配置</div>
        <label class="flex cursor-pointer items-center gap-2 text-[11px] text-(--theme-modal-text)/60">
            <input
                type="checkbox"
                bind:checked={includeApiKey}
                class="size-4 shrink-0"
                style="accent-color: var(--theme-accent-bg, #6366f1)"
            />
            包含 AI API Key（默认不包含，避免明文外泄）
        </label>
        <button
            onclick={handleExport}
            disabled={busy || selectedGroups.size === 0}
            class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-black transition-all hover:brightness-110 disabled:pointer-events-none disabled:opacity-40"
            style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
        >
            <Icon icon="mdi:download-outline" class="size-3.5" />
            导出为 JSON
        </button>
        <p class="text-[10px] text-(--theme-modal-text)/40">
            导出文件为 v2 格式：顶层按「设置（settings）」「本地库（libraries）」两类分开，各类下再按分组存放。
        </p>
    </div>

    <!-- 导入 -->
    <div class="space-y-2 border p-2.5" style="border-color: var(--theme-divider-border);">
        <div class="text-xs font-black tracking-tight">导入配置</div>
        <div class="flex items-center gap-1.5 text-[11px]">
            <span class="text-(--theme-modal-text)/50">导入方式</span>
            {#each [['merge', '合并（只覆盖文件里有的项）'], ['replace', '覆盖（未出现的项清空）']] as [key, label]}
                <button
                    onclick={() => (importMode = key as 'merge' | 'replace')}
                    class="border px-1.5 py-0.5 transition-colors"
                    style={importMode === key
                        ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff); border-color: transparent;'
                        : 'background: var(--theme-card-bg); color: color-mix(in srgb, var(--theme-modal-text) 60%, transparent); border-color: var(--theme-divider-border);'}
                >
                    {label}
                </button>
            {/each}
        </div>
        <p class="text-[10px] text-(--theme-modal-text)/40">
            {importMode === 'replace'
                ? '覆盖：已勾选分组中，文件里没有的项会被清空（回到默认）'
                : '合并：只覆盖文件里出现的项，其余保持现状'}
        </p>
        <input type="file" accept=".json,application/json" class="hidden" bind:this={fileInput} onchange={handleFile} />
        <button
            onclick={() => fileInput?.click()}
            disabled={busy || selectedGroups.size === 0}
            class="flex items-center gap-1.5 border px-3 py-1.5 text-xs font-black transition-colors hover:border-(--theme-accent-bg) disabled:pointer-events-none disabled:opacity-40"
            style="border-color: var(--theme-divider-border); color: var(--theme-modal-text);"
        >
            <Icon icon="mdi:upload-outline" class="size-3.5" />
            选择配置文件
        </button>

        {#if importError}
            <div
                class="flex items-start gap-1.5 border px-2 py-1.5 text-[10px] text-red-400"
                style="border-color: color-mix(in srgb, red 40%, transparent); background: color-mix(in srgb, red 8%, transparent);"
            >
                <Icon icon="mdi:alert-circle-outline" class="mt-px size-3.5 shrink-0" />
                <span class="min-w-0 flex-1">{importError}</span>
            </div>
        {/if}

        {#if pending && summary}
            <!-- 文件里有什么 / 将导入什么 -->
            <div
                class="space-y-2 border p-2.5"
                style="border-color: var(--theme-accent-bg); background: color-mix(in srgb, var(--theme-accent-bg) 6%, transparent);"
            >
                <div class="flex items-center gap-2 text-[11px] font-black">
                    <Icon icon="mdi:file-document-outline" class="size-3.5 shrink-0" />
                    <span class="min-w-0 flex-1 truncate" title={pendingFileName}>{pendingFileName}</span>
                    <span class="shrink-0 text-[10px] font-normal text-(--theme-modal-text)/50">
                        {pending.legacyVersion !== undefined
                            ? `旧格式 v${pending.legacyVersion} → 已按新格式解析`
                            : `v${pending.version}`}
                    </span>
                </div>
                <div class="text-[10px] text-(--theme-modal-text)/45">
                    导出时间 {new Date(pending.exportedAt).toLocaleString()} · 文件内共 {summary.count} 项
                    {#if pending.skipped?.length}
                        · 导出时跳过：{pending.skipped.join('、')}
                    {/if}
                </div>

                {#each previewCategories as cat (cat.id)}
                    <div class="space-y-1">
                        <div class="text-[10px] font-black tracking-tight text-(--theme-modal-text)/70">
                            {cat.label} · {cat.count} 项
                        </div>
                        {#if cat.groups.length === 0}
                            <div class="px-1 text-[10px] text-(--theme-modal-text)/30">文件里没有这一类</div>
                        {:else}
                            {#each cat.groups as g (g.id)}
                                <div
                                    class="border px-2 py-1"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    <div class="flex items-center gap-2">
                                        <span class="text-[10px] font-medium text-(--theme-modal-text)/70"
                                            >{g.label}</span
                                        >
                                        <span class="text-[10px] tabular-nums text-(--theme-modal-text)/35"
                                            >{g.entries.length} 项</span
                                        >
                                        {#if !g.selected}
                                            <span class="text-[10px] text-amber-400/80">未勾选，不会导入</span>
                                        {/if}
                                    </div>
                                    <div class="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
                                        {#each g.entries as e (e.key)}
                                            <span
                                                class="text-[10px] {e.known
                                                    ? 'text-(--theme-modal-text)/50'
                                                    : 'text-amber-400/80'}"
                                            >
                                                {e.known ? e.label : `${e.key}（未登记，忽略）`}
                                            </span>
                                        {/each}
                                    </div>
                                </div>
                            {/each}
                        {/if}
                    </div>
                {/each}

                {#if summary.unknownKeys.length}
                    <div class="text-[10px] text-amber-400/80">
                        文件中有 {summary.unknownKeys.length} 个未登记的键（导入时忽略）：{summary.unknownKeys.join(
                            '、'
                        )}
                    </div>
                {/if}

                <div class="flex items-center gap-2">
                    <button
                        onclick={confirmImport}
                        disabled={busy || summary.count === 0}
                        class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-black transition-all hover:brightness-110 disabled:pointer-events-none disabled:opacity-40"
                        style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                    >
                        <Icon icon="mdi:check" class="size-3.5" />
                        确认导入（{selectedList.length} 个分组）
                    </button>
                    <button
                        onclick={cancelImport}
                        disabled={busy}
                        class="border px-3 py-1.5 text-xs font-black transition-colors disabled:pointer-events-none disabled:opacity-40"
                        style="border-color: var(--theme-divider-border); color: var(--theme-modal-text);"
                    >
                        取消
                    </button>
                </div>
            </div>
        {/if}

        <p class="text-[10px] text-(--theme-modal-text)/40">
            导入只影响上方已勾选的分组；导入完成后建议刷新页面，让各 store 重新读取配置。
        </p>
    </div>
</div>
