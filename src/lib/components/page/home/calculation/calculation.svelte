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
        getDamageTypesForEntry,
        toggleDamageTypeForEntry,
        init,
        getGlobalBuffSetIds,
        getBuffDiffMode,
        getConditionProfile,
        getHideConditionMismatch
    } from './calculation.store.svelte'
    import type { CharSlot } from '$lib/data/types'
    import type { TimelineData } from '../timeline/timeline.types'
    import type { CalcState } from './calculation.types'
    import BuffModal from './buff-modal.svelte'
    import SpreadTable from './spread-table.svelte'
    import DropdownTable from './dropdown-table.svelte'
    import { getCalcViewMode } from '$lib/data/calc-view.svelte'

    interface Props {
        team: [CharSlot, CharSlot, CharSlot]
        timelineData: TimelineData | null
        calcState: CalcState | null
        locked?: boolean
        onupdate: (state: CalcState) => void
    }

    let { team, timelineData, calcState, locked = false, onupdate }: Props = $props()

    $effect(() => {
        team
        timelineData
        calcState
        locked
        untrack(() => init(team, timelineData, calcState, locked, onupdate))
    })

    let damageEntries = $derived(getAllDamageEntries())
    let buffSets = $derived(getAllBuffSets())
    let showBuffModal = $derived(getShowBuffModal())
    let globalBuffSetIds = $derived(getGlobalBuffSetIds())
    let entryDamageTypeMap = $derived<Record<string, string[]>>(
        Object.fromEntries(damageEntries.map((e) => [e.id, getDamageTypesForEntry(e.id)]))
    )
    let entryBuffSetIdMap = $derived<Record<string, string[]>>(
        Object.fromEntries(damageEntries.map((e) => [e.id, getBuffSetIdsForEntry(e.id)]))
    )

    let calcViewMode = $derived(getCalcViewMode())

    function handleCloseBuffModal() {
        setShowBuffModal(false)
        onupdate(getCalcState())
    }

    function handleSpreadToggle(entryId: string, buffId: string) {
        toggleBuffSetForEntry(entryId, buffId)
        onupdate(getCalcState())
    }

    function handleSpreadToggleDamageType(entryId: string, damageType: string) {
        toggleDamageTypeForEntry(entryId, damageType)
        onupdate(getCalcState())
    }

    function handleSpreadSetEntryBuffSetIds(entryId: string, ids: string[]) {
        setBuffSetIdsForEntry(entryId, ids)
        onupdate(getCalcState())
    }
</script>

<BuffModal open={showBuffModal} {team} onclose={handleCloseBuffModal} />

{#if calcViewMode === 'spread'}
    <SpreadTable
        {team}
        {damageEntries}
        {buffSets}
        {entryBuffSetIdMap}
        {entryDamageTypeMap}
        {globalBuffSetIds}
        conditionProfile={getConditionProfile()}
        hideConditionMismatch={getHideConditionMismatch()}
        onToggle={handleSpreadToggle}
        onToggleDamageType={handleSpreadToggleDamageType}
        onSetEntryBuffSetIds={handleSpreadSetEntryBuffSetIds}
    />
{:else}
    <DropdownTable
        {team}
        {damageEntries}
        {buffSets}
        {entryBuffSetIdMap}
        {entryDamageTypeMap}
        {globalBuffSetIds}
        conditionProfile={getConditionProfile()}
        hideConditionMismatch={getHideConditionMismatch()}
        buffDiffMode={getBuffDiffMode()}
        {onupdate}
    />
{/if}
