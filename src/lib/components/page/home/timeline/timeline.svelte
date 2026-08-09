<script lang="ts">
    import { untrack } from 'svelte'
    import type { CharSlot } from '$lib/data/types'
    import type { TimelineData } from './timeline.types'
    import {
        init,
        getRefLines,
        getOpBlocks,
        getDamageBlocks,
        getLocked,
        getUiBtnIcons,
        getEditingId,
        getEditValue,
        setEditingId,
        setEditValue,
        getDraggingId,
        getDragBlockId,
        getDragBlockVisualPositions,
        getIsGroupDrag,
        getBlockWidths,
        getCharIconMap,
        getBlockMenu,
        getEditingBlockId,
        getEditingBlockDesc,
        setEditingBlockId,
        setEditingBlockDesc,
        getContextMenu,
        getTrackMenu,
        getTRACKS,
        getTableWidth,
        vx,
        damageBlockLeft,
        getDamageBlocksStacked,
        setDamageWidth,
        getSegments,
        elementColor,
        estimateDamageHeight,
        startDrag,
        startBlockDrag,
        onDrag,
        onBlockDrag,
        stopDrag,
        stopBlockDrag,
        confirmEdit,
        confirmBlockDesc,
        handleBlockDblclick,
        setBlockWidth,
        setContextMenu,
        setTrackMenu,
        setBlockMenu,
        getMultiBlockMenu,
        setMultiBlockMenu,
        reflowTrack,
        getSelectedBlockIds,
        getSelectedRefLineIds,
        getSelectionRect,
        toggleBlockSelection,
        toggleRefLineSelection,
        clearBlockSelection,
        startSelectionRect,
        updateSelectionRect,
        endSelectionRect,
        removeSelection,
        undo,
        redo,
        copySelection,
        cutSelection,
        pasteSelection,
        selectAll,
        setPointerX,
        hasClipboard,
        getQuickMode,
        getQuickSpecial,
        getQuickCharIndex,
        toggleQuickMode,
        quickInput,
        quickUndoLast,
        quickAddRefLine,
        quickEditLastDesc,
        quickOpenLastBind,
        cycleQuickSpecial,
        getLastQuickOpBlockId,
        openNonDirectPicker,
        getSkillPickerBlockId,
        getNonDirectPickerBlockId,
        getBlockKeyPickerId,
        applySkillHits,
        applyNonDirectEntries,
        setQuickCharIndex
    } from './timeline.store.svelte'
    import { remapDuplicatedDamageBuffs } from '../calculation/calculation.store.svelte'
    import {
        SIDE_PAD,
        PPS,
        SNAP_PX,
        MIN_GAP,
        MIN_TIME,
        MAX_TIME,
        MAX_POS,
        NON_DIRECT_ELEMENT,
        TRACK_COLORS,
        GAMEPAD_BUTTONS
    } from './timeline.consts'
    import type { OpBlock, DamageBlock } from './timeline.types'
    import ContextMenu from './context-menu.svelte'
    import SkillPicker from './skill-picker.svelte'
    import NonDirectPicker from './non-direct-picker.svelte'
    import DamageList from './damage-list.svelte'
    import { fallbackIcon } from '$lib/utils/icons'
    import { getKeyMapEntries, getDefaultBlockKey } from '$lib/data/keymap.svelte'
    import { getInputShortcutId, getShortcutKey, normalizeShortcutEvent } from '$lib/data/shortcuts.svelte'
    import { addToast } from '$lib/data/toast.svelte'

    interface Props {
        team: [CharSlot, CharSlot, CharSlot]
        locked: boolean
        data: TimelineData | null
        onupdate: (data: TimelineData) => void
    }

    let { team, locked, data, onupdate }: Props = $props()

    let timelineEl: HTMLDivElement | undefined = $state()
    let editInput: HTMLInputElement | undefined = $state()
    let blockEditInput: HTMLInputElement | undefined = $state()
    // 长按 Enter：非直伤配置触发（定时器 + 标记，短按松开执行倍率绑定）
    let enterHoldTimer: ReturnType<typeof setTimeout> | null = null
    let enterLongPressed = false
    // 最近一次 Enter 按下是否来自输入框（备注编辑 Enter 保存后不应触发倍率绑定/长按定时器）
    let enterFromInput = false

    let uiBtnIconMap = $derived(new Map(getUiBtnIcons()))
    // 手柄图标（游戏原生，blockKey 为手柄 id 时使用）
    const gamepadIconMap = new Map(GAMEPAD_BUTTONS.filter((b) => b.icon).map((b) => [b.id, b.icon as string]))
    // 查找索引：伤害层每帧渲染用 O(1) 替代 find（拖拽帧成本优化）
    let teamByChar = $derived(new Map(team.map((s) => [s.character ?? '', s])))
    let opBlockById = $derived(new Map(getOpBlocks().map((b) => [b.id, b])))
    let damageStack = $derived(getDamageBlocksStacked())
    let damageStackHeight = $derived.by(() => {
        let maxBottom = 0
        for (const item of damageStack) {
            maxBottom = Math.max(maxBottom, item.top + estimateDamageHeight(item.block))
        }
        return maxBottom + 12
    })

    $effect(() => {
        data
        onupdate
        team
        locked
        untrack(() => init(data, onupdate, team, locked))
    })

    $effect(() => {
        if (getEditingId()) editInput?.focus()
    })
    $effect(() => {
        if (getEditingBlockId()) blockEditInput?.focus()
    })

    const onWindowMouseDown = (e: MouseEvent) => {
        const target = e.target as HTMLElement
        if (getContextMenu() && !target.closest('[data-context-menu]')) setContextMenu(null)
        if (getMultiBlockMenu() && !target.closest('[data-context-menu]')) setMultiBlockMenu(null)
        if (getTrackMenu() && !target.closest('[data-track-menu]')) setTrackMenu(null)
        if (getBlockMenu() && !target.closest('[data-block-menu]')) setBlockMenu(null)
        const trackEl = target.closest<HTMLElement>('[data-track-index]')
        if (getLocked()) return
        if (timelineEl && target.closest('[data-block]')) {
            if (e.button === 0 && !e.ctrlKey) {
                const clickedId = (target.closest('[data-block]') as HTMLElement)?.dataset.block ?? ''
                if (!getSelectedBlockIds()[clickedId]) clearBlockSelection()
            }
            return
        }
        if (timelineEl && target.closest('[data-ref-line]')) {
            if (e.button === 0 && !e.ctrlKey) {
                const clickedId = (target.closest('[data-ref-line]') as HTMLElement)?.dataset.refLine ?? ''
                if (!getSelectedRefLineIds()[clickedId]) clearBlockSelection()
            }
            return
        }
        if (timelineEl && trackEl && !target.closest('.sticky') && !e.ctrlKey) {
            const rect = timelineEl.getBoundingClientRect()
            const scrollL = timelineEl.scrollLeft
            const mx = e.clientX - rect.left + scrollL - 80
            if (mx >= 0) startSelectionRect(mx)
        }
    }

    // 时间轴视口度量缓存：mousemove 每帧读取（避免 layout 读），在滚动/尺寸变化时刷新
    let tlMetrics = $state({ left: 0, top: 0, width: 0, height: 0, scrollLeft: 0 })

    function refreshTimelineMetrics() {
        if (!timelineEl) return
        const r = timelineEl.getBoundingClientRect()
        tlMetrics = {
            left: r.left,
            top: r.top,
            width: r.width,
            height: r.height,
            scrollLeft: timelineEl.scrollLeft
        }
    }

    $effect(() => {
        timelineEl
        refreshTimelineMetrics()
        const obs = new ResizeObserver(refreshTimelineMetrics)
        if (timelineEl) obs.observe(timelineEl)
        return () => obs.disconnect()
    })

    const onWindowMouseMove = (e: MouseEvent) => {
        if (!timelineEl) return
        const rect = tlMetrics
        const rawX = e.clientX - rect.left + rect.scrollLeft - 80
        if (e.clientX >= rect.left && e.clientX <= rect.left + rect.width) {
            setPointerX(rawX)
        }
        if (getSelectionRect()) {
            updateSelectionRect(rawX)
        }
        onDrag(rawX)
        onBlockDrag(rawX)
    }

    const onWindowMouseUp = () => {
        endSelectionRect()
        stopDrag()
        stopBlockDrag()
    }

    const onWindowMouseLeave = () => {
        stopDrag()
        stopBlockDrag()
    }

    const onWheel = (e: WheelEvent) => {
        if (!timelineEl) return
        e.preventDefault()
        timelineEl.scrollLeft += e.deltaY
        refreshTimelineMetrics()
    }

    const onDamageWheel = (e: WheelEvent) => {
        if (e.ctrlKey) {
            e.preventDefault()
            e.stopPropagation()
            const el = e.currentTarget as HTMLElement
            el.scrollTop += e.deltaY
        }
    }

    function nonpassiveWheel(node: HTMLElement, handler: (e: WheelEvent) => void) {
        node.addEventListener('wheel', handler, { passive: false })
        return {
            destroy() {
                node.removeEventListener('wheel', handler)
            }
        }
    }

    function measureWidth(node: HTMLElement, blockId: string) {
        const set = () => {
            setBlockWidth(blockId, node.offsetWidth)
        }
        set()
        const ro = new ResizeObserver(set)
        return { destroy: () => ro.disconnect() }
    }

    function measureDamageWidth(node: HTMLElement, blockId: string) {
        const set = () => setDamageWidth(blockId, node.offsetWidth)
        set()
        const ro = new ResizeObserver(set)
        return { destroy: () => ro.disconnect() }
    }

    function blockIconKey(block: OpBlock): string {
        const entry = getKeyMapEntries().find((e) => getDefaultBlockKey(e.id) === block.key)
        return entry ? entry.blockKey : block.key
    }

    function onTrackContextMenu(e: MouseEvent, i: number) {
        if (getQuickMode() || i >= getTRACKS().length - 1 || !timelineEl || getLocked()) return
        const rect = timelineEl.getBoundingClientRect()
        const scrollL = timelineEl.scrollLeft
        const x = e.clientX - rect.left + scrollL - 80
        const pos2 = Math.max(SIDE_PAD, Math.min(MAX_POS, x))
        setTrackMenu({ x: e.clientX, y: e.clientY, trackIndex: i, pos: pos2 })
    }

    function onBlockContextMenu(e: MouseEvent, blockId: string) {
        if (getQuickMode() || getLocked()) return
        const target = e.target as HTMLElement
        if (target.closest('input, textarea, [contenteditable]')) return
        e.preventDefault()
        e.stopPropagation()
        const selected = getSelectedBlockIds()
        if (Object.keys(selected).length > 1 && selected[blockId]) {
            setMultiBlockMenu({ x: e.clientX, y: e.clientY })
        } else {
            toggleBlockSelection(blockId, false)
            setBlockMenu({ x: e.clientX, y: e.clientY, blockId })
        }
    }

    function onRefContextMenu(e: MouseEvent, refId: string) {
        if (getQuickMode() || getLocked()) return
        e.preventDefault()
        e.stopPropagation()
        const selectedRefs = getSelectedRefLineIds()
        const selectedBlocks = getSelectedBlockIds()
        const totalSelected = Object.keys(selectedRefs).length + Object.keys(selectedBlocks).length
        if (totalSelected > 1 && selectedRefs[refId]) {
            setMultiBlockMenu({ x: e.clientX, y: e.clientY })
        } else {
            toggleRefLineSelection(refId, false)
            setContextMenu({ x: e.clientX, y: e.clientY, id: refId })
        }
    }

    function scrollQuickBlockIntoView(id: string) {
        if (!timelineEl) return
        const block = getOpBlocks().find((b) => b.id === id)
        if (!block) return
        const width = getBlockWidths()[id] ?? 56
        const x = 80 + block.pos - width / 2
        const left = timelineEl.scrollLeft
        const right = left + timelineEl.clientWidth
        if (x < left + 12 || x + width > right - 12) {
            timelineEl.scrollTo({ left: Math.max(0, x - 24), behavior: 'smooth' })
        }
    }
