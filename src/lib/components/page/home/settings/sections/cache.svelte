<script lang="ts">
    /**
     * @desc 设置 → 缓存清理（Phase 5.1 第二增量：自 `settings-modal.svelte` 原样抽出，标记与行为未改）。
     * 自有状态（`cacheEntries` / `cacheBusy` / `expandedCache`）落在 `settings-ui.svelte.ts`
     * （`cacheEntries` 的刷新被外壳「打开设置」的 $effect 共用）；分类文案与清理提示留在本组件。
     */
    import Icon from '@iconify/svelte'
    import SectionTitle from '$lib/components/ui/section-title.svelte'
    import SettingRow from '$lib/components/ui/setting-row.svelte'
    import Button from '$lib/components/ui/button.svelte'
    import EmptyState from '$lib/components/ui/empty-state.svelte'
    import { slide } from 'svelte/transition'
    import { MOTION_MS, slideParams } from '$lib/utils/motion'
    import {
        clearCache,
        clearCacheCategory,
        deleteCacheEntry,
        type CacheCategory,
        type CacheEntry
    } from '$lib/api/data-cache'
    import { addToast } from '$lib/data/toast.svelte'
    import {
        getCacheBusy,
        getCacheEntries,
        getExpandedCache,
        refreshCacheEntries,
        setCacheBusy,
        setExpandedCache
    } from '../settings-ui.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'
    import { ACTION_BTN, ACTION_BTN_ACCENT, ACTION_BTN_DANGER } from '../utils'

    interface Props extends ComponentsProps {}
    let { class: className, style: styleProp }: Props = $props()

    /** @desc 卡片表面（与 `config-section` / `archive` 的卡片同规格） */
    const CARD_SURFACE = 'sf-radius rounded-none border'
    const CARD_STYLE = 'border-color: var(--theme-divider-border); background: var(--theme-input-bg);'

    const cacheEntries = $derived(getCacheEntries())
    const cacheBusy = $derived(getCacheBusy())
    const expandedCache = $derived(getExpandedCache())

    const CACHE_LABELS: { key: CacheCategory; label: string; icon: string; desc: string }[] = [
        { key: 'list', label: '列表缓存', icon: 'mdi:file-document-outline', desc: '角色 / 武器 / 声骸 / 套装 名录' },
        { key: 'info', label: '详情缓存', icon: 'mdi:information-outline', desc: '技能、数值等词条详情' },
        { key: 'image', label: '图像缓存', icon: 'mdi:image-outline', desc: '图标批量表 + 浏览器图像桶' }
    ]

    /** @desc 实体标识 → 中文名（缓存条目明细用） */
    const CACHE_ENTITY_LABELS: Record<string, string> = {
        character: '角色',
        weapon: '武器',
        echo: '声骸',
        'echo-set': '声骸套装',
        'character-v3': '角色详情',
        // 旧版角色详情缓存（v2 接口已下线）：保留标签便于单独清理残留条目
        'character-v2': '角色详情（旧）'
    }

    const entityLabel = (entity: string): string => CACHE_ENTITY_LABELS[entity] ?? entity

    /** @desc 某分类下的条目（含全部上游来源） */
    const entriesOf = (kind: CacheCategory): CacheEntry[] => cacheEntries.filter((e) => e.category === kind)

    const cacheCount = $derived(cacheEntries.length)

    /** @desc 统一包一层：执行清理 → 刷新计数 → 提示 */
    const runCacheClear = async (action: () => Promise<void>, message: string) => {
        setCacheBusy(true)
        try {
            await action()
            await refreshCacheEntries()
            addToast(message, 'success')
        } finally {
            setCacheBusy(false)
        }
    }

    const handleClearCache = (kind: CacheCategory) =>
        runCacheClear(() => clearCacheCategory(kind), `已清理${CACHE_LABELS.find((c) => c.key === kind)?.label ?? ''}`)

    const handleClearCacheAll = () =>
        runCacheClear(async () => {
            await Promise.all(CACHE_LABELS.map((c) => clearCacheCategory(c.key)))
            // 兜底：清掉命名空间内可能残留的历史/未知键
            clearCache()
        }, '已清空全部接口缓存')

    const handleClearCacheEntry = (entry: CacheEntry) => {
        const what = entry.name ?? entityLabel(entry.entity)
        return runCacheClear(() => deleteCacheEntry(entry.key), `已清理「${what}」缓存`)
    }
</script>

