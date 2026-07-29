<script lang="ts">
    import type { Character } from '$lib/api/types'
    import Icon from '@iconify/svelte'
    import { fallbackIcon } from '$lib/utils/icons'

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
            class="relative flex max-h-[75vh] min-h-[50vh] w-170 max-w-[90vw] flex-col rounded-xl text-(--theme-modal-text) shadow-2xl"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent);"
            role="dialog"
            aria-modal="true"
        >
            <div class="flex items-center gap-2 border-b px-4 py-3" style="border-color: var(--theme-divider-border)">
                <Icon icon="mdi:magnify" class="size-4 shrink-0 text-(--theme-muted-text)" />
                <input
                    bind:value={query}
                    placeholder="搜索角色..."
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

            <div class="flex flex-1 overflow-hidden">
                <!-- Content area (left) -->
                <div class="flex-1 overflow-y-auto p-4">
                    {#if showSearchResults}
                        {#if searchResults.length === 0}
                            <div class="py-12 text-center text-sm text-(--theme-muted-text)">无匹配角色</div>
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
                                        <div class="size-14 overflow-hidden rounded-full bg-(--theme-modal-text)/10">
                                            {#if icons[c.name]}
                                                <img
                                                    src={icons[c.name]}
                                                    alt={c.name}
                                                    use:fallbackIcon={'/icons/placeholder-character.svg'}
                                                    class="size-full object-cover"
                                                />
                                            {:else}
                                                <div
                                                    class="flex size-full items-center justify-center text-xs text-(--theme-muted-text)"
                                                >
                                                    {c.name.charAt(0)}
                                                </div>
                                            {/if}
                                        </div>
                                        <span class="truncate text-sm leading-tight text-(--theme-modal-text)"
                                            >{c.name}</span
                                        >
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    {:else}
                        {#each ELEMENT_ORDER as el}
                            {@const group = groupedCharacters.get(el)}
                            {#if group && (group.rover.length > 0 || group.fiveStar.length > 0 || group.fourStar.length > 0)}
                                <div bind:this={groupRefs[el]} class="mb-4">
                                    <div
                                        class="mb-2 flex items-center gap-1.5 text-xs font-medium text-(--theme-muted-text)"
                                    >
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
                                                <div
                                                    class="size-14 overflow-hidden rounded-full bg-(--theme-modal-text)/10"
                                                >
                                                    {#if icons[c.name]}
                                                        <img
                                                            src={icons[c.name]}
                                                            alt={c.name}
                                                            use:fallbackIcon={'/icons/placeholder-character.svg'}
                                                            class="size-full object-cover"
                                                        />
                                                    {:else}
                                                        <div
                                                            class="flex size-full items-center justify-center text-xs text-(--theme-muted-text)"
                                                        >
                                                            {c.name.charAt(0)}
                                                        </div>
                                                    {/if}
                                                </div>
                                                <span
                                                    class="truncate text-[11px] leading-tight text-(--theme-modal-text)"
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
                    <div
                        class="flex w-10 shrink-0 flex-col items-center gap-2 border-l py-3"
                        style="border-color: var(--theme-divider-border)"
                    >
                        {#each ELEMENT_ORDER as el}
                            <button
                                onclick={() => scrollToElement(el)}
                                class="flex size-7 items-center justify-center rounded p-0.5 text-(--theme-muted-text) transition-colors hover:bg-(--theme-modal-text)/5 hover:text-(--theme-modal-text)"
                                title={el}
                            >
                                {#if elementIcons[el]}
                                    <img src={elementIcons[el]} alt={el} class="size-full object-contain" />
                                {:else}
                                    <Icon icon="mdi:circle" class="size-3.5" />
                                {/if}
                            </button>
                        {/each}
                    </div>
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
