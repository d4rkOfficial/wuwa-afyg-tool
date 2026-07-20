<script lang="ts">
    import {
        getSelectedCharNames,
        getRefLines,
        getOpBlocks,
        getDamageBlocks,
        getTRACKS,
        getSegments,
        getTableWidth,
        getEditingId,
        getEditValue,
        getDragVisualPositions,
        getDraggingId,
        getDragBlockId,
        getBlockWidths,
        getEditingBlockId,
        getEditingBlockDesc,
        getContextMenu,
        getTrackMenu,
        getBlockMenu,
        getSkillPickerBlockId,
        getNonDirectPickerBlockId,
        getShowDamageList,
        getShowEchoSelect,
        getShowCharSelect,
        getUiBtnIcons,
        imgUrl,
        vx,
        timeToX,
        damageBlockLeft,
        btnIconUrl,
        elementColor,
        confirmEdit,
        confirmBlockDesc,
        handleContextmenu,
        handleWindowMousedown,
        handleBlockContextmenu,
        handleBlockDblclick,
        startBlockDrag,
        startDrag,
        onBlockDrag as storeOnBlockDrag,
        onDrag as storeOnDrag,
        stopDrag as storeStopDrag,
        stopBlockDrag as storeStopBlockDrag,
        setEditingId,
        setEditValue,
        setContextMenu,
        setTrackMenu,
        setBlockMenu,
        setShowDamageList,
        setShowEchoSelect,
        setShowCharSelect,
        addOpBlock as storeAddOpBlock,
        setDragVisualPositions,
        setDraggingId,
        setDragBlockId,
        setBlockWidths,
        setEditingBlockId,
        setEditingBlockDesc,
        addOpBlock,
        removeDamageBySource,
        removeDamageBlock,
        addDamageBlock,
        echoNameForChar,
        reflowTrack,
        setEditInput,
        setBlockEditInput,
        setTrackMenu as storeSetTrackMenu,
        loadCharacters
    } from './store.svelte'
    import { browser } from '$app/environment'
    import {
        SIDE_PAD,
        PPS,
        SNAP_PX,
        MIN_GAP,
        MIN_TIME,
        MAX_TIME,
        ELEMENT_COLORS,
        NON_DIRECT_ELEMENT,
        TRACK_COLORS
    } from './consts'
    import type { OpBlock, DamageBlock } from './types'
    import CharacterSelect from '$lib/.test/components/page/timeline/CharacterSelect.svelte'
    import EchoSelect from '$lib/.test/components/page/timeline/EchoSelect.svelte'
    import ContextMenu from '$lib/.test/components/page/timeline/ContextMenu.svelte'
    import SkillPicker from '$lib/.test/components/page/timeline/SkillPicker.svelte'
    import NonDirectPicker from '$lib/.test/components/page/timeline/NonDirectPicker.svelte'
    import DamageList from '$lib/.test/components/page/timeline/DamageList.svelte'

    let timelineEl: HTMLDivElement | undefined = $state()
    let editInput: HTMLInputElement | undefined = $state()
    let blockEditInput: HTMLInputElement | undefined = $state()

    $effect(() => {
        setEditInput(editInput)
    })
    $effect(() => {
        setBlockEditInput(blockEditInput)
    })
    $effect(() => {
        if (getEditingId()) editInput?.focus()
    })
    $effect(() => {
        if (getEditingBlockId()) blockEditInput?.focus()
    })
    $effect(() => {
        if (browser && getShowCharSelect()) loadCharacters()
    })

    const onWindowMouseDown = (e: MouseEvent) => {
        handleWindowMousedown(e)
    }

    const onWindowMouseMove = (e: MouseEvent) => {
        if (!timelineEl) return
        const rect = timelineEl.getBoundingClientRect()
        const scrollL = timelineEl.scrollLeft
        const rawX = e.clientX - rect.left + scrollL - 80
        storeOnDrag(rawX)
        storeOnBlockDrag(rawX)
    }

    const onWindowMouseUp = () => {
        storeStopDrag()
        storeStopBlockDrag()
    }

    const onWindowMouseLeave = () => {
        storeStopDrag()
        storeStopBlockDrag()
    }

    const onWheel = (e: WheelEvent) => {
        if (!timelineEl) return
        e.preventDefault()
        timelineEl.scrollLeft += e.deltaY
    }

    const measureWidth = (node: HTMLElement, blockId: string) => {
        const set = () => {
            setBlockWidths({ ...getBlockWidths(), [blockId]: node.offsetWidth })
        }
        set()
        const ro = new ResizeObserver(set)
        return { destroy: () => ro.disconnect() }
    }