</script>

<svelte:window
    onmousedown={onWindowMouseDown}
    onmousemove={onWindowMouseMove}
    onmouseup={onWindowMouseUp}
    onmouseleave={onWindowMouseLeave}
    oncontextmenu={(e) => {
        const target = e.target as HTMLElement
        if (target.closest('input, textarea, [contenteditable]')) return
        e.preventDefault()
    }}
    oncopy={(e) => {
        const target = e.target as HTMLElement
        if (target.closest('input, textarea, [contenteditable]')) return
        if (Object.keys(getSelectedBlockIds()).length > 0 || Object.keys(getSelectedRefLineIds()).length > 0) {
            e.preventDefault()
            copySelection()
        }
    }}
    oncut={(e) => {
        const target = e.target as HTMLElement
        if (target.closest('input, textarea, [contenteditable]')) return
        if (Object.keys(getSelectedBlockIds()).length > 0 || Object.keys(getSelectedRefLineIds()).length > 0) {
            e.preventDefault()
            cutSelection()
        }
    }}
    onpaste={(e) => {
        const target = e.target as HTMLElement
        if (target.closest('input, textarea, [contenteditable]')) return
        if (!hasClipboard()) return
        e.preventDefault()
        const damageMap = pasteSelection()
        if (Object.keys(damageMap).length > 0) remapDuplicatedDamageBuffs(damageMap)
    }}
    onkeydown={(e) => {
        const quickConfigKey = getShortcutKey('timeline-quick.config')
        // Enter 按下的瞬间记录来源（输入框/弹窗内按下后元素可能销毁，keyup 的 target 会变成 body）
        if (normalizeShortcutEvent(e) === quickConfigKey) {
            const fromInput =
                e.target instanceof HTMLElement && !!e.target.closest('input, textarea, [contenteditable]')
            const fromModal = getSkillPickerBlockId() !== null || getNonDirectPickerBlockId() !== null
            // 一旦来自输入框/弹窗，保持抑制直到 keyup 重置（元素销毁后 repeat 的 target 不再是原元素）
            enterFromInput = enterFromInput || fromInput || fromModal
        }
        // 直伤/非直伤弹窗：ESC=保存并退出（全局兜底，弹窗内部事件也冒泡至此）；Enter 留给弹窗内点击
        if (e.key === 'Escape') {
            if (getSkillPickerBlockId() !== null) {
                e.preventDefault()
                applySkillHits()
                return
            }
            if (getNonDirectPickerBlockId() !== null) {
                e.preventDefault()
                applyNonDirectEntries()
                return
            }
        }
        const target = e.target as HTMLElement
        if (target.closest('input, textarea, [contenteditable]')) return
        const norm = normalizeShortcutEvent(e)
        // PageUp/PageDown：快速左右滚动（弹窗/菜单打开时不拦截）
        if (
            (norm === getShortcutKey('timeline.scroll-left') || norm === getShortcutKey('timeline.scroll-right')) &&
            !getSkillPickerBlockId() &&
            !getNonDirectPickerBlockId() &&
            !getBlockKeyPickerId() &&
            !getContextMenu() &&
            !getTrackMenu() &&
            !getBlockMenu() &&
            !getMultiBlockMenu()
        ) {
            e.preventDefault()
            const amount = timelineEl?.clientWidth ?? 800
            timelineEl?.scrollBy({
                left: norm === getShortcutKey('timeline.scroll-left') ? -amount : amount,
                behavior: 'smooth'
            })
            return
        }
        const key = e.key.toLowerCase()
        if ((e.ctrlKey || e.metaKey) && key === 'a') {
            e.preventDefault()
            selectAll()
            return
        }
        if ((e.ctrlKey || e.metaKey) && (key === 'z' || key === 'y')) {
            e.preventDefault()
            if (key === 'y' || e.shiftKey) redo()
            else undo()
            return
        }
        if (norm === getShortcutKey('timeline.quick-mode') && !e.repeat) {
            toggleQuickMode()
            return
        }
        if (
            getQuickMode() &&
            !getSkillPickerBlockId() &&
            !getNonDirectPickerBlockId() &&
            !getBlockKeyPickerId() &&
            !getContextMenu() &&
            !getTrackMenu() &&
            !getBlockMenu() &&
            !getMultiBlockMenu()
        ) {
            if (norm === quickConfigKey) {
                // 长按（≥500ms）：为最近输入的操作块打开非直伤配置；短按松开 = 打开倍率绑定
                e.preventDefault()
                if (enterHoldTimer === null && !enterLongPressed && !enterFromInput) {
                    enterHoldTimer = setTimeout(() => {
                        enterHoldTimer = null
                        enterLongPressed = true
                        const blockId = getLastQuickOpBlockId()
                        if (blockId) openNonDirectPicker('op', blockId)
                        else addToast('没有可配置的操作块', 'info')
                    }, 500)
                }
                return
            }
            if (norm === getShortcutKey('timeline-quick.quick-undo')) {
                e.preventDefault()
                quickUndoLast()
                return
            }
            if (norm === getShortcutKey('timeline-quick.ref-line')) {
                e.preventDefault()
                quickAddRefLine(true)
                return
            }
            if (norm === getShortcutKey('timeline-quick.cycle-next')) {
                e.preventDefault()
                cycleQuickSpecial(1)
                return
            }
            if (norm === getShortcutKey('timeline-quick.cycle-prev')) {
                e.preventDefault()
                cycleQuickSpecial(-1)
                return
            }
            if (norm === getShortcutKey('timeline-quick.edit-desc')) {
                e.preventDefault()
                quickEditLastDesc()
                return
            }
            if (norm === getShortcutKey('timeline-quick.char-1')) {
                e.preventDefault()
                setQuickCharIndex(0)
                return
            }
            if (norm === getShortcutKey('timeline-quick.char-2')) {
                e.preventDefault()
                setQuickCharIndex(1)
                return
            }
            if (norm === getShortcutKey('timeline-quick.char-3')) {
                e.preventDefault()
                setQuickCharIndex(2)
                return
            }
            // 输入键（普攻/重击/闪避/Q/E/R/F/T/跳跃）按配置匹配，支持修饰组合；置于修饰键拦截之前
            const inputId = getInputShortcutId(norm)
            if (inputId !== null) {
                e.preventDefault()
                const res = quickInput(norm)
                if (res !== null) scrollQuickBlockIntoView(res)
                return
            }
            // 未匹配到任何配置键的修饰键组合（复制/粘贴等）不触发快速输入
            if (e.ctrlKey || e.metaKey || e.altKey) return
        }
        if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'Delete' || e.key === 'Backspace')) {
            e.preventDefault()
            removeSelection()
        }
    }}
    onkeyup={(e) => {
        if (normalizeShortcutEvent(e) !== getShortcutKey('timeline-quick.config')) return
        // 输入框内（备注编辑等）的 Enter 已由输入框自身处理，不触发倍率绑定
        if (enterFromInput) {
            enterFromInput = false
            return
        }
        if (enterHoldTimer !== null) {
            clearTimeout(enterHoldTimer)
            enterHoldTimer = null
        }
        // 短按 Enter：打开最近操作块的倍率绑定（长按已进入非直伤配置则跳过）
        const quickActive =
            getQuickMode() &&
            !getSkillPickerBlockId() &&
            !getNonDirectPickerBlockId() &&
            !getBlockKeyPickerId() &&
            !getContextMenu() &&
            !getTrackMenu() &&
            !getBlockMenu() &&
            !getMultiBlockMenu()
        if (!enterLongPressed && quickActive) {
            void quickOpenLastBind()
        }
        enterLongPressed = false
    }}
