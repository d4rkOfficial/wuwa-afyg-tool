<script lang="ts">
    import Icon from '@iconify/svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import {
        getContextMenu,
        setContextMenu,
        getTrackMenu,
        setTrackMenu,
        getBlockMenu,
        setBlockMenu,
        getMultiBlockMenu,
        setMultiBlockMenu,
        getOpBlocks,
        getDamageBlocks,
        getRefLines,
        getUiBtnIcons,
        canAddBefore,
        canAddAfter,
        addBefore,
        addAfter,
        removeLine,
        startEdit,
        canSetIntro,
        toggleIntro,
        canSetSwitchback,
        toggleSwitchback,
        removeBlock,
        removeBlocks,
        resetDamageBindingsForBlocks,
        openRefSkillPicker,
        openSkillPicker,
        openNonDirectPicker,
        addDamageBlock,
        removeDamageBySource,
        addOpBlock,
        canDelete,
        handleBlockDblclick,
        getSelectedBlockIds
    } from './timeline.store.svelte'

    let confirmMultiAction = $state<'delete' | 'reset' | null>(null)

    function clampMenu(node: HTMLElement, pos: { x: number; y: number }) {
        node.style.left = pos.x + 'px'
        node.style.top = pos.y + 'px'
        requestAnimationFrame(() => {
            const r = node.getBoundingClientRect()
            const cw = document.documentElement.clientWidth
            const ch = document.documentElement.clientHeight
            if (r.right > cw - 8) node.style.left = cw - r.width - 8 + 'px'
            if (r.bottom > ch - 8) node.style.top = ch - r.height - 8 + 'px'
        })
    }
</script>

