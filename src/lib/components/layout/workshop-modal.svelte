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
        buildImportLink,
        SHARE_SORT_LABELS,
        type ShareProject
    } from '$lib/data/share.svelte'
    import { getCharIconMap } from '$lib/calc/timeline.store.svelte'
    import { addToast } from '$lib/data/toast.svelte'
    import { shortName } from '$lib/utils/character'

    interface Props extends ComponentsProps {
        open: boolean
        onclose?: () => void
        /** 点击列表项「详情」时回调（code → 工坊 /share/xxx 详情页） */
        ondetail?: (code: string) => void
    }

    let { open, onclose, ondetail, backgroundImage, textColor, class: className, style: styleProp }: Props = $props()

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

    async function handleShare(item: ShareProject) {
        const link = buildImportLink(item.code)
        try {
            await navigator.clipboard.writeText(link)
            addToast(`已复制「${item.title}」的分享链接`, 'success')
        } catch {
            addToast(`分享链接：${link}`, 'success')
        }
    }
</script>

<Modal {open} {onclose} backdropClose={false} class={className} style="width: min(94vw, 1040px); {mergedStyle}">
    {#snippet title()}
        <Icon icon="mdi:storefront-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        <span class="font-black tracking-tight">椰果工坊 · 社区工程</span>
    {/snippet}

    <div class="flex items-center justify-between gap-2">
        <p class="text-[10px] leading-relaxed text-(--theme-modal-text)/40">无需登录，下载后自动导入本地项目列表</p>
        <button
            onclick={() => refreshProjects()}
            disabled={share.loading}
            class="inline-flex shrink-0 items-center gap-1 rounded-none border px-2 py-1 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text) disabled:opacity-40"
            style="border-color: var(--theme-divider-border);"
        >
            <Icon icon="mdi:refresh" class="size-3" />
            刷新
        </button>
    </div>

    <div class="mt-3 flex items-center gap-2">
        <div class="relative flex-1">
            <Icon
                icon="mdi:magnify"
                class="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-(--theme-modal-text)/40"
            />
            <input
                bind:value={keyword}
                placeholder="搜索标题 / 作者"
                class="w-full rounded-none border py-1.5 pl-8 pr-3 text-xs text-(--theme-modal-text) outline-none transition-colors placeholder:text-(--theme-modal-text)/35 focus:border-(--theme-accent-bg)/50"
                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
            />
        </div>
        <div
            class="flex shrink-0 items-center rounded-none border p-0.5"
            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
        >
            {#each SHARE_SORT_LABELS as opt}
                <button
                    onclick={() => setSort(opt.value)}
                    class={[
                        'rounded-none px-2.5 py-1 text-[10px] transition-colors',
                        share.sort === opt.value
                            ? 'font-black text-(--theme-accent-text)'
                            : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)'
                    ].join(' ')}
                >
                    {opt.label}
                </button>
            {/each}
        </div>
    </div>

    <div class="mt-3 grid grid-cols-1 gap-2 xl:grid-cols-2 xl:gap-x-4">
        {#if share.loading}
            <div
                class="flex items-center justify-center gap-2 py-10 text-xs text-(--theme-modal-text)/40 xl:col-span-2"
            >
                <Icon icon="mdi:loading" class="size-5 animate-spin" />
                加载中…
            </div>
        {:else if share.error}
            <div class="flex flex-col items-center gap-3 py-10 text-xs text-(--theme-modal-text)/40 xl:col-span-2">
                <Icon icon="mdi:cloud-off-outline" class="size-8" />
                无法连接椰果工坊
                <button
                    onclick={() => refreshProjects()}
                    class="inline-flex shrink-0 items-center gap-1 rounded-none border px-2.5 py-1 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                    style="border-color: var(--theme-divider-border);"
                >
                    重试
                </button>
            </div>
        {:else if share.projects.length === 0}
            <div class="flex flex-col items-center gap-2 py-10 text-xs text-(--theme-modal-text)/40 xl:col-span-2">
                <Icon icon="mdi:storefront-outline" class="size-8" />
                {share.query.trim() ? '没有匹配的工程' : '还没有人分享工程'}
            </div>
        {:else}
            {#each share.projects as item (item.id)}
                <div
                    class="flex min-w-0 items-center gap-3 rounded-none border px-3 py-2.5 transition-colors hover:bg-(--theme-modal-text)/5"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                >
                    {#if item.teamPreview?.names?.length}
                        <div class="flex shrink-0 -space-x-1.5">
                            {#each item.teamPreview.names.slice(0, 3) as name}
                                <Avatar
                                    src={charIconMap[name] || undefined}
                                    alt={name}
                                    size="sm"
                                    class="ring-2 ring-(--theme-input-bg)"
                                />
                            {/each}
                        </div>
                    {/if}
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2">
                            <span class="truncate text-sm font-black tracking-tight text-(--theme-modal-text)">
                                {item.title}
                            </span>
                            {#if item.gameVersion}
                                <span
                                    class="shrink-0 rounded-none bg-(--theme-accent-bg)/10 px-1.5 py-0.5 text-[10px] text-(--theme-accent-text)"
                                >
                                    {item.gameVersion}
                                </span>
                            {/if}
                        </div>
                        <div class="mt-0.5 flex items-center gap-2 text-[10px] text-(--theme-modal-text)/40">
                            {#if item.teamPreview?.names?.length}
                                <span class="truncate">
                                    {item.teamPreview.names.map((n) => shortName(n)).join(' / ')}
                                </span>
                                <span>·</span>
                            {/if}
                            {#if item.downloads > 0}
                                <span class="shrink-0"
                                    ><span class="font-black text-(--theme-modal-text)/70">{item.downloads}</span> 下载</span
                                >
                                <span>·</span>
                            {/if}
                            <span class="shrink-0">{item.authorName}</span>
                        </div>
                    </div>
                    <button
                        onclick={() => handleShare(item)}
                        class="inline-flex shrink-0 items-center rounded-none border px-2 py-1 text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                        style="border-color: var(--theme-divider-border);"
                        title="复制分享链接"
                    >
                        <Icon icon="mdi:share-variant" class="size-3.5" />
                    </button>
                    <button
                        onclick={() => ondetail?.(item.code)}
                        class="inline-flex shrink-0 items-center gap-1 rounded-none border px-2 py-1 text-[10px] whitespace-nowrap text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                        style="border-color: var(--theme-divider-border);"
                        title="查看详情"
                    >
                        <Icon icon="mdi:information-outline" class="size-3" />
                        详情
                    </button>
                    <button
                        onclick={() => handleDownload(item.code, item.title)}
                        disabled={downloading !== null}
                        class="inline-flex shrink-0 items-center gap-1 rounded-none px-2.5 py-1 text-[10px] font-medium whitespace-nowrap transition-all hover:brightness-110 disabled:opacity-40"
                        style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                    >
                        <Icon
                            icon={downloading === item.code ? 'mdi:loading' : 'mdi:download'}
                            class={downloading === item.code ? 'size-3 animate-spin' : 'size-3'}
                        />
                        下载
                    </button>
                </div>
            {/each}
        {/if}
    </div>

    {#snippet footer()}
        {#if share.total > 0}
            <div
                class="flex items-center justify-between gap-2 border-t pt-3 text-[10px] text-(--theme-modal-text)/40"
                style="border-color: var(--theme-divider-border);"
            >
                <span class="shrink-0"
                    >共 <span class="font-black text-(--theme-modal-text)/70">{share.total}</span> 条</span
                >
                <div class="flex items-center gap-2">
                    <button
                        onclick={() => setPage(share.page - 1)}
                        disabled={share.page <= 1}
                        class="inline-flex shrink-0 items-center gap-1 rounded-none border px-2 py-1 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text) disabled:pointer-events-none disabled:opacity-40"
                        style="border-color: var(--theme-divider-border);"
                    >
                        上一页
                    </button>
                    <span class="shrink-0 font-black tracking-[0.22em] text-(--theme-modal-text)/40"
                        >第 {share.page} / {totalPages} 页</span
                    >
                    <button
                        onclick={() => setPage(share.page + 1)}
                        disabled={share.page >= totalPages}
                        class="inline-flex shrink-0 items-center gap-1 rounded-none border px-2 py-1 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text) disabled:pointer-events-none disabled:opacity-40"
                        style="border-color: var(--theme-divider-border);"
                    >
                        下一页
                    </button>
                </div>
            </div>
        {/if}
    {/snippet}
</Modal>
