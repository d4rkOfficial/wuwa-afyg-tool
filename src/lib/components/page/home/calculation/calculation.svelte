<script lang="ts">
    import {
        getEntries,
        getBlocks,
        getEntryBlockIds,
        toggleEntryBlock,
        getShowBuffModal,
        setShowBuffModal,
        getCalcState,
        init
    } from './calculation.store.svelte'
    import { ZONE_MAP } from './calculation.consts'
    import { ELEMENT_COLORS } from '../timeline/timeline.consts'
    import { getCharElementMap } from '../timeline/timeline.store.svelte'
    import type { CharSlot } from '$lib/data/types'
    import type { TimelineData } from '../timeline/timeline.types'
    import type { CalcState } from './calculation.types'
    import BuffModal from './buff-modal.svelte'
    import Icon from '@iconify/svelte'

    interface Props {
        team: [CharSlot, CharSlot, CharSlot]
        timelineData: TimelineData | null
        calcState: CalcState | null
        locked?: boolean
        onupdate: (state: CalcState) => void
    }

    let { team, timelineData, calcState, locked = false, onupdate }: Props = $props()

    let expandedId = $state<string | null>(null)

    $effect(() => {
        init(team, timelineData, calcState, locked)
    })

    let entries = $derived(getEntries())
    let blocks = $derived(getBlocks())
    let charElements = $derived(getCharElementMap())
    let showBuffModal = $derived(getShowBuffModal())

    let selectedEntry = $derived(entries.find((e) => e.id === expandedId) ?? null)
    let selectedBlockIds = $derived(expandedId ? getEntryBlockIds(expandedId) : [])

    function handleToggleExpand(id: string) {
        expandedId = expandedId === id ? null : id
    }

    function handleToggleBlock(blockId: string) {
        if (!expandedId) return
        toggleEntryBlock(expandedId, blockId)
        onupdate(getCalcState())
    }

    function handleCloseBuffModal() {
        setShowBuffModal(false)
        onupdate(getCalcState())
    }
</script>

<BuffModal open={showBuffModal} {team} onclose={handleCloseBuffModal} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="h-full overflow-auto"
    onwheel={(e) => {
        if (e.ctrlKey) {
            e.preventDefault()
            ;(e.currentTarget as HTMLElement).scrollLeft += e.deltaY
        }
    }}
>
    <table class="w-full text-xs">
        <thead>
            <tr
                class="text-[var(--theme-modal-text)]/50 border-b border-white/10 sticky top-0 bg-[var(--theme-modal-bg)]"
            >
                <th class="text-left font-medium py-2 px-3">来源</th>
                <th class="text-left font-medium py-2 px-3">[技能]倍率名</th>
                <th class="text-left font-medium py-2 px-3">Buff</th>
            </tr>
        </thead>
        <tbody>
            {#each entries as entry}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <tr
                    onclick={() => handleToggleExpand(entry.id)}
                    class={[
                        'cursor-pointer border-b border-white/5 transition-colors',
                        expandedId === entry.id ? 'bg-indigo-500/10' : 'hover:bg-white/5'
                    ].join(' ')}
                >
                    <td class="py-1.5 px-3">
                        <span
                            style="color: {(ELEMENT_COLORS as Record<string, string>)[charElements[entry.character]] ??
                                '#888'}"
                        >
                            {entry.character}
                        </span>
                    </td>
                    <td class="py-1.5 px-3">
                        <span class="text-[var(--theme-modal-text)]/40">[{entry.skillType}]</span>
                        <span style="color: {(ELEMENT_COLORS as Record<string, string>)[entry.element] ?? '#888'}">
                            {entry.hitName}
                        </span>
                        {#if entry.hits > 1}
                            <span class="text-[var(--theme-modal-text)]/40"> ×{entry.hits}</span>
                        {/if}
                    </td>
                    <td class="py-1.5 px-3">
                        <div class="flex flex-wrap gap-1">
                            {#each getEntryBlockIds(entry.id) as blockId}
                                {@const block = blocks.find((b) => b.id === blockId)}
                                {#if block}
                                    <span
                                        class="inline-flex items-center gap-1 rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] text-indigo-400"
                                    >
                                        <Icon icon="mdi:widgets" class="size-3" />
                                        {block.name}
                                    </span>
                                {/if}
                            {/each}
                        </div>
                    </td>
                </tr>
                {#if expandedId === entry.id}
                    <tr class="bg-white/[0.02]">
                        <td colspan="3" class="p-0">
                            <div class="border-b border-white/5 px-6 py-3">
                                {#if blocks.length > 0}
                                    <div class="grid grid-cols-2 gap-x-4 gap-y-0.5">
                                        {#each blocks as block}
                                            {@const checked = selectedBlockIds.includes(block.id)}
                                            <label
                                                class="flex items-center gap-2 cursor-pointer rounded px-2 py-1 hover:bg-white/5"
                                                onclick={(e) => e.stopPropagation()}
                                            >
                                                <input
                                                    type="checkbox"
                                                    {checked}
                                                    onchange={() => handleToggleBlock(block.id)}
                                                    class="size-3.5 accent-indigo-500 shrink-0"
                                                />
                                                <span class="text-xs text-[var(--theme-modal-text)] truncate"
                                                    >{block.name}</span
                                                >
                                            </label>
                                        {/each}
                                    </div>
                                {:else}
                                    <div class="text-xs text-[var(--theme-modal-text)]/30">暂无 BUFF 块</div>
                                {/if}
                            </div>
                        </td>
                    </tr>
                {/if}
            {/each}
        </tbody>
    </table>
    {#if entries.length === 0}
        <div class="flex items-center justify-center py-12 text-xs text-[var(--theme-modal-text)]/40">暂无伤害数据</div>
    {/if}
</div>
