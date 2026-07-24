<script lang="ts">
    import type { Echo } from '$lib/api/types'
    import Icon from '@iconify/svelte'

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
                    placeholder="搜索声骸..."
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
                {#if filtered.length === 0}
                    <div class="py-12 text-center text-sm text-(--theme-muted-text)">无匹配声骸</div>
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
                                    <div class="size-14 overflow-hidden rounded-lg bg-(--theme-modal-text)/10 p-1">
                                        {#if icons[e.name]}
                                            <img src={icons[e.name]} alt={e.name} class="size-full object-contain" />
                                        {:else}
                                            <div
                                                class="flex size-full items-center justify-center text-xs text-(--theme-muted-text)"
                                            >
                                                {e.name.charAt(0)}
                                            </div>
                                        {/if}
                                    </div>
                                    <span class="truncate text-sm leading-tight text-(--theme-modal-text)"
                                        >{e.name}</span
                                    >
                                    <span class="text-[10px] text-cyan-600">C{e.cost}</span>
                                </div>
                            {/each}
                        </div>
                    {:else}
                        {#each groupedByCost as [cost, list]}
                            <div class="mb-4">
                                <div class="mb-2 text-xs font-medium text-(--theme-muted-text)">C{cost}</div>
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
                                            <div
                                                class="size-14 overflow-hidden rounded-lg bg-(--theme-modal-text)/10 p-1"
                                            >
                                                {#if icons[e.name]}
                                                    <img
                                                        src={icons[e.name]}
                                                        alt={e.name}
                                                        class="size-full object-contain"
                                                    />
                                                {:else}
                                                    <div
                                                        class="flex size-full items-center justify-center text-xs text-(--theme-muted-text)"
                                                    >
                                                        {e.name.charAt(0)}
                                                    </div>
                                                {/if}
                                            </div>
                                            <span class="truncate text-[11px] leading-tight text-(--theme-modal-text)"
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