</script>

<svelte:window
    onmousedown={onWindowMouseDown}
    onmousemove={onWindowMouseMove}
    onmouseup={onWindowMouseUp}
    onmouseleave={onWindowMouseLeave}
    oncontextmenu={(e) => e.preventDefault()}
    oncopy={(e) => e.preventDefault()}
    oncut={(e) => e.preventDefault()}
/>

<div class="h-dvh flex flex-col bg-zinc-950 text-zinc-100 select-none">
    <header class="shrink-0 h-12 flex items-center gap-3 px-5 border-b border-zinc-800/50">
        <h1 class="text-sm font-semibold">时间线 Demo</h1>
        <button
            class="ml-auto bg-white text-black text-xs px-3 py-1.5 rounded font-medium transition-colors hover:bg-zinc-200"
            onclick={() => setShowDamageList(true)}>查看所有伤害</button
        >
    </header>

    <div class="flex-1 overflow-x-auto overflow-y-hidden" bind:this={timelineEl} onwheel={onWheel}>
        <div class="relative" style="width: {getTableWidth()}px; min-width: 100%; height: 100%;">
            <div class="flex flex-col h-full">
                <!-- Header row -->
                <div class="relative shrink-0 h-8 border-b border-zinc-800/50">
                    <div class="sticky left-0 z-[35] w-20 h-full bg-zinc-950 border-r border-zinc-800/50"></div>
                </div>

                <!-- Track rows -->
                {#each getTRACKS() as name, i}
                    <div
                        class="relative shrink-0 {i < 3 ? 'h-14' : 'flex-1'}"
                        style="border-bottom: 1px solid color-mix(in srgb, {TRACK_COLORS[i]} 15%, transparent);"
                        oncontextmenu={(e) => {
                            if (i >= 3 || !timelineEl) return
                            const rect = timelineEl.getBoundingClientRect()
                            const scrollL = timelineEl.scrollLeft
                            const x = e.clientX - rect.left + scrollL - 80
                            const t = Math.max(0, Math.min(MAX_TIME, (x - SIDE_PAD) / PPS))
                            storeSetTrackMenu({ x: e.clientX, y: e.clientY, trackIndex: i, time: t })
                        }}
                        role="region"
                    >
                        <div
                            class="sticky left-0 z-[35] w-20 h-full bg-zinc-950 border-r border-zinc-800/50 flex items-center justify-center"
                        >
                            {#if i < 3}
                                {@const url = imgUrl(name)}
                                {#if url}
                                    {@const c = elementColor(name)}
                                    <div
                                        class="size-10 box-border rounded overflow-hidden shrink-0"
                                        style="border-bottom: 2px solid {c}; border-right: 2px solid {c};
                                        background: linear-gradient(135deg, transparent 0%, {c}40 100%);"
                                    >
                                        <img src={url} alt={name} class="size-full object-contain" />
                                    </div>
                                {:else}
                                    <div class="[writing-mode:vertical-rl] text-[11px] font-medium text-zinc-400">
                                        {name}
                                    </div>
                                {/if}
                            {:else}
                                <div class="[writing-mode:vertical-rl] text-[11px] font-medium text-zinc-400">
                                    伤害绑定
                                </div>
                            {/if}
                        </div>

                        <!-- block overlay -->
                        <div class="absolute pointer-events-none" style="left: 5rem; top: 0; right: 0; bottom: 0;">
                            {#each getOpBlocks().filter((b: OpBlock) => b.trackIndex === i) as block (block.id)}
                                <div
                                    class="absolute inset-y-0 flex items-center pointer-events-auto cursor-grab active:cursor-grabbing select-none"
                                    style="left: {timeToX(
                                        block.time
                                    )}px; transform: translateX(-50%) {getDragBlockId() === block.id
                                        ? 'translateY(-4px)'
                                        : ''}; z-index: {getDragBlockId() === block.id ? 20 : 5};"
                                    role="button"
                                    tabindex="0"
                                    data-block="true"
                                    use:measureWidth={block.id}
                                    onmousedown={(e) => startBlockDrag(e, block.id)}
                                    oncontextmenu={(e) => handleBlockContextmenu(e, block.id)}
                                    ondblclick={() => handleBlockDblclick(block.id)}
                                >
                                    <div
                                        class="flex items-center gap-1.5 h-full rounded-md px-2.5 text-xs bg-zinc-800/90 border whitespace-nowrap shadow-sm min-w-[56px] {getDragBlockId() ===
                                        block.id
                                            ? 'border-blue-400 shadow-blue-500/20'
                                            : 'border-zinc-700/60'}"
                                    >
                                        {#if block.intro}
                                            <span class="text-xs text-yellow-400 font-semibold shrink-0">变奏</span>
                                        {/if}
                                        {#if btnIconUrl(block.key)}
                                            <img
                                                src={btnIconUrl(block.key)}
                                                alt={block.key}
                                                draggable="false"
                                                class="size-7 object-contain shrink-0 pointer-events-none"
                                            />
                                        {:else}
                                            <span class="font-bold text-zinc-200">{block.key}</span>
                                        {/if}
                                        {#if getEditingBlockId() === block.id}
                                            <input
                                                bind:this={blockEditInput}
                                                value={getEditingBlockDesc()}
                                                oninput={(e) =>
                                                    setEditingBlockDesc((e.target as HTMLInputElement).value)}
                                                onblur={confirmBlockDesc}
                                                onkeydown={(e) => {
                                                    if (e.key === 'Enter') confirmBlockDesc()
                                                    if (e.key === 'Escape') setEditingBlockId(null)
                                                }}
                                                class="w-14 bg-zinc-700 text-xs text-zinc-200 text-center rounded outline-none border border-blue-500/50"
                                            />
                                        {:else}
                                            <span class="text-zinc-400 max-w-24 truncate">{block.desc}</span>
                                        {/if}
                                    </div>
                                </div>
                            {/each}
                        </div>

                        <!-- damage block overlay -->
                        <div
                            class="absolute pointer-events-none"
                            style="left: 5rem; top: 0; right: 0; bottom: 0; z-index: 6;"
                        >
                            {#each getDamageBlocks().filter((d: DamageBlock) => d.trackIndex === i && (d.skillHits.length > 0 || d.nonDirectEntries.length > 0)) as dmg (dmg.id)}
                                <div
                                    class="absolute inset-y-0 flex items-center pointer-events-auto cursor-default"
                                    style="left: {damageBlockLeft(dmg)}px;"
                                >
                                    <div
                                        class="h-full flex flex-col items-start justify-start gap-0.5 flex-wrap content-start overflow-hidden px-1"
                                    >
                                        {#each dmg.skillHits as hit}
                                            <span
                                                class="text-[10px] font-bold leading-none border border-dashed px-3 py-0.5"
                                                style="color: {(ELEMENT_COLORS as Record<string, string>)[
                                                    hit.element
                                                ] ?? '#ef4444'}; border-color: {(
                                                    ELEMENT_COLORS as Record<string, string>
                                                )[hit.element] ?? '#ef4444'}; writing-mode: vertical-rl;"
                                            >
                                                {hit.skillType === '声骸技能'
                                                    ? hit.character +
                                                      '-' +
                                                      (echoNameForChar(hit.character) ?? '?') +
                                                      '-' +
                                                      hit.hitName.replace('伤害', '') +
                                                      ((hit.hits ?? 0) >= 1 ? '*' + hit.hits : '')
                                                    : (dmg.sourceType === 'ref' && hit.character
                                                          ? `[${hit.character}]`
                                                          : '') +
                                                      hit.hitName.replace('伤害', '') +
                                                      ((hit.hits ?? 0) >= 1 ? '×' + hit.hits : '')}
                                            </span>
                                        {/each}
                                        {#each [...dmg.nonDirectEntries].sort((a, b) => {
                                            const w = { 处决: 0, 响应: 1, 效应: 2 }
                                            return (w[a.category] ?? 3) - (w[b.category] ?? 3)
                                        }) as nd}
                                            {@const c =
                                                nd.category === '响应'
                                                    ? '#22c55e'
                                                    : nd.category === '处决'
                                                      ? '#ffffff'
                                                      : (NON_DIRECT_ELEMENT as Record<string, string>)[nd.name]
                                                        ? (ELEMENT_COLORS as Record<string, string>)[
                                                              (NON_DIRECT_ELEMENT as Record<string, string>)[nd.name]
                                                          ]
                                                        : '#ef4444'}
                                            <span
                                                class="text-[10px] font-bold leading-none border border-dashed px-3 py-0.5"
                                                style="color: {c}; border-color: {c}; opacity: {nd.category === '效应'
                                                    ? 0.75
                                                    : 1}; writing-mode: vertical-rl;"
                                            >
                                                {nd.category === '效应' ? nd.name + nd.layers + '层' : nd.name}{nd
                                                    .responders?.length
                                                    ? '[' + nd.responders.join(',') + ']'
                                                    : ''}
                                            </span>
                                        {/each}
                                    </div>
                                </div>
                            {/each}
                        </div>
                    </div>
                {/each}
            </div>

            <!-- Ref line overlay -->
            <div class="absolute pointer-events-none" style="left: 5rem; top: 2rem; right: 0; bottom: 0; z-index: 10;">
                {#each getRefLines() as rl}
                    <div
                        class="absolute top-0 bottom-0 {getDraggingId() === rl.id
                            ? 'border-l border-dashed border-blue-400'
                            : 'border-l border-dashed border-zinc-700/60'}"
                        style="left: {vx(rl.id, rl.time)}px;"
                    ></div>
                {/each}
            </div>

            <!-- Header label overlay -->
            <div class="absolute pointer-events-none" style="left: 5rem; top: 0; right: 0; height: 2rem; z-index: 20;">
                {#each getRefLines() as rl}
                    <div
                        class="absolute top-0 h-full flex items-center pointer-events-auto"
                        style="left: {vx(rl.id, rl.time)}px; transform: translateX(-50%); white-space: nowrap;"
                    >
                        {#if getEditingId() === rl.id && rl.id !== 'left' && rl.id !== 'right'}
                            <input
                                bind:this={editInput}
                                value={getEditValue()}
                                oninput={(e) => setEditValue((e.target as HTMLInputElement).value)}
                                onblur={confirmEdit}
                                onkeydown={(e) => {
                                    if (e.key === 'Enter') confirmEdit()
                                    if (e.key === 'Escape') setEditingId(null)
                                }}
                                class="w-12 bg-zinc-800 text-[9px] text-zinc-200 text-center rounded outline-none border border-blue-500/50 tabular-nums"
                            />
                        {:else}
                            <span
                                class="text-[9px] tabular-nums text-zinc-500 cursor-pointer hover:text-zinc-300"
                                oncontextmenu={(e) => handleContextmenu(e, rl.id)}
                                role="button"
                                tabindex="-1">{rl.time.toFixed(1)}s</span
                            >
                        {/if}
                    </div>
                {/each}
            </div>

            <!-- Drag hot zone overlay -->
            <div class="absolute pointer-events-none" style="top: 2rem; left: 5rem; right: 0; bottom: 0; z-index: 30;">
                {#each getRefLines() as rl}
                    <div
                        class="absolute inset-y-0 pointer-events-auto {rl.id !== 'left' ? 'cursor-col-resize' : ''}"
                        style="left: {vx(rl.id, rl.time) - 10}px; width: 20px;"
                        role="presentation"
                        tabindex="-1"
                        onmousedown={(e) => {
                            if (rl.id !== 'left') startDrag(e, rl.id)
                        }}
                        oncontextmenu={(e) => handleContextmenu(e, rl.id)}
                    ></div>
                {/each}
            </div>
        </div>
    </div>
</div>

<CharacterSelect />
<EchoSelect />
<ContextMenu />
<SkillPicker />
<NonDirectPicker />
<DamageList />
