<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import Avatar from '$lib/components/ui/avatar.svelte'
    import {
        getShareState,
        refreshProjects,
        downloadProject,
        setSearch,
        setSort,
        setPage,
        SHARE_SORT_LABELS
    } from '$lib/data/share.svelte'
    import { getCharIconMap } from './timeline/timeline.store.svelte'
    import { addToast } from '$lib/data/toast.svelte'
    import { shortName } from '$lib/utils/character'

    interface Props extends ComponentsProps {
        open: boolean
        onclose?: () => void
    }

    let { open, onclose, backgroundImage, textColor, class: className, style: styleProp }: Props = $props()

    let mergedStyle = $derived(
        [
            backgroundImage ? `background: ${backgroundImage}` : '',
            textColor ? `color: ${textColor}` : '',
            styleProp || ''
        ]
            .filter(Boolean)
            .join(';')
    )

    const share = getShareState()
    let charIconMap = $derived(getCharIconMap())

    let downloading = $state<string | null>(null)
    let prevOpen = $state(open)
    let keyword = $state(share.query)

    $effect(() => {
        if (open && !prevOpen) {
            refreshProjects()
        }
        prevOpen = open
    })

    let debounceTimer: ReturnType<typeof setTimeout> | undefined
    $effect(() => {
        const value = keyword
        clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
            setSearch(value)
        }, 350)
        return () => clearTimeout(debounceTimer)
    })

    let totalPages = $derived(Math.max(1, Math.ceil(share.total / share.perPage)))

    async function handleDownload(code: string, title: string) {
        if (downloading) return
        downloading = code
        const res = await downloadProject(code)
        downloading = null
        if (res.ok) {
            addToast(`已下载并导入「${title}」`, 'success')
        } else {
            addToast(res.error ?? '下载失败', 'error')
        }
    }

    function formatTime(iso: string) {
        return new Date(iso).toLocaleString('zh-CN', {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })
    }
</script>

