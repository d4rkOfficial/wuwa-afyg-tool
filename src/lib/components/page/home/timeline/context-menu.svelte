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
        getOpBlocks,
        getDamageBlocks,
        getRefLines,
        getUiBtnIcons,
        getTeam,
        canAddBefore,
        canAddAfter,
        addBefore,
        addAfter,
        removeLine,
        startEdit,
        canSetIntro,
        toggleIntro,
        removeBlock,
        openRefSkillPicker,
        openSkillPicker,
        openNonDirectPicker,
        addDamageBlock,
        removeDamageBySource,
        addOpBlock,
        isBoundary,
        canDelete,
        setEditingBlockId,
        setEditingBlockDesc,
        handleBlockDblclick,
        clearLeftOpBlocks,
        resetLeftDamageBindings
    } from './timeline.store.svelte'

    let confirmAction = $state<{
        type: 'clear' | 'reset'
        refId: string
        prevLabel: string
        curLabel: string
    } | null>(null)

    function openConfirm(type: 'clear' | 'reset', refId: string) {
        const refLines = getRefLines()
        const idx = refLines.findIndex((r) => r.id === refId)
        if (idx <= 0) return
        const prevLabel = refLines[idx - 1].time || '(起始)'
        const curLabel = refLines[idx].time || '(未命名)'
        confirmAction = { type, refId, prevLabel, curLabel }
    }

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
        class="fixed z-50 min-w-44 rounded-lg border bg-[var(--theme-context-menu-bg)] text-[var(--theme-context-menu-text)] py-1 shadow-xl backdrop-blur-lg"
        style="left: {cm.x}px; top: {cm.y}px; border-color: var(--theme-divider-border);"
        data-context-menu="true"
        use:clampMenu={{ x: cm.x, y: cm.y }}
        onclick={() => setContextMenu(null)}
    >
        <div class="px-3 py-1 text-xs font-semibold text-[var(--theme-context-menu-text)]/50 uppercase tracking-wider">
            参考线
        </div>
        {#if canAddBefore(cm.id)}
            <button
                onclick={() => {
                    addBefore(cm.id)
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--theme-context-menu-text)] hover:bg-[var(--theme-context-menu-bg-focused)] transition-colors"
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
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--theme-context-menu-text)] hover:bg-[var(--theme-context-menu-bg-focused)] transition-colors"
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
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--theme-context-menu-text)] hover:bg-[var(--theme-context-menu-bg-focused)] transition-colors"
            >
                <Icon icon="mdi:clock-edit" class="size-4 shrink-0" />
                命名参考线
            </button>
            <button
                onclick={() => {
                    removeLine(cm.id)
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400 hover:bg-[var(--theme-context-menu-bg-focused)] transition-colors"
            >
                <Icon icon="mdi:delete" class="size-4 shrink-0" />
                删除参考线
            </button>
        {/if}
        <div class="border-t my-1" style="border-color: var(--theme-divider-border);"></div>
        <div class="px-3 py-1 text-xs font-semibold text-[var(--theme-context-menu-text)]/50 uppercase tracking-wider">
            伤害绑定
        </div>
        <div class="px-3 py-0.5 text-[9px] text-[var(--theme-context-menu-text)]/40">直伤</div>
        {#if getDamageBlocks().some((d) => d.sourceId === cm.id && d.trackIndex === 3 && d.skillHits.length > 0)}
            <button
                onclick={() => {
                    openRefSkillPicker(cm.id)
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--theme-context-menu-text)] hover:bg-[var(--theme-context-menu-bg-focused)] transition-colors"
            >
                <Icon icon="mdi:pencil" class="size-4 shrink-0" />
                编辑直伤
            </button>
        {:else}
            <button
                onclick={() => {
                    openRefSkillPicker(cm.id)
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--theme-context-menu-text)] hover:bg-[var(--theme-context-menu-bg-focused)] transition-colors"
            >
                <Icon icon="mdi:link-variant" class="size-4 shrink-0" />
                绑定直伤
            </button>
        {/if}
        <div class="px-3 py-0.5 text-[9px] text-[var(--theme-context-menu-text)]/40">效应/处决</div>
        {#if getDamageBlocks().some((d) => d.sourceId === cm.id && d.trackIndex === 3 && d.nonDirectEntries.length > 0)}
            <button
                onclick={() => {
                    openNonDirectPicker('ref', cm.id)
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--theme-context-menu-text)] hover:bg-[var(--theme-context-menu-bg-focused)] transition-colors"
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
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--theme-context-menu-text)] hover:bg-[var(--theme-context-menu-bg-focused)] transition-colors"
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
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400 hover:bg-[var(--theme-context-menu-bg-focused)] transition-colors"
            >
                <Icon icon="mdi:restore" class="size-4 shrink-0" />
                重置伤害绑定
            </button>
        {/if}
        {#if getRefLines().findIndex((r) => r.id === cm.id) > 0}
            <div class="border-t my-1" style="border-color: var(--theme-divider-border);"></div>
            <div class="px-3 py-1 text-xs font-semibold text-red-400/70 uppercase tracking-wider">危险操作</div>
            <button
                onclick={() => openConfirm('clear', cm.id)}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400 hover:bg-[var(--theme-context-menu-bg-focused)] transition-colors"
            >
                <Icon icon="mdi:playlist-remove" class="size-4 shrink-0" />
                清空左侧操作块
            </button>
            <button
                onclick={() => openConfirm('reset', cm.id)}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400 hover:bg-[var(--theme-context-menu-bg-focused)] transition-colors"
            >
                <Icon icon="mdi:delete-sweep" class="size-4 shrink-0" />
                重置左侧伤害绑定
            </button>
        {/if}
    </div>
{/if}

{#if confirmAction}
    {@const action = confirmAction}
    <Modal open={true} onclose={() => (confirmAction = null)}>
        {#snippet title()}
            <div class="flex items-center gap-2 text-red-400">
                <Icon icon="mdi:alert-circle" class="size-5" />
                危险操作
            </div>
        {/snippet}
        {#snippet children()}
            <p class="text-sm leading-relaxed">
                {#if action.type === 'clear'}
                    这将清空 参考线{action.prevLabel} 到 参考线{action.curLabel} 之间的操作块，是否确认？
                {:else}
                    这将重置 参考线{action.prevLabel} 到 参考线{action.curLabel} 之间的伤害绑定，是否确认？
                {/if}
            </p>
            <div class="flex justify-end gap-2 mt-5">
                <button
                    onclick={() => (confirmAction = null)}
                    class="h-8 rounded-md px-4 text-xs text-[var(--theme-modal-text)]/60 transition-colors hover:bg-[var(--theme-modal-text)]/[0.1]"
                    style="background: var(--theme-input-bg);"
                >
                    取消
                </button>
                <button
                    onclick={() => {
                        if (action.type === 'clear') {
                            clearLeftOpBlocks(action.refId)
                        } else {
                            resetLeftDamageBindings(action.refId)
                        }
                        confirmAction = null
                    }}
                    class="h-8 rounded-md bg-red-700 px-4 text-xs text-white transition-colors hover:bg-red-600"
                >
                    确认
                </button>
            </div>
        {/snippet}
    </Modal>
{/if}

<!-- Block Context Menu -->
{#if getBlockMenu()}
    {@const bm = getBlockMenu()!}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
        class="fixed z-50 min-w-44 rounded-lg border bg-[var(--theme-context-menu-bg)] text-[var(--theme-context-menu-text)] py-1 shadow-xl backdrop-blur-lg"
        style="left: {bm.x}px; top: {bm.y}px; border-color: var(--theme-divider-border);"
        data-block-menu="true"
        use:clampMenu={{ x: bm.x, y: bm.y }}
        onclick={() => setBlockMenu(null)}
    >
        <div class="px-3 py-1 text-xs font-semibold text-[var(--theme-context-menu-text)]/50 uppercase tracking-wider">
            操作块
        </div>
        <button
            onclick={() => {
                handleBlockDblclick(bm.blockId)
            }}
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--theme-context-menu-text)] hover:bg-[var(--theme-context-menu-bg-focused)] transition-colors whitespace-nowrap"
        >
            <Icon icon="mdi:comment-edit" class="size-4 shrink-0" />
            修改备注
        </button>
        <button
            onclick={() => {
                removeBlock(bm.blockId)
            }}
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400 hover:bg-[var(--theme-context-menu-bg-focused)] transition-colors whitespace-nowrap"
        >
            <Icon icon="mdi:delete" class="size-4 shrink-0" />
            删除操作块
        </button>
        <div class="border-t my-1" style="border-color: var(--theme-divider-border);"></div>
        <div class="px-3 py-1 text-xs font-semibold text-[var(--theme-context-menu-text)]/50 uppercase tracking-wider">
            变奏
        </div>
        {#if canSetIntro(bm.blockId)}
            <button
                onclick={() => {
                    toggleIntro(bm.blockId)
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--theme-context-menu-text)] hover:bg-[var(--theme-context-menu-bg-focused)] transition-colors whitespace-nowrap"
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
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--theme-context-menu-text)] hover:bg-[var(--theme-context-menu-bg-focused)] transition-colors whitespace-nowrap"
            >
                <Icon icon="mdi:stop-circle" class="size-4 shrink-0" />
                取消变奏入场
            </button>
        {/if}
        <div class="border-t my-1" style="border-color: var(--theme-divider-border);"></div>
        <div class="px-3 py-1 text-xs font-semibold text-[var(--theme-context-menu-text)]/50 uppercase tracking-wider">
            伤害绑定
        </div>
        <div class="px-3 py-0.5 text-[9px] text-[var(--theme-context-menu-text)]/40">直伤</div>
        {#if getDamageBlocks().some((d) => d.sourceId === bm.blockId && d.trackIndex === 3 && d.skillHits.length > 0)}
            <button
                onclick={() => {
                    openSkillPicker(bm.blockId)
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--theme-context-menu-text)] hover:bg-[var(--theme-context-menu-bg-focused)] transition-colors whitespace-nowrap"
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
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--theme-context-menu-text)] hover:bg-[var(--theme-context-menu-bg-focused)] transition-colors whitespace-nowrap"
            >
                <Icon icon="mdi:link-variant" class="size-4 shrink-0" />
                绑定直伤
            </button>
        {/if}
        <div class="px-3 py-0.5 text-[9px] text-[var(--theme-context-menu-text)]/40">效应/处决</div>
        {#if getDamageBlocks().some((d) => d.sourceId === bm.blockId && d.trackIndex === 3 && d.nonDirectEntries.length > 0)}
            <button
                onclick={() => {
                    openNonDirectPicker('op', bm.blockId)
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--theme-context-menu-text)] hover:bg-[var(--theme-context-menu-bg-focused)] transition-colors whitespace-nowrap"
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
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--theme-context-menu-text)] hover:bg-[var(--theme-context-menu-bg-focused)] transition-colors whitespace-nowrap"
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
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400 hover:bg-[var(--theme-context-menu-bg-focused)] transition-colors whitespace-nowrap"
            >
                <Icon icon="mdi:restore" class="size-4 shrink-0" />
                重置伤害绑定
            </button>
        {/if}
    </div>
{/if}

<!-- Track Key Picker Menu -->
{#if getTrackMenu()}
    {@const tm = getTrackMenu()!}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
        class="fixed z-50 rounded-lg border bg-[var(--theme-context-menu-bg)] text-[var(--theme-context-menu-text)] py-1.5 px-2 shadow-xl backdrop-blur-lg"
        style="left: {tm.x}px; top: {tm.y}px; border-color: var(--theme-divider-border);"
        data-track-menu="true"
        use:clampMenu={{ x: tm.x, y: tm.y }}
        onclick={() => setTrackMenu(null)}
    >
        <div class="flex items-center gap-1">
            {#each getUiBtnIcons() as [name, url]}
                <button
                    class="size-7 flex items-center justify-center rounded hover:bg-[var(--theme-context-menu-bg-focused)] transition-colors"
                    onclick={() => addOpBlock(tm.trackIndex, tm.pos, name)}
                    title={name}
                >
                    {#if url}
                        <img src={url} alt={name} draggable="false" class="size-5 object-contain pointer-events-none" />
                    {:else}
                        <span class="text-[10px] font-bold text-[var(--theme-context-menu-text)]"
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
