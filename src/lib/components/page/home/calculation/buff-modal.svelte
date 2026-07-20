<script lang="ts">
    import {
        getBlocks,
        addBlock,
        removeBlock,
        updateBlockName,
        addZone,
        removeZone,
        updateZoneValue
    } from './calculation.store.svelte'
    import { ZONE_DEFS, ZONE_MAP } from './calculation.consts'
    import type { CharSlot } from '$lib/data/types'
    import Icon from '@iconify/svelte'
    import QuickLookup from './quick-lookup.svelte'

    interface Props {
        open: boolean
        team: [CharSlot, CharSlot, CharSlot]
        onclose: () => void
    }

    let { open, team, onclose }: Props = $props()

    let showLookup = $state(false)

    let selectedId = $state<string | null>(null)
    let newName = $state('')
    let showAddZone = $state(false)
    let showRename = $state(false)
    let renameValue = $state('')

    let blocks = $derived(getBlocks())

    let selectedBlock = $derived(blocks.find((b) => b.id === selectedId) ?? null)

    function handleAddBlock() {
        const name = newName.trim() || '未命名BUFF块'
        addBlock(name)
        newName = ''
    }

    function handleAddZone(zoneId: string) {
        if (!selectedId) return
        addZone(selectedId, zoneId)
        showAddZone = false
    }

    function handleRemoveBlock() {
        if (!selectedId) return
        removeBlock(selectedId)
        selectedId = null
    }

    function openRename() {
        if (!selectedBlock) return
        renameValue = selectedBlock.name
        showRename = true
    }

    function handleRename() {
        if (!selectedId) return
        updateBlockName(selectedId, renameValue || '未命名BUFF块')
        showRename = false
    }
</script>

