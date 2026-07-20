<script lang="ts">
    import type { ComponentsProps } from '$lib/types/component-props'
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
        getSelectedCharNames,
        imgUrl,
        canAddBefore,
        canAddAfter,
        addBefore,
        addAfter,
        removeLine,
        startEdit,
        canSetIntro,
        toggleIntro,
        handleBlockDblclick,
        removeBlock,
        openRefSkillPicker,
        openSkillPicker,
        openNonDirectPicker,
        addDamageBlock,
        removeDamageBySource,
        addOpBlock
    } from '../../../../../routes/test/timeline/store.svelte'
    import { clampMenu, canDelete } from '../../../../../routes/test/timeline/utils'

    interface Props extends ComponentsProps {}
    let { class: _class = '', style = '' }: Props = $props()

    const handleEsc = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            setContextMenu(null)
            setTrackMenu(null)
            setBlockMenu(null)
        }
    }
</script>

<svelte:window onkeydown={handleEsc} />

<!-- Ref Line Context Menu -->
{#if getContextMenu()}
    {@const cm = getContextMenu()!}
    <div
        class="fixed z-50 min-w-44 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
        style="left: {cm.x}px; top: {cm.y}px"
        data-context-menu="true"
        use:clampMenu={{ x: cm.x, y: cm.y }}
    >
        <div class="px-3 py-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">参考线</div>
        {#if canAddBefore(cm.id)}
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                onclick={() => {
                    addBefore(cm.id)
                    setContextMenu(null)
                }}
            >
                <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    class="size-3.5 shrink-0 text-zinc-500"><path d="M8 3v10M3 8h10" /></svg
                >
                左侧添加参考线
            </button>
        {/if}
        {#if canAddAfter(cm.id)}
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                onclick={() => {
                    addAfter(cm.id)
                    setContextMenu(null)
                }}
            >
                <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    class="size-3.5 shrink-0 text-zinc-500"><path d="M8 3v10M3 8h10" /></svg
                >
                右侧添加参考线
            </button>
        {/if}
        {#if canDelete(cm.id)}
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                onclick={() => {
                    const { id } = cm
                    startEdit(id, getRefLines().find((r: any) => r.id === id)!.time)
                    setContextMenu(null)
                }}
            >
                <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    class="size-3.5 shrink-0 text-zinc-500"><path d="M11 2l3 3-9 9H2v-3z" /></svg
                >
                设置时间值
            </button>
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-red-400 hover:bg-zinc-800 transition-colors"
                onclick={() => {
                    removeLine(cm.id)
                    setContextMenu(null)
                }}
            >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" class="size-3.5 shrink-0"
                    ><path
                        d="M2 4h12M5 4V2.5a.5.5 0 01.5-.5h5a.5.5 0 01.5.5V4M12 4v9.5a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5V4"
                    /></svg
                >
                删除参考线
            </button>
        {/if}
        <div class="border-t border-zinc-800 my-1"></div>
        <div class="px-3 py-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">伤害绑定</div>
        <div class="px-3 py-0.5 text-[9px] text-zinc-600">直伤</div>
        {#if getDamageBlocks().some((d: any) => d.sourceId === cm.id && d.trackIndex === 3 && d.skillHits.length > 0)}
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                onclick={() => {
                    openRefSkillPicker(cm.id)
                    setContextMenu(null)
                }}
            >
                <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    class="size-3.5 shrink-0 text-zinc-500"><path d="M11 2l3 3-9 9H2v-3z" /></svg
                >
                编辑直伤
            </button>
        {:else}
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                onclick={() => {
                    openRefSkillPicker(cm.id)
                    setContextMenu(null)
                }}
            >
                <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    class="size-3.5 shrink-0 text-zinc-500"
                    ><path d="M5 11l3-3 3 3M8 8v6" /><path
                        d="M3 5a2 2 0 012-2h6a2 2 0 012 2v2a2 2 0 01-2 2H5a2 2 0 01-2-2V5z"
                    /></svg
                >
                绑定直伤
            </button>
        {/if}
        <div class="px-3 py-0.5 text-[9px] text-zinc-600">效应/处决</div>
        {#if getDamageBlocks().some((d: any) => d.sourceId === cm.id && d.trackIndex === 3 && d.nonDirectEntries.length > 0)}
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                onclick={() => {
                    openNonDirectPicker('ref', cm.id)
                    setContextMenu(null)
                }}
            >
                <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    class="size-3.5 shrink-0 text-zinc-500"><path d="M11 2l3 3-9 9H2v-3z" /></svg
                >
                编辑效应/处决
            </button>
        {:else}
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                onclick={() => {
                    addDamageBlock('ref', cm.id)
                    openNonDirectPicker('ref', cm.id)
                    setContextMenu(null)
                }}
            >
                <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    class="size-3.5 shrink-0 text-zinc-500"
                    ><path d="M5 11l3-3 3 3M8 8v6" /><path
                        d="M3 5a2 2 0 012-2h6a2 2 0 012 2v2a2 2 0 01-2 2H5a2 2 0 01-2-2V5z"
                    /></svg
                >
                绑定效应/处决
            </button>
        {/if}
        {#if getDamageBlocks().some((d: any) => d.sourceId === cm.id && d.trackIndex === 3)}
            <div class="border-t border-zinc-800 my-1"></div>
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-red-400 hover:bg-zinc-800 transition-colors"
                onclick={() => {
                    removeDamageBySource(cm.id, 'all')
                    setContextMenu(null)
                }}
            >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" class="size-3.5 shrink-0"
                    ><path
                        d="M2 4h12M5 4V2.5a.5.5 0 01.5-.5h5a.5.5 0 01.5.5V4M12 4v9.5a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5V4"
                    /></svg
                >
                重置伤害绑定
            </button>
        {/if}
    </div>
{/if}

<!-- Block Context Menu -->
{#if getBlockMenu()}
    {@const bm = getBlockMenu()!}
    <div
        class="fixed z-50 min-w-44 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
        style="left: {bm.x}px; top: {bm.y}px"
        data-block-menu="true"
        use:clampMenu={{ x: bm.x, y: bm.y }}
    >
        <div class="px-3 py-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">操作块</div>
        <button
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors whitespace-nowrap"
            onclick={() => {
                handleBlockDblclick(bm.blockId)
                setBlockMenu(null)
            }}
        >
            <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                class="size-3.5 shrink-0 text-zinc-500"><path d="M11 2l3 3-9 9H2v-3z" /></svg
            >
            修改备注
        </button>
        <button
            class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-red-400 hover:bg-zinc-800 transition-colors whitespace-nowrap"
            onclick={() => {
                removeBlock(bm.blockId)
                setBlockMenu(null)
            }}
        >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" class="size-3.5 shrink-0"
                ><path
                    d="M2 4h12M5 4V2.5a.5.5 0 01.5-.5h5a.5.5 0 01.5.5V4M12 4v9.5a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5V4"
                /></svg
            >
            删除操作块
        </button>
        <div class="border-t border-zinc-800 my-1"></div>
        <div class="px-3 py-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">变奏</div>
        {#if canSetIntro(bm.blockId)}
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors whitespace-nowrap"
                onclick={() => {
                    toggleIntro(bm.blockId)
                    setBlockMenu(null)
                }}
            >
                <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    class="size-3.5 shrink-0 text-zinc-500"
                    ><path d="M11 4L5 12M5 4l6 8" /><circle cx="8" cy="8" r="6.5" /></svg
                >
                设置变奏入场
            </button>
        {/if}
        {#if getOpBlocks().some((b: any) => b.id === bm.blockId && b.intro)}
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors whitespace-nowrap"
                onclick={() => {
                    toggleIntro(bm.blockId)
                    setBlockMenu(null)
                }}
            >
                <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    class="size-3.5 shrink-0 text-zinc-500"><path d="M4 8h8M2 8a6 6 0 0112 0 6 6 0 01-12 0z" /></svg
                >
                取消变奏入场
            </button>
        {/if}
        <div class="border-t border-zinc-800 my-1"></div>
        <div class="px-3 py-1 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">伤害绑定</div>
        <div class="px-3 py-0.5 text-[9px] text-zinc-600">直伤</div>
        {#if getDamageBlocks().some((d: any) => d.sourceId === bm.blockId && d.trackIndex === 3 && d.skillHits.length > 0)}
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors whitespace-nowrap"
                onclick={() => {
                    openSkillPicker(bm.blockId)
                    setBlockMenu(null)
                }}
            >
                <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    class="size-3.5 shrink-0 text-zinc-500"><path d="M11 2l3 3-9 9H2v-3z" /></svg
                >
                编辑直伤
            </button>
        {:else}
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors whitespace-nowrap"
                onclick={() => {
                    addDamageBlock('op', bm.blockId)
                    openSkillPicker(bm.blockId)
                    setBlockMenu(null)
                }}
            >
                <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    class="size-3.5 shrink-0 text-zinc-500"
                    ><path d="M5 11l3-3 3 3M8 8v6" /><path
                        d="M3 5a2 2 0 012-2h6a2 2 0 012 2v2a2 2 0 01-2 2H5a2 2 0 01-2-2V5z"
                    /></svg
                >
                绑定直伤
            </button>
        {/if}
        <div class="px-3 py-0.5 text-[9px] text-zinc-600">效应/处决</div>
        {#if getDamageBlocks().some((d: any) => d.sourceId === bm.blockId && d.trackIndex === 3 && d.nonDirectEntries.length > 0)}
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors whitespace-nowrap"
                onclick={() => {
                    openNonDirectPicker('op', bm.blockId)
                    setBlockMenu(null)
                }}
            >
                <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    class="size-3.5 shrink-0 text-zinc-500"><path d="M11 2l3 3-9 9H2v-3z" /></svg
                >
                编辑效应/处决
            </button>
        {:else}
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-800 transition-colors whitespace-nowrap"
                onclick={() => {
                    addDamageBlock('op', bm.blockId)
                    openNonDirectPicker('op', bm.blockId)
                    setBlockMenu(null)
                }}
            >
                <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    class="size-3.5 shrink-0 text-zinc-500"
                    ><path d="M5 11l3-3 3 3M8 8v6" /><path
                        d="M3 5a2 2 0 012-2h6a2 2 0 012 2v2a2 2 0 01-2 2H5a2 2 0 01-2-2V5z"
                    /></svg
                >
                绑定效应/处决
            </button>
        {/if}
        {#if getDamageBlocks().some((d: any) => d.sourceId === bm.blockId && d.trackIndex === 3)}
            <div class="border-t border-zinc-800/50 mt-1 mb-0"></div>
            <button
                class="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-red-400 hover:bg-zinc-800 transition-colors whitespace-nowrap"
                onclick={() => {
                    removeDamageBySource(bm.blockId, 'all')
                    setBlockMenu(null)
                }}
            >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" class="size-3.5 shrink-0"
                    ><path
                        d="M2 4h12M5 4V2.5a.5.5 0 01.5-.5h5a.5.5 0 01.5.5V4M12 4v9.5a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5V4"
                    /></svg
                >
                重置伤害绑定
            </button>
        {/if}
    </div>
{/if}

<!-- Track Key Picker Menu -->
{#if getTrackMenu()}
    {@const tm = getTrackMenu()!}
    <div
        class="fixed z-50 rounded-lg border border-zinc-700 bg-zinc-900 py-1.5 px-2 shadow-xl"
        style="left: {tm.x}px; top: {tm.y}px"
        data-track-menu="true"
        use:clampMenu={{ x: tm.x, y: tm.y }}
    >
        <div class="flex items-center gap-1">
            {#each getUiBtnIcons() as [name, url]}
                <button
                    class="size-7 flex items-center justify-center rounded hover:bg-zinc-800 transition-colors"
                    onclick={() => addOpBlock(tm.trackIndex, tm.time, name)}
                    title={name}
                >
                    <img src={url} alt={name} class="size-5 object-contain pointer-events-none" />
                </button>
            {/each}
        </div>
    </div>
{/if}