<Modal {open} {onclose} class={className} style="width: min(90vw, 640px); {mergedStyle}">
    {#snippet title()}
        椰果工坊 · 社区工程
    {/snippet}

    <div class="flex items-center justify-between gap-2">
        <p class="text-xs text-(--theme-muted-text)">无需登录，下载后自动导入本地项目列表</p>
        <button
            onclick={() => refreshProjects()}
            disabled={share.loading}
            class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-(--theme-muted-text) transition-colors hover:bg-(--theme-card-bg-focused) hover:text-(--theme-layout-text) disabled:opacity-40"
        >
            <Icon icon="mdi:refresh" class="size-3.5" />
            刷新
        </button>
    </div>

    <div class="mt-3 flex items-center gap-2">
        <div class="relative flex-1">
            <Icon
                icon="mdi:magnify"
                class="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-(--theme-muted-text)"
            />
            <input
                bind:value={keyword}
                placeholder="搜索标题 / 作者"
                class="w-full rounded-lg border border-(--theme-card-border) bg-(--theme-card-bg) py-1.5 pl-8 pr-3 text-sm text-(--theme-layout-text) outline-none transition-colors placeholder:text-(--theme-muted-text) focus:border-(--theme-accent-bg)/50"
            />
        </div>
        <div
            class="flex shrink-0 items-center rounded-lg border border-(--theme-card-border) bg-(--theme-card-bg) p-0.5"
        >
            {#each SHARE_SORT_LABELS as opt}
                <button
                    onclick={() => setSort(opt.value)}
                    class={[
                        'rounded-md px-2.5 py-1 text-xs transition-colors',
                        share.sort === opt.value
                            ? 'font-medium text-(--theme-accent-text)'
                            : 'text-(--theme-muted-text) hover:text-(--theme-layout-text)'
                    ].join(' ')}
                >
                    {opt.label}
                </button>
            {/each}
        </div>
    </div>

    <div class="mt-3 space-y-2">
        {#if share.loading}
            <div class="flex items-center justify-center gap-2 py-10 text-sm text-(--theme-muted-text)">
                <Icon icon="mdi:loading" class="size-5 animate-spin" />
                加载中…
            </div>
        {:else if share.error}
            <div class="flex flex-col items-center gap-3 py-10 text-sm text-(--theme-muted-text)">
                <Icon icon="mdi:cloud-off-outline" class="size-8" />
                无法连接椰果工坊
                <button
                    onclick={() => refreshProjects()}
                    class="rounded-md px-3 py-1.5 text-xs transition-colors hover:bg-(--theme-card-bg-focused)"
                >
                    重试
                </button>
            </div>
        {:else if share.projects.length === 0}
            <div class="flex flex-col items-center gap-2 py-10 text-sm text-(--theme-muted-text)">
                <Icon icon="mdi:storefront-outline" class="size-8" />
                {share.query.trim() ? '没有匹配的工程' : '还没有人分享工程'}
            </div>
        {:else}
            {#each share.projects as item (item.id)}
                <div
                    class="flex items-center gap-3 rounded-lg border border-(--theme-card-border) bg-(--theme-card-bg) px-3 py-2.5 transition-colors hover:bg-(--theme-card-bg-focused)"
                >
                    {#if item.teamPreview?.names?.length}
                        <div class="flex shrink-0 -space-x-1.5">
                            {#each item.teamPreview.names.slice(0, 3) as name}
                                <Avatar
                                    src={charIconMap[name] || undefined}
                                    alt={name}
                                    size="sm"
                                    class="ring-2 ring-(--theme-card-bg)"
                                />
                            {/each}
                        </div>
                    {/if}
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                            <span class="truncate text-sm font-medium text-(--theme-layout-text)">
                                {item.title}
                            </span>
                            {#if item.gameVersion}
                                <span
                                    class="shrink-0 rounded bg-(--theme-accent-bg)/10 px-1.5 py-0.5 text-[10px] text-(--theme-accent-text)"
                                >
                                    {item.gameVersion}
                                </span>
                            {/if}
                        </div>
                        <div class="mt-0.5 flex items-center gap-2 text-xs text-(--theme-muted-text)">
                            {#if item.teamPreview?.names?.length}
                                <span class="truncate">
                                    {item.teamPreview.names.map((n) => shortName(n)).join(' / ')}
                                </span>
                                <span>·</span>
                            {/if}
                            {#if item.downloads > 0}
                                <span class="shrink-0">{item.downloads} 下载</span>
                                <span>·</span>
                            {/if}
                            <span class="shrink-0">{item.authorName}</span>
                            <span>·</span>
                            <span class="shrink-0">{formatTime(item.createdAt)}</span>
                        </div>
                    </div>
                    <button
                        onclick={() => handleDownload(item.code, item.title)}
                        disabled={downloading !== null}
                        class="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all hover:brightness-125 disabled:opacity-40"
                        style="background: var(--theme-btn-bg); color: var(--theme-btn-text);"
                    >
                        <Icon
                            icon={downloading === item.code ? 'mdi:loading' : 'mdi:download'}
                            class={downloading === item.code ? 'size-4 animate-spin' : 'size-4'}
                        />
                        下载
                    </button>
                </div>
            {/each}
        {/if}
    </div>

    {#if share.total > 0}
        <div
            class="mt-3 flex items-center justify-between gap-2 border-t border-(--theme-card-border) pt-3 text-xs text-(--theme-muted-text)"
        >
            <span class="shrink-0">共 {share.total} 条</span>
            <div class="flex items-center gap-2">
                <button
                    onclick={() => setPage(share.page - 1)}
                    disabled={share.page <= 1}
                    class="rounded-md px-2 py-1 transition-colors hover:bg-(--theme-card-bg-focused) hover:text-(--theme-layout-text) disabled:opacity-40 disabled:pointer-events-none"
                >
                    上一页
                </button>
                <span class="shrink-0">第 {share.page} / {totalPages} 页</span>
                <button
                    onclick={() => setPage(share.page + 1)}
                    disabled={share.page >= totalPages}
                    class="rounded-md px-2 py-1 transition-colors hover:bg-(--theme-card-bg-focused) hover:text-(--theme-layout-text) disabled:opacity-40 disabled:pointer-events-none"
                >
                    下一页
                </button>
            </div>
        </div>
    {/if}
</Modal>
