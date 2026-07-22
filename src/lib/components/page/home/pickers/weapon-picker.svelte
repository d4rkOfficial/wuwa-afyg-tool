<script lang="ts">
    import type { Weapon } from '$lib/api/types'

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
            return base + ' ring-2 ring-indigo-500 bg-indigo-500/10'
        }
        return base + ' hover:bg-white/10'
    }
</script>

{#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        class="fixed inset-0 z-50 flex items-center justify-center"
        onkeydown={(e) => {
            if (e.key === 'Escape') onclose()
        }}
    >
        <div
            class="relative flex max-h-[70vh] min-h-[40vh] w-[640px] max-w-[90vw] flex-col rounded-xl bg-[var(--theme-modal-bg)] text-[var(--theme-modal-text)] shadow-2xl"
            role="dialog"
            aria-modal="true"
        >
            <div class="flex items-center gap-2 border-b border-white/5 px-4 py-3">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    class="shrink-0 opacity-50"
                    ><path
                        fill="currentColor"
                        d="m19.6 21l-6.3-6.3q-.75.6-1.725.95T9.5 16q-2.725 0-4.612-1.888T3 9.5t1.888-4.612T9.5 3t4.613 1.888T16 9.5q0 1.1-.35 2.075T14.7 13.3l6.3 6.3zM9.5 14q1.875 0 3.188-1.312T14 9.5t-1.312-3.187T9.5 5T6.313 6.313T5 9.5t1.313 3.188T9.5 14"
                    /></svg
                >
                <input
                    bind:value={query}
                    placeholder="搜索武器..."
                    class="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/30"
                />
                {#if query}
                    <button
                        onclick={() => (query = '')}
                        class="rounded p-0.5 opacity-50 hover:opacity-100"
                        aria-label="Clear search"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                            ><path
                                fill="currentColor"
                                d="M18.3 5.71a1 1 0 0 0-1.42 0L12 10.59L7.12 5.71a1 1 0 1 0-1.42 1.42L10.59 12l-4.89 4.88a1 1 0 1 0 1.42 1.42L12 13.41l4.88 4.89a1 1 0 0 0 1.42-1.42L13.41 12l4.89-4.88a1 1 0 0 0 0-1.41"
                            /></svg
                        >
                    </button>
                {/if}
            </div>

            <div class="flex-1 overflow-y-auto p-4">
                {#if query}
                    {#if filtered.length === 0}
                        <div class="py-12 text-center text-sm text-zinc-500">无匹配武器</div>
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
                                    <div class="size-14 overflow-hidden rounded-lg bg-white/10 p-1">
                                        {#if icons[w.name]}
                                            <img src={icons[w.name]} alt={w.name} class="size-full object-contain" />
                                        {:else}
                                            <div
                                                class="flex size-full items-center justify-center text-xs text-zinc-500"
                                            >
                                                {w.name.charAt(0)}
                                            </div>
                                        {/if}
                                    </div>
                                    <span class="truncate text-sm leading-tight text-zinc-300">{w.name}</span>
                                    <span class="text-[10px] text-yellow-600">{'★'.repeat(w.star)}</span>
                                </div>
                            {/each}
                        </div>
                    {/if}
                {:else}
                    {#each groupedByStar as [star, list]}
                        <div class="mb-4">
                            <div class="mb-2 text-xs font-medium text-zinc-500">{star}★</div>
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
                                        <div class="size-14 overflow-hidden rounded-lg bg-white/10 p-1">
                                            {#if icons[w.name]}
                                                <img
                                                    src={icons[w.name]}
                                                    alt={w.name}
                                                    class="size-full object-contain"
                                                />
                                            {:else}
                                                <div
                                                    class="flex size-full items-center justify-center text-xs text-zinc-500"
                                                >
                                                    {w.name.charAt(0)}
                                                </div>
                                            {/if}
                                        </div>
                                        <span class="truncate text-sm leading-tight text-zinc-300">{w.name}</span>
                                        <span class="text-[10px] text-yellow-600">{'★'.repeat(w.star)}</span>
                                    </div>
                                {/each}
                            </div>
                        </div>
                    {/each}
                {/if}
            </div>

            <div class="flex justify-end border-t border-white/5 px-4 py-2.5">
                <button
                    onclick={handleConfirm}
                    class="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium text-[var(--theme-btn-text)] transition-colors hover:bg-white/5"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                        ><path
                            fill="currentColor"
                            d="M9 16.17L5.53 12.7a1 1 0 0 0-1.42 1.42l4.18 4.18a1 1 0 0 0 1.42 0L20.29 7.71a1 1 0 1 0-1.42-1.42z"
                        /></svg
                    >
                    确认
                </button>
            </div>
        </div>
    </div>
{/if}
