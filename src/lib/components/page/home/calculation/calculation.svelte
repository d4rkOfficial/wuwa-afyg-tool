<script lang="ts">
    import { untrack, tick } from 'svelte'
    import { slide } from 'svelte/transition'
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
        setDamageTypesForEntry,
        init,
        getGlobalBuffSetIds,
        getBuffDiffMode
    } from './calculation.store.svelte'
    import { addToast } from '$lib/data/toast.svelte'
    import {
        ZONE_MAP,
        DAMAGE_TYPES,
        DAMAGE_TYPE_SHORT,
        groupBuffSets,
        LAYERED_BUFF_PATTERN
    } from './calculation.consts'
    import type { GroupedBuffSetItem } from './calculation.consts'
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
    let calcContainer = $state<HTMLDivElement | undefined>()

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
    let groupedVisibleSets = $derived(groupBuffSets(visibleBuffSets))
    let groupedFolderItems = $derived(groupedVisibleSets.filter((g) => g.type === 'folder'))
    let groupedStandaloneItems = $derived(groupedVisibleSets.filter((g) => g.type !== 'folder'))

    let buffDiffMode = $derived(getBuffDiffMode())

    interface BuffDiffItem {
        setId: string
        name: string
        type: 'added' | 'removed' | 'same' | 'global'
    }

    let entryBuffDiff = $derived.by(() => {
        if (!buffDiffMode) return {} as Record<string, BuffDiffItem[]>

        const result: Record<string, BuffDiffItem[]> = {}
        for (let i = 0; i < damageEntries.length; i++) {
            const e = damageEntries[i]

            const globalItems = (entryBuffSetIdMap[e.id] ?? [])
                .filter((sid) => globalBuffSetIds.includes(sid))
                .map((sid) => ({
                    setId: sid,
                    name: buffSets.find((b) => b.id === sid)?.name ?? '',
                    type: 'global' as const
                }))

            const isFirstCharEntry = e.character
                ? !damageEntries.slice(0, i).some((p) => p.character === e.character)
                : true

            if (e.isTuneBreak || e.isTuneResponse) {
                result[e.id] = [
                    ...(isFirstCharEntry ? globalItems : []),
                    ...(entryBuffSetIdMap[e.id] ?? [])
                        .filter((sid) => !globalBuffSetIds.includes(sid))
                        .map((sid) => ({
                            setId: sid,
                            name: buffSets.find((b) => b.id === sid)?.name ?? '',
                            type: 'same' as const
                        }))
                ]
                continue
            }

            let prevId: string | null = null
            if (e.isEffect) {
                for (let j = i - 1; j >= 0; j--) {
                    const p = damageEntries[j]
                    if (p.isEffect && p.hitName === e.hitName) {
                        prevId = p.id
                        break
                    }
                }
            } else {
                for (let j = i - 1; j >= 0; j--) {
                    const p = damageEntries[j]
                    if (!p.isEffect && !p.isTuneBreak && !p.isTuneResponse && p.character === e.character) {
                        prevId = p.id
                        break
                    }
                }
            }

            if (!prevId) {
                result[e.id] = [
                    ...(isFirstCharEntry ? globalItems : []),
                    ...(entryBuffSetIdMap[e.id] ?? [])
                        .filter((sid) => !globalBuffSetIds.includes(sid))
                        .map((sid) => ({
                            setId: sid,
                            name: buffSets.find((b) => b.id === sid)?.name ?? '',
                            type: 'added' as const
                        }))
                ]
                continue
            }

            const curr = new Set(entryBuffSetIdMap[e.id] ?? [])
            const prev = new Set(entryBuffSetIdMap[prevId] ?? [])
            const items: BuffDiffItem[] = []
            for (const id of curr)
                if (!prev.has(id))
                    items.push({ setId: id, name: buffSets.find((b) => b.id === id)?.name ?? '', type: 'added' })
            for (const id of prev)
                if (!curr.has(id))
                    items.push({ setId: id, name: buffSets.find((b) => b.id === id)?.name ?? '', type: 'removed' })
            result[e.id] = items
        }
        return result
    })

    function handleToggleExpand(id: string, _index: number) {
        const expanding = expandedEntryId !== id
        expandedEntryId = expanding ? id : null
        if (expanding) {
            tick().then(() => {
                calcContainer
                    ?.querySelector<HTMLElement>(`[data-entry-id="${id}"]`)
                    ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
            })
        }
    }

    function handleToggleBuffSetForEntry(setId: string) {
        if (!expandedEntryId) return
        toggleBuffSetForEntry(expandedEntryId, setId)
        onupdate(getCalcState())
    }

    function handleToggleFolder(folder: GroupedBuffSetItem) {
        if (!expandedEntryId || !folder.children) return
        const childIds = folder.children.map((c) => c.id)
        const allSelected = childIds.every((id) => selectedEntrySetIds.includes(id))
        const currentSet = new Set(selectedEntrySetIds)
        if (allSelected) {
            for (const id of childIds) currentSet.delete(id)
        } else {
            for (const id of childIds) currentSet.add(id)
        }
        setBuffSetIdsForEntry(expandedEntryId, [...currentSet])
        onupdate(getCalcState())
    }

    function handleToggleDamageType(entryId: string, damageType: string) {
        toggleDamageTypeForEntry(entryId, damageType)
        onupdate(getCalcState())
    }

    function handleCopyDamageTypeToNext(entryId: string) {
        const entry = damageEntries.find((e) => e.id === entryId)
        if (!entry || !entry.character) return
        const entryIndex = damageEntries.findIndex((e) => e.id === entryId)
        if (entryIndex < 0) return
        const char = entry.character
        const currentTypes = getDamageTypesForEntry(entryId)
        for (let i = entryIndex + 1; i < damageEntries.length; i++) {
            const next = damageEntries[i]
            if (next.character === char && isDirectDamage(next)) {
                setDamageTypesForEntry(next.id, [...currentTypes])
                onupdate(getCalcState())
                expandedEntryId = next.id
                addToast('已复制伤害类型到下一段直伤', 'success')
                return
            }
        }
        addToast('已经是本角色最后一段直伤', 'info')
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
        addToast('已经是本角色最后一段直伤', 'info')
    }

    function handleCopyFromPrevEffect(entryId: string) {
        const entry = damageEntries.find((e) => e.id === entryId)
        if (!entry || !entry.isEffect) return

        const entryIndex = damageEntries.findIndex((e) => e.id === entryId)
        if (entryIndex <= 0) {
            addToast('未找到上一个同名效应', 'info')
            return
        }

        for (let i = entryIndex - 1; i >= 0; i--) {
            const prev = damageEntries[i]
            if (prev.isEffect && prev.hitName === entry.hitName) {
                const prevSetIds = getBuffSetIdsForEntry(prev.id)
                if (!setBuffSetIdsForEntry(entryId, prevSetIds)) return
                onupdate(getCalcState())
                addToast('已复制前段效应的增益', 'success')
                return
            }
        }

        addToast('未找到上一个同名效应', 'info')
    }

    function handleCopyToNextEffect(entryId: string) {
        const entry = damageEntries.find((e) => e.id === entryId)
        if (!entry || !entry.isEffect) return

        const entryIndex = damageEntries.findIndex((e) => e.id === entryId)
        const currentSetIds = getBuffSetIdsForEntry(entryId)

        for (let i = entryIndex + 1; i < damageEntries.length; i++) {
            const next = damageEntries[i]
            if (next.isEffect && next.hitName === entry.hitName) {
                if (!setBuffSetIdsForEntry(next.id, [...currentSetIds])) return
                onupdate(getCalcState())
                expandedEntryId = next.id
                addToast('已复制增益到下一段效应', 'success')
                return
            }
        }

        expandedEntryId = null
        addToast('已经是本效应最后一次伤害结算', 'info')
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

<svelte:window
    onkeydown={(e) => {
        const el = e.target as HTMLElement
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON') return
        if (e.key === ' ' && expandedEntryId !== null) {
            e.preventDefault()
            const idx = damageEntries.findIndex((de) => de.id === expandedEntryId)
            if (idx >= 0) {
                const nextIdx = idx + 1 < damageEntries.length ? idx + 1 : 0
                handleToggleExpand(damageEntries[nextIdx].id, nextIdx)
            }
        }
        if (e.key === 'Enter' && e.shiftKey && expandedEntryId !== null) {
            e.preventDefault()
            handleCopyDamageTypeToNext(expandedEntryId)
        }
        if (e.key === 'Z' && e.shiftKey && expandedEntryId !== null) {
            e.preventDefault()
            handleCopyFromPrevDirect(expandedEntryId)
        }
        if (e.key === 'X' && e.shiftKey && expandedEntryId !== null) {
            e.preventDefault()
            handleCopyToNextDirect(expandedEntryId)
        }
        if (e.key === 'C' && e.shiftKey && expandedEntryId !== null) {
            e.preventDefault()
            handleClearAllBuffs(expandedEntryId)
        }
    }}
/>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="h-full overflow-auto pb-48"
    style="background: var(--theme-modal-bg);"
    bind:this={calcContainer}
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
                class="text-(--theme-modal-text)/50 sticky top-0 bg-(--theme-modal-bg)/80 backdrop-blur-md opacity-100!"
                style="border-bottom: 1px solid var(--theme-divider-border);"
            >
                <th
                    class="text-left font-medium py-2 px-3 w-20 shrink-0 border-r border-dashed"
                    style="border-color: var(--theme-divider-border);">来源</th
                >
                <th
                    class="text-left font-medium py-2 px-3 w-56 shrink-0 border-r border-dashed"
                    style="border-color: var(--theme-divider-border);">条目</th
                >
                <th
                    class="text-left font-medium py-2 px-3 w-32 shrink-0 border-r border-dashed"
                    style="border-color: var(--theme-divider-border);">视为</th
                >
                <th class="text-left font-medium py-2 px-3">Buff</th>
            </tr>
        </thead>
        <tbody>
            {#each damageEntries as damageEntry, i}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <tr
                    onclick={() => handleToggleExpand(damageEntry.id, i)}
                    data-entry-id={damageEntry.id}
                    class={[
                        'cursor-pointer border-b transition-colors',
                        expandedEntryId === damageEntry.id ? '' : 'hover:bg-(--theme-modal-text)/5',
                        expandedEntryId !== null && expandedEntryId !== damageEntry.id ? 'opacity-40' : ''
                    ].join(' ')}
                    style={'border-color: var(--theme-divider-border);' +
                        (expandedEntryId === damageEntry.id
                            ? 'background: color-mix(in srgb, var(--theme-accent-bg) 10%, transparent);'
                            : '')}
                >
                    <td
                        class="py-1.5 px-3 w-20 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap border-r border-dashed"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <span style="color: var(--theme-element-{calcElementMap[damageEntry.character ?? '']}, #888)">
                            {damageEntry.character ?? '—'}
                        </span>
                    </td>
                    <td
                        class="py-1.5 px-3 w-56 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap border-r border-dashed"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <span
                            style="color: var(--theme-element-{damageEntry.damageElement}, #888)"
                            title={damageEntry.displayName}
                        >
                            {damageEntry.displayName}
                        </span>
                    </td>
                    <td
                        class="py-1.5 px-3 w-32 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap border-r border-dashed"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <div class="flex flex-wrap gap-0.5">
                            {#each entryDamageTypeMap[damageEntry.id] ?? [] as dt}
                                <span
                                    class="text-[10px] px-1 rounded text-(--theme-modal-text)/70 leading-tight"
                                    style="background: var(--theme-input-bg);"
                                    >{DAMAGE_TYPE_SHORT[dt as keyof typeof DAMAGE_TYPE_SHORT] ?? dt}</span
                                >
                            {/each}
                        </div>
                    </td>
                    <td class="py-1.5 px-3">
                        <div class="flex flex-wrap gap-1">
                            {#if buffDiffMode}
                                {#each entryBuffDiff[damageEntry.id] ?? [] as diff}
                                    {#if diff.type === 'global'}
                                        <span
                                            class="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium bg-yellow-500/15 text-yellow-500"
                                        >
                                            <Icon icon="mdi:crown" class="size-3" />{diff.name}
                                        </span>
                                    {:else if diff.type === 'added'}
                                        <span
                                            class="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium bg-green-500/15 text-green-500"
                                        >
                                            <Icon icon="mdi:plus" class="size-3" />{diff.name}
                                        </span>
                                    {:else if diff.type === 'removed'}
                                        <span
                                            class="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-500/15 text-red-500"
                                        >
                                            <Icon icon="mdi:minus" class="size-3" />{diff.name}
                                        </span>
                                    {:else}
                                        <span
                                            class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
                                            style="background: color-mix(in srgb, var(--theme-accent-bg) 15%, transparent); color: var(--theme-accent-text);"
                                        >
                                            {diff.name}
                                        </span>
                                    {/if}
                                {/each}
                            {:else}
                                {#each entryBuffSetIdMap[damageEntry.id] ?? [] as setId}
                                    {@const buffSet = buffSets.find((s) => s.id === setId)}
                                    {#if buffSet && !globalBuffSetIds.includes(setId)}
                                        <span
                                            class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
                                            style="background: color-mix(in srgb, var(--theme-accent-bg) 15%, transparent); color: var(--theme-accent-text);"
                                        >
                                            {buffSet.name}
                                        </span>
                                    {/if}
                                {/each}
                            {/if}
                        </div>
                    </td>
                </tr>
                {#if expandedEntryId === damageEntry.id}
                    <tr style="background: var(--theme-input-bg);">
                        <td colspan="4" class="p-0">
                            <div
                                transition:slide|local={{ duration: 200 }}
                                class="border-b px-6 py-3 space-y-3"
                                style="border-color: var(--theme-divider-border);"
                            >
                                {#if !damageEntry.isEffect && !damageEntry.isTuneBreak && !damageEntry.isTuneResponse}
                                    <div>
                                        <div class="text-xs text-(--theme-modal-text)/50 mb-1.5">伤害类型</div>
                                        {#if isDirectDamage(damageEntry) && damageEntry.character}
                                            <div class="mb-1.5">
                                                <button
                                                    onclick={(e) => {
                                                        e.stopPropagation()
                                                        handleCopyDamageTypeToNext(damageEntry.id)
                                                    }}
                                                    title="Shift+Enter"
                                                    class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors bg-(--theme-input-bg) text-(--theme-input-text) border border-(--theme-input-border) hover:bg-(--theme-input-bg-focused)"
                                                >
                                                    <Icon icon="mdi:content-paste" class="size-3 shrink-0" />
                                                    复制到下段直伤
                                                </button>
                                            </div>
                                        {/if}
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
                                                        'px-2 py-1 text-xs rounded transition-colors border',
                                                        selected
                                                            ? ''
                                                            : 'text-(--theme-modal-text)/50 hover:bg-(--theme-modal-text)/10'
                                                    ].join(' ')}
                                                    style={selected
                                                        ? 'background: color-mix(in srgb, var(--theme-accent-bg) 20%, transparent); color: var(--theme-accent-text); border-color: color-mix(in srgb, var(--theme-accent-bg) 40%, transparent);'
                                                        : 'background: var(--theme-input-bg); border-color: var(--theme-divider-border);'}
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
                                            class="flex flex-wrap items-center gap-1 pb-2 border-b mb-2"
                                            style="border-color: var(--theme-divider-border);"
                                        >
                                            {#if isDirectDamage(damageEntry)}
                                                <button
                                                    onclick={(e) => {
                                                        e.stopPropagation()
                                                        handleCopyFromPrevDirect(damageEntry.id)
                                                    }}
                                                    title="Shift+Z"
                                                    class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors bg-(--theme-input-bg) text-(--theme-input-text) border border-(--theme-input-border) hover:bg-(--theme-input-bg-focused)"
                                                >
                                                    <Icon icon="mdi:content-copy" class="size-3 shrink-0" />
                                                    复制前段直伤
                                                </button>
                                                <button
                                                    onclick={(e) => {
                                                        e.stopPropagation()
                                                        handleCopyToNextDirect(damageEntry.id)
                                                    }}
                                                    title="Shift+X"
                                                    class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors bg-(--theme-input-bg) text-(--theme-input-text) border border-(--theme-input-border) hover:bg-(--theme-input-bg-focused)"
                                                >
                                                    <Icon icon="mdi:content-paste" class="size-3 shrink-0" />
                                                    复制到下段直伤
                                                </button>
                                            {:else if damageEntry.isEffect}
                                                <button
                                                    onclick={(e) => {
                                                        e.stopPropagation()
                                                        handleCopyFromPrevEffect(damageEntry.id)
                                                    }}
                                                    class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors bg-(--theme-input-bg) text-(--theme-input-text) border border-(--theme-input-border) hover:bg-(--theme-input-bg-focused)"
                                                >
                                                    <Icon icon="mdi:content-copy" class="size-3 shrink-0" />
                                                    复制前段效应
                                                </button>
                                                <button
                                                    onclick={(e) => {
                                                        e.stopPropagation()
                                                        handleCopyToNextEffect(damageEntry.id)
                                                    }}
                                                    class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors bg-(--theme-input-bg) text-(--theme-input-text) border border-(--theme-input-border) hover:bg-(--theme-input-bg-focused)"
                                                >
                                                    <Icon icon="mdi:content-paste" class="size-3 shrink-0" />
                                                    复制到下段效应
                                                </button>
                                            {/if}
                                            <button
                                                disabled={selectedEntrySetIds.length === 0}
                                                onclick={(e) => {
                                                    e.stopPropagation()
                                                    handleClearAllBuffs(damageEntry.id)
                                                }}
                                                title="Shift+C"
                                                class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors bg-(--theme-input-bg) text-(--theme-input-text) border border-(--theme-input-border) hover:bg-(--theme-input-bg-focused) disabled:opacity-40 disabled:pointer-events-none"
                                            >
                                                <Icon icon="mdi:close-circle-outline" class="size-3 shrink-0" />
                                                清除所有增益
                                            </button>
                                            <div class="flex-1"></div>
                                            <button
                                                onclick={(e) => {
                                                    e.stopPropagation()
                                                    const nextIdx = i + 1 < damageEntries.length ? i + 1 : 0
                                                    handleToggleExpand(damageEntries[nextIdx].id, nextIdx)
                                                }}
                                                title="Space"
                                                class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors bg-(--theme-accent-bg)/20 text-(--theme-accent-text) border border-(--theme-accent-bg)/30 hover:bg-(--theme-accent-bg)/30"
                                            >
                                                <Icon icon="mdi:arrow-down" class="size-3 shrink-0" />
                                                下一条
                                            </button>
                                        </div>
                                        {#if groupedFolderItems.length > 0}
                                            <div class="flex flex-wrap gap-1 mb-2">
                                                {#each groupedFolderItems as item (item.key)}
                                                    {@const folderActive = item.children!.some((c) =>
                                                        selectedEntrySetIds.includes(c.id)
                                                    )}
                                                    <div
                                                        class="flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors"
                                                        style={folderActive
                                                            ? 'background: color-mix(in srgb, var(--theme-accent-bg) 15%, transparent); border-color: color-mix(in srgb, var(--theme-accent-bg) 40%, transparent);'
                                                            : 'background: var(--theme-input-bg); border-color: var(--theme-divider-border);'}
                                                    >
                                                        <button
                                                            onclick={(e) => {
                                                                e.stopPropagation()
                                                                handleToggleFolder(item)
                                                            }}
                                                            class="shrink-0 transition-colors"
                                                            class:text-(--theme-accent-text)={item.children!.some((c) =>
                                                                selectedEntrySetIds.includes(c.id)
                                                            )}
                                                        >
                                                            <Icon
                                                                icon={item.children!.some((c) =>
                                                                    selectedEntrySetIds.includes(c.id)
                                                                )
                                                                    ? 'mdi:check'
                                                                    : 'mdi:close'}
                                                                class="size-3"
                                                            />
                                                        </button>
                                                        <span class="text-(--theme-modal-text)/70 whitespace-nowrap"
                                                            >{item.prefixText}</span
                                                        >
                                                        <div class="flex gap-0.5">
                                                            {#each item.children! as child}
                                                                {@const childChecked = selectedEntrySetIds.includes(
                                                                    child.id
                                                                )}
                                                                <button
                                                                    onclick={(e) => {
                                                                        e.stopPropagation()
                                                                        handleToggleBuffSetForEntry(child.id)
                                                                    }}
                                                                    class={[
                                                                        'rounded px-2 py-1 text-[10px] font-medium tabular-nums transition-colors min-w-[1.2em] text-center',
                                                                        childChecked
                                                                            ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/30'
                                                                            : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70 hover:bg-(--theme-accent-bg)/10'
                                                                    ].join(' ')}
                                                                >
                                                                    {child.name
                                                                        .match(LAYERED_BUFF_PATTERN)
                                                                        ?.slice(2)
                                                                        .join('') ?? child.name}
                                                                </button>
                                                            {/each}
                                                        </div>
                                                    </div>
                                                {/each}
                                            </div>
                                        {/if}
                                        {#if groupedStandaloneItems.length > 0}
                                            <div class="flex flex-wrap gap-1">
                                                {#each groupedStandaloneItems as item (item.key)}
                                                    {@const checked = selectedEntrySetIds.includes(item.buffSet!.id)}
                                                    <button
                                                        onclick={(e) => {
                                                            e.stopPropagation()
                                                            handleToggleBuffSetForEntry(item.buffSet!.id)
                                                        }}
                                                        class={[
                                                            'px-2 py-1 text-xs rounded transition-colors inline-flex items-center gap-1 border',
                                                            checked
                                                                ? ''
                                                                : 'text-(--theme-modal-text)/50 hover:bg-(--theme-modal-text)/10'
                                                        ].join(' ')}
                                                        style={checked
                                                            ? 'background: color-mix(in srgb, var(--theme-accent-bg) 20%, transparent); color: var(--theme-accent-text); border-color: color-mix(in srgb, var(--theme-accent-bg) 40%, transparent);'
                                                            : 'background: var(--theme-input-bg); border-color: var(--theme-divider-border);'}
                                                    >
                                                        <Icon
                                                            icon={checked ? 'mdi:check' : 'mdi:close'}
                                                            class="size-3 shrink-0"
                                                        />
                                                        {item.buffSet!.name}
                                                    </button>
                                                {/each}
                                            </div>
                                        {/if}
                                    {:else}
                                        <div class="text-xs text-(--theme-modal-text)/30">
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
        <div class="flex items-center justify-center py-12 text-xs text-(--theme-modal-text)/40">暂无伤害数据</div>
    {/if}
</div>
