<script lang="ts">
    import {
        getAllBuffSets,
        createBuffSet,
        deleteBuffSet,
        duplicateBuffSet,
        renameBuffSet,
        addZoneToBuffSet,
        removeZoneFromBuffSet,
        setBuffSetZoneValue,
        setBuffSetScope,
        setBuffSetZoneRef,
        getGlobalBuffSetIds,
        reorderNonGlobalBuffSets,
        toggleBuffSetStarred
    } from './calculation.store.svelte'
    import { ZONE_DEFS, ZONE_MAP, ZONE_REF_DEFS, ZONE_REF_MAP, groupBuffSets } from './calculation.consts'
    import type { ZoneId, GroupedBuffSetItem } from './calculation.consts'
    import type { CharSlot } from '$lib/data/types'
    import type { ZoneRef, BuffSet } from './calculation.types'
    import { getCharIconMap, elementColor } from '../timeline/timeline.store.svelte'
    import Icon from '@iconify/svelte'
    import QuickLookup from './quick-lookup.svelte'
    import { slide } from 'svelte/transition'

    interface Props {
        open: boolean
        team: [CharSlot, CharSlot, CharSlot]
        onclose: () => void
    }

    let { open, team, onclose }: Props = $props()

    let showLookup = $state(false)
    let showRefLookup = $state(false)

    type DragState = {
        id: string
        idx: number
        dropIdx: number
        outside: boolean
        mode: 'item' | 'folder' | 'child'
        folderPrefix?: string
    }
    let dragState = $state<DragState | null>(null)
    let collapsedFolders = $state(new Set<string>())
    let savedCollapsedState: Set<string> | null = null
    let showDeleteFolderConfirm = $state(false)
    let deleteFolderPrefix = $state('')
    let deleteFolderCount = $state(0)

    function globalBuffColor(buffSet: { scope: number[] | 'all' }): string {
        if (!Array.isArray(buffSet.scope) || buffSet.scope.length === 0) return '#eab308'
        const idx = buffSet.scope[0]
        const charName = team[idx]?.character
        if (!charName) return '#eab308'
        return elementColor(charName)
    }

    let selectedBuffSetId = $state<string | null>(null)
    let newName = $state('')
    let renameValue = $state('')
    let isEditingName = $state(false)
    $effect(() => {
        selectedBuffSetId
        isEditingName = false
        if (selectedBuffSet) renameValue = selectedBuffSet.name
    })

    // ZoneRef modal state
    let showRefModal = $state(false)
    let refZoneId = $state<string>('')
    let refCharacterIdx = $state<number>(0)
    let refTargetZoneId = $state<string>('base_atk')
    let refThreshold = $state<number>(0)
    let refLower = $state<number | undefined>(undefined)
    let refUpper = $state<number | undefined>(undefined)
    let showRefZoneMenu = $state(false)
    let refHasThreshold = $state(true)
    let refDivisor = $state(10)
    let refMultiplier = $state(0)
    let refHasLower = $state(false)
    let refHasUpper = $state(false)
    let refIsDiscrete = $state(false)

    function gcd(a: number, b: number): number {
        a = Math.abs(a)
        b = Math.abs(b)
        while (b) {
            const t = b
            b = a % b
            a = t
        }
        return a
    }

    function simplifyPct(pct: number): { divisor: number; multiplier: number } {
        if (pct === 0) return { divisor: 1, multiplier: 0 }
        const num = Math.round(pct)
        const g = gcd(num, 100)
        return { divisor: 100 / g, multiplier: num / g }
    }

    // groupBuffSets imported from calculation.consts

    let buffSets = $derived(getAllBuffSets())
    let globalBuffSetIds = $derived(getGlobalBuffSetIds())
    let charIconMap = $derived(getCharIconMap())
    let sortedBuffSets = $derived(
        [...buffSets].sort((a, b) => {
            const aG = globalBuffSetIds.includes(a.id) ? 0 : 1
            const bG = globalBuffSetIds.includes(b.id) ? 0 : 1
            return aG - bG
        })
    )

    let groupedBuffSets = $derived.by(() => {
        const globalItems = sortedBuffSets
            .filter((bs) => globalBuffSetIds.includes(bs.id))
            .map((bs) => ({ key: bs.id, type: 'item' as const, buffSet: bs }))
        const nonGlobalItems = groupBuffSets(sortedBuffSets.filter((bs) => !globalBuffSetIds.includes(bs.id)))
        return [...globalItems, ...nonGlobalItems] as GroupedBuffSetItem[]
    })
    let topLevelFlatItems = $derived.by(() => {
        const result: Array<{ key: string; type: 'item' | 'folder' }> = []
        for (const item of groupedBuffSets) {
            if (item.type === 'folder') {
                result.push({ key: item.prefix!, type: 'folder' })
            } else if (!globalBuffSetIds.includes(item.buffSet!.id)) {
                result.push({ key: item.buffSet!.id, type: 'item' })
            }
        }
        return result
    })
    let topLevelIdxMap = $derived(new Map(topLevelFlatItems.map((x, i) => [x.key, i])))
    let topLevelCount = $derived(topLevelFlatItems.length)

    let selectedBuffSet = $derived(buffSets.find((s) => s.id === selectedBuffSetId) ?? null)

    let scopeChars = $derived.by(() => {
        if (!selectedBuffSet || selectedBuffSet.scope === 'all') return [true, true, true]
        const s = selectedBuffSet.scope
        return team.map((_, i) => s.includes(i))
    })

    let refTargetDef = $derived(ZONE_REF_MAP.get(refTargetZoneId) ?? ZONE_MAP.get(refTargetZoneId as any) ?? null)
    let refTargetDefUnit = $derived(refTargetDef?.unit === '%' ? '%' : '点')
    let currentZoneDef = $derived(ZONE_MAP.get(refZoneId as ZoneId) ?? null)
    let currentZoneUnit = $derived(currentZoneDef?.unit === '%' ? '%' : '点')

    function handleCreateBuffSet() {
        const name = newName.trim() || '未命名BUFF块'
        createBuffSet(name)
        newName = ''
    }

    function handleDeleteBuffSet() {
        if (!selectedBuffSetId) return
        deleteBuffSet(selectedBuffSetId)
        selectedBuffSetId = null
    }

    function handleCopyBuffSet() {
        if (!selectedBuffSetId) return
        let copyName: string | undefined
        for (const item of groupedBuffSets) {
            if (item.type === 'folder' && item.children?.some((c) => c.id === selectedBuffSetId)) {
                copyName = (item.prefixText ?? '') + '0' + (item.suffixText ?? '')
                break
            }
        }
        const newId = duplicateBuffSet(selectedBuffSetId, copyName)
        if (newId) selectedBuffSetId = newId
    }

    function handleRenameInline() {
        if (!selectedBuffSetId) return
        renameBuffSet(selectedBuffSetId, renameValue.trim() || '未命名BUFF块')
        isEditingName = false
    }

    function handleToggleChar(idx: number) {
        if (!selectedBuffSetId || !selectedBuffSet) return
        const current: number[] = selectedBuffSet.scope === 'all' ? [0, 1, 2] : (selectedBuffSet.scope as number[])
        const next = current.includes(idx) ? current.filter((i) => i !== idx) : [...current, idx].sort()
        setBuffSetScope(selectedBuffSetId, next.length === 3 ? 'all' : next)
    }

    function openRefModal(zoneId: string) {
        const zone = selectedBuffSet?.zones.find((z) => z.zoneId === zoneId)
        refZoneId = zoneId
        showRefZoneMenu = false
        if (zone?.ref) {
            refCharacterIdx = zone.ref.characterIdx
            refTargetZoneId = zone.ref.zoneId
            refThreshold = zone.ref.threshold
            refLower = zone.ref.lower
            refUpper = zone.ref.upper
            const s = simplifyPct(zone.ref.pct)
            refDivisor = zone.ref.divisor ?? s.divisor
            refMultiplier = zone.ref.multiplier ?? s.multiplier
            refIsDiscrete = zone.ref.discrete ?? false
            refHasThreshold = true
            refHasLower = zone.ref.lower !== undefined
            refHasUpper = zone.ref.upper !== undefined
        } else {
            refCharacterIdx = 0
            refTargetZoneId = zoneId
            refThreshold = 0
            refLower = undefined
            refUpper = undefined
            refDivisor = 10
            refMultiplier = 0
            refIsDiscrete = false
            refHasThreshold = true
            refHasLower = false
            refHasUpper = false
        }
        if (refTargetZoneId === refZoneId) {
            const fallback = ZONE_REF_DEFS.find((d) => d.id !== refZoneId)
            refTargetZoneId = fallback?.id ?? ''
        }
        showRefModal = true
    }

    function handleConfirmRef() {
        if (!selectedBuffSetId) return
        const pct = refDivisor !== 0 ? (refMultiplier / refDivisor) * 100 : 0
        const ref: ZoneRef = {
            characterIdx: refCharacterIdx,
            zoneId: refTargetZoneId as any,
            threshold: refHasThreshold ? refThreshold : 0,
            pct,
            lower: refHasLower && refLower !== undefined && !isNaN(refLower) ? refLower : undefined,
            upper: refHasUpper && refUpper !== undefined && !isNaN(refUpper) ? refUpper : undefined,
            discrete: refIsDiscrete,
            divisor: refDivisor,
            multiplier: refMultiplier
        }
        setBuffSetZoneRef(selectedBuffSetId, refZoneId, ref)
        showRefModal = false
    }

    function handleClearRef() {
        if (!selectedBuffSetId) return
        setBuffSetZoneRef(selectedBuffSetId, refZoneId, null)
        showRefModal = false
    }

    function toggleFolder(prefix: string) {
        const next = new Set(collapsedFolders)
        if (next.has(prefix)) {
            next.delete(prefix)
        } else {
            next.add(prefix)
        }
        collapsedFolders = next
    }

    function startDrag(e: PointerEvent, id: string, mode: 'item' | 'folder' | 'child', folderPrefix?: string) {
        if ((e.target as HTMLElement).closest('input')) return
        if (!(e.target as HTMLElement).closest('.drag-handle')) return
        const el = e.currentTarget as HTMLElement
        el.setPointerCapture(e.pointerId)
        savedCollapsedState = new Set(collapsedFolders)
        collapsedFolders = new Set()

        let idx = -1
        if (mode === 'child' && folderPrefix) {
            const container = el.closest('.buff-list-container') as HTMLElement | null
            if (container) {
                const items = container.querySelectorAll(`[data-folder-child="${folderPrefix}"]`)
                const ids = [...items].map((item) => (item as HTMLElement).dataset.buffsetId!)
                idx = ids.indexOf(id)
            }
        } else if (mode === 'item' || mode === 'folder') {
            idx = topLevelIdxMap.get(id) ?? -1
        }
        dragState = { id, idx, dropIdx: idx, outside: false, mode, folderPrefix }
    }

    function onDragMove(e: PointerEvent) {
        if (!dragState) return
        const container = (e.currentTarget as HTMLElement).closest('.buff-list-container') as HTMLElement | null
        if (!container) return

        const cr = container.getBoundingClientRect()
        const margin = 30
        const outside =
            e.clientX < cr.left - margin ||
            e.clientX > cr.right + margin ||
            e.clientY < cr.top - margin ||
            e.clientY > cr.bottom + margin

        if (outside) {
            dragState = { ...dragState, outside: true, dropIdx: -1 }
            return
        }

        let items: NodeListOf<HTMLElement>
        if (dragState.mode === 'child' && dragState.folderPrefix) {
            items = container.querySelectorAll(`[data-folder-child="${dragState.folderPrefix}"]`)
        } else {
            items = container.querySelectorAll('[data-buffset-id]:not([data-folder-child]), [data-folder-prefix]')
        }
        let dropIdx = items.length
        items.forEach((item, i) => {
            const r = item.getBoundingClientRect()
            if (e.clientY < r.top + r.height / 2 && dropIdx === items.length) dropIdx = i
        })
        dragState = { ...dragState, outside: false, dropIdx }
    }

    function onDragEnd(e: PointerEvent) {
        if (!dragState) return

        if (dragState.outside) {
            if (dragState.mode === 'folder') {
                const folder = groupedBuffSets.find((g) => g.type === 'folder' && g.prefix === dragState!.id)
                if (folder?.children && folder.children.length > 0) {
                    deleteFolderPrefix = dragState!.id
                    deleteFolderCount = folder.children.length
                    showDeleteFolderConfirm = true
                }
                if (savedCollapsedState !== null) {
                    collapsedFolders = savedCollapsedState
                    savedCollapsedState = null
                }
                dragState = null
                return
            }
            deleteBuffSet(dragState.id)
            if (selectedBuffSetId === dragState.id) selectedBuffSetId = null
        } else if (dragState.dropIdx !== dragState.idx || dragState.mode === 'folder') {
            const container = (e.currentTarget as HTMLElement).closest('.buff-list-container') as HTMLElement | null
            if (container && (dragState.dropIdx !== dragState.idx || dragState.mode === 'folder')) {
                const reordered = computeNewOrder(container, dragState)
                if (reordered) reorderNonGlobalBuffSets(reordered)
            }
        } else {
            selectedBuffSetId = dragState.id
        }

        if (savedCollapsedState !== null) {
            collapsedFolders = savedCollapsedState
            savedCollapsedState = null
        }
        dragState = null
    }

    function computeNewOrder(container: HTMLElement, state: DragState): string[] | null {
        if (state.mode === 'folder') {
            const prefix = state.id
            const draggedChildIds = [...container.querySelectorAll(`[data-folder-child="${prefix}"]`)]
                .map((el) => (el as HTMLElement).dataset.buffsetId!)
                .filter(Boolean)
            const allIds = [...container.querySelectorAll('[data-buffset-id]')]
                .map((el) => (el as HTMLElement).dataset.buffsetId!)
                .filter(Boolean)
            const withoutDragged = allIds.filter((id) => !draggedChildIds.includes(id))

            const topLevel = container.querySelectorAll(
                '[data-buffset-id]:not([data-folder-child]), [data-folder-prefix]'
            )
            let insertAt = 0
            let counted = 0
            for (const el of topLevel) {
                const htmlEl = el as HTMLElement
                if (counted === state.dropIdx) break
                const p = htmlEl.dataset.folderPrefix
                if (p) {
                    if (p !== prefix) {
                        insertAt += container.querySelectorAll(`[data-folder-child="${p}"]`).length
                    }
                } else {
                    insertAt += 1
                }
                counted++
            }

            withoutDragged.splice(insertAt, 0, ...draggedChildIds)
            return withoutDragged
        }

        if (state.mode === 'child' && state.folderPrefix) {
            const prefix = state.folderPrefix
            const childIds = [...container.querySelectorAll(`[data-folder-child="${prefix}"]`)]
                .map((el) => (el as HTMLElement).dataset.buffsetId!)
                .filter(Boolean)
            const reorderedChildren = childIds.filter((id) => id !== state.id)
            reorderedChildren.splice(state.dropIdx, 0, state.id)

            const allIds = [...container.querySelectorAll('[data-buffset-id]')]
                .map((el) => (el as HTMLElement).dataset.buffsetId!)
                .filter(Boolean)
            const result: string[] = []
            let replaced = false
            for (const id of allIds) {
                if (childIds.includes(id)) {
                    if (!replaced) {
                        result.push(...reorderedChildren)
                        replaced = true
                    }
                } else {
                    result.push(id)
                }
            }
            return result
        }

        const allIds = [...container.querySelectorAll('[data-buffset-id]')]
            .map((el) => (el as HTMLElement).dataset.buffsetId!)
            .filter(Boolean)
        const withoutDragged = allIds.filter((id) => id !== state.id)
        withoutDragged.splice(state.dropIdx, 0, state.id)
        return withoutDragged
    }

    function confirmDeleteFolder() {
        const folder = groupedBuffSets.find((g) => g.type === 'folder' && g.prefix === deleteFolderPrefix)
        if (folder?.children) {
            for (const child of folder.children) {
                deleteBuffSet(child.id)
            }
        }
        if (selectedBuffSetId && folder?.children?.some((c) => c.id === selectedBuffSetId)) {
            selectedBuffSetId = null
        }
        showDeleteFolderConfirm = false
        deleteFolderPrefix = ''
        deleteFolderCount = 0
    }

    let teamNames = $derived(team.map((s) => s.character ?? '?'))