/>

<div class="theme-glass-surface flex h-full flex-col bg-(--theme-timeline-bg) text-(--theme-timeline-text)">
    <div class="theme-scrollbar flex-1 overflow-x-auto overflow-y-hidden" bind:this={timelineEl} onwheel={onWheel}>
        <div class="relative" style="width: {getTableWidth()}px; min-width: 100%; height: 100%;">
            <div class="flex flex-col h-full">
                <!-- Header row -->
                <div class="relative shrink-0 h-8 border-b" style="border-bottom-color: var(--theme-divider-border);">
                    <div
                        class="sticky left-0 z-35 w-20 h-full bg-(--theme-timeline-bg)/80 border-r backdrop-blur-sm flex items-center justify-center"
                        style="border-right-color: var(--theme-divider-border);"
                    >
                        {#if getQuickMode() && getQuickSpecial() !== 'none'}
                            <span
                                class="text-[10px] font-bold {getQuickSpecial() === 'intro'
                                    ? 'text-yellow-400'
                                    : 'text-cyan-400'}"
                            >
                                {getQuickSpecial() === 'intro' ? '变奏' : '切回'}
                            </span>
                        {/if}
                    </div>
                </div>

                <!-- Track rows -->
                {#each getTRACKS() as name, i}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                        class="relative shrink-0 {i < getTRACKS().length - 1 ? 'h-14' : 'flex-1'}"
                        data-track-index={i}
                        style="border-bottom: 1px solid color-mix(in srgb, {TRACK_COLORS[
                            i
                        ]} 15%, transparent);{getQuickMode() && i < getTRACKS().length - 1 && i === getQuickCharIndex()
                            ? ` background: color-mix(in srgb, ${elementColor(name)} 18%, transparent);`
                            : ''}"
                        oncontextmenu={(e) => {
                            e.preventDefault()
                            onTrackContextMenu(e, i)
                        }}
                    >
                        <!-- Sticky label column -->
                        <div
                            class="sticky left-0 z-35 w-20 h-full bg-(--theme-timeline-bg)/60 border-r backdrop-blur-sm flex items-center justify-center"
                            style="border-right-color: var(--theme-divider-border);"
                        >
                            {#if i < getTRACKS().length - 1}
                                <div
                                    class="flex items-center justify-center w-full h-full overflow-hidden"
                                    style="border-right: 3px solid {elementColor(
                                        name
                                    )}; margin-right: 4px; width: calc(100% - 4px); background: linear-gradient(135deg, transparent 0%, color-mix(in srgb, {elementColor(
                                        name
                                    )} 25%, transparent) 100%);"
                                >
                                    {#if getCharIconMap()[name]}
                                        <img
                                            src={getCharIconMap()[name]}
                                            alt={name}
                                            draggable="false"
                                            use:fallbackIcon={'/icons/placeholder-character.svg'}
                                            class="h-full w-full object-cover"
                                        />
                                    {/if}
                                </div>
                            {:else}
                                <div
                                    class="flex items-center justify-center w-full h-full overflow-hidden"
                                    style="border-right: 3px dashed color-mix(in srgb, var(--theme-timeline-text) 50%, transparent); margin-right: 4px; width: calc(100% - 4px);"
                                >
                                    <div
                                        class="[writing-mode:vertical-rl] text-[16px] font-medium text-(--theme-timeline-text)/60"
                                    >
                                        伤害绑定
                                    </div>
                                </div>
                            {/if}
                        </div>

                        <!-- Op blocks overlay -->
                        {#if i < getTRACKS().length - 1}
                            <div class="absolute pointer-events-none" style="left: 5rem; top: 0; right: 0; bottom: 0;">
                                {#each getOpBlocks().filter((b: OpBlock) => b.trackIndex === i) as block (block.id)}
                                    {@const effKey = blockIconKey(block)}
                                    {@const blockIcon = uiBtnIconMap.get(effKey) ?? gamepadIconMap.get(effKey)}
                                    {@const isGroupDrag = getIsGroupDrag()}
                                    {@const isHighlighted =
                                        getDragBlockId() === block.id ||
                                        (getSelectedBlockIds()[block.id] && isGroupDrag)}
                                    {@const isSelected = getSelectedBlockIds()[block.id] !== undefined}
                                    {@const isOtherBlockDimmed =
                                        (getDragBlockId() !== null &&
                                            block.id !== getDragBlockId() &&
                                            !getSelectedBlockIds()[block.id]) ||
                                        (isGroupDrag && !getSelectedBlockIds()[block.id])}
                                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                                    <div
                                        class="absolute inset-y-0 flex items-center pointer-events-auto cursor-grab active:cursor-grabbing select-none"
                                        style="left: {getDragBlockVisualPositions()[block.id] ??
                                            block.pos}px; transform: translateX(-50%) {isHighlighted
                                            ? 'translateY(-4px)'
                                            : ''}; z-index: {isHighlighted ? 20 : 5}; opacity: {isOtherBlockDimmed
                                            ? 0.4
                                            : 1}; transition: opacity 150ms ease;"
                                        data-block={block.id}
                                        onmousedown={(e) => {
                                            if (e.ctrlKey) {
                                                e.stopPropagation()
                                                toggleBlockSelection(block.id, true)
                                                return
                                            }
                                            if (!timelineEl) return
                                            const rect = timelineEl.getBoundingClientRect()
                                            const scrollL2 = timelineEl.scrollLeft
                                            const mx = e.clientX - rect.left + scrollL2 - 80
                                            startBlockDrag(e, block.id, mx)
                                        }}
                                        oncontextmenu={(e) => onBlockContextMenu(e, block.id)}
                                        ondblclick={() => {
                                            if (!getLocked()) handleBlockDblclick(block.id)
                                        }}
                                    >
                                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                                        <div
                                            class="flex items-center gap-1 h-full rounded-md {getEditingBlockId() ===
                                            block.id
                                                ? ''
                                                : 'px-2.5'} text-sm bg-(--theme-timeline-bg)/80 border whitespace-nowrap shadow-sm min-w-14"
                                            style="border-color: {isHighlighted || isSelected
                                                ? 'var(--theme-accent-bg)'
                                                : 'var(--theme-divider-border)'};{isHighlighted || isSelected
                                                ? ' box-shadow: 0 0 0 2px color-mix(in srgb, var(--theme-accent-bg) 50%, transparent);'
                                                : ''}"
                                            use:measureWidth={block.id}
                                        >
                                            {#if block.intro}
                                                <span class="text-xs text-yellow-400 font-semibold shrink-0">变奏</span>
                                            {/if}
                                            {#if block.switchback}
                                                <span class="text-xs text-cyan-400 font-semibold shrink-0">切回</span>
                                            {/if}
                                            {#if blockIcon}
                                                <img
                                                    src={blockIcon}
                                                    alt={effKey}
                                                    draggable="false"
                                                    class="size-10 object-contain shrink-0"
                                                />
                                            {:else}
                                                <span class="font-bold text-(--theme-timeline-text)">{effKey}</span>
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
                                                    size={Math.max(6, (getEditingBlockDesc()?.length || 0) + 3)}
                                                    class="bg-(--theme-timeline-bg)/60 text-(--theme-timeline-text) text-xs text-left rounded outline-none border px-1"
                                                    style="border-color: color-mix(in srgb, var(--theme-accent-bg) 50%, transparent);"
                                                />
                                            {:else}
                                                <span class="text-(--theme-timeline-text)/60 max-w-24 truncate"
                                                    >{block.desc}</span
                                                >
                                            {/if}
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        {:else}
                            <!-- Damage blocks overlay for track 3 -->
                            <div
                                class="absolute pointer-events-auto theme-scrollbar overflow-y-auto"
                                style="left: 5rem; top: 0; right: 0; bottom: 0; z-index: 6;"
                                use:nonpassiveWheel={onDamageWheel}
                            >
                                <div class="relative" style="height: {damageStackHeight}px; width: 100%;">
                                    {#each damageStack as { block: dmg, top, left } (dmg.id)}
                                        {@const isGroupDrag = getIsGroupDrag()}
                                        {@const isParentDragged = isGroupDrag
                                            ? dmg.sourceType === 'op'
                                                ? getSelectedBlockIds()[dmg.sourceId]
                                                : getSelectedRefLineIds()[dmg.sourceId]
                                            : getDragBlockId() !== null &&
                                              dmg.sourceType === 'op' &&
                                              (Object.keys(getSelectedBlockIds()).length > 1
                                                  ? getSelectedBlockIds()[dmg.sourceId]
                                                  : getDragBlockId() === dmg.sourceId)}
                                        {@const isDimmed =
                                            (getDragBlockId() !== null || isGroupDrag) && !isParentDragged}
                                        <div
                                            class="absolute cursor-default"
                                            style="left: {left}px; top: {top}px; transform: scale({isParentDragged
                                                ? 1.2
                                                : 1}); opacity: {isDimmed
                                                ? 0.4
                                                : 1}; transform-origin: left center; transition: transform 150ms ease, opacity 150ms ease;"
                                        >
                                            <div
                                                class="flex flex-col items-start gap-0.5 px-1 py-0.5"
                                                use:measureDamageWidth={dmg.id}
                                            >
                                                {#each dmg.skillHits as hit}
                                                    {@const echoName = teamByChar.get(hit.character)?.echoes?.[0]?.name}
                                                    {@const srcOp =
                                                        dmg.sourceType === 'op' ? opBlockById.get(dmg.sourceId) : null}
                                                    {@const srcChar =
                                                        dmg.sourceType === 'ref'
                                                            ? ''
                                                            : srcOp && srcOp.trackIndex < getTRACKS().length - 1
                                                              ? (team[srcOp.trackIndex]?.character ?? '')
                                                              : ''}
                                                    <span
                                                        class="text-[11px] font-bold leading-tight border border-dashed rounded px-1.5 py-px"
                                                        style="color: var(--theme-element-{hit.element}, #888); border-color: var(--theme-element-{hit.element}, #888);"
                                                    >
                                                        {(dmg.sourceType === 'ref' && hit.character
                                                            ? `[${hit.character}]`
                                                            : dmg.sourceType === 'op' &&
                                                                hit.character &&
                                                                hit.character !== srcChar
                                                              ? `[${hit.character}]`
                                                              : '') +
                                                            (hit.skillType === '声骸技能' && echoName
                                                                ? echoName + '·'
                                                                : '') +
                                                            hit.hitName.replace('伤害', '') +
                                                            ((hit.hits ?? 0) > 1 ? '\u00D7' + hit.hits : '')}
                                                    </span>
                                                {/each}
                                                {#each [...dmg.nonDirectEntries].sort((a, b) => {
                                                    const w = { 处决: 0, 响应: 1, 效应: 2 }
                                                    return (w[a.category] ?? 3) - (w[b.category] ?? 3)
                                                }) as nd}
                                                    {@const c =
                                                        nd.category === '响应'
                                                            ? 'var(--theme-accent-bg)'
                                                            : nd.category === '处决'
                                                              ? 'var(--theme-accent-text)'
                                                              : (NON_DIRECT_ELEMENT as Record<string, string>)[nd.name]
                                                                ? `var(--theme-element-${(NON_DIRECT_ELEMENT as Record<string, string>)[nd.name]}, #888)`
                                                                : 'var(--theme-accent-bg)'}
                                                    <span
                                                        class="text-[11px] font-bold leading-tight border border-dashed rounded px-1.5 py-px"
                                                        style="color: {c}; border-color: {c}; opacity: {nd.category ===
                                                        '效应'
                                                            ? 0.75
                                                            : 1};"
                                                    >
                                                        {nd.category === '效应'
                                                            ? nd.name +
                                                              nd.layers +
                                                              '层' +
                                                              ((nd.hits ?? 1) > 1 ? `×${nd.hits}段` : '')
                                                            : nd.name}{nd.responders?.length
                                                            ? '[' + nd.responders.join(',') + ']'
                                                            : ''}
                                                    </span>
                                                {/each}
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        {/if}
                    </div>
                {/each}
            </div>

            <!-- Ref line overlay (vertical lines spanning all tracks) -->
            <div class="absolute pointer-events-none" style="left: 5rem; top: 2rem; right: 0; bottom: 0; z-index: 10;">
                {#each getRefLines() as rl}
                    <div
                        class="absolute top-0 bottom-0 border-l-2 border-dashed"
                        style="left: {vx(rl.id, rl.pos)}px; border-left-color: {getDraggingId() === rl.id ||
                        getSelectedRefLineIds()[rl.id]
                            ? 'var(--theme-accent-bg)'
                            : 'color-mix(in srgb, var(--theme-timeline-text) 30%, transparent)'};"
                    ></div>
                {/each}
            </div>

            <!-- Header time label overlay -->
            <div class="absolute pointer-events-none" style="left: 5rem; top: 0; height: 2rem; z-index: 20;">
                {#each getRefLines() as rl}
                    <div
                        class="absolute top-0 h-full flex items-center pointer-events-auto"
                        style="left: {vx(rl.id, rl.pos)}px; transform: translateX(-50%); white-space: nowrap;"
                    >
                        {#if getEditingId() === rl.id && !(rl.id === 'left' || rl.id === 'right')}
                            <input
                                bind:this={editInput}
                                value={getEditValue()}
                                oninput={(e) => setEditValue((e.target as HTMLInputElement).value)}
                                onblur={confirmEdit}
                                onkeydown={(e) => {
                                    if (e.key === 'Enter') confirmEdit()
                                    if (e.key === 'Escape') setEditingId(null)
                                }}
                                size={Math.max(5, (getEditValue()?.length || 0) + 2)}
                                class="bg-(--theme-timeline-bg)/60 text-[9px] text-(--theme-timeline-text) text-left rounded outline-none border tabular-nums"
                                style="border-color: color-mix(in srgb, var(--theme-accent-bg) 50%, transparent);"
                            />
                        {:else}
                            <span
                                class="text-[9px] tabular-nums cursor-pointer"
                                style="color: {getDraggingId() === rl.id || getSelectedRefLineIds()[rl.id]
                                    ? 'var(--theme-accent-bg)'
                                    : 'var(--theme-timeline-text)'}; transform: scale({getDraggingId() === rl.id
                                    ? 1.2
                                    : 1}); transition: color 150ms ease, transform 150ms ease;"
                                data-ref-line={rl.id}
                                onmousedown={(e) => {
                                    if (e.ctrlKey) {
                                        e.preventDefault()
                                        e.stopPropagation()
                                        toggleRefLineSelection(rl.id, true)
                                    }
                                }}
                                oncontextmenu={(e) => onRefContextMenu(e, rl.id)}
                                role="button"
                                tabindex="-1">{rl.time || ''}</span
                            >
                        {/if}
                    </div>
                {/each}
            </div>

            <!-- Selection rect overlay -->
            {#if getSelectionRect()}
                {@const sr = getSelectionRect()!}
                {@const rectLeft = Math.min(sr.startX, sr.currentX)}
                {@const rectWidth = Math.abs(sr.currentX - sr.startX)}
                <div
                    class="absolute pointer-events-none"
                    style="top: 2rem; left: {5 * 16 +
                        rectLeft}px; width: {rectWidth}px; bottom: 0; z-index: 7; background: color-mix(in srgb, var(--theme-accent-bg) 12%, transparent); border-left: 1px solid color-mix(in srgb, var(--theme-accent-bg) 40%, transparent); border-right: 1px solid color-mix(in srgb, var(--theme-accent-bg) 40%, transparent);"
                ></div>
            {/if}
            <!-- Drag hot zone overlay -->
            <div class="absolute pointer-events-none" style="top: 2rem; left: 5rem; right: 0; bottom: 0; z-index: 30;">
                {#each getRefLines() as rl}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                        class="absolute inset-y-0 pointer-events-auto cursor-col-resize"
                        style="left: {vx(rl.id, rl.pos) - 10}px; width: 20px;"
                        data-ref-line={rl.id}
                        onmousedown={(e) => {
                            if (e.ctrlKey) {
                                e.preventDefault()
                                e.stopPropagation()
                                toggleRefLineSelection(rl.id, true)
                                return
                            }
                            startDrag(e, rl.id)
                        }}
                        oncontextmenu={(e) => onRefContextMenu(e, rl.id)}
                    ></div>
                {/each}
            </div>
        </div>
    </div>
</div>

<ContextMenu />
<SkillPicker />
<NonDirectPicker />
<DamageList />
