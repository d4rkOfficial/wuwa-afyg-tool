<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
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
    import { getCharIconMap, getCharElementMap } from '$lib/calc/timeline.store.svelte'
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
    const charElements = $derived(getCharElementMap())

    /** @desc 角色元素主题色（getCharElementMap 返回元素名，转 --theme-element-*） */
    const elementColor = (character: string | null | undefined): string => {
        const el = charElements[character ?? '']
        return el ? `var(--theme-element-${el}, #888)` : '#888'
    }

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

    /** @desc 点作者超链接 / 角色角标 → 回填搜索框并立即检索（角色名由本地检索支持） */
    const searchBy = (text: string) => {
        keyword = text
        void setSearch(text)
    }

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

<Modal {open} {onclose} backdropClose={false} class={className} style="width: min(96vw, 1360px); {mergedStyle}">
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
                placeholder="搜索标题 / 作者 / 角色"
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

    <div class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:gap-x-4">
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
                {@const names = item.teamPreview?.names?.slice(0, 3) ?? []}
                {@const avatars = names.map((n) => charIconMap[n])}
                <div
                    class="group relative flex min-h-[11rem] min-w-0 flex-col overflow-hidden rounded-none border p-4 transition-colors hover:border-(--theme-accent-bg)"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                >
                    <!-- 角色头像叠底（右下：1号大→3号小，向左递减；半透明 + 边缘淡出） -->
                    {#if avatars[2]}
                        <div
                            class="pointer-events-none absolute -bottom-3 right-36 z-0 size-16 opacity-40"
                            style="-webkit-mask-image: linear-gradient(to left, transparent, #000 40%), linear-gradient(to bottom, transparent, #000 40%); -webkit-mask-composite: source-in; mask-image: linear-gradient(to left, transparent, #000 40%), linear-gradient(to bottom, transparent, #000 40%); mask-composite: intersect;"
                        >
                            <img src={avatars[2]} alt="" class="size-full object-cover" />
                        </div>
                    {/if}
                    {#if avatars[1]}
                        <div
                            class="pointer-events-none absolute -bottom-3 right-[4.5rem] z-0 size-24 opacity-40"
                            style="-webkit-mask-image: linear-gradient(to left, transparent, #000 40%), linear-gradient(to bottom, transparent, #000 40%); -webkit-mask-composite: source-in; mask-image: linear-gradient(to left, transparent, #000 40%), linear-gradient(to bottom, transparent, #000 40%); mask-composite: intersect;"
                        >
                            <img src={avatars[1]} alt="" class="size-full object-cover" />
                        </div>
                    {/if}
                    {#if avatars[0]}
                        <div
                            class="pointer-events-none absolute -bottom-3 right-0 z-0 size-32 opacity-40"
                            style="-webkit-mask-image: linear-gradient(to bottom, transparent, #000 40%); mask-image: linear-gradient(to bottom, transparent, #000 40%);"
                        >
                            <img src={avatars[0]} alt="" class="size-full object-cover" />
                        </div>
                    {/if}

                    <!-- 标题 + 版本号 -->
                    <div class="relative z-10 flex items-start gap-2">
                        <h4
                            class="min-w-0 flex-1 truncate text-base font-black leading-tight tracking-tight text-(--theme-modal-text) [text-shadow:0_0_3px_var(--theme-halo-color)]"
                        >
                            {item.title}
                        </h4>
                        {#if item.gameVersion}
                            <span
                                class="shrink-0 border px-1.5 py-0.5 text-[10px] font-black tracking-[0.18em] text-(--theme-accent-text)"
                                style="border-color: color-mix(in srgb, var(--theme-accent-bg) 45%, transparent); background: color-mix(in srgb, var(--theme-accent-bg) 12%, transparent);"
                            >
                                {item.gameVersion}
                            </span>
                        {/if}
                    </div>

                    <!-- 作者（超链接：点按即按作者名搜索） -->
                    <div class="relative z-10 mt-1.5 flex min-w-0 items-center text-[10px]">
                        <button
                            onclick={() => searchBy(item.authorName)}
                            class="inline-flex min-w-0 items-center gap-1 font-black text-(--theme-accent-text) underline decoration-dotted underline-offset-2 transition-colors hover:decoration-solid"
                            title={`搜索作者「${item.authorName}」`}
                        >
                            <span class="min-w-0 truncate">{item.authorName}</span>
                            <Icon icon="mdi:magnify" class="size-3 shrink-0" />
                        </button>
                    </div>

                    <!-- 队伍角色（元素色角标；头像已作叠底，这里只留名字；点按即按角色名搜索） -->
                    {#if names.length > 0}
                        <div class="relative z-10 mt-2.5 flex flex-wrap items-center gap-1.5">
                            {#each names as name}
                                <button
                                    onclick={() => searchBy(name)}
                                    class="inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px] font-black transition-colors hover:brightness-125"
                                    style="border-color: color-mix(in srgb, {elementColor(
                                        name
                                    )} 45%, transparent); color: {elementColor(
                                        name
                                    )}; background: color-mix(in srgb, {elementColor(name)} 12%, transparent);"
                                    title={`搜索角色「${name}」`}
                                >
                                    {shortName(name)}
                                    <Icon icon="mdi:magnify" class="size-2.5 shrink-0" />
                                </button>
                            {/each}
                        </div>
                    {/if}

                    <!-- 底部：下载量 + 操作按钮 -->
                    <div class="relative z-10 mt-auto flex items-end justify-between gap-3 pt-4">
                        <span
                            class="flex shrink-0 items-baseline gap-1.5 text-[10px] tracking-[0.18em] text-(--theme-modal-text)/40"
                        >
                            <span
                                class="text-lg font-black leading-none tabular-nums text-(--theme-modal-text)"
                                style="text-shadow: 0 0 3px var(--theme-halo-color);">{item.downloads}</span
                            >
                            下载
                        </span>
                        <div class="flex shrink-0 items-center gap-1.5">
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
                    </div>
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
