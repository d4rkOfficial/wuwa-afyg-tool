<script lang="ts">
    import {
        getAllBuffSets,
        createBuffSet,
        deleteBuffSet,
        renameBuffSet,
        addZoneToBuffSet,
        removeZoneFromBuffSet,
        setBuffSetZoneValue,
        setBuffSetScope,
        setBuffSetZoneRef,
        getGlobalBuffSetIds
    } from './calculation.store.svelte'
    import { ZONE_DEFS, ZONE_MAP, ZONE_REF_DEFS, ZONE_REF_MAP } from './calculation.consts'
    import type { CharSlot } from '$lib/data/types'
    import type { ZoneRef } from './calculation.types'
    import { getCharIconMap, elementColor } from '../timeline/timeline.store.svelte'
    import Icon from '@iconify/svelte'
    import QuickLookup from './quick-lookup.svelte'

    interface Props {
        open: boolean
        team: [CharSlot, CharSlot, CharSlot]
        onclose: () => void
    }

    let { open, team, onclose }: Props = $props()

    let showLookup = $state(false)

    function globalBuffColor(buffSet: { scope: number[] | 'all' }): string {
        if (!Array.isArray(buffSet.scope) || buffSet.scope.length === 0) return '#eab308'
        const idx = buffSet.scope[0]
        const charName = team[idx]?.character
        if (!charName) return '#eab308'
        return elementColor(charName)
    }

    let selectedBuffSetId = $state<string | null>(null)
    let newName = $state('')
    let showAddZone = $state(false)
    let showRename = $state(false)
    let renameValue = $state('')

    // ZoneRef modal state
    let showRefModal = $state(false)
    let refZoneId = $state<string>('')
    let refCharacterIdx = $state<number>(0)
    let refTargetZoneId = $state<string>('base_atk')
    let refThreshold = $state<number>(0)
    let refPct = $state<number>(100)
    let refLower = $state<number | undefined>(undefined)
    let refUpper = $state<number | undefined>(undefined)
    let showRefZoneMenu = $state(false)

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

    let selectedBuffSet = $derived(buffSets.find((s) => s.id === selectedBuffSetId) ?? null)

    let scopeChars = $derived.by(() => {
        if (!selectedBuffSet || selectedBuffSet.scope === 'all') return [true, true, true]
        const s = selectedBuffSet.scope
        return team.map((_, i) => s.includes(i))
    })

    let refTargetDef = $derived(ZONE_REF_MAP.get(refTargetZoneId) ?? ZONE_MAP.get(refTargetZoneId as any) ?? null)

    function handleCreateBuffSet() {
        const name = newName.trim() || '未命名BUFF块'
        createBuffSet(name)
        newName = ''
    }

    function handleAddZoneToBuffSet(zoneId: string) {
        if (!selectedBuffSetId) return
        addZoneToBuffSet(selectedBuffSetId, zoneId)
        showAddZone = false
    }

    function handleDeleteBuffSet() {
        if (!selectedBuffSetId) return
        deleteBuffSet(selectedBuffSetId)
        selectedBuffSetId = null
    }

    function openRename() {
        if (!selectedBuffSet) return
        renameValue = selectedBuffSet.name
        showRename = true
    }

    function handleRename() {
        if (!selectedBuffSetId) return
        renameBuffSet(selectedBuffSetId, renameValue || '未命名BUFF块')
        showRename = false
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
            refPct = zone.ref.pct
            refLower = zone.ref.lower
            refUpper = zone.ref.upper
        } else {
            refCharacterIdx = 0
            refTargetZoneId = zoneId
            refThreshold = 0
            refPct = 100
            refLower = undefined
            refUpper = undefined
        }
        if (refTargetZoneId === refZoneId) {
            const fallback = ZONE_REF_DEFS.find((d) => d.id !== refZoneId)
            refTargetZoneId = fallback?.id ?? ''
        }
        showRefModal = true
    }

    function handleConfirmRef() {
        if (!selectedBuffSetId) return
        const ref: ZoneRef = {
            characterIdx: refCharacterIdx,
            zoneId: refTargetZoneId as any,
            threshold: refThreshold,
            pct: refPct,
            lower: refLower !== undefined && !isNaN(refLower) ? refLower : undefined,
            upper: refUpper !== undefined && !isNaN(refUpper) ? refUpper : undefined
        }
        setBuffSetZoneRef(selectedBuffSetId, refZoneId, ref)
        showRefModal = false
    }

    function handleClearRef() {
        if (!selectedBuffSetId) return
        setBuffSetZoneRef(selectedBuffSetId, refZoneId, null)
        showRefModal = false
    }

    let teamNames = $derived(team.map((s) => s.character ?? '?'))
