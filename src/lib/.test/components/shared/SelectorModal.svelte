<script lang="ts">
    import type { ComponentsProps } from '$lib/types'

    export interface SelectorItem {
        name: string
        subtitle?: string
        badge?: string | number
        badgeColor?: string
        icon?: string
        color?: string
        meta?: Record<string, string>
    }

    interface SelectorGroup {
        label: string
        icon?: string
        items: SelectorItem[]
    }

    interface Props extends ComponentsProps {
        show: boolean
        title: string
        groups: SelectorGroup[]
        selected: string | null
        onSelect: (item: { name: string; meta?: Record<string, string> }) => void
        onClose: () => void
        filterOptions?: { label: string; value: string }[]
        filterValues?: string[]
        filterFn?: (item: SelectorItem, values: string[]) => boolean
    }

    let {
        show,
        title,
        groups,
        selected,
        onSelect,
        onClose,
        filterOptions = [],
        filterValues = $bindable([]),
        filterFn,
        class: className,
        style
    }: Props = $props()

    let search = $state('')
    let contentEl: HTMLElement | undefined = $state()

    const toggleFilter = (value: string) => {
        if (filterValues.includes(value)) {
            filterValues = filterValues.filter((v) => v !== value)
        } else {
            filterValues = [...filterValues, value]
        }
    }

    let filteredGroups = $derived(
        groups
            .map((g) => ({
                ...g,
                items: g.items.filter(
                    (item) =>
                        item.name.toLowerCase().includes(search.toLowerCase()) &&
                        (!filterFn || filterFn(item, filterValues))
                )
            }))
            .filter((g) => g.items.length > 0)
    )

    const scrollTo = (label: string) => {
        document.getElementById(label)?.scrollIntoView({ behavior: 'smooth' })
    }

    const handleKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose()
    }

    const handleBackdrop = (e: MouseEvent) => {
        if ((e.target as HTMLElement).dataset?.modal === 'backdrop') onClose()
    }

    const selectedStyle = (item: SelectorItem): string => {
        if (item.name !== selected) return ''
        const c = item.color ?? '#fbbf24'
        return `background-image: linear-gradient(135deg, transparent 30%, ${c}25 100%);`
    }

    const defaultStyle = (_item: SelectorItem): string => {
        return ''
    }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if show}
    <div
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 {className ?? ''}"
        {style}
        role="button"
        tabindex="-1"
        data-modal="backdrop"
        onclick={handleBackdrop}
        onkeydown={handleKeydown}
    >
        <div
            class="mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        >
            <div class="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
                <h2 class="text-base font-semibold text-zinc-100">{title}</h2>
                <button
                    class="flex size-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                    onclick={onClose}
                >
                    ✕
                </button>
            </div>

            <div class="flex items-center gap-3 border-b border-zinc-800 px-5 py-3">
                <input
                    type="text"
                    class="h-8 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-4 text-sm text-zinc-200 outline-none placeholder:text-zinc-500 focus:border-zinc-500"
                    placeholder="搜索…"
                    bind:value={search}
                />
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
            </div>

            <div class="flex flex-1 overflow-hidden">
                <nav
                    class="shrink-0 w-28 overflow-y-auto border-r border-zinc-800 bg-zinc-950/60 flex flex-col gap-0.5 p-2 scrollbar-none"
                >
                    {#each filteredGroups as group}
                        <button
                            onclick={() => scrollTo(group.label)}
                            class="h-8 rounded-lg flex items-center gap-1.5 px-2 text-left hover:bg-zinc-800/60 transition-colors shrink-0"
                            title={group.label}
                        >
                            {#if group.icon}
                                <img src={group.icon} alt="" class="size-4 object-contain shrink-0" />
                            {/if}
                            <span class="text-[11px] text-zinc-400 truncate">{group.label}</span>
                        </button>
                    {/each}
                </nav>

                <div class="flex-1 overflow-y-auto px-4 pb-4" bind:this={contentEl}>
                    {#if filteredGroups.length === 0}
                        <div class="py-8 text-center text-sm text-zinc-500">无结果</div>
                    {:else}
                        {#each filteredGroups as group (group.label)}
                            <section id={group.label} class="mb-6 last:mb-0">
                                <div class="flex items-center gap-2 pt-4 pb-2">
                                    {#if group.icon}
                                        <img src={group.icon} alt="" class="size-4 rounded object-contain" />
                                    {/if}
                                    <span class="text-xs font-semibold text-zinc-400">{group.label}</span>
                                    <span class="text-[11px] text-zinc-600">{group.items.length}</span>
                                </div>
                                <div class="grid grid-cols-2 gap-2">
                                    {#each group.items as item}
                                        <button
                                            class="rounded-lg overflow-hidden flex items-center gap-2.5 p-3 text-left transition-colors hover:brightness-125"
                                            style={item.name === selected ? selectedStyle(item) : defaultStyle(item)}
                                            onclick={() => {
                                                onSelect({ name: item.name, meta: item.meta })
                                                onClose()
                                            }}
                                        >
                                            <div
                                                class="size-10 shrink-0 rounded-md bg-zinc-800/40 flex items-center justify-center overflow-hidden"
                                            >
                                                {#if item.icon}
                                                    <img
                                                        src={item.icon}
                                                        alt={item.name}
                                                        class="size-full object-contain"
                                                    />
                                                {:else}
                                                    <span class="text-xs text-zinc-500">{item.name[0]}</span>
                                                {/if}
                                            </div>
                                            <div class="min-w-0 flex-1">
                                                <div class="flex items-center gap-1">
                                                    <span class="text-xs font-semibold text-zinc-200 truncate"
                                                        >{item.name}</span
                                                    >
                                                </div>
                                                {#if item.subtitle}
                                                    <div class="text-[11px] text-zinc-500 mt-0.5">
                                                        {item.subtitle}
                                                    </div>
                                                {/if}
                                            </div>
                                            {#if item.badge != null}
                                                <span
                                                    class="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium {item.badgeColor ??
                                                        'text-zinc-400 bg-zinc-800'}"
                                                >
                                                    {item.badge}
                                                </span>
                                            {/if}
                                        </button>
                                    {/each}
                                </div>
                            </section>
                        {/each}
                    {/if}
                </div>
            </div>
        </div>
    </div>
{/if}