{#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-lg"
        onkeydown={(e) => e.key === 'Escape' && onclose()}
    >
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="w-full max-h-[95vh] h-full max-w-3xl rounded-xl border border-white/10 bg-[var(--theme-modal-bg)] text-[var(--theme-modal-text)] shadow-xl overflow-hidden flex flex-col my-4"
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
                        {#each blocks as block}
                            <button
                                onclick={() => {
                                    selectedId = block.id
                                    showAddZone = false
                                }}
                                class={[
                                    'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-left transition-colors',
                                    selectedId === block.id
                                        ? 'bg-indigo-500/15 text-indigo-300'
                                        : 'text-[var(--theme-modal-text)]/70 hover:bg-white/5'
                                ].join(' ')}
                            >
                                <Icon icon="mdi:widgets" class="size-4 shrink-0 opacity-60" />
                                <span class="truncate flex-1">{block.name}</span>
                                <span class="text-[10px] text-[var(--theme-modal-text)]/40">{block.zones.length}</span>
                            </button>
                        {/each}
                        {#if blocks.length === 0}
                            <div class="text-xs text-[var(--theme-modal-text)]/30 text-center py-4">暂无 BUFF 块</div>
                        {/if}
                    </div>
                    <div class="shrink-0 border-t border-white/10 p-2">
                        <div class="flex gap-1">
                            <input
                                type="text"
                                bind:value={newName}
                                placeholder="新BUFF块名称"
                                onkeydown={(e) => e.key === 'Enter' && handleAddBlock()}
                                class="flex-1 min-w-0 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs outline-none text-[var(--theme-modal-text)] placeholder:text-[var(--theme-modal-text)]/30"
                            />
                            <button
                                onclick={handleAddBlock}
                                class="shrink-0 rounded px-2 py-1 text-xs bg-indigo-500 text-white transition-colors hover:bg-indigo-400"
                            >
                                <Icon icon="mdi:plus" class="size-3" />
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Right column: block editor -->
                <div class="flex-1 flex flex-col">
                    {#if selectedBlock}
                        <!-- Add zone button at top -->
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
                                    <div
                                        class="absolute left-0 top-full z-10 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-white/10 bg-[var(--theme-modal-bg)] py-1 shadow-xl backdrop-blur-lg"
                                        onclick={(e) => e.stopPropagation()}
                                    >
                                        {#each ZONE_DEFS as def}
                                            {@const exists = selectedBlock.zones.some((z) => z.zoneId === def.id)}
                                            <button
                                                onclick={() => !exists && handleAddZone(def.id)}
                                                disabled={exists}
                                                class={[
                                                    'flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                                                    exists
                                                        ? 'text-[var(--theme-modal-text)]/20 cursor-not-allowed'
                                                        : 'text-[var(--theme-modal-text)] hover:bg-white/5'
                                                ].join(' ')}
                                            >
                                                <span class="flex-1">{def.label}</span>
                                                <span class="text-[10px] text-[var(--theme-modal-text)]/40"
                                                    >{def.unit}</span
                                                >
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
                            {#each selectedBlock.zones as zone}
                                {@const def = ZONE_MAP.get(zone.zoneId)}
                                {#if def}
                                    <div class="flex items-center gap-2 rounded bg-white/5 px-3 py-2">
                                        <span class="flex-1 text-xs text-[var(--theme-modal-text)]">{def.label}</span>
                                        <input
                                            type="number"
                                            value={zone.value}
                                            oninput={(e) => {
                                                const v = parseFloat((e.target as HTMLInputElement).value)
                                                updateZoneValue(selectedBlock.id, zone.zoneId, isNaN(v) ? 0 : v)
                                            }}
                                            class="w-16 h-6 rounded border border-white/10 bg-transparent px-1.5 text-xs text-right tabular-nums text-[var(--theme-modal-text)] outline-none"
                                        />
                                        <span class="text-[10px] text-[var(--theme-modal-text)]/40 w-4"
                                            >{def.unit === '%' ? '%' : ''}</span
                                        >
                                        <button
                                            onclick={() => removeZone(selectedBlock.id, zone.zoneId)}
                                            class="shrink-0 rounded p-0.5 text-zinc-500 transition-colors hover:text-red-400"
                                        >
                                            <Icon icon="mdi:close" class="size-3.5" />
                                        </button>
                                    </div>
                                {/if}
                            {/each}
                            {#if selectedBlock.zones.length === 0}
                                <div class="text-xs text-[var(--theme-modal-text)]/30 py-4 text-center">暂无乘区</div>
                            {/if}
                        </div>
                    {:else}
                        <div class="flex-1 flex items-center justify-center text-xs text-[var(--theme-modal-text)]/40">
                            选择一个 BUFF 块进行编辑
                        </div>
                    {/if}
                </div>
            </div>

            <div class="flex items-center justify-between gap-2 border-t border-white/10 px-5 py-3">
                <div class="flex items-center gap-2">
                    {#if selectedBlock}
                        <button
                            onclick={openRename}
                            class="h-7 rounded-md bg-white/5 px-3 text-xs text-[var(--theme-modal-text)]/60 transition-colors hover:bg-white/10"
                        >
                            <Icon icon="mdi:rename-outline" class="size-3.5 inline mr-1" />
                            编辑名称
                        </button>
                        <button
                            onclick={handleRemoveBlock}
                            class="h-7 rounded-md bg-white/5 px-3 text-xs text-red-400 transition-colors hover:bg-red-500/20"
                        >
                            <Icon icon="mdi:delete-outline" class="size-3.5 inline mr-1" />
                            删除
                        </button>
                    {/if}
                </div>
                <button
                    onclick={onclose}
                    class="h-7 rounded-md bg-white/5 px-4 text-xs text-[var(--theme-modal-text)]/60 transition-colors hover:bg-white/10"
                    >关闭</button
                >
            </div>
        </div>
    </div>
{/if}

{#if showRename}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
        onkeydown={(e) => e.key === 'Escape' && (showRename = false)}
    >
        <div
            class="rounded-xl border border-white/10 bg-[var(--theme-modal-bg)] p-5 shadow-xl w-80"
            onclick={(e) => e.stopPropagation()}
        >
            <h3 class="text-sm font-semibold mb-3">编辑名称</h3>
            <input
                type="text"
                bind:value={renameValue}
                placeholder="输入新名称"
                onkeydown={(e) => e.key === 'Enter' && handleRename()}
                class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none text-[var(--theme-modal-text)] placeholder:text-[var(--theme-modal-text)]/30 mb-4"
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

<QuickLookup
    open={showLookup}
    {team}
    showCustomHitOption={false}
    onCreateBuff={(name) => addBlock(name)}
    onclose={() => (showLookup = false)}
/>