<!-- Cache management：按类型浏览 + 逐条清理 -->
<div class={mergeClass([className])} style={styleProp}>
    <SectionTitle>
        <Icon icon="mdi:database-off-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        缓存清理
    </SectionTitle>
    <p class="mb-3 text-[10px] leading-4 text-(--theme-modal-text)/40">
        清理角色、武器、声骸等接口数据缓存；不影响你的工程与本地数据，展开分类可逐条清理
    </p>

    <!-- 汇总条：总数 + 全部清理 -->
    <SettingRow class="mb-3">
        <span class="min-w-0 truncate text-[10px] text-(--theme-modal-text)/45">
            当前共 <span
                class="text-base font-black text-(--theme-modal-text)"
                style="text-shadow: 0 0 3px var(--theme-halo-color);">{cacheCount}</span
            >
            条缓存{cacheBusy ? ' · 处理中…' : ''}
        </span>
        <Button
            variant="icon-text"
            size="none"
            bare
            keepDisabled
            onclick={handleClearCacheAll}
            disabled={cacheBusy || cacheCount === 0}
            class={ACTION_BTN_DANGER}
            title="清空全部接口缓存（不可恢复，但会随使用自动重建）"
        >
            <Icon icon="mdi:delete-sweep-outline" class="size-3.5" />
            全部清理
        </Button>
    </SettingRow>

    <div class="flex flex-col gap-2">
        {#each CACHE_LABELS as item (item.key)}
            {@const entries = entriesOf(item.key)}
            {@const expanded = expandedCache === item.key}
            {@const showProvider = new Set(entries.map((e) => e.provider)).size > 1}
            <div class={CARD_SURFACE} style={CARD_STYLE}>
                <!-- 分类行 -->
                <div class="flex items-center gap-2.5 px-3 py-2">
                    <Icon icon={item.icon} class="size-4 shrink-0 text-(--theme-accent-text)" />
                    <div class="min-w-0 flex-1">
                        <span class="flex items-center gap-2 text-xs font-medium text-(--theme-modal-text)">
                            {item.label}
                            <span class="text-[10px] font-normal text-(--theme-modal-text)/40">{entries.length} 条</span
                            >
                        </span>
                        <span class="mt-0.5 block truncate text-[10px] text-(--theme-modal-text)/40">{item.desc}</span>
                    </div>
                    <Button
                        variant="icon-text"
                        size="none"
                        bare
                        keepDisabled
                        onclick={() => setExpandedCache(expanded ? null : item.key)}
                        disabled={entries.length === 0}
                        class={ACTION_BTN}
                        title="展开逐条清理"
                    >
                        <Icon icon={expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} class="size-3.5" />
                        {expanded ? '收起' : '明细'}
                    </Button>
                    <Button
                        variant="icon-text"
                        size="none"
                        bare
                        keepDisabled
                        onclick={() => handleClearCache(item.key)}
                        disabled={cacheBusy || entries.length === 0}
                        backgroundImage="var(--theme-accent-bg)"
                        textColor="var(--theme-accent-text-on-bg)"
                        class={ACTION_BTN_ACCENT}
                        title="清理该类型全部缓存"
                    >
                        <Icon icon="mdi:delete-sweep-outline" class="size-3.5" />
                        清理本类
                    </Button>
                </div>

                <!-- 条目明细：逐条清理（T15/T16：展开动效；`|local` 必加，避免所在分类块新建时重复播放） -->
                {#if expanded}
                    <div
                        transition:slide|local={slideParams(MOTION_MS.base)}
                        class="border-t px-2 py-2"
                        style="border-color: var(--theme-divider-border);"
                    >
                        {#if entries.length === 0}
                            <EmptyState size="sm">暂无缓存条目</EmptyState>
                        {:else}
                            <div
                                class="theme-scrollbar grid max-h-52 grid-cols-1 gap-1 overflow-y-auto pr-1 xl:grid-cols-2 xl:gap-x-3"
                            >
                                {#each entries as entry (entry.key)}
                                    <div
                                        class="sf-radius flex min-w-0 items-center gap-2 rounded-none border px-2 py-1"
                                        style="border-color: var(--theme-divider-border);"
                                    >
                                        <span
                                            class="min-w-0 flex-1 truncate text-[10px] text-(--theme-modal-text)/70"
                                            title={entry.key}
                                        >
                                            <span class="text-(--theme-modal-text)/35">{entityLabel(entry.entity)}</span
                                            >
                                            {#if entry.name}
                                                · {entry.name}
                                            {/if}
                                            {#if showProvider}
                                                <span class="ml-1 opacity-40">[{entry.provider}]</span>
                                            {/if}
                                        </span>
                                        <Button
                                            variant="text"
                                            size="none"
                                            bare
                                            keepDisabled
                                            pad="p-0.5"
                                            onclick={() => handleClearCacheEntry(entry)}
                                            disabled={cacheBusy}
                                            class="shrink-0 rounded-none text-(--theme-modal-text)/40 transition-colors hover:text-red-500 focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-(--theme-accent-bg)"
                                            title="清理该条目"
                                        >
                                            <Icon icon="mdi:close" class="size-3.5" />
                                        </Button>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                {/if}
            </div>
        {/each}
    </div>
</div>
