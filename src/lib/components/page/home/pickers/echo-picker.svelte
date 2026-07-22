<script lang="ts">
    import type { Echo } from '$lib/api/types'

    interface Props {
        open: boolean
        onclose: () => void
        onselect: (echo: Echo | null) => void
        echoes: Echo[]
        icons: Record<string, string>
        currentName?: string
    }

    let { open, onclose, onselect, echoes, icons, currentName }: Props = $props()

    let query = $state('')
    let localSelected = $state<Echo | null>(null)

    $effect(() => {
        if (open) {
            localSelected = echoes.find((e) => e.name === currentName) ?? null
            query = ''
        }
    })

    let filtered = $derived.by(() => {
        let list = query ? echoes.filter((e) => e.name.includes(query)) : echoes
        return [...list].sort((a, b) => b.cost - a.cost)
    })

    let groupedByCost = $derived.by(() => {
        const map = new Map<number, Echo[]>()
        for (const e of filtered) {
            const arr = map.get(e.cost) || []
            arr.push(e)
            map.set(e.cost, arr)
        }
        return [...map.entries()].sort(([a], [b]) => b - a)
    })

    function toggleSelect(e: Echo) {
        if (localSelected?.name === e.name) {
            localSelected = null
        } else {
            localSelected = e
        }
    }

    function handleConfirm() {
        onselect(localSelected)
        onclose()
    }

    function isSelected(e: Echo): boolean {
        return localSelected?.name === e.name
    }

    function itemClass(e: Echo): string {
        const base = 'flex w-[110px] flex-col items-center gap-1.5 rounded-lg p-3 transition-colors cursor-pointer'
        if (isSelected(e)) {
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
                    placeholder="搜索声骸..."
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
                {#if filtered.length === 0}
                    <div class="py-12 text-center text-sm text-zinc-500">无匹配声骸</div>
                {:else}
                    {#if query}
                        <div class="flex flex-wrap gap-2">
                            {#each filtered as e}
                                <!-- svelte-ignore a11y_no_static_element_interactions -->
                                <!-- svelte-ignore a11y_click_events_have_key_events -->
                                <div
                                    onclick={() => toggleSelect(e)}
                                    onkeydown={(ev) => {
                                        if (ev.key === 'Enter' || ev.key === ' ') {
                                            ev.preventDefault()
                                            toggleSelect(e)
                                        }
                                    }}
                                    role="button"
                                    tabindex="0"
                                    class={itemClass(e)}
                                >
                                    <div class="size-14 overflow-hidden rounded-lg bg-white/10 p-1">
                                        {#if icons[e.name]}
                                            <img src={icons[e.name]} alt={e.name} class="size-full object-contain" />
                                        {:else}
                                            <div
                                                class="flex size-full items-center justify-center text-xs text-zinc-500"
                                            >
                                                {e.name.charAt(0)}
                                            </div>
                                        {/if}
                                    </div>
                                    <span class="truncate text-sm leading-tight text-zinc-300">{e.name}</span>
                                    <span class="text-[10px] text-cyan-600">C{e.cost}</span>
                                </div>
                            {/each}
                        </div>
                    {:else}
                        {#each groupedByCost as [cost, list]}
                            <div class="mb-4">
                                <div class="mb-2 text-xs font-medium text-zinc-500">C{cost}</div>
                                <div class="flex flex-wrap gap-2">
                                    {#each list as e}
                                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                                        <div
                                            onclick={() => toggleSelect(e)}
                                            onkeydown={(ev) => {
                                                if (ev.key === 'Enter' || ev.key === ' ') {
                                                    ev.preventDefault()
                                                    toggleSelect(e)
                                                }
                                            }}
                                            role="button"
                                            tabindex="0"
                                            class={itemClass(e)}
                                        >
                                            <div class="size-14 overflow-hidden rounded-lg bg-white/10 p-1">
                                                {#if icons[e.name]}
                                                    <img
                                                        src={icons[e.name]}
                                                        alt={e.name}
                                                        class="size-full object-contain"
                                                    />
                                                {:else}
                                                    <div
                                                        class="flex size-full items-center justify-center text-xs text-zinc-500"
                                                    >
                                                        {e.name.charAt(0)}
                                                    </div>
                                                {/if}
                                            </div>
                                            <span class="truncate text-[11px] leading-tight text-zinc-300"
                                                >{e.name}</span
                                            >
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        {/each}
                    {/if}
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