<!-- Ref Line Context Menu -->
{#if getContextMenu()}
    {@const cm = getContextMenu()!}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
        class="fixed z-50 min-w-44 rounded-lg border bg-(--theme-context-menu-bg) text-(--theme-context-menu-text) py-1 shadow-xl backdrop-blur-lg"
        style="left: {cm.x}px; top: {cm.y}px; border-color: var(--theme-divider-border);"
        data-context-menu="true"
        use:clampMenu={{ x: cm.x, y: cm.y }}
        onclick={() => setContextMenu(null)}
    >
        <div class="px-3 py-1 text-xs font-semibold text-(--theme-context-menu-text)/50 uppercase tracking-wider">
            参考线
        </div>
        {#if canAddBefore(cm.id)}
            <button
                onclick={() => {
                    addBefore(cm.id)
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors"
            >
                <Icon icon="mdi:arrow-left-bold" class="size-4 shrink-0" />
                左侧添加参考线
            </button>
        {/if}
        {#if canAddAfter(cm.id)}
            <button
                onclick={() => {
                    addAfter(cm.id)
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors"
            >
                <Icon icon="mdi:arrow-right-bold" class="size-4 shrink-0" />
                右侧添加参考线
            </button>
        {/if}
        {#if canDelete(cm.id)}
            <button
                onclick={() => {
                    const r = getRefLines().find((rl) => rl.id === cm.id)
                    if (r) startEdit(cm.id, r.time)
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors"
            >
                <Icon icon="mdi:clock-edit" class="size-4 shrink-0" />
                命名参考线
            </button>
            <button
                onclick={() => {
                    removeLine(cm.id)
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400 hover:bg-(--theme-context-menu-bg-focused) transition-colors"
            >
                <Icon icon="mdi:delete" class="size-4 shrink-0" />
                删除参考线
            </button>
        {/if}
        <div class="border-t my-1" style="border-color: var(--theme-divider-border);"></div>
        <div class="px-3 py-1 text-xs font-semibold text-(--theme-context-menu-text)/50 uppercase tracking-wider">
            伤害绑定
        </div>
        <div class="px-3 py-0.5 text-[9px] text-(--theme-context-menu-text)/40">直伤</div>
        {#if getDamageBlocks().some((d) => d.sourceId === cm.id && d.trackIndex === 3 && d.skillHits.length > 0)}
            <button
                onclick={() => {
                    openRefSkillPicker(cm.id)
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors"
            >
                <Icon icon="mdi:pencil" class="size-4 shrink-0" />
                编辑直伤
            </button>
        {:else}
            <button
                onclick={() => {
                    openRefSkillPicker(cm.id)
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors"
            >
                <Icon icon="mdi:link-variant" class="size-4 shrink-0" />
                绑定直伤
            </button>
        {/if}
        <div class="px-3 py-0.5 text-[9px] text-(--theme-context-menu-text)/40">效应/处决</div>
        {#if getDamageBlocks().some((d) => d.sourceId === cm.id && d.trackIndex === 3 && d.nonDirectEntries.length > 0)}
            <button
                onclick={() => {
                    openNonDirectPicker('ref', cm.id)
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors"
            >
                <Icon icon="mdi:pencil" class="size-4 shrink-0" />
                编辑效应/处决
            </button>
        {:else}
            <button
                onclick={() => {
                    addDamageBlock('ref', cm.id)
                    openNonDirectPicker('ref', cm.id)
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors"
            >
                <Icon icon="mdi:link-variant" class="size-4 shrink-0" />
                绑定效应/处决
            </button>
        {/if}
        {#if getDamageBlocks().some((d) => d.sourceId === cm.id && d.trackIndex === 3)}
            <div class="border-t my-1" style="border-color: var(--theme-divider-border);"></div>
            <button
                onclick={() => {
                    removeDamageBySource(cm.id, 'all')
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400 hover:bg-(--theme-context-menu-bg-focused) transition-colors"
            >
                <Icon icon="mdi:restore" class="size-4 shrink-0" />
                重置伤害绑定
            </button>
        {/if}
    </div>
{/if}

<!-- Block Context Menu -->
{#if getBlockMenu()}
    {@const bm = getBlockMenu()!}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
        class="fixed z-50 min-w-44 rounded-lg border bg-(--theme-context-menu-bg) text-(--theme-context-menu-text) py-1 shadow-xl backdrop-blur-lg"
        style="left: {bm.x}px; top: {bm.y}px; border-color: var(--theme-divider-border);"
        data-block-menu="true"
        use:clampMenu={{ x: bm.x, y: bm.y }}
        onclick={() => setBlockMenu(null)}
    >
        <div class="px-3 py-1 text-xs font-semibold text-(--theme-context-menu-text)/50 uppercase tracking-wider">
            操作块
        </div>
        <button
            onclick={() => {
                handleBlockDblclick(bm.blockId)
            }}
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
        >
            <Icon icon="mdi:comment-edit" class="size-4 shrink-0" />
            修改备注
        </button>
        <button
            onclick={() => {
                removeBlock(bm.blockId)
            }}
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400 hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
        >
            <Icon icon="mdi:delete" class="size-4 shrink-0" />
            删除操作块
        </button>
        <div class="border-t my-1" style="border-color: var(--theme-divider-border);"></div>
        <div class="px-3 py-1 text-xs font-semibold text-(--theme-context-menu-text)/50 uppercase tracking-wider">
            特殊切人
        </div>
        {#if canSetIntro(bm.blockId)}
            <button
                onclick={() => {
                    toggleIntro(bm.blockId)
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
            >
                <Icon icon="mdi:play-circle" class="size-4 shrink-0" />
                设置变奏入场
            </button>
        {/if}
        {#if getOpBlocks().some((b) => b.id === bm.blockId && b.intro)}
            <button
                onclick={() => {
                    toggleIntro(bm.blockId)
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
            >
                <Icon icon="mdi:stop-circle" class="size-4 shrink-0" />
                取消变奏入场
            </button>
        {/if}
        {#if canSetSwitchback(bm.blockId)}
            <button
                onclick={() => {
                    toggleSwitchback(bm.blockId)
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
            >
                <Icon icon="mdi:play-circle" class="size-4 shrink-0" />
                设置为切回
            </button>
        {/if}
        {#if getOpBlocks().some((b) => b.id === bm.blockId && b.switchback)}
            <button
                onclick={() => {
                    toggleSwitchback(bm.blockId)
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
            >
                <Icon icon="mdi:close-circle-outline" class="size-4 shrink-0" />
                取消切回
            </button>
        {/if}
        <div class="border-t my-1" style="border-color: var(--theme-divider-border);"></div>
        <div class="px-3 py-1 text-xs font-semibold text-(--theme-context-menu-text)/50 uppercase tracking-wider">
            伤害绑定
        </div>
        <div class="px-3 py-0.5 text-[9px] text-(--theme-context-menu-text)/40">直伤</div>
        {#if getDamageBlocks().some((d) => d.sourceId === bm.blockId && d.trackIndex === 3 && d.skillHits.length > 0)}
            <button
                onclick={() => {
                    openSkillPicker(bm.blockId)
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
            >
                <Icon icon="mdi:pencil" class="size-4 shrink-0" />
                编辑直伤
            </button>
        {:else}
            <button
                onclick={() => {
                    addDamageBlock('op', bm.blockId)
                    openSkillPicker(bm.blockId)
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
            >
                <Icon icon="mdi:link-variant" class="size-4 shrink-0" />
                绑定直伤
            </button>
        {/if}
        <div class="px-3 py-0.5 text-[9px] text-(--theme-context-menu-text)/40">效应/处决</div>
        {#if getDamageBlocks().some((d) => d.sourceId === bm.blockId && d.trackIndex === 3 && d.nonDirectEntries.length > 0)}
            <button
                onclick={() => {
                    openNonDirectPicker('op', bm.blockId)
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
            >
                <Icon icon="mdi:pencil" class="size-4 shrink-0" />
                编辑效应/处决
            </button>
        {:else}
            <button
                onclick={() => {
                    addDamageBlock('op', bm.blockId)
                    openNonDirectPicker('op', bm.blockId)
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
            >
                <Icon icon="mdi:link-variant" class="size-4 shrink-0" />
                绑定效应/处决
            </button>
        {/if}
        {#if getDamageBlocks().some((d) => d.sourceId === bm.blockId && d.trackIndex === 3)}
            <div class="border-t mt-1 mb-0" style="border-color: var(--theme-divider-border);"></div>
            <button
                onclick={() => {
                    removeDamageBySource(bm.blockId, 'all')
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400 hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
            >
                <Icon icon="mdi:restore" class="size-4 shrink-0" />
                重置伤害绑定
            </button>
        {/if}
    </div>
{/if}

<!-- Multi-Block Context Menu -->
{#if getMultiBlockMenu()}
    {@const mm = getMultiBlockMenu()!}
    {@const count = Object.keys(getSelectedBlockIds()).length}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
        class="fixed z-50 min-w-44 rounded-lg border bg-(--theme-context-menu-bg) text-(--theme-context-menu-text) py-1 shadow-xl backdrop-blur-lg"
        style="left: {mm.x}px; top: {mm.y}px; border-color: var(--theme-divider-border);"
        data-context-menu="true"
        use:clampMenu={{ x: mm.x, y: mm.y }}
        onclick={() => setMultiBlockMenu(null)}
    >
        <div class="px-3 py-1 text-xs font-semibold text-(--theme-context-menu-text)/50 uppercase tracking-wider">
            操作块 (已选 {count} 个)
        </div>
        <button
            onclick={() => (confirmMultiAction = 'delete')}
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400 hover:bg-(--theme-context-menu-bg-focused) transition-colors"
        >
            <Icon icon="mdi:delete" class="size-4 shrink-0" />
            删除操作块 ({count} 个)
        </button>
        <button
            onclick={() => (confirmMultiAction = 'reset')}
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400 hover:bg-(--theme-context-menu-bg-focused) transition-colors"
        >
            <Icon icon="mdi:restore" class="size-4 shrink-0" />
            重置伤害绑定 ({count} 个)
        </button>
    </div>
{/if}

{#if confirmMultiAction === 'delete'}
    {@const ids = Object.keys(getSelectedBlockIds())}
    <Modal open={true} onclose={() => (confirmMultiAction = null)}>
        {#snippet title()}
            <div class="flex items-center gap-2 text-red-400">
                <Icon icon="mdi:alert-circle" class="size-5" />
                危险操作
            </div>
        {/snippet}
        {#snippet children()}
            <p class="text-sm leading-relaxed">
                确认删除选中的 {ids.length} 个操作块？该操作不可撤销。
            </p>
            <div class="flex justify-end gap-2 mt-5">
                <button
                    onclick={() => (confirmMultiAction = null)}
                    class="h-8 rounded-md px-4 text-xs text-(--theme-modal-text)/60 transition-colors hover:bg-(--theme-modal-text)/10"
                    style="background: var(--theme-input-bg);"
                >
                    取消
                </button>
                <button
                    onclick={() => {
                        removeBlocks(ids)
                        confirmMultiAction = null
                    }}
                    class="h-8 rounded-md bg-red-700 px-4 text-xs text-white transition-colors hover:bg-red-600"
                >
                    确认
                </button>
            </div>
        {/snippet}
    </Modal>
{/if}

{#if confirmMultiAction === 'reset'}
    {@const ids = Object.keys(getSelectedBlockIds())}
    <Modal open={true} onclose={() => (confirmMultiAction = null)}>
        {#snippet title()}
            <div class="flex items-center gap-2 text-red-400">
                <Icon icon="mdi:alert-circle" class="size-5" />
                危险操作
            </div>
        {/snippet}
        {#snippet children()}
            <p class="text-sm leading-relaxed">
                确认重置选中的 {ids.length} 个操作块的伤害绑定？
            </p>
            <div class="flex justify-end gap-2 mt-5">
                <button
                    onclick={() => (confirmMultiAction = null)}
                    class="h-8 rounded-md px-4 text-xs text-(--theme-modal-text)/60 transition-colors hover:bg-(--theme-modal-text)/10"
                    style="background: var(--theme-input-bg);"
                >
                    取消
                </button>
                <button
                    onclick={() => {
                        resetDamageBindingsForBlocks(ids)
                        confirmMultiAction = null
                    }}
                    class="h-8 rounded-md bg-red-700 px-4 text-xs text-white transition-colors hover:bg-red-600"
                >
                    确认
                </button>
            </div>
        {/snippet}
    </Modal>
{/if}

<!-- Track Key Picker Menu -->
{#if getTrackMenu()}
    {@const tm = getTrackMenu()!}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
        class="fixed z-50 rounded-lg border bg-(--theme-context-menu-bg) text-(--theme-context-menu-text) py-1.5 px-2 shadow-xl backdrop-blur-lg"
        style="left: {tm.x}px; top: {tm.y}px; border-color: var(--theme-divider-border);"
        data-track-menu="true"
        use:clampMenu={{ x: tm.x, y: tm.y }}
        onclick={() => setTrackMenu(null)}
    >
        <div class="flex items-center gap-1">
            {#each getUiBtnIcons() as [name, url]}
                <button
                    class="size-7 flex items-center justify-center rounded hover:bg-(--theme-context-menu-bg-focused) transition-colors"
                    onclick={() => addOpBlock(tm.trackIndex, tm.pos, name)}
                    title={name}
                >
                    {#if url}
                        <img src={url} alt={name} draggable="false" class="size-5 object-contain pointer-events-none" />
                    {:else}
                        <span class="text-[10px] font-bold text-(--theme-context-menu-text)"
                            >{name === 'SpaceBar'
                                ? '⎵'
                                : name === 'MouseLeft'
                                  ? 'L'
                                  : name === 'MouseRight'
                                    ? 'R'
                                    : name === 'MouseMiddle'
                                      ? 'M'
                                      : name}</span
                        >
                    {/if}
                </button>
            {/each}
        </div>
    </div>
{/if}