</script>

{#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-lg"
        onkeydown={(e) => e.key === 'Escape' && onclose()}
    >
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="w-full max-h-[95vh] h-full max-w-3xl rounded-xl border border-white/10 bg-(--theme-modal-bg) text-(--theme-modal-text) shadow-xl overflow-hidden flex flex-col my-4"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
        >
            <div class="flex items-center justify-between px-5 py-3 border-b border-white/10">
                <h2 class="text-sm font-semibold">BUFF 配置</h2>
                <button
                    onclick={() => (showLookup = true)}
                    class="flex items-center gap-1 rounded px-2 py-1 text-xs text-indigo-400 transition-colors hover:bg-white/5"
                >
                    <Icon icon="mdi:magnify" class="size-3.5" />
                    速查
                </button>
            </div>

            <div class="flex flex-1 overflow-hidden">
                <!-- Left column: block list -->
                <div class="w-56 shrink-0 border-r border-white/10 flex flex-col">
                    <div class="flex-1 overflow-y-auto p-2 space-y-1">
                        {#each sortedBuffSets as buffSet}
                            {@const isGlobal = globalBuffSetIds.includes(buffSet.id)}
                            <button
                                onclick={() => {
                                    selectedBuffSetId = buffSet.id
                                    showAddZone = false
                                }}
                                class={[
                                    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-left transition-colors',
                                    selectedBuffSetId === buffSet.id
                                        ? 'bg-indigo-500/15 text-indigo-300'
                                        : 'text-(--theme-modal-text)/70 hover:bg-white/5'
                                ].join(' ')}
                            >
                                <Icon
                                    icon={isGlobal ? 'mdi:crown' : 'mdi:widgets'}
                                    class="size-4 shrink-0 opacity-60"
                                />
                                <span class="truncate flex-1">{buffSet.name}</span>
                                {#if !isGlobal}
                                    {#if buffSet.scope === 'all'}
                                        <span class="text-[10px] text-(--theme-modal-text)/30 whitespace-nowrap"
                                            >(通用)</span
                                        >
                                    {:else}
                                        <span class="text-[10px] text-(--theme-modal-text)/30 whitespace-nowrap"
                                            >({teamNames
                                                .filter((_, i) => (buffSet.scope as number[]).includes(i))
                                                .join(', ')})</span
                                        >
                                    {/if}
                                {/if}
                            </button>
                        {/each}
                        {#if buffSets.length === 0}
                            <div class="text-xs text-(--theme-modal-text)/30 text-center py-4">暂无 BUFF 块</div>
                        {/if}
                    </div>
                    <div class="shrink-0 border-t border-white/10 p-2">
                        <div class="flex gap-1">
                            <input
                                type="text"
                                bind:value={newName}
                                placeholder="新BUFF块名称"
                                onkeydown={(e) => e.key === 'Enter' && handleCreateBuffSet()}
                                class="flex-1 min-w-0 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs outline-none text-(--theme-modal-text) placeholder:text-(--theme-modal-text)/30"
                            />
                            <button
                                onclick={handleCreateBuffSet}
                                class="shrink-0 rounded px-2 py-1 text-xs bg-indigo-500 text-white transition-colors hover:bg-indigo-400"
                            >
                                <Icon icon="mdi:plus" class="size-3" />
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Right column: block editor -->
                <div class="flex-1 flex flex-col">
                    {#if selectedBuffSet}
                        <!-- Character scope -->
                        <div class="shrink-0 px-3 pt-3 pb-1 border-b border-white/10">
                            <div class="flex items-center gap-1.5">
                                <span class="text-[10px] text-(--theme-modal-text)/50 mr-1">角色</span>
                                {#each team as slot, i}
                                    {@const globalDisabled =
                                        selectedBuffSet && globalBuffSetIds.includes(selectedBuffSet.id)}
                                    <button
                                        onclick={() => !globalDisabled && handleToggleChar(i)}
                                        class={[
                                            'size-8 rounded-full overflow-hidden border-2 transition-all',
                                            scopeChars[i]
                                                ? 'border-indigo-400 ring-2 ring-indigo-400/40'
                                                : globalDisabled
                                                  ? 'border-white/10'
                                                  : 'border-white/10 grayscale opacity-30 hover:opacity-60',
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

                        <!-- Add zone button -->
                        <div class="shrink-0 p-3 border-b border-white/10">
                            <div class="relative w-full">
                                <button
                                    onclick={() => (showAddZone = !showAddZone)}
                                    class="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/20 px-3 py-2 text-xs text-indigo-400 transition-colors hover:bg-white/5 hover:border-indigo-500/50"
                                >
                                    <Icon icon="mdi:plus" class="size-3.5" />
                                    添加乘区
                                </button>
                                {#if showAddZone}
                                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                                    <div
                                        class="absolute left-0 top-full z-10 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-white/10 bg-(--theme-modal-bg) py-1 shadow-xl backdrop-blur-lg"
                                        onclick={(e) => e.stopPropagation()}
                                    >
                                        {#each ZONE_DEFS as def}
                                            {@const exists = selectedBuffSet.zones.some((z) => z.zoneId === def.id)}
                                            <button
                                                onclick={() => !exists && handleAddZoneToBuffSet(def.id)}
                                                disabled={exists}
                                                class={[
                                                    'flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                                                    exists
                                                        ? 'text-(--theme-modal-text)/20 cursor-not-allowed'
                                                        : 'text-(--theme-modal-text) hover:bg-white/5'
                                                ].join(' ')}
                                            >
                                                <span class="flex-1">{def.label}</span>
                                                <span class="text-[10px] text-(--theme-modal-text)/40">{def.unit}</span>
                                                {#if exists}
                                                    <Icon icon="mdi:check" class="size-3 text-indigo-400" />
                                                {/if}
                                            </button>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        </div>

                        <!-- Zone list -->
                        <div class="flex-1 overflow-y-auto p-3 space-y-1">
                            {#each selectedBuffSet.zones as zone}
                                {@const def = ZONE_MAP.get(zone.zoneId)}
                                {#if def}
                                    <div class="flex items-center gap-1.5 rounded bg-white/5 px-3 py-2">
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
                                            {@const refClamp =
                                                (zone.ref.lower !== undefined ? zone.ref.lower : '') +
                                                ' ~ ' +
                                                (zone.ref.upper !== undefined ? zone.ref.upper : '')}
                                            {@const hasClamp = refClamp.trim() !== ' ~ '}
                                            <span
                                                class="flex-1 text-[10px] text-(--theme-modal-text)/40 truncate min-w-0 text-right"
                                                title="({refName}.{refDef?.label ?? '?'}{refTh !== 0
                                                    ? ' ' + refOp + ' ' + refTh + (refDef?.unit === '%' ? '%' : '')
                                                    : ''}) × {zone.ref.pct}%{hasClamp
                                                    ? ' clamp(' + refClamp + ')'
                                                    : ''}"
                                            >
                                                引用: ({refName}.{refDef?.label ?? '?'}{refTh !== 0
                                                    ? refOp + refTh + (refDef?.unit === '%' ? '%' : '')
                                                    : ''}) × {zone.ref.pct}%
                                                {#if hasClamp}
                                                    <span class="text-[var(--theme-modal-text)]/30"
                                                        >clamp({refClamp})</span
                                                    >
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
                                                    class="w-14 h-6 rounded border border-white/10 bg-transparent px-1.5 text-xs text-right tabular-nums text-(--theme-modal-text) outline-none"
                                                />
                                                <span class="text-[10px] text-(--theme-modal-text)/40 w-3"
                                                    >{def.unit === '%' ? '%' : ''}</span
                                                >
                                            </div>
                                        {/if}
                                        <button
                                            onclick={() => openRefModal(zone.zoneId)}
                                            class={[
                                                'shrink-0 rounded p-0.5 transition-colors',
                                                zone.ref
                                                    ? 'text-indigo-400 hover:text-indigo-300'
                                                    : 'text-zinc-500 hover:text-indigo-400'
                                            ].join(' ')}
                                            title={zone.ref ? '编辑引用' : '设置引用'}
                                        >
                                            <Icon icon="mdi:link-variant" class="size-3.5" />
                                        </button>
                                        <button
                                            onclick={() => removeZoneFromBuffSet(selectedBuffSet.id, zone.zoneId)}
                                            class="shrink-0 rounded p-0.5 text-zinc-500 transition-colors hover:text-red-400"
                                        >
                                            <Icon icon="mdi:close" class="size-3.5" />
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
            </div>

            <div class="flex items-center justify-between gap-2 border-t border-white/10 px-5 py-3">
                <div class="flex items-center gap-2">
                    {#if selectedBuffSet}
                        {@const isGlobal = globalBuffSetIds.includes(selectedBuffSet.id)}
                        {#if !isGlobal}
                            <button
                                onclick={openRename}
                                class="h-7 rounded-md bg-white/5 px-3 text-xs text-(--theme-modal-text)/60 transition-colors hover:bg-white/10"
                            >
                                <Icon icon="mdi:rename-outline" class="size-3.5 inline mr-1" />
                                编辑名称
                            </button>
                            <button
                                onclick={handleDeleteBuffSet}
                                class="h-7 rounded-md bg-white/5 px-3 text-xs text-red-400 transition-colors hover:bg-red-500/20"
                            >
                                <Icon icon="mdi:delete-outline" class="size-3.5 inline mr-1" />
                                删除
                            </button>
                        {/if}
                    {/if}
                </div>
                <button
                    onclick={onclose}
                    class="h-7 rounded-md bg-white/5 px-4 text-xs text-(--theme-modal-text)/60 transition-colors hover:bg-white/10"
                    >保存并关闭</button
                >
            </div>
        </div>
    </div>
{/if}

{#if showRename}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-60 flex items-center justify-center bg-black/40"
        onkeydown={(e) => e.key === 'Escape' && (showRename = false)}
    >
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
            class="rounded-xl border border-white/10 bg-(--theme-modal-bg) p-5 shadow-xl w-80"
            onclick={(e) => e.stopPropagation()}
        >
            <h3 class="text-sm font-semibold mb-3">编辑名称</h3>
            <input
                type="text"
                bind:value={renameValue}
                placeholder="输入新名称"
                onkeydown={(e) => e.key === 'Enter' && handleRename()}
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none text-(--theme-modal-text) placeholder:text-[var(--theme-modal-text)]/30 mb-4"
            />
            <div class="flex justify-end gap-2">
                <button
                    onclick={() => (showRename = false)}
                    class="h-7 rounded-md bg-white/5 px-3 text-xs text-[var(--theme-modal-text)]/60 transition-colors hover:bg-white/10"
                    >取消</button
                >
                <button
                    onclick={handleRename}
                    class="h-7 rounded-md bg-indigo-600 px-3 text-xs text-white transition-colors hover:bg-indigo-500"
                    >确认</button
                >
            </div>
        </div>
    </div>
{/if}

{#if showRefModal}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
        onkeydown={(e) => e.key === 'Escape' && (showRefModal = false)}
    >
        <div
            class="rounded-xl border border-white/10 bg-[var(--theme-modal-bg)] p-5 shadow-xl w-80"
            onclick={(e) => e.stopPropagation()}
        >
            <h3 class="text-sm font-semibold mb-4">引用配置</h3>

            <div class="space-y-3">
                <!-- Character selector -->
                <div>
                    <label class="text-[10px] text-[var(--theme-modal-text)]/50 block mb-1.5">引用角色</label>
                    <div class="flex gap-1.5">
                        {#each team as slot, i}
                            <button
                                onclick={() => (refCharacterIdx = i)}
                                class={[
                                    'size-9 rounded-full overflow-hidden border-2 transition-all',
                                    refCharacterIdx === i
                                        ? 'border-indigo-400 ring-2 ring-indigo-400/40'
                                        : 'border-white/10 grayscale opacity-30 hover:opacity-60'
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
                                        class="w-full h-full flex items-center justify-center text-xs font-bold text-[var(--theme-modal-text)]/50"
                                        >{slot.character?.charAt(0) ?? '?'}</span
                                    >
                                {/if}
                            </button>
                        {/each}
                    </div>
                </div>

                <!-- Zone selector (custom dropdown) -->
                <div>
                    <label class="text-[10px] text-[var(--theme-modal-text)]/50 block mb-1">引用乘区</label>
                    <div class="relative">
                        <button
                            onclick={() => (showRefZoneMenu = !showRefZoneMenu)}
                            class="w-full flex items-center justify-between rounded border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-[var(--theme-modal-text)] transition-colors hover:bg-white/10"
                        >
                            <span>{refTargetDef?.label ?? refTargetZoneId}</span>
                            <svg
                                class="size-3 text-[var(--theme-modal-text)]/40"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"><path d="M6 9l6 6 6-6" /></svg
                            >
                        </button>
                        {#if showRefZoneMenu}
                            <div
                                class="absolute left-0 top-full z-10 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-white/10 bg-[var(--theme-modal-bg)] py-1 shadow-xl backdrop-blur-lg"
                                onclick={(e) => e.stopPropagation()}
                            >
                                {#each ZONE_REF_DEFS.filter((d) => d.id !== refZoneId) as def}
                                    <button
                                        onclick={() => {
                                            refTargetZoneId = def.id
                                            showRefZoneMenu = false
                                        }}
                                        class={[
                                            'flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                                            refTargetZoneId === def.id
                                                ? 'text-indigo-400 bg-indigo-500/10'
                                                : 'text-[var(--theme-modal-text)] hover:bg-white/5'
                                        ].join(' ')}
                                    >
                                        <span class="flex-1">{def.label}</span>
                                        <span class="text-[10px] text-[var(--theme-modal-text)]/40">{def.unit}</span>
                                    </button>
                                {/each}
                            </div>
                        {/if}
                    </div>
                </div>

                <!-- Threshold & Pct -->
                <div>
                    <label class="text-[10px] text-[var(--theme-modal-text)]/50 block mb-1">阈值 × 百分比</label>
                    <div class="flex items-center gap-1.5">
                        <input
                            type="number"
                            bind:value={refThreshold}
                            class="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-[var(--theme-modal-text)] outline-none tabular-nums"
                        />
                        <span class="text-[var(--theme-modal-text)]/40 text-xs">×</span>
                        <input
                            type="number"
                            bind:value={refPct}
                            oninput={() => {
                                refPct = refPct
                            }}
                            class="w-20 rounded border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-[var(--theme-modal-text)] outline-none tabular-nums"
                        />
                        <span class="text-[var(--theme-modal-text)]/40 text-xs">%</span>
                    </div>
                </div>

                <!-- Lower & Upper -->
                <div>
                    <label class="text-[10px] text-[var(--theme-modal-text)]/50 block mb-1">下限 ~ 上限</label>
                    <div class="flex items-center gap-1.5">
                        <input
                            type="number"
                            bind:value={refLower}
                            class="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-[var(--theme-modal-text)] outline-none tabular-nums"
                        />
                        <span class="text-[var(--theme-modal-text)]/40 text-xs">~</span>
                        <input
                            type="number"
                            bind:value={refUpper}
                            oninput={() => {
                                if (refUpper !== undefined && refLower !== undefined && refUpper < refLower) {
                                    refLower = refUpper
                                }
                            }}
                            class="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-[var(--theme-modal-text)] outline-none tabular-nums"
                        />
                    </div>
                </div>

                <!-- Preview -->
                {#if refTargetDef}
                    {@const rChar = teamNames[refCharacterIdx] ?? '?'}
                    {@const pOp = refThreshold < 0 ? '+' : '-'}
                    {@const pTh = refThreshold < 0 ? -refThreshold : refThreshold}
                    {@const pClamp =
                        (refLower !== undefined && !isNaN(refLower) ? refLower : '') +
                        ' ~ ' +
                        (refUpper !== undefined && !isNaN(refUpper) ? refUpper : '')}
                    <div
                        class="rounded bg-white/5 px-2 py-1.5 text-[10px] text-[var(--theme-modal-text)]/50 text-center"
                    >
                        = ({rChar}.{refTargetDef.label}{pTh !== 0
                            ? pOp + pTh + (refTargetDef.unit === '%' ? '%' : '')
                            : ''}) × {refPct}%
                        {#if pClamp.trim() !== ' ~ '}
                            clamp({pClamp})
                        {/if}
                    </div>
                {/if}
            </div>

            <div class="flex justify-between mt-5">
                <button
                    onclick={handleClearRef}
                    class="h-7 rounded-md bg-white/5 px-3 text-xs text-red-400 transition-colors hover:bg-red-500/20"
                    >清除引用</button
                >
                <div class="flex gap-2">
                    <button
                        onclick={() => (showRefModal = false)}
                        class="h-7 rounded-md bg-white/5 px-3 text-xs text-[var(--theme-modal-text)]/60 transition-colors hover:bg-white/10"
                        >取消</button
                    >
                    <button
                        onclick={handleConfirmRef}
                        class="h-7 rounded-md bg-indigo-600 px-3 text-xs text-white transition-colors hover:bg-indigo-500"
                        >确认</button
                    >
                </div>
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
