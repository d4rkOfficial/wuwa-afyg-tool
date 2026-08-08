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
        addRefLineAt,
        removeLine,
        startEdit,
        setBlockSpecial,
        removeBlock,
        openRefSkillPicker,
        openSkillPicker,
        openNonDirectPicker,
        addDamageBlock,
        removeDamageBySource,
        addOpBlock,
        canDelete,
        handleBlockDblclick,
        getSelectedBlockIds,
        getSelectedRefLineIds,
        removeSelection,
        resetSelectionDamage,
        copySelection,
        pasteSelection,
        selectAll,
        hasClipboard,
        setBlockKey,
        getBlockKeyPickerId,
        setBlockKeyPickerId
    } from './timeline.store.svelte'
    import { remapDuplicatedDamageBuffs } from '../calculation/calculation.store.svelte'
    import { ORIGINAL_BUTTON_KEYS, GAMEPAD_BUTTONS } from './timeline.consts'
    import { getKeyMapEntries, getDefaultBlockKey } from '$lib/data/keymap.svelte'

    let confirmMultiAction = $state<'delete' | 'reset' | null>(null)

    // 手柄图标（blockKey 为手柄 id 时使用）
    const gamepadIconMap = new Map(GAMEPAD_BUTTONS.filter((b) => b.icon).map((b) => [b.id, b.icon as string]))

    let menuBtnIcons = $derived.by(() => {
        const iconMap = new Map(getUiBtnIcons())
        const customByDefault = new Map(getKeyMapEntries().map((e) => [getDefaultBlockKey(e.id), e.blockKey]))
        return getUiBtnIcons()
            .filter(([name]) => (ORIGINAL_BUTTON_KEYS as readonly string[]).includes(name))
            .map(
                ([name]) =>
                    [
                        name,
                        iconMap.get(customByDefault.get(name) ?? name) ??
                            gamepadIconMap.get(customByDefault.get(name) ?? name) ??
                            ''
                    ] as [string, string]
            )
    })

    const specialOptions = [
        { value: 'none', label: '无' },
        { value: 'intro', label: '变奏' },
        { value: 'switchback', label: '切回' }
    ] as const

    function copyToClipboard() {
        copySelection()
    }

    function pasteFromClipboard() {
        const damageMap = pasteSelection()
        if (Object.keys(damageMap).length > 0) remapDuplicatedDamageBuffs(damageMap)
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

{#snippet shortcut(label: string)}
    <span class="ml-auto pl-3 text-[10px] text-(--theme-context-menu-text)/30">{label}</span>
{/snippet}

{#snippet damageBinding(id: string, sourceType: 'op' | 'ref')}
    <div class="border-t my-1" style="border-color: var(--theme-divider-border);"></div>
    <div class="px-3 py-1 text-xs font-semibold text-(--theme-context-menu-text)/50 uppercase tracking-wider">
        伤害绑定
    </div>
    <div class="px-3 py-0.5 text-[9px] text-(--theme-context-menu-text)/40">直伤</div>
    {#if getDamageBlocks().some((d) => d.sourceId === id && d.trackIndex === 3 && d.skillHits.length > 0)}
        <button
            onclick={() => (sourceType === 'op' ? openSkillPicker(id) : openRefSkillPicker(id))}
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
        >
            <Icon icon="mdi:pencil" class="size-4 shrink-0" />
            编辑直伤
        </button>
    {:else}
        <button
            onclick={() => (sourceType === 'op' ? openSkillPicker(id) : openRefSkillPicker(id))}
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
        >
            <Icon icon="mdi:link-variant" class="size-4 shrink-0" />
            绑定直伤
        </button>
    {/if}
    <div class="px-3 py-0.5 text-[9px] text-(--theme-context-menu-text)/40">效应/处决</div>
    {#if getDamageBlocks().some((d) => d.sourceId === id && d.trackIndex === 3 && d.nonDirectEntries.length > 0)}
        <button
            onclick={() => openNonDirectPicker(sourceType, id)}
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
        >
            <Icon icon="mdi:pencil" class="size-4 shrink-0" />
            编辑效应/处决
        </button>
    {:else}
        <button
            onclick={() => {
                addDamageBlock(sourceType, id)
                openNonDirectPicker(sourceType, id)
            }}
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
        >
            <Icon icon="mdi:link-variant" class="size-4 shrink-0" />
            绑定效应/处决
        </button>
    {/if}
    {#if getDamageBlocks().some((d) => d.sourceId === id && d.trackIndex === 3)}
        <div class="border-t mt-1 mb-0" style="border-color: var(--theme-divider-border);"></div>
        <button
            onclick={() => removeDamageBySource(id, 'all')}
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400 hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
        >
            <Icon icon="mdi:restore" class="size-4 shrink-0" />
            重置伤害绑定
        </button>
    {/if}
{/snippet}

<!-- Ref Line Context Menu -->
{#if getContextMenu()}
    {@const cm = getContextMenu()!}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
        class="fixed z-50 min-w-44 max-h-[70vh] overflow-y-auto rounded-lg border bg-(--theme-context-menu-bg) text-(--theme-context-menu-text) py-1 shadow-xl backdrop-blur-lg"
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
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400 hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
            >
                <Icon icon="mdi:delete" class="size-4 shrink-0" />
                删除参考线
                {@render shortcut('Del')}
            </button>
            <button
                onclick={copyToClipboard}
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
            >
                <Icon icon="mdi:clipboard-outline" class="size-4 shrink-0" />
                复制
                {@render shortcut('Ctrl+C')}
            </button>
        {/if}
        {@render damageBinding(cm.id, 'ref')}
    </div>
{/if}

<!-- Block Context Menu -->
{#if getBlockMenu()}
    {@const bm = getBlockMenu()!}
    {@const special = getOpBlocks().some((b) => b.id === bm.blockId && b.intro)
        ? 'intro'
        : getOpBlocks().some((b) => b.id === bm.blockId && b.switchback)
          ? 'switchback'
          : 'none'}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
        class="fixed z-50 min-w-44 max-h-[70vh] overflow-y-auto rounded-lg border bg-(--theme-context-menu-bg) text-(--theme-context-menu-text) py-1 shadow-xl backdrop-blur-lg"
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
            onclick={() => setBlockKeyPickerId(bm.blockId)}
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
        >
            <Icon icon="mdi:keyboard-outline" class="size-4 shrink-0" />
            更换按键
        </button>
        <button
            onclick={() => {
                removeBlock(bm.blockId)
            }}
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400 hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
        >
            <Icon icon="mdi:delete" class="size-4 shrink-0" />
            删除操作块
            {@render shortcut('Del')}
        </button>
        <button
            onclick={copyToClipboard}
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
        >
            <Icon icon="mdi:clipboard-outline" class="size-4 shrink-0" />
            复制
            {@render shortcut('Ctrl+C')}
        </button>
        <div class="border-t my-1" style="border-color: var(--theme-divider-border);"></div>
        <div class="px-3 py-1 text-xs font-semibold text-(--theme-context-menu-text)/50 uppercase tracking-wider">
            特殊切人
        </div>
        <div class="flex gap-1 px-3 py-1.5">
            {#each specialOptions as opt}
                <button
                    onclick={() => setBlockSpecial(bm.blockId, opt.value)}
                    class="flex-1 rounded px-2 py-1 text-xs font-medium transition-colors {special === opt.value
                        ? 'bg-(--theme-accent-bg) text-[var(--theme-accent-text-on-bg)]'
                        : 'text-(--theme-context-menu-text)/70 hover:bg-(--theme-context-menu-bg-focused)'}"
                >
                    {opt.label}
                </button>
            {/each}
        </div>
        {@render damageBinding(bm.blockId, 'op')}
    </div>
{/if}

<!-- Multi-Block Context Menu -->
{#if getMultiBlockMenu()}
    {@const mm = getMultiBlockMenu()!}
    {@const blockCount = Object.keys(getSelectedBlockIds()).length}
    {@const refCount = Object.keys(getSelectedRefLineIds()).length}
    {@const totalCount = blockCount + refCount}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
        class="fixed z-50 min-w-44 max-h-[70vh] overflow-y-auto rounded-lg border bg-(--theme-context-menu-bg) text-(--theme-context-menu-text) py-1 shadow-xl backdrop-blur-lg"
        style="left: {mm.x}px; top: {mm.y}px; border-color: var(--theme-divider-border);"
        data-context-menu="true"
        use:clampMenu={{ x: mm.x, y: mm.y }}
        onclick={() => setMultiBlockMenu(null)}
    >
        <div class="px-3 py-1 text-xs font-semibold text-(--theme-context-menu-text)/50 uppercase tracking-wider">
            多选 (操作块 {blockCount} · 参考线 {refCount})
        </div>
        <button
            onclick={() => {
                selectAll()
            }}
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
        >
            <Icon icon="mdi:select-all" class="size-4 shrink-0" />
            全选
            {@render shortcut('Ctrl+A')}
        </button>
        <button
            onclick={copyToClipboard}
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
        >
            <Icon icon="mdi:clipboard-outline" class="size-4 shrink-0" />
            复制
            {@render shortcut('Ctrl+C')}
        </button>
        <button
            onclick={() => (confirmMultiAction = 'delete')}
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400 hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
        >
            <Icon icon="mdi:delete" class="size-4 shrink-0" />
            删除 ({totalCount} 项)
            {@render shortcut('Del')}
        </button>
        <button
            onclick={() => (confirmMultiAction = 'reset')}
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400 hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
        >
            <Icon icon="mdi:restore" class="size-4 shrink-0" />
            重置伤害绑定 ({totalCount} 项)
        </button>
    </div>
{/if}

{#if confirmMultiAction === 'delete'}
    {@const blockCount = Object.keys(getSelectedBlockIds()).length}
    {@const refCount = Object.keys(getSelectedRefLineIds()).length}
    {@const totalCount = blockCount + refCount}
    <Modal open={true} onclose={() => (confirmMultiAction = null)}>
        {#snippet title()}
            <div class="flex items-center gap-2 text-red-400">
                <Icon icon="mdi:alert-circle" class="size-5" />
                危险操作
            </div>
        {/snippet}
        {#snippet children()}
            <p class="text-sm leading-relaxed">
                确认删除选中的 {totalCount} 项（操作块 {blockCount} · 参考线 {refCount}）？该操作可通过 Ctrl+Z 撤销。
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
                        removeSelection()
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
    {@const blockCount = Object.keys(getSelectedBlockIds()).length}
    {@const refCount = Object.keys(getSelectedRefLineIds()).length}
    {@const totalCount = blockCount + refCount}
    <Modal open={true} onclose={() => (confirmMultiAction = null)}>
        {#snippet title()}
            <div class="flex items-center gap-2 text-red-400">
                <Icon icon="mdi:alert-circle" class="size-5" />
                危险操作
            </div>
        {/snippet}
        {#snippet children()}
            <p class="text-sm leading-relaxed">
                确认重置选中的 {totalCount} 项的伤害绑定？该操作可通过 Ctrl+Z 撤销。
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
                        resetSelectionDamage()
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
        class="fixed z-50 max-w-[80vw] overflow-x-auto rounded-lg border bg-(--theme-context-menu-bg) text-(--theme-context-menu-text) py-1.5 px-2 shadow-xl backdrop-blur-lg"
        style="left: {tm.x}px; top: {tm.y}px; border-color: var(--theme-divider-border);"
        data-track-menu="true"
        use:clampMenu={{ x: tm.x, y: tm.y }}
        onclick={() => setTrackMenu(null)}
    >
        <div class="flex flex-col">
            <div class="flex items-center gap-1">
                {#each menuBtnIcons as [name, url]}
                    <button
                        class="size-7 flex items-center justify-center rounded hover:bg-(--theme-context-menu-bg-focused) transition-colors"
                        onclick={() => addOpBlock(tm.trackIndex, tm.pos, name)}
                        title={name}
                    >
                        {#if url}
                            <img
                                src={url}
                                alt={name}
                                draggable="false"
                                class="size-5 object-contain pointer-events-none"
                            />
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
            <div class="border-t my-1" style="border-color: var(--theme-divider-border);"></div>
            <button
                onclick={() => addRefLineAt(tm.pos)}
                class="w-full flex items-center gap-2 px-1 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
            >
                <Icon icon="mdi:timeline-plus-outline" class="size-4 shrink-0" />
                创建参考线
            </button>
            {#if hasClipboard()}
                <div class="border-t my-1" style="border-color: var(--theme-divider-border);"></div>
                <button
                    onclick={pasteFromClipboard}
                    class="w-full flex items-center gap-2 px-1 py-1.5 text-left text-sm text-(--theme-context-menu-text) hover:bg-(--theme-context-menu-bg-focused) transition-colors whitespace-nowrap"
                >
                    <Icon icon="mdi:clipboard-arrow-left" class="size-4 shrink-0" />
                    粘贴
                    {@render shortcut('Ctrl+V')}
                </button>
            {/if}
        </div>
    </div>
{/if}

{#if getBlockKeyPickerId()}
    {@const pickerBlockId = getBlockKeyPickerId()!}
    <Modal open={true} onclose={() => setBlockKeyPickerId(null)}>
        {#snippet title()}
            <div class="flex items-center gap-2">
                <Icon icon="mdi:keyboard-outline" class="size-5" />
                更换按键
            </div>
        {/snippet}
        {#snippet children()}
            <div class="flex flex-wrap gap-1.5">
                {#each menuBtnIcons as [name, url]}
                    <button
                        onclick={() => {
                            setBlockKey(pickerBlockId, name)
                            setBlockKeyPickerId(null)
                        }}
                        class="size-10 flex items-center justify-center rounded-md border transition-colors hover:bg-(--theme-modal-text)/10"
                        style="border-color: var(--theme-divider-border);"
                        title={name}
                    >
                        {#if url}
                            <img
                                src={url}
                                alt={name}
                                draggable="false"
                                class="size-6 object-contain pointer-events-none"
                            />
                        {:else}
                            <span class="text-xs font-bold text-(--theme-modal-text)"
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
                {#each GAMEPAD_BUTTONS as btn}
                    <button
                        onclick={() => {
                            setBlockKey(pickerBlockId, btn.id)
                            setBlockKeyPickerId(null)
                        }}
                        class="size-10 flex items-center justify-center rounded-md border transition-colors hover:bg-(--theme-modal-text)/10"
                        style="border-color: var(--theme-divider-border);"
                        title={btn.label}
                    >
                        {#if btn.icon}
                            <img
                                src={btn.icon}
                                alt={btn.label}
                                draggable="false"
                                class="size-6 object-contain pointer-events-none"
                            />
                        {:else}
                            <span class="text-xs font-bold text-(--theme-modal-text)">{btn.label}</span>
                        {/if}
                    </button>
                {/each}
            </div>
        {/snippet}
    </Modal>
{/if}
