<script lang="ts">
    import type { Echo } from '$lib/api/types'
    import type { ComponentsProps } from '$lib/types'
    import { fallbackIcon } from '$lib/utils/icons'
    import EmptyState from '$lib/components/ui/empty-state.svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import PickerSearch from './picker-search.svelte'
    import PickerFooter from './picker-footer.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import { pickerCardClass } from '$lib/utils/picker-card-class'

    interface Props extends ComponentsProps {
        open: boolean
        onclose: () => void
        onselect: (echo: Echo | null) => void
        echoes: Echo[]
        icons: Record<string, string>
        currentName?: string
    }

    let { open, onclose, onselect, echoes, icons, currentName, class: className, style: styleProp }: Props = $props()

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
</script>

<Modal {open} {onclose} class={mergeClass(['w-160 max-w-[90vw] min-h-[40vh]', className])} style={styleProp}>
    {#snippet title()}
        <PickerSearch bind:value={query} placeholder="搜索声骸..." />
    {/snippet}
    {#if filtered.length === 0}
        <EmptyState size="lg">无匹配声骸</EmptyState>
    {:else}
        {#if query}
            <div class="flex flex-wrap gap-2">
                {#each filtered as e (e.name)}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <div
                        data-press=""
                        onclick={() => toggleSelect(e)}
                        onkeydown={(ev) => {
                            if (ev.key === 'Enter' || ev.key === ' ') {
                                ev.preventDefault()
                                toggleSelect(e)
                            }
                        }}
                        role="button"
                        tabindex="0"
                        data-sf="widget"
                        data-sf-flat
                        style="--sf-base: var(--theme-input-bg)"
                        class={pickerCardClass(isSelected(e), 'w-[110px]')}
                    >
                        <div class="size-14 overflow-hidden rounded-none bg-(--theme-modal-text)/10 p-1">
                            {#if icons[e.name]}
                                <img
                                    src={icons[e.name]}
                                    alt={e.name}
                                    use:fallbackIcon={'/icons/placeholder-echo.svg'}
                                    class="size-full object-contain"
                                />
                            {:else}
                                <div
                                    class="flex size-full items-center justify-center text-xs text-(--theme-modal-text)/40"
                                >
                                    {e.name.charAt(0)}
                                </div>
                            {/if}
                        </div>
                        <span class="truncate text-[11px] font-black leading-tight text-(--theme-modal-text)"
                            >{e.name}</span
                        >
                        <span class="text-[10px] font-black text-(--theme-accent-text)">C{e.cost}</span>
                    </div>
                {/each}
            </div>
        {:else}
            {#each groupedByCost as [cost, list] (cost)}
                <div class="mb-4">
                    <div
                        class="mb-2 flex items-center gap-1.5 border-t pt-3 text-xs font-black tracking-tight text-(--theme-modal-text)/80"
                        style="border-color: var(--theme-divider-border);"
                    >
                        C{cost}
                    </div>
                    <div class="flex flex-wrap gap-2">
                        {#each list as e (e.name)}
                            <!-- svelte-ignore a11y_no_static_element_interactions -->
                            <!-- svelte-ignore a11y_click_events_have_key_events -->
                            <div
                                data-press=""
                                onclick={() => toggleSelect(e)}
                                onkeydown={(ev) => {
                                    if (ev.key === 'Enter' || ev.key === ' ') {
                                        ev.preventDefault()
                                        toggleSelect(e)
                                    }
                                }}
                                role="button"
                                tabindex="0"
                                data-sf="widget"
                                data-sf-flat
                                style="--sf-base: var(--theme-input-bg)"
                                class={pickerCardClass(isSelected(e), 'w-[110px]')}
                            >
                                <div class="size-14 overflow-hidden rounded-none bg-(--theme-modal-text)/10 p-1">
                                    {#if icons[e.name]}
                                        <img
                                            src={icons[e.name]}
                                            alt={e.name}
                                            use:fallbackIcon={'/icons/placeholder-echo.svg'}
                                            class="size-full object-contain"
                                        />
                                    {:else}
                                        <div
                                            class="flex size-full items-center justify-center text-xs text-(--theme-modal-text)/40"
                                        >
                                            {e.name.charAt(0)}
                                        </div>
                                    {/if}
                                </div>
                                <span class="truncate text-[11px] font-black leading-tight text-(--theme-modal-text)"
                                    >{e.name}</span
                                >
                            </div>
                        {/each}
                    </div>
                </div>
            {/each}
        {/if}
    {/if}
    {#snippet footer()}
        <PickerFooter onconfirm={handleConfirm} />
    {/snippet}
</Modal>
