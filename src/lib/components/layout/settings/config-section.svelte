<script lang="ts">
    /** @desc 设置 → 配置：把全部设置偏好导出为 JSON / 从 JSON 导入（一切皆「配置」）。
     *  支持勾选分组与「是否包含 API Key」；导入可选「合并」或「覆盖」。 */
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import {
        CONFIG_GROUPS,
        ConfigParseError,
        countConfigEntriesByGroup,
        exportConfig,
        importConfig,
        listConfigEntries,
        parseConfigFile,
        readConfigEntry,
        writeConfigEntry,
        type ConfigGroup
    } from '$lib/data/config'
    import { addToast } from '$lib/data/toast.svelte'

    interface Props extends ComponentsProps {}
    let { class: className, style: styleProp }: Props = $props()

    let includeApiKey = $state(false)
    let importMode = $state<'merge' | 'replace'>('merge')
    /** @desc 仅导入这些分组（缺省=全部） */
    let selectedGroups = $state<Set<ConfigGroup>>(new Set(CONFIG_GROUPS.map((g) => g.id)))
    let counts = $state<Record<ConfigGroup, number>>({
        appearance: 0,
        interaction: 0,
        data: 0,
        assistant: 0,
        library: 0
    })
    let busy = $state(false)
    let fileInput: HTMLInputElement | undefined = $state()

    const refreshCounts = async () => {
        counts = await countConfigEntriesByGroup()
    }
    refreshCounts()

    const toggleGroup = (id: ConfigGroup) => {
        const next = new Set(selectedGroups)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        selectedGroups = next
    }

    const selectedList = $derived([...selectedGroups])

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
                `配置已导出（${config.skipped?.length ? `已跳过：${config.skipped.join('、')}` : '含所选分组'}）`,
                'success'
            )
        } finally {
            busy = false
        }
    }

    const handleFile = async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) return
        try {
            const text = await file.text()
            const config = parseConfigFile(text)
            const result = await importConfig(config, { mode: importMode, groups: selectedList })
            await refreshCounts()
            addToast(
                `已导入 ${result.applied} 项配置${result.unknownKeys.length ? `（忽略未知项 ${result.unknownKeys.length} 个）` : ''}，刷新页面后完全生效`,
                'success'
            )
        } catch (err) {
            addToast(err instanceof ConfigParseError ? `导入失败：${err.message}` : '导入失败：文件读取失败', 'error')
        }
        if (fileInput) fileInput.value = ''
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
            全部设置偏好（外观 / 交互 / 数据 / AI 助手 / 本地库）统一看作一份「配置」，可导出为 JSON 备份或跨设备搬运，
            也可以从 JSON 导入回来。工程数据不在配置范围内（请用工程导出）。
        </div>
    </div>

    <!-- 分组勾选 -->
    <div class="space-y-1.5">
        {#each CONFIG_GROUPS as g (g.id)}
            <div class="border" style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);">
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
                    <span class="shrink-0 text-[10px] tabular-nums text-(--theme-modal-text)/40">{counts[g.id]} 项</span
                    >
                    <button
                        onclick={() => toggleGroupDetail(g.id)}
                        class="shrink-0 rounded-none p-1 text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)"
                        title="查看该分组当前的配置项"
                    >
                        <Icon icon={expandedGroup === g.id ? 'mdi:chevron-up' : 'mdi:chevron-down'} class="size-3.5" />
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
        <p class="text-[10px] text-(--theme-modal-text)/40">
            导入只影响上方已勾选的分组；导入完成后建议刷新页面，让各 store 重新读取配置。
        </p>
    </div>
</div>
