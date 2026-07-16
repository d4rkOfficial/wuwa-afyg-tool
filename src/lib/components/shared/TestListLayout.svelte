<script lang="ts">
    import type { Snippet } from 'svelte'
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {
        title: string
        groups: { label: string; items: any[]; icon?: string; pieces?: number[] }[]
        search?: string
        filterValues?: string[]
        filterOptions?: { label: string; value: string }[]
        filterFn?: (item: any, values: string[]) => boolean
        card: Snippet<[item: any, groupLabel: string]>
    }

    let {
        title,
        groups,
        search = $bindable(''),
        filterValues = $bindable([]),
        filterOptions = [],
        filterFn,
        card,
        class: className,
        style
    }: Props = $props()

    const toggleFilter = (value: string) => {
        if (filterValues.includes(value)) {
            filterValues = filterValues.filter((v) => v !== value)
        } else {
            filterValues = [...filterValues, value]
        }
    }

    let sidebarWidth = $state(160)
    let dragging = $state(false)

    const onDragStart = (e: MouseEvent) => {
        e.preventDefault()
        dragging = true
    }

    $effect(() => {
        if (!dragging) return
        const onMove = (e: MouseEvent) => {
            sidebarWidth = Math.max(120, Math.min(360, e.clientX))
        }
        const onUp = () => {
            dragging = false
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
        }
    })

    let filteredGroups = $derived(
        groups
            .map((g) => ({
                ...g,
                items: g.items.filter(
                    (item: any) =>
                        item.name.toLowerCase().includes(search.toLowerCase()) &&
                        (!filterFn || filterFn(item, filterValues))
                )
            }))
            .filter((g) => g.items.length > 0)
    )

    let totalItems = $derived(groups.reduce((sum, g) => sum + g.items.length, 0))

    let totalFiltered = $derived(filteredGroups.reduce((sum, g) => sum + g.items.length, 0))

    const hideImg = (e: Event) => {
        ;(e.currentTarget as HTMLElement).style.display = 'none'
    }

    const scrollTo = (label: string) => {
        document.getElementById(label)?.scrollIntoView({ behavior: 'smooth' })
        document
            .querySelector(`[data-sidebar-label="${label}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    let navEl: HTMLElement | undefined = $state()
    let sidebarCentered = $state(true)

    $effect(() => {
        filteredGroups
        const el = navEl
        if (!el) return
        sidebarCentered = el.scrollHeight <= el.clientHeight
    })
</script>

<div {style} class="h-dvh flex flex-col bg-zinc-950 text-zinc-100 {className}">
    <header class="shrink-0 h-12 flex items-center px-5 border-b border-zinc-800/50 bg-zinc-950 gap-4">
        <div class="flex items-center gap-3 shrink-0">
            <h1 class="text-sm font-semibold tracking-tight text-zinc-100">{title}</h1>
            <span class="text-[11px] text-zinc-500 tabular-nums">
                {#if search || filterValues.length < filterOptions.length}
                    {totalFiltered} / {totalItems}
                {:else}
                    {totalItems}
                {/if}
            </span>
        </div>
        <div class="flex-1 flex justify-center">
            <div class="max-w-md w-full relative">
                <Icon icon="mdi:magnify" class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-500" />
                <input
                    bind:value={search}
                    placeholder="搜索..."
                    class="h-8 w-full pl-9 pr-3 rounded-lg bg-zinc-800/60 border border-zinc-700/50 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none transition-colors focus:border-blue-500/50"
                />
            </div>
        </div>
        {#if filterOptions.length > 0}
            <div class="flex items-center gap-1 shrink-0">
                {#each filterOptions as opt}
                    <button
                        onclick={() => toggleFilter(opt.value)}
                        class="h-7 px-2.5 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap {filterValues.includes(
                            opt.value
                        )
                            ? 'bg-blue-500/20 text-blue-400'
                            : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700/60'}"
                    >
                        {opt.label}
                    </button>
                {/each}
            </div>
        {/if}
    </header>

    <div class="flex-1 flex overflow-hidden">
        <nav
            class="shrink-0 border-r border-zinc-800/50 bg-zinc-950/60 overflow-y-auto flex flex-col gap-0.5 pt-3 pb-4 pl-3 pr-2 scrollbar-none relative {dragging
                ? 'select-none'
                : ''} {sidebarCentered ? 'justify-center' : 'justify-start'} {sidebarCentered
                ? ''
                : 'shadow-[inset_0_-10px_8px_-8px_rgba(0,0,0,0.5)]'}"
            style="width: {sidebarWidth}px"
            bind:this={navEl}
        >
            {#each filteredGroups as group}
                <button
                    onclick={() => scrollTo(group.label)}
                    data-sidebar-label={group.label}
                    class="h-8 rounded-lg flex items-center gap-2 px-2 hover:bg-zinc-800/60 transition-colors shrink-0 text-left"
                    title={group.label}
                >
                    {#if group.icon}
                        <img src={group.icon} alt="" class="size-5 object-contain shrink-0" onerror={hideImg} />
                    {/if}
                    <span class="text-[11px] leading-none text-zinc-400 truncate">{group.label}</span>
                </button>
            {/each}
            <button
                aria-label="Resize sidebar"
                class="appearance-none bg-transparent border-none p-0 absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-10 transition-colors hover:bg-blue-400/50"
                onmousedown={onDragStart}
            ></button>
        </nav>

        <div class="flex-1 overflow-y-auto px-4 py-4">
            {#each filteredGroups as group (group.label)}
                <section id={group.label} class="mb-8 last:mb-0">
                    <div class="flex items-center gap-2 text-xs font-semibold text-zinc-400 mb-2 py-1 pb-2">
                        {#if group.icon}
                            <img src={group.icon} alt="" class="size-4 rounded object-contain" onerror={hideImg} />
                        {/if}
                        {group.label}
                        <span class="text-zinc-600 font-medium">{group.items.length}</span>
                        {#if group.pieces}
                            <span class="ml-auto flex items-center gap-1.5 text-zinc-600 font-normal">
                                {#each group.pieces as p}
                                    <span class="tabular-nums">{p}件套</span>
                                {/each}
                            </span>
                        {/if}
                    </div>
                    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                        {#each group.items as item}
                            <div
                                class="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20"
                            >
                                {@render card(item, group.label)}
                            </div>
                        {/each}
                    </div>
                </section>
            {/each}

            {#if filteredGroups.length === 0}
                <div class="flex flex-col items-center justify-center py-20 text-zinc-500">
                    <Icon icon="mdi:file-search-outline" class="size-10 mb-3 text-zinc-600" />
                    <span class="text-sm font-medium">没有匹配的结果</span>
                </div>
            {/if}
        </div>
    </div>
</div>
