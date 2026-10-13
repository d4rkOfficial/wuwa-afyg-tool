<script lang="ts">
    /** @desc 设置 → 配置：把全部配置导出为 JSON / 从 JSON 导入（一切皆「配置」）。
     *  配置文件分「设置」（外观 / 交互 / 数据 / AI 助手偏好）与「本地库」（Buff 集 / 词条方案 / 自定义技能）
     *  两大类；**勾选粒度到单条配置项**（展开分组逐条勾选），大类 / 分组勾选只是聚合快捷方式。
     *  导入前先预览「文件里有什么」，再选「合并」或「覆盖」确认导入。
     *
     *  UI 整改（本次，**不动任何勾选 / 导入导出语义**）：
     *   ① 本页此前有两个标题（`sections/config.svelte` 的「配置导入导出」+ 本组件自己的图标说明行），
     *      现由本组件独占一个 `ui/section-title`，外壳只当容器；
     *   ② 三块内容（选择范围 / 导出 / 导入）统一为「SectionTitle + 说明 + 卡片」，不再混用
     *      `text-xs font-black` 手写标题与 `text-[10px]` 随手标注；
     *   ③ 按钮从「原生 button 与 `ui/Button` 混用」收敛为同一族规格；复选框统一 `size-4` +
     *      `accent-(--theme-accent-bg)` 类（原先逐处内联 `accent-color`）；
     *   ④ 逐条勾选从单列长列表改为窄屏单列 / 宽屏双列，条目标签与键名分色；
     *   ⑤ 预览块的表头、分组、状态标记统一为「卡片 + 标签」两级，不再每行各写一套字号。
     */
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import SectionTitle from '$lib/components/ui/section-title.svelte'
    import Tabs from '$lib/components/ui/tabs.svelte'
    import Button from '$lib/components/ui/button.svelte'
    import { slide } from 'svelte/transition'
    import { MOTION_MS, slideParams } from '$lib/utils/motion'
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
        readConfigEntry,
        summarizeConfig,
        sumCountsByCategory,
        writeConfigEntry,
        type ConfigGroup,
        type ParsedConfig
    } from '$lib/data/config'
    import { addToast } from '$lib/data/toast.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import { TAB_ACCENT } from './utils'

    interface Props extends ComponentsProps {}
    let { class: className, style: styleProp }: Props = $props()

    /** @desc 次要动作按钮的统一规格（与设置内其它行内动作钮同档；`bare` 档的 `ui/Button` 不带焦点层，故自带 outline） */
    const ACTION_BTN =
        'h-7 shrink-0 gap-1 rounded-none border border-(--theme-divider-border) px-2.5 text-xs text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text) focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-(--theme-accent-bg)'

    /** @desc 卡片表面（三块内容共用；原先每块各写一遍内联 border/background） */
    const CARD_SURFACE = 'sf-radius rounded-none border'
    const CARD_STYLE = 'border-color: var(--theme-divider-border); background: var(--theme-input-bg);'

    /** @desc 复选框统一规格（三态仍由 `use:triState` 写入 DOM 属性） */
    const CHECKBOX = 'size-4 shrink-0 accent-(--theme-accent-bg)'

    /** @desc 全部登记项（大类 / 分组勾选都是它的聚合视图；导出 / 导入的真源是 key 集合） */
    const ALL_ENTRIES = listConfigEntries()
    /** @desc 分组 → 该组登记项（静态表，避免模板里反复 filter） */
    const ENTRIES_BY_GROUP = new Map(
        CONFIG_GROUPS.map((g) => [g.id, ALL_ENTRIES.filter((e) => e.group === g.id)] as const)
    )

    let includeApiKey = $state(false)
    let importMode = $state<'merge' | 'replace'>('merge')

    /**
     * @desc 导入方式（T15：原来是两个手搓分段按钮，与「导入方式」标签同一行）。
     * 改成 `ui/tabs` 的文字 tab 后标签独占一行、分段满宽（两段等宽 → 指示块无需测量即可对齐）；
     * 文案与下方随选择变化的那句说明都原样保留，取值仍是 `'merge' | 'replace'`。
     */
    const IMPORT_MODE_TABS = [
        { value: 'merge', label: '合并（只覆盖文件里有的项）' },
        { value: 'replace', label: '覆盖（未出现的项清空）' }
    ]
    const pickImportMode = (value: string) => {
        if (value === 'merge' || value === 'replace') importMode = value
    }
    /** @desc 参与导出 / 导入的配置项 key（**粒度到单条**；大类 / 分组开关只批量增删这个集合） */
    let selectedKeys = $state<Set<string>>(new Set(ALL_ENTRIES.map((e) => e.key)))
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

    // ── 选择模型：key 集合 → 分组 / 大类的聚合视图 ──
    const selectedList = $derived([...selectedKeys])
    const categoryCounts = $derived(sumCountsByCategory(counts))
    const summary = $derived(pending ? summarizeConfig(pending) : null)
    /** @desc 预览用：文件里各类别 / 分组的条目 + 逐条是否被勾选（未勾选则不会导入） */
    const previewCategories = $derived(
        (summary?.categories ?? []).map((cat) => ({
            ...cat,
            groups: cat.groups.map((g) => {
                const known = g.entries.filter((e) => e.known)
                return {
                    ...g,
                    entries: g.entries.map((e) => ({ ...e, selected: selectedKeys.has(e.key) })),
                    knownCount: known.length,
                    selectedCount: known.filter((e) => selectedKeys.has(e.key)).length
                }
            })
        }))
    )

    const selectedCountOf = (keys: readonly string[]): number => keys.filter((k) => selectedKeys.has(k)).length
    const isAllSelected = (keys: readonly string[]): boolean => keys.length > 0 && selectedCountOf(keys) === keys.length
    /** @desc 部分选中（既非全选也非全不选）：用于复选框三态 */
    const isPartiallySelected = (keys: readonly string[]): boolean => {
        const n = selectedCountOf(keys)
        return n > 0 && n < keys.length
    }

    /**
     * @desc 复选框三态：`indeterminate` 不是 HTML 属性，只能写成 DOM 属性。
     * 用 action 而不是 `bind:` —— 后者要求每个分组再建一份可写状态，纯属重复。
     */
    const triState = (node: HTMLInputElement, value: boolean) => {
        node.indeterminate = value
        return { update: (next: boolean) => (node.indeterminate = next) }
    }

    /** @desc 批量勾选 / 取消一批 key（`on` 省略时：当前未全选则全选，已全选则全不选） */
    const toggleKeys = (keys: readonly string[], on?: boolean) => {
        const target = on ?? !isAllSelected(keys)
        const next = new Set(selectedKeys)
        for (const k of keys) {
            if (target) next.add(k)
            else next.delete(k)
        }
        selectedKeys = next
    }

    const handleExport = async () => {
        if (busy) return
        busy = true
        try {
            const config = await exportConfig({ includeApiKey, keys: selectedList })
            const written = Object.values({ ...config.settings, ...config.libraries }).reduce(
                (n, bucket) => n + Object.keys(bucket).length,
                0
            )
            if (written === 0) {
                addToast('所选配置项当前都没有已保存的值，导出文件为空', 'info')
                return
            }
            const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `椰果工具箱-配置-${new Date().toISOString().slice(0, 10)}.json`
            a.click()
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
            const result = await importConfig(pending, { mode: importMode, keys: selectedList })
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

    /** @desc 分组内逐项重置为默认（删除存储键） */
    const resetGroup = async (group: ConfigGroup) => {
        for (const entry of listConfigEntries()) {
            if (entry.group !== group) continue
            await writeConfigEntry(entry, undefined)
        }
        await refreshCounts()
        addToast(`已重置「${CONFIG_GROUPS.find((g) => g.id === group)?.label}」分组，刷新后生效`, 'info')
    }

    /** @desc 展开的分组（懒读一次：该组里哪些条目当前有值，用于标「已保存」） */
    let expandedGroup = $state<ConfigGroup | null>(null)
    let savedKeys = $state<Set<string>>(new Set())
    const toggleGroupDetail = async (group: ConfigGroup) => {
        if (expandedGroup === group) {
            expandedGroup = null
            return
        }
        const saved = new Set<string>()
        for (const entry of listConfigEntries()) {
            if (entry.group !== group) continue
            if ((await readConfigEntry(entry)) !== undefined) saved.add(entry.key)
        }
        savedKeys = saved
        expandedGroup = group
    }
</script>

<div class={mergeClass(['flex flex-col gap-5', className])} style={styleProp}>
    <div>
        <SectionTitle>
            <Icon icon="mdi:cog-sync-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            配置导入导出
        </SectionTitle>
        <p class="text-[10px] leading-4 text-(--theme-modal-text)/40">
            勾选要处理的条目，导出成 JSON 备份或从 JSON 导入；导入前会先预览文件内容。工程数据不在此范围，请用工程导出。
        </p>
    </div>

    <!-- ── 选择范围：大类 → 分组 → 单条配置项 ── -->
    <div>
        <div class="mb-2 flex items-baseline justify-between gap-2">
            <span class="text-xs font-black tracking-tight">选择条目</span>
            <span class="shrink-0 text-[10px] tabular-nums text-(--theme-modal-text)/40">
                已勾选 {selectedKeys.size}/{ALL_ENTRIES.length} 条
            </span>
        </div>

        <div class="flex flex-col gap-4">
            {#each CONFIG_CATEGORIES as cat (cat.id)}
                <div class="flex flex-col gap-1.5">
                    <!-- 大类行 -->
                    <div
                        class="flex items-center gap-2 border-b pb-1.5"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <input
                            type="checkbox"
                            use:triState={isPartiallySelected(configKeysOfCategory(cat.id))}
                            checked={isAllSelected(configKeysOfCategory(cat.id))}
                            onchange={() => toggleKeys(configKeysOfCategory(cat.id))}
                            class={CHECKBOX}
                        />
                        <div class="flex min-w-0 flex-1 items-baseline gap-2">
                            <span class="text-xs font-black tracking-tight">{cat.label}</span>
                            <span class="truncate text-[10px] text-(--theme-modal-text)/40">{cat.desc}</span>
                        </div>
                        <span class="shrink-0 text-[10px] tabular-nums text-(--theme-modal-text)/40">
                            已选 {selectedCountOf(configKeysOfCategory(cat.id))}/{configKeysOfCategory(cat.id).length}
                            · 已保存 {categoryCounts[cat.id]}
                        </span>
                    </div>

                    <!-- 分组卡片 -->
                    {#each groupsOfCategory(cat.id) as g (g.id)}
                        <div class={CARD_SURFACE} style={CARD_STYLE}>
                            <div class="flex items-center gap-2 px-3 py-2">
                                <input
                                    type="checkbox"
                                    use:triState={isPartiallySelected(configKeysOfGroup(g.id))}
                                    checked={isAllSelected(configKeysOfGroup(g.id))}
                                    onchange={() => toggleKeys(configKeysOfGroup(g.id))}
                                    class={CHECKBOX}
                                />
                                <div class="min-w-0 flex-1">
                                    <div class="text-xs font-black tracking-tight">{g.label}</div>
                                    <div class="truncate text-[10px] text-(--theme-modal-text)/40">{g.desc}</div>
                                </div>
                                <span class="shrink-0 text-[10px] tabular-nums text-(--theme-modal-text)/40">
                                    已选 {selectedCountOf(configKeysOfGroup(g.id))}/{configKeysOfGroup(g.id).length} · 已保存
                                    {counts[g.id]}
                                </span>
                                <Button
                                    variant="text"
                                    size="none"
                                    bare
                                    pad="p-1"
                                    onclick={() => toggleGroupDetail(g.id)}
                                    class="shrink-0 rounded-none text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)"
                                    title="展开逐条勾选"
                                >
                                    <Icon
                                        icon={expandedGroup === g.id ? 'mdi:chevron-up' : 'mdi:chevron-down'}
                                        class="size-4"
                                    />
                                </Button>
                                <Button
                                    variant="text"
                                    size="none"
                                    bare
                                    onclick={() => resetGroup(g.id)}
                                    class="h-6 shrink-0 rounded-none px-1.5 text-[10px] text-(--theme-modal-text)/45 transition-colors hover:text-red-400"
                                    title="清空该分组的全部配置项（回到默认）"
                                >
                                    重置
                                </Button>
                            </div>
                            {#if expandedGroup === g.id}
                                <!-- T15/T16：展开动效（`|local` 必加，避免所在分组块新建时重复播放一次） -->
                                <div
                                    transition:slide|local={slideParams(MOTION_MS.base)}
                                    class="space-y-1.5 border-t px-3 py-2 text-[10px] text-(--theme-modal-text)/50"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    <div class="flex items-center gap-2">
                                        <Button
                                            variant="text"
                                            size="none"
                                            bare
                                            onclick={() => toggleKeys(configKeysOfGroup(g.id), true)}
                                            class="h-6 shrink-0 rounded-none border border-(--theme-divider-border) px-1.5 transition-colors hover:border-(--theme-accent-bg)"
                                        >
                                            全选
                                        </Button>
                                        <Button
                                            variant="text"
                                            size="none"
                                            bare
                                            onclick={() => toggleKeys(configKeysOfGroup(g.id), false)}
                                            class="h-6 shrink-0 rounded-none border border-(--theme-divider-border) px-1.5 transition-colors hover:border-(--theme-accent-bg)"
                                        >
                                            全不选
                                        </Button>
                                        <span class="text-(--theme-modal-text)/30">只导出 / 导入勾选的条目</span>
                                    </div>
                                    <div class="grid grid-cols-1 gap-1 xl:grid-cols-2 xl:gap-x-3">
                                        {#each ENTRIES_BY_GROUP.get(g.id) ?? [] as e (e.key)}
                                            <label class="flex cursor-pointer items-center gap-2 rounded-none">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedKeys.has(e.key)}
                                                    onchange={() => toggleKeys([e.key])}
                                                    class={CHECKBOX}
                                                />
                                                <span class="min-w-0 flex-1 truncate">
                                                    {e.label} <span class="text-(--theme-modal-text)/30">{e.key}</span>
                                                </span>
                                                {#if savedKeys.has(e.key)}
                                                    <span class="shrink-0 text-(--theme-accent-text)/70">已保存</span>
                                                {/if}
                                            </label>
                                        {/each}
                                    </div>
                                </div>
                            {/if}
                        </div>
                    {/each}
                </div>
            {/each}
        </div>
    </div>

    <!-- ── 导出 ── -->
    <div class={mergeClass([CARD_SURFACE, 'p-3'])} style={CARD_STYLE}>
        <div class="mb-2 flex items-baseline justify-between gap-2">
            <span class="text-xs font-black tracking-tight">导出配置</span>
            <span class="shrink-0 text-[10px] tabular-nums text-(--theme-modal-text)/40">
                已勾选 {selectedKeys.size}/{ALL_ENTRIES.length} 条
            </span>
        </div>
        <label class="mb-2 flex cursor-pointer items-center gap-2 text-xs text-(--theme-modal-text)/70">
            <input type="checkbox" bind:checked={includeApiKey} class={CHECKBOX} />
            包含 AI API Key（默认不包含，避免明文外泄）
        </label>
        <Button
            variant="icon-text"
            size="none"
            bare
            keepDisabled
            onclick={handleExport}
            disabled={busy || selectedKeys.size === 0}
            backgroundImage="var(--theme-accent-bg)"
            textColor="var(--theme-accent-text-on-bg, #fff)"
            class="h-8 gap-1.5 px-3 text-xs font-medium transition-all hover:brightness-110"
        >
            <Icon icon="mdi:download-outline" class="size-3.5" />
            导出为 JSON（{selectedKeys.size} 条）
        </Button>
        <p class="mt-2 text-[10px] leading-4 text-(--theme-modal-text)/40">
            文件为 v2 格式：顶层按「设置」「本地库」分开，各类下再按分组存放；只写入已勾选且当前有保存值的条目。
        </p>
    </div>

    <!-- ── 导入 ── -->
    <div class={mergeClass([CARD_SURFACE, 'p-3'])} style={CARD_STYLE}>
        <div class="mb-2 text-xs font-black tracking-tight">导入配置</div>

        <div class="mb-1.5 text-[10px] text-(--theme-modal-text)/50">导入方式</div>
        <Tabs items={IMPORT_MODE_TABS} value={importMode} onchange={pickImportMode} compact {...TAB_ACCENT} />
        <p class="mt-1.5 text-[10px] leading-4 text-(--theme-modal-text)/40">
            {importMode === 'replace'
                ? `覆盖：在已勾选的 ${selectedKeys.size} 条里，文件里没有的会被清空（回到默认）`
                : `合并：只覆盖文件里出现的项（同样只处理已勾选的 ${selectedKeys.size} 条）`}
        </p>

        <input type="file" accept=".json,application/json" class="hidden" bind:this={fileInput} onchange={handleFile} />
        <div class="mt-2 flex flex-wrap items-center gap-2">
            <Button
                variant="icon-text"
                size="none"
                bare
                keepDisabled
                onclick={() => fileInput?.click()}
                disabled={busy || selectedKeys.size === 0}
                class={mergeClass([ACTION_BTN, 'gap-1.5'])}
            >
                <Icon icon="mdi:upload-outline" class="size-3.5" />
                选择配置文件
            </Button>
            <span class="text-[10px] text-(--theme-modal-text)/40">选中后会先预览，确认前不会写入任何配置</span>
        </div>

        {#if importError}
            <div
                class="sf-radius mt-2 flex items-start gap-1.5 border px-2.5 py-1.5 text-[10px] text-red-400"
                style="border-color: color-mix(in srgb, red 40%, transparent); background: color-mix(in srgb, red 8%, transparent);"
            >
                <Icon icon="mdi:alert-circle-outline" class="mt-px size-3.5 shrink-0" />
                <span class="min-w-0 flex-1">{importError}</span>
            </div>
        {/if}

        {#if pending && summary}
            <!-- 文件里有什么 / 将导入什么 -->
            <div
                class="sf-radius mt-3 space-y-2 border p-3"
                style="border-color: var(--theme-accent-bg); background: color-mix(in srgb, var(--theme-accent-bg) 6%, transparent);"
            >
                <div class="flex items-center gap-2 text-xs font-black">
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
                                <div class={CARD_SURFACE} style={CARD_STYLE}>
                                    <div
                                        class="flex items-center gap-2 border-b px-2.5 py-1"
                                        style="border-color: var(--theme-divider-border);"
                                    >
                                        <span class="text-[10px] font-medium text-(--theme-modal-text)/70"
                                            >{g.label}</span
                                        >
                                        <span class="text-[10px] tabular-nums text-(--theme-modal-text)/35"
                                            >{g.entries.length} 项</span
                                        >
                                        {#if g.knownCount === 0}
                                            <span class="ml-auto text-[10px] text-(--theme-modal-text)/30"
                                                >无可导入条目</span
                                            >
                                        {:else if g.selectedCount === 0}
                                            <span class="ml-auto text-[10px] text-amber-400/80">未勾选，不会导入</span>
                                        {:else if g.selectedCount < g.knownCount}
                                            <span class="ml-auto text-[10px] text-(--theme-modal-text)/45"
                                                >将导入 {g.selectedCount}/{g.knownCount} 条</span
                                            >
                                        {:else}
                                            <span class="ml-auto text-[10px] text-(--theme-accent-text)/70"
                                                >全部导入</span
                                            >
                                        {/if}
                                    </div>
                                    <div class="flex flex-wrap gap-x-2 gap-y-0.5 px-2.5 py-1.5">
                                        {#each g.entries as e (e.key)}
                                            <span
                                                class="text-[10px] {e.known
                                                    ? e.selected
                                                        ? 'text-(--theme-modal-text)/50'
                                                        : 'text-(--theme-modal-text)/25 line-through'
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

                <div class="flex items-center gap-2 border-t pt-2" style="border-color: var(--theme-divider-border);">
                    <Button
                        variant="icon-text"
                        size="none"
                        bare
                        keepDisabled
                        onclick={confirmImport}
                        disabled={busy || summary.count === 0 || selectedKeys.size === 0}
                        backgroundImage="var(--theme-accent-bg)"
                        textColor="var(--theme-accent-text-on-bg, #fff)"
                        class="h-8 gap-1.5 px-3 text-xs font-medium transition-all hover:brightness-110"
                    >
                        <Icon icon="mdi:check" class="size-3.5" />
                        确认导入（{selectedKeys.size} 条勾选项）
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
            </div>
        {/if}

        <p class="mt-2 text-[10px] leading-4 text-(--theme-modal-text)/40">
            导入只影响上方已勾选的条目（划掉的表示未勾选、不会导入）；导入完成后建议刷新页面，让各 store 重新读取配置。
        </p>
    </div>
</div>
