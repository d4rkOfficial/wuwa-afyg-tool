<script lang="ts">
    import { untrack } from 'svelte'
    import {
        getAllDamageEntries,
        getAllBuffSets,
        getBuffSetIdsForEntry,
        toggleBuffSetForEntry,
        setBuffSetIdsForEntry,
        getShowBuffModal,
        setShowBuffModal,
        getCalcState,
        getCalcElementMap,
        getDamageTypesForEntry,
        toggleDamageTypeForEntry,
        init,
        getGlobalBuffSetIds
    } from './calculation.store.svelte'
    import { addToast } from '$lib/data/toast.svelte'
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
        team
        timelineData
        calcState
        locked
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

    function isDirectDamage(e: { isEffect: boolean; isTuneBreak: boolean; isTuneResponse: boolean }): boolean {
        return !e.isEffect && !e.isTuneBreak && !e.isTuneResponse
    }

    function handleCopyFromPrevDirect(entryId: string) {
        const entry = damageEntries.find((e) => e.id === entryId)
        if (!entry || !entry.character) return

        const entryIndex = damageEntries.findIndex((e) => e.id === entryId)
        if (entryIndex <= 0) {
            addToast('未找到本角色的上一个直伤', 'info')
            return
        }

        for (let i = entryIndex - 1; i >= 0; i--) {
            const prev = damageEntries[i]
            if (prev.character === entry.character && isDirectDamage(prev)) {
                const prevSetIds = getBuffSetIdsForEntry(prev.id)
                if (!setBuffSetIdsForEntry(entryId, prevSetIds)) return
                onupdate(getCalcState())
                addToast('已复制前段直伤的增益', 'success')
                return
            }
        }

        addToast('未找到本角色的上一个直伤', 'info')
    }

    function handleCopyToNextDirect(entryId: string) {
        const entry = damageEntries.find((e) => e.id === entryId)
        if (!entry || !entry.character) return

        const entryIndex = damageEntries.findIndex((e) => e.id === entryId)
        const char = entry.character
        const currentSetIds = getBuffSetIdsForEntry(entryId)

        for (let i = entryIndex + 1; i < damageEntries.length; i++) {
            const next = damageEntries[i]
            if (next.character === char && isDirectDamage(next)) {
                if (!setBuffSetIdsForEntry(next.id, [...currentSetIds])) return
                onupdate(getCalcState())
                expandedEntryId = next.id
                addToast('已复制增益到下一段直伤', 'success')
                return
            }
        }

        expandedEntryId = null
    }

    function handleClearAllBuffs(entryId: string) {
        if (!setBuffSetIdsForEntry(entryId, [])) return
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
                                <div>
                                    <div class="text-xs text-(--theme-modal-text)/50 mb-1.5">增益选择</div>
                                    {#if visibleBuffSets.length > 0}
                                        <div
                                            class="flex flex-wrap items-center gap-1 pb-2 border-b border-white/5 mb-2"
                                        >
                                            {#if isDirectDamage(damageEntry)}
                                                <button
                                                    onclick={(e) => {
                                                        e.stopPropagation()
                                                        handleCopyFromPrevDirect(damageEntry.id)
                                                    }}
                                                    class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors bg-[var(--theme-input-bg)] text-[var(--theme-input-text)] border border-[var(--theme-input-border)] hover:bg-[var(--theme-input-bg-focused)]"
                                                >
                                                    <Icon icon="mdi:content-copy" class="size-3 shrink-0" />
                                                    复制前段直伤
                                                </button>
                                                <button
                                                    onclick={(e) => {
                                                        e.stopPropagation()
                                                        handleCopyToNextDirect(damageEntry.id)
                                                    }}
                                                    class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors bg-[var(--theme-input-bg)] text-[var(--theme-input-text)] border border-[var(--theme-input-border)] hover:bg-[var(--theme-input-bg-focused)]"
                                                >
                                                    <Icon icon="mdi:content-paste" class="size-3 shrink-0" />
                                                    复制到下段直伤
                                                </button>
                                            {/if}
                                            <button
                                                disabled={selectedEntrySetIds.length === 0}
                                                onclick={(e) => {
                                                    e.stopPropagation()
                                                    handleClearAllBuffs(damageEntry.id)
                                                }}
                                                class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors bg-[var(--theme-input-bg)] text-[var(--theme-input-text)] border border-[var(--theme-input-border)] hover:bg-[var(--theme-input-bg-focused)] disabled:opacity-40 disabled:pointer-events-none"
                                            >
                                                <Icon icon="mdi:close-circle-outline" class="size-3 shrink-0" />
                                                清除所有增益
                                            </button>
                                        </div>
                                        <div class="flex flex-wrap gap-1">
                                            {#each visibleBuffSets as buffSet}
                                                {@const checked = selectedEntrySetIds.includes(buffSet.id)}
                                                <!-- svelte-ignore a11y_click_events_have_key_events -->
                                                <!-- svelte-ignore a11y_no_static_element_interactions -->
                                                <button
                                                    onclick={(e) => {
                                                        e.stopPropagation()
                                                        handleToggleBuffSetForEntry(buffSet.id)
                                                    }}
                                                    class={[
                                                        'px-2 py-1 text-xs rounded transition-colors inline-flex items-center gap-1',
                                                        checked
                                                            ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40'
                                                            : 'bg-white/5 text-(--theme-modal-text)/50 border border-white/10 hover:bg-white/10'
                                                    ].join(' ')}
                                                >
                                                    <Icon
                                                        icon={checked ? 'mdi:check' : 'mdi:close'}
                                                        class="size-3 shrink-0"
                                                    />
                                                    {buffSet.name}
                                                </button>
                                            {/each}
                                        </div>
                                    {:else}
                                        <div class="text-xs text-[var(--theme-modal-text)]/30">
                                            无可用 BUFF 块，点击底栏【BUFF配置】按钮进行配置
                                        </div>
                                    {/if}
                                </div>
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
