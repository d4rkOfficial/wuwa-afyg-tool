<script lang="ts">
    import type { Weapon } from '$lib/api/types'
    import Icon from '@iconify/svelte'
    import { fallbackIcon } from '$lib/utils/icons'

    interface Props {
        open: boolean
        onclose: () => void
        onselect: (weapon: Weapon | null) => void
        weapons: Weapon[]
        icons: Record<string, string>
        currentName?: string
    }

    let { open, onclose, onselect, weapons, icons, currentName }: Props = $props()

    let query = $state('')
    let localSelected = $state<Weapon | null>(null)

    $effect(() => {
        if (open) {
            localSelected = weapons.find((w) => w.name === currentName) ?? null
            query = ''
        }
    })

    let filtered = $derived.by(() => {
        let list = weapons.filter((w) => !w.name.startsWith('投影·'))
        if (query) list = list.filter((w) => w.name.includes(query))
        return list.sort((a, b) => b.star - a.star)
    })

    let groupedByStar = $derived.by(() => {
        const map = new Map<number, Weapon[]>()
        for (const w of filtered) {
            const arr = map.get(w.star) || []
            arr.push(w)
            map.set(w.star, arr)
        }
        return [...map.entries()].sort(([a], [b]) => b - a)
    })

    function toggleSelect(w: Weapon) {
        if (localSelected?.name === w.name) {
            localSelected = null
        } else {
            localSelected = w
        }
    }

    function handleConfirm() {
        onselect(localSelected)
        onclose()
    }

    function isSelected(w: Weapon): boolean {
        return localSelected?.name === w.name
    }

    function itemClass(w: Weapon): string {
        const base = 'flex w-[110px] flex-col items-center gap-1.5 rounded-lg p-3 transition-colors cursor-pointer'
        if (isSelected(w)) {
            return base + ' ring-2 ring-[var(--theme-accent-bg)] bg-[var(--theme-accent-bg)]/10'
        }
        return base + ' hover:bg-[var(--theme-modal-text)]/5'
    }
</script>

{#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        class="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
        onkeydown={(e) => {
            if (e.key === 'Escape') onclose()
        }}
    >
        <div
            class="relative flex max-h-[70vh] min-h-[40vh] w-160 max-w-[90vw] flex-col rounded-xl text-(--theme-modal-text) shadow-2xl"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent);"
            role="dialog"
            aria-modal="true"
        >
            <div class="flex items-center gap-2 border-b px-4 py-3" style="border-color: var(--theme-divider-border)">
                <Icon icon="mdi:magnify" class="size-4 shrink-0 text-(--theme-muted-text)" />
                <input
                    bind:value={query}
                    placeholder="搜索武器..."
                    class="min-w-0 flex-1 bg-transparent text-sm outline-none text-(--theme-modal-text) placeholder:text-(--theme-modal-text)/30"
                />
                {#if query}
                    <button
                        onclick={() => (query = '')}
                        class="rounded p-0.5 text-(--theme-muted-text) hover:text-(--theme-modal-text)"
                        aria-label="Clear search"
                    >
                        <Icon icon="mdi:close" class="size-4" />
                    </button>
                {/if}
            </div>

            <div class="flex-1 overflow-y-auto p-4">
                {#if query}
                    {#if filtered.length === 0}
                        <div class="py-12 text-center text-sm text-(--theme-muted-text)">无匹配武器</div>
                    {:else}
                        <div class="flex flex-wrap gap-2">
                            {#each filtered as w}
                                <!-- svelte-ignore a11y_no_static_element_interactions -->
                                <!-- svelte-ignore a11y_click_events_have_key_events -->
                                <div
                                    onclick={() => toggleSelect(w)}
                                    onkeydown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault()
                                            toggleSelect(w)
                                        }
                                    }}
                                    role="button"
                                    tabindex="0"
                                    class={itemClass(w)}
                                >
                                    <div class="size-14 overflow-hidden rounded-lg bg-(--theme-modal-text)/10 p-1">
                                        {#if icons[w.name]}
                                            <img
                                                src={icons[w.name]}
                                                alt={w.name}
                                                use:fallbackIcon={'/icons/placeholder-weapon.svg'}
                                                class="size-full object-contain"
                                            />
                                        {:else}
                                            <div
                                                class="flex size-full items-center justify-center text-xs text-(--theme-muted-text)"
                                            >
                                                {w.name.charAt(0)}
                                            </div>
                                        {/if}
                                    </div>
                                    <span class="truncate text-sm leading-tight text-(--theme-modal-text)"
                                        >{w.name}</span
                                    >
                                    <span class="text-[10px] text-yellow-600">{'★'.repeat(w.star)}</span>
                                </div>
                            {/each}
                        </div>
                    {/if}
                {:else}
                    {#each groupedByStar as [star, list]}
                        <div class="mb-4">
                            <div class="mb-2 text-xs font-medium text-(--theme-muted-text)">{star}★</div>
                            <div class="flex flex-wrap gap-2">
                                {#each list as w}
                                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                                    <div
                                        onclick={() => toggleSelect(w)}
                                        onkeydown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault()
                                                toggleSelect(w)
                                            }
                                        }}
                                        role="button"
                                        tabindex="0"
                                        class={itemClass(w)}
                                    >
                                        <div class="size-14 overflow-hidden rounded-lg bg-(--theme-modal-text)/10 p-1">
                                            {#if icons[w.name]}
                                                <img
                                                    src={icons[w.name]}
                                                    alt={w.name}
                                                    use:fallbackIcon={'/icons/placeholder-weapon.svg'}
                                                    class="size-full object-contain"
                                                />
                                            {:else}
                                                <div
                                                    class="flex size-full items-center justify-center text-xs text-(--theme-muted-text)"
                                                >
                                                    {w.name.charAt(0)}
                                                </div>
                                            {/if}
                                        </div>
                                        <span class="truncate text-sm leading-tight text-(--theme-modal-text)"
                                            >{w.name}</span
                                        >
                                        <span class="text-[10px] text-yellow-600">{'★'.repeat(w.star)}</span>
                                    </div>
                                {/each}
                            </div>
                        </div>
                    {/each}
                {/if}
            </div>

            <div class="flex justify-end border-t px-4 py-2.5" style="border-color: var(--theme-divider-border)">
                <button
                    onclick={handleConfirm}
                    class="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-all hover:brightness-125"
                    style="background: var(--theme-btn-bg); color: var(--theme-btn-text);"
                >
                    <Icon icon="mdi:check" class="size-4" />
                    确认
                </button>
            </div>
        </div>
    </div>
{/if}
