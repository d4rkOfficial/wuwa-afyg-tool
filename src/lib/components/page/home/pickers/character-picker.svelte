<script lang="ts">
    import type { Character } from '$lib/api/types'

    interface GroupData {
        rover: Character[]
        fiveStar: Character[]
        fourStar: Character[]
    }

    interface Props {
        open: boolean
        onclose: () => void
        onselect: (character: Character | null) => void
        characters: Character[]
        icons: Record<string, string>
        elementIcons?: Record<string, string>
        currentName?: string
    }

    let { open, onclose, onselect, characters, icons, elementIcons = {}, currentName }: Props = $props()

    const ELEMENT_ORDER = ['冷凝', '热熔', '导电', '气动', '衍射', '湮灭']

    let query = $state('')
    let groupRefs: Record<string, HTMLDivElement | null> = {}
    let localSelected = $state<Character | null>(null)

    $effect(() => {
        if (open) {
            localSelected = characters.find((c) => c.name === currentName) ?? null
            query = ''
        }
    })

    let groupedCharacters = $derived.by(() => {
        const map = new Map<string, GroupData>()
        for (const el of ELEMENT_ORDER) {
            map.set(el, { rover: [], fiveStar: [], fourStar: [] })
        }
        for (const c of characters) {
            const group = map.get(c.element)
            if (!group) continue
            if (c.name.includes('漂泊者')) {
                group.rover.push(c)
            } else if (c.star === 5) {
                group.fiveStar.push(c)
            } else if (c.star === 4) {
                group.fourStar.push(c)
            }
        }
        return map
    })

    let showSearchResults = $derived(query.length > 0)

    let searchResults = $derived(characters.filter((c) => c.name.includes(query)))

    function scrollToElement(element: string) {
        groupRefs[element]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    function toggleSelect(c: Character) {
        if (localSelected?.name === c.name) {
            localSelected = null
        } else {
            localSelected = c
        }
    }

    function handleConfirm() {
        onselect(localSelected)
        onclose()
    }

    function isSelected(c: Character): boolean {
        return localSelected?.name === c.name
    }

    function itemClass(c: Character): string {
        const base = 'flex w-[100px] flex-col items-center gap-1.5 rounded-lg p-3 transition-colors cursor-pointer'
        if (isSelected(c)) {
            return base + ' ring-2 ring-indigo-500 bg-indigo-500/10'
        }
        return base + ' hover:bg-white/10'
    }
</script>

{#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
        onkeydown={(e) => {
            if (e.key === 'Escape') onclose()
        }}
    >
        <div
            class="relative flex max-h-[75vh] min-h-[50vh] w-[680px] max-w-[90vw] flex-col rounded-xl bg-[var(--theme-modal-bg)] text-[var(--theme-modal-text)] shadow-2xl"
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
                    placeholder="搜索角色..."
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

            <div class="flex flex-1 overflow-hidden">
                <!-- Content area (left) -->
                <div class="flex-1 overflow-y-auto p-4">
                    {#if showSearchResults}
                        {#if searchResults.length === 0}
                            <div class="py-12 text-center text-sm text-zinc-500">无匹配角色</div>
                        {:else}
                            <div class="flex flex-wrap gap-2">
                                {#each searchResults as c}
                                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                                    <div
                                        onclick={() => toggleSelect(c)}
                                        onkeydown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault()
                                                toggleSelect(c)
                                            }
                                        }}
                                        role="button"
                                        tabindex="0"
                                        class={itemClass(c)}
                                    >
                                        <div class="size-14 overflow-hidden rounded-full bg-white/10">
                                            {#if icons[c.name]}
                                                <img src={icons[c.name]} alt={c.name} class="size-full object-cover" />
                                            {:else}
                                                <div
                                                    class="flex size-full items-center justify-center text-xs text-zinc-500"
                                                >
                                                    {c.name.charAt(0)}
                                                </div>
                                            {/if}
                                        </div>
                                        <span class="truncate text-sm leading-tight text-zinc-300">{c.name}</span>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    {:else}
                        {#each ELEMENT_ORDER as el}
                            {@const group = groupedCharacters.get(el)}
                            {#if group && (group.rover.length > 0 || group.fiveStar.length > 0 || group.fourStar.length > 0)}
                                <div bind:this={groupRefs[el]} class="mb-4">
                                    <div class="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                                        {#if elementIcons[el]}
                                            <img src={elementIcons[el]} alt={el} class="size-4 object-contain" />
                                        {/if}
                                        {el}
                                    </div>
                                    <div class="flex flex-wrap gap-2">
                                        {#each ([] as Character[]).concat(group.rover, group.fiveStar, group.fourStar) as c}
                                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                                            <div
                                                onclick={() => toggleSelect(c)}
                                                onkeydown={(e) => {
                                                    if (e.key === 'Enter' || e.key === ' ') {
                                                        e.preventDefault()
                                                        toggleSelect(c)
                                                    }
                                                }}
                                                role="button"
                                                tabindex="0"
                                                class={itemClass(c)}
                                            >
                                                <div class="size-14 overflow-hidden rounded-full bg-white/10">
                                                    {#if icons[c.name]}
                                                        <img
                                                            src={icons[c.name]}
                                                            alt={c.name}
                                                            class="size-full object-cover"
                                                        />
                                                    {:else}
                                                        <div
                                                            class="flex size-full items-center justify-center text-xs text-zinc-500"
                                                        >
                                                            {c.name.charAt(0)}
                                                        </div>
                                                    {/if}
                                                </div>
                                                <span class="truncate text-[11px] leading-tight text-zinc-300"
                                                    >{c.name}</span
                                                >
                                            </div>
                                        {/each}
                                    </div>
                                </div>
                            {/if}
                        {/each}
                    {/if}
                </div>

                <!-- Element nav sidebar (right) -->
                {#if !showSearchResults}
                    <div class="flex w-10 shrink-0 flex-col items-center gap-2 border-l border-white/5 py-3">
                        {#each ELEMENT_ORDER as el}
                            <button
                                onclick={() => scrollToElement(el)}
                                class="flex size-7 items-center justify-center rounded p-0.5 text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-300"
                                title={el}
                            >
                                {#if elementIcons[el]}
                                    <img src={elementIcons[el]} alt={el} class="size-full object-contain" />
                                {:else}
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                                        ><path
                                            fill="currentColor"
                                            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2"
                                        /></svg
                                    >
                                {/if}
                            </button>
                        {/each}
                    </div>
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