</script>

{#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        class="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
        onkeydown={(e) => e.key === 'Escape' && onclose()}
    >
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="w-full max-h-[95vh] h-full max-w-6xl rounded-xl border text-(--theme-modal-text) shadow-xl overflow-hidden flex flex-col my-4"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
        >
            <div
                class="flex items-center justify-between px-5 py-3 border-b"
                style="border-bottom: 1px solid var(--theme-divider-border);"
            >
                <h2 class="text-sm font-semibold">BUFF 配置</h2>
                <button
                    onclick={() => (showLookup = true)}
                    class="flex items-center gap-1 rounded px-2 py-1 text-xs text-(--theme-accent-text) transition-colors hover:bg-(--theme-modal-text)/5"
                >
                    <Icon icon="mdi:magnify" class="size-3.5" />
                    速查
                </button>
            </div>

            <div class="flex flex-1 overflow-hidden">
                <!-- Left column: block list -->
                <div
                    class="w-64 shrink-0 border-r flex flex-col"
                    style="border-right: 1px solid var(--theme-divider-border);"
                >
                    <div class="flex-1 overflow-y-auto p-2 space-y-1 buff-list-container">
                        {#each groupedBuffSets as item (item.key)}
                            {#if item.type === 'folder'}
                                {@const topIdx = topLevelIdxMap.get(item.prefix!)}
                                {@const folderHasStar = item.children!.some((c) => c.starred)}
                                {#if dragState && dragState.mode !== 'child' && !dragState.outside && dragState.dropIdx === topIdx}
                                    <div class="h-0.5 rounded-full bg-(--theme-accent-bg)"></div>
                                {/if}
                                <button
                                    data-folder-prefix={item.prefix}
                                    onclick={() => toggleFolder(item.prefix!)}
                                    onpointerdown={(e) => startDrag(e, item.prefix!, 'folder')}
                                    onpointermove={onDragMove}
                                    onpointerup={onDragEnd}
                                    class={[
                                        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-left transition-all',
                                        'text-(--theme-modal-text)/60 hover:bg-(--theme-modal-text)/5',
                                        dragState?.id === item.prefix &&
                                            !dragState!.outside &&
                                            'ring-2 ring-(--theme-accent-bg)',
                                        dragState?.id === item.prefix &&
                                            dragState!.outside &&
                                            'ring-2 ring-red-500 opacity-50'
                                    ].join(' ')}
                                    transition:slide={{ duration: 200 }}
                                >
                                    <Icon
                                        icon={collapsedFolders.has(item.prefix!) ? 'mdi:folder' : 'mdi:folder-open'}
                                        class="drag-handle touch-none select-none cursor-grab active:cursor-grabbing size-4 shrink-0 {folderHasStar
                                            ? 'text-amber-400'
                                            : 'opacity-60'}"
                                    />
                                    <span class="truncate flex-1">{item.name}</span>
                                    <span class="text-[10px] text-(--theme-modal-text)/30"
                                        >({item.children!.length}项)</span
                                    >
                                </button>
                                {#if !collapsedFolders.has(item.prefix!)}
                                    <div
                                        class="ml-3 space-y-1 border-l pl-2"
                                        style="border-color: var(--theme-divider-border);"
                                    >
                                        {#each item.children! as child, ci (child.id)}
                                            {#if dragState && dragState.mode === 'child' && dragState.folderPrefix === item.prefix && !dragState.outside && dragState.dropIdx === ci}
                                                <div class="h-0.5 rounded-full bg-(--theme-accent-bg)"></div>
                                            {/if}
                                            <button
                                                data-buffset-id={child.id}
                                                data-folder-child={item.prefix}
                                                onclick={() => {
                                                    selectedBuffSetId = child.id
                                                }}
                                                onpointerdown={(e) => startDrag(e, child.id, 'child', item.prefix)}
                                                onpointermove={onDragMove}
                                                onpointerup={onDragEnd}
                                                class={[
                                                    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-left transition-all',
                                                    selectedBuffSetId === child.id
                                                        ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                                        : 'text-(--theme-modal-text)/70 hover:bg-(--theme-modal-text)/5',
                                                    dragState?.id === child.id &&
                                                        !dragState.outside &&
                                                        'ring-2 ring-(--theme-accent-bg)',
                                                    dragState?.id === child.id &&
                                                        dragState.outside &&
                                                        'ring-2 ring-red-500 opacity-50'
                                                ].join(' ')}
                                                transition:slide={{ duration: 200 }}
                                            >
                                                <Icon
                                                    icon={child.starred ? 'mdi:star' : 'mdi:widgets'}
                                                    class="drag-handle touch-none select-none cursor-grab active:cursor-grabbing size-4 shrink-0 {child.starred
                                                        ? 'text-amber-400'
                                                        : 'opacity-60'}"
                                                />
                                                <span class="truncate flex-1">{child.name}</span>
                                                {#if child.scope === 'all'}
                                                    <span
                                                        class="text-[10px] text-(--theme-modal-text)/30 whitespace-nowrap"
                                                        >(通用)</span
                                                    >
                                                {:else}
                                                    <span
                                                        class="text-[10px] text-(--theme-modal-text)/30 whitespace-nowrap"
                                                        >({teamNames
                                                            .filter((_, i) => (child.scope as number[]).includes(i))
                                                            .join(', ')})</span
                                                    >
                                                {/if}
                                            </button>
                                        {/each}
                                        {#if dragState && dragState.mode === 'child' && dragState.folderPrefix === item.prefix && !dragState.outside && dragState.dropIdx === item.children!.length}
                                            <div class="h-0.5 rounded-full bg-(--theme-accent-bg)"></div>
                                        {/if}
                                    </div>
                                {/if}
                            {:else}
                                {@const isGlobal = globalBuffSetIds.includes(item.buffSet!.id)}
                                {#if !isGlobal}
                                    {@const topIdx = topLevelIdxMap.get(item.buffSet!.id)}
                                    {#if dragState && dragState.mode !== 'child' && !dragState.outside && dragState.dropIdx === topIdx}
                                        <div class="h-0.5 rounded-full bg-(--theme-accent-bg)"></div>
                                    {/if}
                                {/if}
                                <button
                                    data-buffset-id={isGlobal ? undefined : item.buffSet!.id}
                                    onclick={() => {
                                        selectedBuffSetId = item.buffSet!.id
                                    }}
                                    onpointerdown={isGlobal ? undefined : (e) => startDrag(e, item.buffSet!.id, 'item')}
                                    onpointermove={isGlobal ? undefined : onDragMove}
                                    onpointerup={isGlobal ? undefined : onDragEnd}
                                    class={[
                                        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-left transition-all',
                                        selectedBuffSetId === item.buffSet!.id
                                            ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                            : 'text-(--theme-modal-text)/70 hover:bg-(--theme-modal-text)/5',
                                        !isGlobal &&
                                            dragState?.id === item.buffSet!.id &&
                                            !dragState.outside &&
                                            'ring-2 ring-(--theme-accent-bg)',
                                        !isGlobal &&
                                            dragState?.id === item.buffSet!.id &&
                                            dragState.outside &&
                                            'ring-2 ring-red-500 opacity-50'
                                    ].join(' ')}
                                    transition:slide={{ duration: 200 }}
                                >
                                    <Icon
                                        icon={isGlobal
                                            ? 'mdi:crown'
                                            : item.buffSet!.starred
                                              ? 'mdi:star'
                                              : 'mdi:widgets'}
                                        class={[
                                            'size-4 shrink-0',
                                            !isGlobal && item.buffSet!.starred ? 'text-amber-400' : 'opacity-60',
                                            isGlobal
                                                ? ''
                                                : 'drag-handle touch-none select-none cursor-grab active:cursor-grabbing'
                                        ]
                                            .filter(Boolean)
                                            .join(' ')}
                                    />
                                    <span class="truncate flex-1">{item.buffSet!.name}</span>
                                    {#if !isGlobal}
                                        {#if item.buffSet!.scope === 'all'}
                                            <span class="text-[10px] text-(--theme-modal-text)/30 whitespace-nowrap"
                                                >(通用)</span
                                            >
                                        {:else}
                                            <span class="text-[10px] text-(--theme-modal-text)/30 whitespace-nowrap"
                                                >({teamNames
                                                    .filter((_, i) => (item.buffSet!.scope as number[]).includes(i))
                                                    .join(', ')})</span
                                            >
                                        {/if}
                                    {/if}
                                </button>
                            {/if}
                        {/each}
                        {#if dragState && dragState.mode !== 'child' && !dragState.outside && dragState.dropIdx === topLevelCount}
                            <div class="h-0.5 rounded-full bg-(--theme-accent-bg)"></div>
                        {/if}
                        {#if buffSets.length === 0}
                            <div class="text-xs text-(--theme-modal-text)/30 text-center py-4">暂无 BUFF 块</div>
                        {/if}
                    </div>
                    <div class="shrink-0 border-t p-2" style="border-top: 1px solid var(--theme-divider-border);">
                        <div class="flex gap-1">
                            <input
                                type="text"
                                bind:value={newName}
                                placeholder="新BUFF块名称"
                                onkeydown={(e) => e.key === 'Enter' && handleCreateBuffSet()}
                                class="flex-1 min-w-0 rounded border px-2 py-1 text-xs outline-none text-(--theme-modal-text) placeholder:text-(--theme-modal-text)/30"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                            />
                            <button
                                onclick={handleCreateBuffSet}
                                class="shrink-0 rounded px-2 py-1 text-xs text-white transition-colors"
                                style="background: var(--theme-accent-bg);"
                            >
                                <Icon icon="mdi:plus" class="size-3" />
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Right column: block editor -->
                <div class="flex-1 flex flex-col">
                    {#if selectedBuffSet}
                        <!-- Buff name header -->
                        <div
                            class="shrink-0 px-3 py-2.5 border-b flex items-center gap-2"
                            style="border-bottom: 1px solid var(--theme-divider-border);"
                        >
                            {#if globalBuffSetIds.includes(selectedBuffSet.id)}
                                <button disabled class="shrink-0 rounded p-1 text-amber-400/40 cursor-not-allowed">
                                    <Icon
                                        icon={selectedBuffSet.starred ? 'mdi:star' : 'mdi:star-outline'}
                                        class="size-4"
                                    />
                                </button>
                                <input
                                    type="text"
                                    value={selectedBuffSet.name}
                                    readonly
                                    class="flex-1 min-w-0 rounded border px-2 py-1.5 text-xs font-medium outline-none text-(--theme-modal-text) cursor-default"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                />
                            {:else}
                                <button
                                    onclick={() => toggleBuffSetStarred(selectedBuffSet.id)}
                                    class="shrink-0 rounded p-1 transition-colors text-amber-400 hover:text-amber-300"
                                >
                                    <Icon
                                        icon={selectedBuffSet.starred ? 'mdi:star' : 'mdi:star-outline'}
                                        class="size-4"
                                    />
                                </button>
                                <!-- svelte-ignore a11y_no_static_element_interactions -->
                                <input
                                    type="text"
                                    bind:value={renameValue}
                                    readonly={!isEditingName}
                                    ondblclick={() => {
                                        if (!isEditingName) {
                                            renameValue = selectedBuffSet.name
                                            isEditingName = true
                                        }
                                    }}
                                    onkeydown={(e) => e.key === 'Enter' && handleRenameInline()}
                                    onblur={handleRenameInline}
                                    class="flex-1 min-w-0 rounded border px-2 py-1.5 text-xs font-medium outline-none cursor-default text-(--theme-modal-text)"
                                    style={isEditingName
                                        ? 'border-color: var(--theme-accent-bg); background: var(--theme-input-bg);'
                                        : 'border-color: var(--theme-divider-border); background: var(--theme-input-bg);'}
                                />
                                <button
                                    onclick={handleCopyBuffSet}
                                    class="shrink-0 flex items-center gap-1 rounded border px-2 py-1.5 text-xs text-(--theme-modal-text) transition-colors hover:bg-(--theme-accent-bg)/10"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    <Icon icon="mdi:content-copy" class="size-3.5" />
                                    复制
                                </button>
                                <button
                                    onclick={handleDeleteBuffSet}
                                    class="shrink-0 flex items-center gap-1 rounded border border-red-500 px-2 py-1.5 text-xs text-red-500 transition-colors hover:bg-red-500/20"
                                >
                                    <Icon icon="mdi:delete-outline" class="size-3.5" />
                                    删除
                                </button>
                            {/if}
                        </div>

                        <!-- Character scope -->
                        <div
                            class="shrink-0 px-3 pt-3 pb-2.5 border-b"
                            style="border-bottom: 1px solid var(--theme-divider-border);"
                        >
                            <div class="flex items-center gap-1.5">
                                <span class="text-xs text-(--theme-modal-text)/50 mr-1">这些角色可以吃到：</span>
                                {#each team as slot, i}
                                    {@const globalDisabled =
                                        selectedBuffSet && globalBuffSetIds.includes(selectedBuffSet.id)}
                                    <button
                                        onclick={() => !globalDisabled && handleToggleChar(i)}
                                        class={[
                                            'size-8 rounded-full overflow-hidden border-2 transition-all',
                                            scopeChars[i]
                                                ? 'border-(--theme-accent-bg)'
                                                : globalDisabled
                                                  ? 'border-(--theme-divider-border)'
                                                  : 'border-(--theme-divider-border) grayscale opacity-30 hover:opacity-60',
                                            globalDisabled ? 'pointer-events-none' : ''
                                        ].join(' ')}
                                    >
                                        {#if slot.character && charIconMap[slot.character]}
                                            <img
                                                src={charIconMap[slot.character]}
                                                alt={slot.character}
                                                draggable="false"
                                                class="h-full w-full object-cover"
                                            />
                                        {:else}
                                            <span
                                                class="w-full h-full flex items-center justify-center text-[9px] font-bold text-(--theme-modal-text)/50"
                                                >{slot.character?.charAt(0) ?? '?'}</span
                                            >
                                        {/if}
                                    </button>
                                {/each}
                            </div>
                        </div>

                        <!-- Zone list -->
                        <div class="flex-1 overflow-y-auto p-3 space-y-1">
                            {#each selectedBuffSet.zones as zone}
                                {@const def = ZONE_MAP.get(zone.zoneId)}
                                {#if def}
                                    <div
                                        class="flex items-center gap-1.5 rounded px-3 py-2"
                                        style="background: var(--theme-input-bg);"
                                    >
                                        <span class="shrink-0 text-xs text-(--theme-modal-text) truncate"
                                            >{def.label}</span
                                        >
                                        {#if zone.ref}
                                            {@const refDef =
                                                ZONE_REF_MAP.get(zone.ref.zoneId) ??
                                                ZONE_MAP.get(zone.ref.zoneId as any)}
                                            {@const refName = teamNames[zone.ref.characterIdx] ?? '?'}
                                            {@const refOp = zone.ref.threshold < 0 ? '+' : '-'}
                                            {@const refTh =
                                                zone.ref.threshold < 0 ? -zone.ref.threshold : zone.ref.threshold}
                                            {@const refS = simplifyPct(zone.ref.pct)}
                                            {@const hasThreshold = zone.ref.threshold !== 0}
                                            {@const hasLower = zone.ref.lower !== undefined}
                                            {@const hasUpper = zone.ref.upper !== undefined}
                                            <span
                                                class="flex-1 text-[10px] text-(--theme-modal-text)/40 truncate min-w-0 text-right"
                                                title="({refName}.{refDef?.label ?? '?'}{hasThreshold
                                                    ? ' ' + refOp + ' ' + refTh + (refDef?.unit === '%' ? '%' : '')
                                                    : ''}) ÷{refS.divisor}×{refS.multiplier}{hasLower || hasUpper
                                                    ? ' clamp(' +
                                                      (hasLower ? String(zone.ref.lower) : '') +
                                                      ' ~ ' +
                                                      (hasUpper ? String(zone.ref.upper) : '') +
                                                      ')'
                                                    : ''}"
                                            >
                                                引用: ({refName}.{refDef?.label ?? '?'}{hasThreshold
                                                    ? refOp + refTh + (refDef?.unit === '%' ? '%' : '')
                                                    : ''}) ÷{refS.divisor}×{refS.multiplier}
                                                {#if hasLower || hasUpper}
                                                    <span class="text-(--theme-modal-text)/30">
                                                        ({hasLower ? zone.ref.lower : ''}~{hasUpper
                                                            ? zone.ref.upper
                                                            : ''})
                                                    </span>
                                                {/if}
                                            </span>
                                        {:else}
                                            <div class="flex-1 flex justify-end items-center gap-1">
                                                <input
                                                    type="number"
                                                    value={zone.value}
                                                    oninput={(e) => {
                                                        const v = parseFloat((e.target as HTMLInputElement).value)
                                                        setBuffSetZoneValue(
                                                            selectedBuffSet.id,
                                                            zone.zoneId,
                                                            isNaN(v) ? 0 : v
                                                        )
                                                    }}
                                                    class="w-14 h-6 rounded border bg-transparent px-1.5 text-xs text-right tabular-nums text-(--theme-modal-text) outline-none"
                                                    style="border-color: var(--theme-divider-border);"
                                                />
                                                <span class="text-[10px] text-(--theme-modal-text)/40 w-3"
                                                    >{def.unit === '%' ? '%' : ''}</span
                                                >
                                            </div>
                                        {/if}
                                        <button
                                            onclick={() => openRefModal(zone.zoneId)}
                                            class="shrink-0 rounded border px-1.5 py-0.5 text-[10px] transition-colors flex items-center gap-0.5"
                                            style="border-color: var(--theme-divider-border);"
                                        >
                                            <Icon icon="mdi:link-variant" class="size-3" />
                                            引用
                                        </button>
                                    </div>
                                {/if}
                            {/each}
                            {#if selectedBuffSet.zones.length === 0}
                                <div class="text-xs text-(--theme-modal-text)/30 py-4 text-center">暂无乘区</div>
                            {/if}
                        </div>
                    {:else}
                        <div class="flex-1 flex items-center justify-center text-xs text-(--theme-modal-text)/40">
                            选择一个 BUFF 块进行编辑
                        </div>
                    {/if}
                </div>
                {#if selectedBuffSet}
                    <div
                        class="w-52 shrink-0 border-l flex flex-col"
                        style="border-left: 1px solid var(--theme-divider-border);"
                    >
                        <div class="flex-1 overflow-y-auto p-3">
                            <div class="flex flex-col gap-0.5">
                                {#each ZONE_DEFS as def}
                                    {@const exists = selectedBuffSet.zones.some((z) => z.zoneId === def.id)}
                                    <button
                                        onclick={() => {
                                            if (exists) {
                                                removeZoneFromBuffSet(selectedBuffSet.id, def.id)
                                            } else {
                                                addZoneToBuffSet(selectedBuffSet.id, def.id)
                                            }
                                        }}
                                        class={[
                                            'w-full text-left rounded px-2 py-1.5 text-xs font-medium transition-colors inline-flex items-center gap-1.5',
                                            exists
                                                ? 'bg-(--theme-accent-bg)/20 text-(--theme-accent-text)'
                                                : 'text-(--theme-modal-text)/50 hover:bg-(--theme-modal-text)/5'
                                        ].join(' ')}
                                    >
                                        <Icon
                                            icon={exists ? 'mdi:check' : 'mdi:circle-outline'}
                                            class="size-3.5 shrink-0"
                                        />
                                        {def.label}
                                    </button>
                                {/each}
                            </div>
                        </div>
                    </div>
                {/if}
            </div>

            <div
                class="flex items-center justify-end gap-2 border-t px-5 py-3"
                style="border-top: 1px solid var(--theme-divider-border);"
            >
                <button
                    onclick={onclose}
                    class="h-7 rounded-md px-4 text-xs text-(--theme-modal-text)/60 transition-colors hover:bg-(--theme-modal-text)/10"
                    style="background: var(--theme-input-bg);">保存并关闭</button
                >
            </div>
        </div>
    </div>
{/if}

{#if showRefModal}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        class="fixed inset-0 z-60 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        onkeydown={(e) => e.key === 'Escape' && (showRefModal = false)}
    >
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
            class="rounded-xl border p-5 shadow-xl w-[28rem]"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
        >
            <div class="flex items-center justify-between mb-5">
                <h3 class="text-sm font-semibold">引用配置</h3>
                <button
                    onclick={() => (showRefLookup = true)}
                    class="flex items-center gap-1 rounded px-2 py-1 text-xs text-(--theme-accent-text) transition-colors hover:bg-(--theme-modal-text)/5"
                >
                    <Icon icon="mdi:magnify" class="size-3.5" />
                    速查
                </button>
            </div>

            <div class="space-y-4">
                <!-- Character selector (top) -->
                <div>
                    <label class="text-[10px] text-(--theme-modal-text)/50 block mb-1.5">引用角色</label>
                    <div class="flex gap-2">
                        {#each team as slot, i}
                            <button
                                onclick={() => (refCharacterIdx = i)}
                                class={[
                                    'size-9 rounded-full overflow-hidden border-2 transition-all',
                                    refCharacterIdx === i
                                        ? 'border-(--theme-accent-bg) ring-2 ring-(--theme-accent-bg)/30'
                                        : 'border-transparent grayscale opacity-30 hover:opacity-60'
                                ].join(' ')}
                            >
                                {#if slot.character && charIconMap[slot.character]}
                                    <img
                                        src={charIconMap[slot.character]}
                                        alt={slot.character}
                                        draggable="false"
                                        class="h-full w-full object-cover"
                                    />
                                {:else}
                                    <span
                                        class="w-full h-full flex items-center justify-center text-xs font-bold text-(--theme-modal-text)/50"
                                        >{slot.character?.charAt(0) ?? '?'}</span
                                    >
                                {/if}
                            </button>
                        {/each}
                    </div>
                </div>

                <!-- Zone selector (below) -->
                <div>
                    <label class="text-[10px] text-(--theme-modal-text)/50 block mb-1.5">引用属性</label>
                    <div class="relative">
                        <button
                            onclick={() => (showRefZoneMenu = !showRefZoneMenu)}
                            class="w-full flex items-center justify-between rounded-lg border px-3 py-2 text-xs text-(--theme-modal-text) transition-colors hover:bg-(--theme-modal-text)/5"
                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                        >
                            <span class="truncate">{refTargetDef?.label ?? refTargetZoneId}</span>
                            <Icon icon="mdi:chevron-down" class="size-3.5 shrink-0 text-(--theme-modal-text)/40" />
                        </button>
                        {#if showRefZoneMenu}
                            <div
                                class="absolute left-0 top-full z-10 mt-1.5 w-full max-h-60 overflow-y-auto rounded-lg border bg-(--theme-modal-bg) py-1 shadow-xl backdrop-blur-lg"
                                style="border-color: var(--theme-divider-border);"
                                onclick={(e) => e.stopPropagation()}
                            >
                                {#each ZONE_REF_DEFS.filter((d) => d.id !== refZoneId) as def}
                                    <button
                                        onclick={() => {
                                            refTargetZoneId = def.id
                                            showRefZoneMenu = false
                                        }}
                                        class={[
                                            'flex w-full items-center gap-2 px-3 py-2 text-xs text-left transition-colors',
                                            refTargetZoneId === def.id
                                                ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/15'
                                                : 'text-(--theme-modal-text) hover:bg-(--theme-modal-text)/5'
                                        ].join(' ')}
                                    >
                                        <span class="flex-1">{def.label}</span>
                                        <span class="text-[10px] text-(--theme-modal-text)/40"
                                            >{def.unit === '%' ? '%' : ''}</span
                                        >
                                    </button>
                                {/each}
                            </div>
                        {/if}
                    </div>
                </div>

                <!-- Conversion rule card -->
                {#if refTargetDef && currentZoneDef}
                    <div
                        class="rounded-lg border px-4 py-3.5 space-y-3"
                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                    >
                        <!-- Header: refAttr -->
                        <div class="text-xs text-(--theme-modal-text)/60">
                            <span class="font-medium text-(--theme-modal-text)/80">{refTargetDef.label}</span>
                        </div>

                        <!-- Line 1: 超过 [threshold] unit1 的部分 -->
                        <div
                            class="flex items-center rounded-md border overflow-hidden"
                            style="border-color: var(--theme-divider-border);"
                        >
                            <button
                                onclick={() => {
                                    refHasThreshold = !refHasThreshold
                                }}
                                class={[
                                    'px-3 py-1.5 text-xs font-medium transition-all',
                                    refHasThreshold
                                        ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12 shadow-sm'
                                        : 'text-(--theme-modal-text)/25 bg-transparent hover:text-(--theme-modal-text)/50'
                                ].join(' ')}
                            >
                                超过
                            </button>
                            <div
                                class="flex items-center flex-1 px-3 py-1.5 border-x"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                            >
                                <input
                                    type="number"
                                    bind:value={refThreshold}
                                    disabled={!refHasThreshold}
                                    class="w-full min-w-0 text-xs outline-none tabular-nums text-center bg-transparent disabled:text-(--theme-modal-text)/20"
                                    class:text-(--theme-modal-text)={refHasThreshold}
                                />
                                <span class="text-xs text-(--theme-modal-text)/40">{refTargetDefUnit}</span>
                            </div>
                            <span class="text-xs text-(--theme-modal-text)/40 px-3 py-1.5">的部分</span>
                        </div>

                        <!-- Conversion mode tab -->
                        <div
                            class="flex rounded-md border overflow-hidden"
                            style="border-color: var(--theme-divider-border);"
                        >
                            <button
                                onclick={() => {
                                    refIsDiscrete = false
                                }}
                                class={[
                                    'flex-1 px-3 py-1.5 text-xs font-medium transition-all',
                                    !refIsDiscrete
                                        ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12 shadow-sm'
                                        : 'text-(--theme-modal-text)/25 bg-transparent hover:text-(--theme-modal-text)/50'
                                ].join(' ')}
                            >
                                线性地
                            </button>
                            <div class="w-px self-stretch" style="background: var(--theme-divider-border);"></div>
                            <button
                                onclick={() => {
                                    refIsDiscrete = true
                                }}
                                class={[
                                    'flex-1 px-3 py-1.5 text-xs font-medium transition-all',
                                    refIsDiscrete
                                        ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12 shadow-sm'
                                        : 'text-(--theme-modal-text)/25 bg-transparent hover:text-(--theme-modal-text)/50'
                                ].join(' ')}
                            >
                                离散地
                            </button>
                        </div>

                        <!-- Line 2: 每 [divisor] unit1 转换为 [multiplier] unit2 -->
                        <div
                            class="flex items-center rounded-md border overflow-hidden"
                            style="border-color: var(--theme-divider-border);"
                        >
                            <span
                                class="text-xs text-(--theme-modal-text)/40 px-3 py-1.5 border-r"
                                style="border-color: var(--theme-divider-border);">每</span
                            >
                            <div
                                class="flex items-center flex-1 px-3 py-1.5 border-r"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                            >
                                <input
                                    type="number"
                                    bind:value={refDivisor}
                                    class="w-full min-w-0 text-xs text-(--theme-modal-text) outline-none tabular-nums text-center bg-transparent"
                                />
                                <span class="text-xs text-(--theme-modal-text)/40">{refTargetDefUnit}</span>
                            </div>
                            <span
                                class="text-xs text-(--theme-modal-text)/40 px-3 py-1.5 border-r"
                                style="border-color: var(--theme-divider-border);">转换为</span
                            >
                            <div
                                class="flex items-center flex-1 px-3 py-1.5"
                                style="background: var(--theme-input-bg);"
                            >
                                <input
                                    type="number"
                                    bind:value={refMultiplier}
                                    class="w-full min-w-0 text-xs text-(--theme-modal-text) outline-none tabular-nums text-center bg-transparent"
                                />
                                <span class="text-xs text-(--theme-modal-text)/40">{currentZoneUnit}</span>
                            </div>
                        </div>

                        <!-- Footer: 的 targetName -->
                        <div class="flex justify-end text-sm text-(--theme-modal-text)/60">
                            <span class="text-(--theme-modal-text)/30">的</span>
                            <span class="font-medium text-(--theme-accent-text) ml-1">{currentZoneDef.label}</span>
                        </div>
                    </div>
                {/if}

                <!-- Lower & Upper -->
                <div class="flex gap-2">
                    <div
                        class="flex items-center flex-1 rounded-md border overflow-hidden"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <button
                            onclick={() => {
                                refHasLower = !refHasLower
                            }}
                            class={[
                                'px-3 py-1.5 text-xs font-medium transition-all',
                                refHasLower
                                    ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12 shadow-sm'
                                    : 'text-(--theme-modal-text)/25 bg-transparent hover:text-(--theme-modal-text)/50'
                            ].join(' ')}
                        >
                            下限
                        </button>
                        <div
                            class="flex items-center flex-1 px-3 py-1.5 border-x"
                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                        >
                            <input
                                type="number"
                                bind:value={refLower}
                                disabled={!refHasLower}
                                class="w-full min-w-0 text-xs outline-none tabular-nums text-center bg-transparent disabled:text-(--theme-modal-text)/20"
                                class:text-(--theme-modal-text)={refHasLower}
                            />
                        </div>
                        <span class="text-xs text-(--theme-modal-text)/40 px-3 py-1.5">{currentZoneUnit}</span>
                    </div>
                    <div
                        class="flex items-center flex-1 rounded-md border overflow-hidden"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <button
                            onclick={() => {
                                refHasUpper = !refHasUpper
                            }}
                            class={[
                                'px-3 py-1.5 text-xs font-medium transition-all',
                                refHasUpper
                                    ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12 shadow-sm'
                                    : 'text-(--theme-modal-text)/25 bg-transparent hover:text-(--theme-modal-text)/50'
                            ].join(' ')}
                        >
                            上限
                        </button>
                        <div
                            class="flex items-center flex-1 px-3 py-1.5 border-x"
                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                        >
                            <input
                                type="number"
                                bind:value={refUpper}
                                disabled={!refHasUpper}
                                class="w-full min-w-0 text-xs outline-none tabular-nums text-center bg-transparent disabled:text-(--theme-modal-text)/20"
                                class:text-(--theme-modal-text)={refHasUpper}
                            />
                        </div>
                        <span class="text-xs text-(--theme-modal-text)/40 px-3 py-1.5">{currentZoneUnit}</span>
                    </div>
                </div>
            </div>

            <div
                class="flex items-center justify-between mt-5 pt-4 border-t"
                style="border-color: var(--theme-divider-border);"
            >
                <button
                    onclick={handleClearRef}
                    class="rounded-md px-3 py-1.5 text-xs text-red-500 transition-colors hover:bg-red-500/15"
                    >清除引用</button
                >
                <div class="flex items-center gap-2">
                    <button
                        onclick={() => (showRefModal = false)}
                        class="rounded-md px-3 py-1.5 text-xs text-(--theme-modal-text)/50 transition-colors hover:bg-(--theme-modal-text)/10"
                        >取消</button
                    >
                    <button
                        onclick={handleConfirmRef}
                        class="rounded-md px-4 py-1.5 text-xs text-white transition-all hover:brightness-125 shadow-sm"
                        style="background: var(--theme-accent-bg);">确认</button
                    >
                </div>
            </div>
        </div>
    </div>
{/if}

{#if showDeleteFolderConfirm}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        class="fixed inset-0 z-70 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        onkeydown={(e) => e.key === 'Escape' && (showDeleteFolderConfirm = false)}
    >
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
            class="rounded-xl border p-5 shadow-xl w-80"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
        >
            <h3 class="text-sm font-semibold mb-2">确认删除文件夹</h3>
            <p class="text-xs text-(--theme-modal-text)/60 mb-4">
                将删除该文件夹内的所有 <strong>{deleteFolderCount}</strong> 条 BUFF，确定吗？
            </p>
            <div class="flex justify-end gap-2">
                <button
                    onclick={() => (showDeleteFolderConfirm = false)}
                    class="h-7 rounded-md px-3 text-xs text-(--theme-modal-text)/60 transition-colors hover:bg-(--theme-modal-text)/10"
                    style="background: var(--theme-input-bg);">取消</button
                >
                <button
                    onclick={confirmDeleteFolder}
                    class="h-7 rounded-md px-3 text-xs text-white transition-all hover:brightness-125"
                    style="background: var(--theme-accent-bg);">确认删除</button
                >
            </div>
        </div>
    </div>
{/if}

<QuickLookup
    open={showLookup}
    {team}
    showCustomHitOption={false}
    onCreateBuff={(name) => createBuffSet(name)}
    onclose={() => (showLookup = false)}
/>

<QuickLookup
    open={showRefLookup}
    {team}
    showBuffOption={false}
    showCustomHitOption={false}
    onclose={() => (showRefLookup = false)}
/>
