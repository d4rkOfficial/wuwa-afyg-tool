<script lang="ts">
    import { untrack } from 'svelte'
    import {
        getAllDamageEntries,
        getAllBuffSets,
        getBuffSetIdsForEntry,
        toggleBuffSetForEntry,
        getShowBuffModal,
        setShowBuffModal,
        getCalcState,
        getCalcElementMap,
        getDamageTypesForEntry,
        toggleDamageTypeForEntry,
        init,
        getGlobalBuffSetIds
    } from './calculation.store.svelte'
    import { ZONE_MAP, DAMAGE_TYPES, DAMAGE_TYPE_SHORT } from './calculation.consts'
    import { ELEMENT_COLORS } from '../timeline/timeline.consts'
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

    let expandedEntryId = $state<string | null>(null)

    $effect(() => {
        untrack(() => init(team, timelineData, calcState, locked))
    })

    let damageEntries = $derived(getAllDamageEntries())
    let buffSets = $derived(getAllBuffSets())
    let calcElementMap = $derived(getCalcElementMap())
    let showBuffModal = $derived(getShowBuffModal())
    let globalBuffSetIds = $derived(getGlobalBuffSetIds())
    let entryDamageTypeMap = $derived<Record<string, string[]>>(
        Object.fromEntries(damageEntries.map((e) => [e.id, getDamageTypesForEntry(e.id)]))
    )
    let entryBuffSetIdMap = $derived<Record<string, string[]>>(
        Object.fromEntries(damageEntries.map((e) => [e.id, getBuffSetIdsForEntry(e.id)]))
    )

    let selectedEntry = $derived(damageEntries.find((e) => e.id === expandedEntryId) ?? null)
    let selectedEntrySetIds = $derived(expandedEntryId ? getBuffSetIdsForEntry(expandedEntryId) : [])
    let charToIdx = $derived<Record<string, number>>(
        Object.fromEntries(team.map((s, i) => [s.character ?? '', i]).filter(([name]) => name !== ''))
    )
    let entryCharIdx = $derived(selectedEntry?.character ? (charToIdx[selectedEntry.character] ?? -1) : -1)
    let visibleBuffSets = $derived(
        (entryCharIdx >= 0
            ? buffSets.filter((b) => b.scope === 'all' || (b.scope as number[]).includes(entryCharIdx))
            : buffSets.filter((b) => b.scope === 'all')
        ).filter((b) => !globalBuffSetIds.includes(b.id))
    )

    function handleToggleExpand(id: string) {
        expandedEntryId = expandedEntryId === id ? null : id
    }

    function handleToggleBuffSetForEntry(setId: string) {
        if (!expandedEntryId) return
        toggleBuffSetForEntry(expandedEntryId, setId)
        onupdate(getCalcState())
    }

    function handleToggleDamageType(entryId: string, damageType: string) {
        toggleDamageTypeForEntry(entryId, damageType)
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
    <table class="w-full text-xs table-fixed">
        <thead>
            <tr
                class="text-(--theme-modal-text)/50 border-b border-white/10 sticky top-0 bg-[var(--theme-modal-bg)] opacity-100!"
            >
                <th class="text-left font-medium py-2 px-3 w-20 shrink-0 border-r border-dashed border-white/[0.05]"
                    >来源</th
                >
                <th class="text-left font-medium py-2 px-3 w-56 shrink-0 border-r border-dashed border-white/[0.05]"
                    >条目</th
                >
                <th class="text-left font-medium py-2 px-3 w-32 shrink-0 border-r border-dashed border-white/[0.05]"
                    >视为</th
                >
                <th class="text-left font-medium py-2 px-3">Buff</th>
            </tr>
        </thead>
        <tbody>
            {#each damageEntries as damageEntry}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <tr
                    onclick={() => handleToggleExpand(damageEntry.id)}
                    class={[
                        'cursor-pointer border-b border-white/5 transition-colors',
                        expandedEntryId === damageEntry.id ? 'bg-indigo-500/10' : 'hover:bg-white/5',
                        expandedEntryId !== null && expandedEntryId !== damageEntry.id ? 'opacity-40' : ''
                    ].join(' ')}
                >
                    <td
                        class="py-1.5 px-3 w-20 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap border-r border-dashed border-white/[0.05]"
                    >
                        <span
                            style="color: {(ELEMENT_COLORS as Record<string, string>)[
                                calcElementMap[damageEntry.character ?? '']
                            ] ?? '#888'}"
                        >
                            {damageEntry.character ?? '—'}
                        </span>
                    </td>
                    <td
                        class="py-1.5 px-3 w-56 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap border-r border-dashed border-white/[0.05]"
                    >
                        <span
                            style="color: {(ELEMENT_COLORS as Record<string, string>)[damageEntry.damageElement] ??
                                '#888'}"
                            title={damageEntry.displayName}
                        >
                            {damageEntry.displayName}
                        </span>
                    </td>
                    <td
                        class="py-1.5 px-3 w-32 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap border-r border-dashed border-white/[0.05]"
                    >
                        <div class="flex flex-wrap gap-0.5">
                            {#each entryDamageTypeMap[damageEntry.id] ?? [] as dt}
                                <span
                                    class="text-[10px] px-1 rounded bg-white/10 text-(--theme-modal-text)/70 leading-tight"
                                    >{DAMAGE_TYPE_SHORT[dt as keyof typeof DAMAGE_TYPE_SHORT] ?? dt}</span
                                >
                            {/each}
                        </div>
                    </td>
                    <td class="py-1.5 px-3">
                        <div class="flex flex-wrap gap-1">
                            {#each entryBuffSetIdMap[damageEntry.id] ?? [] as setId}
                                {@const buffSet = buffSets.find((s) => s.id === setId)}
                                {#if buffSet && !globalBuffSetIds.includes(setId)}
                                    <span
                                        class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-indigo-500/15 text-indigo-400"
                                    >
                                        <Icon icon="mdi:widgets" class="size-3" />
                                        {buffSet.name}
                                    </span>
                                {/if}
                            {/each}
                        </div>
                    </td>
                </tr>
                {#if expandedEntryId === damageEntry.id}
                    <tr class="bg-white/[0.02]">
                        <td colspan="4" class="p-0">
                            <div class="border-b border-white/5 px-6 py-3 space-y-3">
                                {#if !damageEntry.isEffect && !damageEntry.isTuneBreak && !damageEntry.isTuneResponse}
                                    <div>
                                        <div class="text-xs text-(--theme-modal-text)/50 mb-1.5">伤害类型</div>
                                        <div class="flex flex-wrap gap-1">
                                            {#each DAMAGE_TYPES as dt}
                                                {@const selected = (entryDamageTypeMap[damageEntry.id] ?? []).includes(
                                                    dt
                                                )}
                                                <!-- svelte-ignore a11y_click_events_have_key_events -->
                                                <!-- svelte-ignore a11y_no_static_element_interactions -->
                                                <button
                                                    onclick={(e) => {
                                                        e.stopPropagation()
                                                        handleToggleDamageType(damageEntry.id, dt)
                                                    }}
                                                    class={[
                                                        'px-2 py-1 text-xs rounded transition-colors',
                                                        selected
                                                            ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40'
                                                            : 'bg-white/5 text-(--theme-modal-text)/50 border border-white/10 hover:bg-white/10'
                                                    ].join(' ')}
                                                >
                                                    {dt}
                                                </button>
                                            {/each}
                                        </div>
                                    </div>
                                {/if}
                                {#if visibleBuffSets.length > 0}
                                    <div>
                                        <div class="text-xs text-(--theme-modal-text)/50 mb-1.5">BUFF</div>
                                        <div
                                            class="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-4 gap-y-0.5"
                                        >
                                            {#each visibleBuffSets as buffSet}
                                                {@const checked = selectedEntrySetIds.includes(buffSet.id)}
                                                <label
                                                    class="flex items-center gap-2 cursor-pointer rounded px-2 py-1 hover:bg-white/5"
                                                    onclick={(e) => e.stopPropagation()}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        {checked}
                                                        onchange={() => handleToggleBuffSetForEntry(buffSet.id)}
                                                        class="size-3.5 accent-indigo-500 shrink-0"
                                                    />
                                                    <span class="text-xs text-[var(--theme-modal-text)] truncate"
                                                        >{buffSet.name}</span
                                                    >
                                                </label>
                                            {/each}
                                        </div>
                                    </div>
                                {:else}
                                    <div class="text-xs text-[var(--theme-modal-text)]/30">
                                        无可用 BUFF 块，点击底栏【BUFF配置】按钮进行配置
                                    </div>
                                {/if}
                            </div>
                        </td>
                    </tr>
                {/if}
            {/each}
        </tbody>
    </table>
    {#if damageEntries.length === 0}
        <div class="flex items-center justify-center py-12 text-xs text-[var(--theme-modal-text)]/40">暂无伤害数据</div>
    {/if}
</div>
