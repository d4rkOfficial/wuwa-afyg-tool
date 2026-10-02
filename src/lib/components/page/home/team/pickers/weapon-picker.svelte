<script lang="ts">
    import type { Weapon } from '$lib/api/types'
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
        onselect: (weapon: Weapon | null) => void
        weapons: Weapon[]
        icons: Record<string, string>
        currentName?: string
    }

    let { open, onclose, onselect, weapons, icons, currentName, class: className, style: styleProp }: Props = $props()

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
</script>

<Modal {open} {onclose} class={mergeClass(['w-160 max-w-[90vw] min-h-[40vh]', className])} style={styleProp}>
    {#snippet title()}
        <PickerSearch bind:value={query} placeholder="搜索武器..." />
    {/snippet}
    {#if query}
        {#if filtered.length === 0}
            <EmptyState size="lg">无匹配武器</EmptyState>
        {:else}
            <div class="flex flex-wrap gap-2">
                {#each filtered as w (w.name)}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <div
                        data-press=""
                        onclick={() => toggleSelect(w)}
                        onkeydown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                toggleSelect(w)
                            }
                        }}
                        role="button"
                        tabindex="0"
                        data-sf="widget"
                        data-sf-flat
                        style="--sf-base: var(--theme-input-bg)"
                        class={pickerCardClass(isSelected(w), 'w-[110px]')}
                    >
                        <div class="size-14 overflow-hidden rounded-none bg-(--theme-modal-text)/10 p-1">
                            {#if icons[w.name]}
                                <img
                                    src={icons[w.name]}
                                    alt={w.name}
                                    use:fallbackIcon={'/icons/placeholder-weapon.svg'}
                                    class="size-full object-contain"
                                />
                            {:else}
                                <div
                                    class="flex size-full items-center justify-center text-xs text-(--theme-modal-text)/40"
                                >
                                    {w.name.charAt(0)}
                                </div>
                            {/if}
                        </div>
                        <span class="truncate text-[11px] font-black leading-tight text-(--theme-modal-text)"
                            >{w.name}</span
                        >
                        <span class="text-[10px] font-black text-amber-600">{'★'.repeat(w.star)}</span>
                    </div>
                {/each}
            </div>
        {/if}
    {:else}
        {#each groupedByStar as [star, list] (star)}
            <div class="mb-4">
                <div
                    class="mb-2 flex items-center gap-1.5 border-t pt-3 text-xs font-black tracking-tight text-(--theme-modal-text)/80"
                    style="border-color: var(--theme-divider-border);"
                >
                    {star}★
                </div>
                <div class="flex flex-wrap gap-2">
                    {#each list as w (w.name)}
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <div
                            data-press=""
                            onclick={() => toggleSelect(w)}
                            onkeydown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    toggleSelect(w)
                                }
                            }}
                            role="button"
                            tabindex="0"
                            data-sf="widget"
                            data-sf-flat
                            style="--sf-base: var(--theme-input-bg)"
                            class={pickerCardClass(isSelected(w), 'w-[110px]')}
                        >
                            <div class="size-14 overflow-hidden rounded-none bg-(--theme-modal-text)/10 p-1">
                                {#if icons[w.name]}
                                    <img
                                        src={icons[w.name]}
                                        alt={w.name}
                                        use:fallbackIcon={'/icons/placeholder-weapon.svg'}
                                        class="size-full object-contain"
                                    />
                                {:else}
                                    <div
                                        class="flex size-full items-center justify-center text-xs text-(--theme-modal-text)/40"
                                    >
                                        {w.name.charAt(0)}
                                    </div>
                                {/if}
                            </div>
                            <span class="truncate text-[11px] font-black leading-tight text-(--theme-modal-text)"
                                >{w.name}</span
                            >
                            <span class="text-[10px] font-black text-amber-600">{'★'.repeat(w.star)}</span>
                        </div>
                    {/each}
                </div>
            </div>
        {/each}
    {/if}
    {#snippet footer()}
        <PickerFooter onconfirm={handleConfirm} />
    {/snippet}
</Modal>
