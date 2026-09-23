<script lang="ts">
    import {
        init,
        getConfig,
        getEchoSlot,
        setEchoCost,
        setMainStat,
        addSubstat,
        removeSubstat,
        moveSubstat,
        updateSubstatValue,
        getCalcState
    } from '$lib/calc/config.store.svelte'
    import { RESISTANCE_KEYS } from '$lib/calc/config.consts'
    import { MAIN_STAT_POOL, SECOND_MAIN_STAT, SUBSTAT_OPTIONS } from '$lib/consts/stat-data'
    import { simulateEnhancement } from '$lib/consts/substat-roll-data'
    import { addToast } from '$lib/data/toast.svelte'
    import type { CharSlot } from '$lib/types/project'
    import type { ConfigState } from '$lib/calc/config.types'
    import { getCharIconMap, elementColor } from '$lib/calc/timeline.store.svelte'
    import EnemyPanel from './enemy-panel.svelte'
    import RandomEnhanceModal from './random-enhance-modal.svelte'
    import EchoSlotCard from '$lib/components/layout/echo-slot-card.svelte'
    import SubstatPickerModal from '$lib/components/layout/substat-picker-modal.svelte'
    import { slide } from 'svelte/transition'
    import Icon from '@iconify/svelte'
    import { fallbackIcon } from '$lib/utils/icons'
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {
        team: [CharSlot, CharSlot, CharSlot]
        data: ConfigState | null
        locked?: boolean
        onupdate: (state: ConfigState) => void
    }

    let { team, data, locked = false, onupdate, class: className, style: styleProp }: Props = $props()

    let activeTab = $state<'char0' | 'char1' | 'char2' | 'enemy'>('char0')
    let showMainStatMenu = $state<{ ci: number; si: number } | null>(null)
    let showSubstatModal = $state<{ ci: number; si: number } | null>(null)
    let showEnhanceModal = $state<{ ci: number; si: number } | null>(null)
    let dragState = $state<{ ci: number; si: number; idx: number; dropIdx: number; outside: boolean } | null>(null)
    let mainStatMenuPos = $state<{ left: number; top: number; width: number } | null>(null)
    let mainStatMenuEl: HTMLElement | undefined = $state()
    let mainStatOverlayEl: HTMLDivElement | undefined = $state()

    function getMainStatTrigger(ci: number, si: number): HTMLButtonElement | null {
        return document.querySelector(`[data-main-stat-trigger="${ci}:${si}"]`)
    }

    function closeMainStatMenu() {
        showMainStatMenu = null
        mainStatMenuPos = null
    }

    function toggleMainStatMenu(ci: number, si: number) {
        if (showMainStatMenu?.ci === ci && showMainStatMenu?.si === si) {
            closeMainStatMenu()
            return
        }
        const el = getMainStatTrigger(ci, si)
        if (!el) return
        const r = el.getBoundingClientRect()
        // 先按视口坐标暂存；渲染后 rAF 里再换算为相对遮罩容器（fixed 定位受 glass surface backdrop-filter 影响）
        mainStatMenuPos = { left: r.left, top: r.bottom + 4, width: r.width }
        showMainStatMenu = { ci, si }
    }

    let mainStatMenuData = $derived.by(() => {
        if (!showMainStatMenu) return null
        const { ci, si } = showMainStatMenu
        return config.characters[ci]?.echoes[si] ?? null
    })

    // 打开期间监听页面级滚动：任何滚动（含 window scroll）都关闭菜单，避免菜单残留错位；
    // 菜单自身内部滚动（滚动选项列表）不触发关闭
    $effect(() => {
        if (!showMainStatMenu) return
        const onScroll = (e: Event) => {
            const t = e.target as HTMLElement | null
            if (t && mainStatMenuEl?.contains(t)) return
            closeMainStatMenu()
        }
        window.addEventListener('scroll', onScroll, true)
        return () => window.removeEventListener('scroll', onScroll, true)
    })

    $effect(() => {
        if (!showMainStatMenu || !mainStatMenuEl || !mainStatOverlayEl) return
        requestAnimationFrame(() => {
            const el = mainStatMenuEl
            const overlay = mainStatOverlayEl
            const menu = showMainStatMenu
            if (!el || !overlay || !menu) return
            const br = getMainStatTrigger(menu.ci, menu.si)?.getBoundingClientRect()
            const or = overlay.getBoundingClientRect()
            if (!br) return
            const cw = document.documentElement.clientWidth
            const ch = document.documentElement.clientHeight
            const menuW = br.width
            const menuH = el.offsetHeight
            let left = br.left - or.left
            let top = br.bottom + 4 - or.top
            if (br.right > cw - 8) left = cw - menuW - 8 - or.left
            if (br.bottom + 4 + menuH > ch - 8) top = br.top - menuH - 4 - or.top
            el.style.left = left + 'px'
            el.style.top = top + 'px'
            el.style.width = menuW + 'px'
        })
    })

    $effect(() => {
        init(data, locked)
    })

    let config = $derived(getConfig())
    let charNames = $derived(team.map((s) => s.character).filter((c): c is string => c !== null))
    let charIcons = $derived(getCharIconMap())
    let charCostStrings = $derived(
        [0, 1, 2].map((ci) =>
            config.characters[ci].echoes
                .map((e) => e.cost)
                .sort((a, b) => b - a)
                .join('')
        )
    )

    const TAB_LABELS = ['角色1', '角色2', '角色3', '敌人配置']
    const COST_OPTIONS = [4, 3, 1]

    function costBtnCls(cost: number): string {
        if (cost === 4) return 'bg-(--theme-accent-bg)/25 text-(--theme-accent-text)'
        if (cost === 3) return 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
        return 'bg-(--theme-accent-bg)/8 text-(--theme-accent-text)'
    }

    function handleSetCost(ci: number, si: number, cost: number) {
        const slots = config.characters[ci].echoes
        const other = slots.reduce((s, e, i) => s + (i === si ? 0 : e.cost), 0)
        if (other + cost > 12) return
        setEchoCost(ci, si, cost)
        onupdate(getCalcState())
    }

    function handleSetMainStat(ci: number, si: number, stat: { type: string; value: number; unit: string } | null) {
        setMainStat(ci, si, stat)
        closeMainStatMenu()
        onupdate(getCalcState())
    }

    function handleAddSubstat(ci: number, si: number, label: string) {
        addSubstat(ci, si, label)
        onupdate(getCalcState())
    }

    function handleRemoveSubstat(ci: number, si: number, idx: number) {
        removeSubstat(ci, si, idx)
        onupdate(getCalcState())
    }

    function handleMoveSubstat(ci: number, si: number, fromIdx: number, toIdx: number) {
        moveSubstat(ci, si, fromIdx, toIdx)
        onupdate(getCalcState())
    }

    function handleClearSubstats(ci: number, si: number) {
        const slot = getConfig().characters[ci].echoes[si]
        for (let i = slot.substats.length - 1; i >= 0; i--) {
            removeSubstat(ci, si, i)
        }
        onupdate(getCalcState())
    }

    function handleUpdateSubstatValue(ci: number, si: number, idx: number, value: number) {
        updateSubstatValue(ci, si, idx, value)
        onupdate(getCalcState())
    }

    function handleEnhanceResult(ci: number, si: number) {
        return (result: { substats: import('$lib/types/game-data').EchoStat[]; attempts: number }) => {
            for (const s of result.substats) {
                addSubstat(ci, si, s.type)
                const slot = getConfig().characters[ci].echoes[si]
                const idx = slot.substats.findIndex((x) => x.type === s.type)
                if (idx !== -1) updateSubstatValue(ci, si, idx, s.value)
            }
            onupdate(getCalcState())
            addToast(`消耗了 ${result.attempts} 个声骸胚子`, 'success', 5000)
        }
    }

    const DAMAGE_SHORT: Record<string, string> = {
        普攻伤害加成: '普攻加成',
        重击伤害加成: '重击加成',
        共鸣技能伤害加成: '共技加成',
        共鸣解放伤害加成: '共解加成'
    }
    function shortLabel(label: string): string {
        return DAMAGE_SHORT[label] ?? label
    }

    function getTierIndex(option: (typeof SUBSTAT_OPTIONS)[number], value: number): number {
        if (value <= 0) return -1
        let closest = 0
        for (let i = 0; i < option.tiers.length; i++) {
            if (Math.abs(option.tiers[i] - value) < Math.abs(option.tiers[closest] - value)) closest = i
        }
        return closest
    }

    function startDrag(e: PointerEvent, ci: number, si: number, idx: number) {
        if ((e.target as HTMLElement).closest('input')) return
        const el = e.currentTarget as HTMLElement
        el.setPointerCapture(e.pointerId)
        dragState = { ci, si, idx, dropIdx: idx, outside: false }
    }

    function onDragMove(e: PointerEvent) {
        if (!dragState) return
        const el = e.currentTarget as HTMLElement
        const card = el.closest('.rounded-none') as HTMLElement | null
        const container = el.closest('.space-y-1') as HTMLElement | null
        if (!card || !container) return

        const cr = card.getBoundingClientRect()
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

        const rows = container.querySelectorAll(':scope > [data-substat]')
        let dropIdx = rows.length
        rows.forEach((row, i) => {
            const r = row.getBoundingClientRect()
            if (e.clientY < r.top + r.height / 2 && dropIdx === rows.length) dropIdx = i
        })
        dragState = { ...dragState, outside: false, dropIdx }
    }

    function onDragEnd(_e: PointerEvent, ci: number, si: number, idx: number) {
        if (!dragState) return
        if (dragState.outside) {
            handleRemoveSubstat(ci, si, idx)
        } else if (dragState.dropIdx !== idx) {
            handleMoveSubstat(ci, si, idx, dragState.dropIdx)
        }
        dragState = null
    }
</script>

<div
    data-sf="content"
    class="theme-glass-surface flex h-full flex-col p-5 {className}"
    style="color: var(--theme-modal-text); {styleProp || ''}"
>
    <!-- Tabs -->
    <div class="mb-4 flex gap-2 border-b pb-2.5" style="border-color: var(--theme-divider-border);">
        {#each TAB_LABELS as label, i}
            {@const isActive = i < 3 ? activeTab === `char${i}` : activeTab === 'enemy'}
            <button
                onclick={() => {
                    activeTab = i < 3 ? (`char${i}` as 'char0' | 'char1' | 'char2') : 'enemy'
                    closeMainStatMenu()
                    showSubstatModal = null
                }}
                class={[
                    'rounded-none border px-3 py-1.5 text-xs font-black tracking-tight transition-colors flex items-center gap-2',
                    isActive && i < 3 && 'border-current',
                    isActive &&
                        i >= 3 &&
                        'border-(--theme-divider-border) bg-(--theme-modal-text)/10 text-(--theme-modal-text)',
                    !isActive &&
                        'border-transparent text-(--theme-modal-text)/40 hover:border-(--theme-divider-border) hover:text-(--theme-modal-text)/70'
                ].join(' ')}
                style={isActive && i < 3
                    ? `background: color-mix(in srgb, ${elementColor(charNames[i] ?? '')} 18%, transparent); color: ${elementColor(charNames[i] ?? '')};`
                    : ''}
            >
                {#if i < 3 && charNames[i]}
                    {#if charIcons[charNames[i]]}
                        <img
                            src={charIcons[charNames[i]]}
                            alt=""
                            use:fallbackIcon={'/icons/placeholder-character.svg'}
                            class="size-5 rounded-full shrink-0"
                        />
                    {:else}
                        <div
                            class="size-5 rounded-full bg-(--theme-modal-text)/10 flex items-center justify-center text-[10px] shrink-0"
                        >
                            {charNames[i]!.charAt(0)}
                        </div>
                    {/if}
                    <span>{charNames[i]}</span>
                    <span class="text-[10px] opacity-50">({charCostStrings[i]})</span>
                {:else if i === 3}
                    <Icon icon="mdi:skull-outline" class="size-4 shrink-0" />
                    {label}
                {:else}
                    {label}
                {/if}
            </button>
        {/each}
    </div>

    <!-- Content -->
    {#if activeTab === 'enemy'}
        <div class="flex-1 overflow-y-auto">
            <EnemyPanel />
        </div>
    {:else}
        {@const ci = parseInt(activeTab.replace('char', ''))}
        <div class="flex flex-col flex-1 min-h-0">
            <div class="relative flex-1 min-h-0">
                <div
                    class="flex flex-wrap content-start gap-4 overflow-y-auto pb-2 hide-scrollbar absolute inset-0"
                    onscroll={closeMainStatMenu}
                >
                    {#each config.characters[ci].echoes as slot, si}
                        <EchoSlotCard
                            class="w-72 shrink-0"
                            {slot}
                            otherCost={config.characters[ci].echoes.reduce(
                                (sum, e, i) => sum + (i === si ? 0 : e.cost),
                                0
                            )}
                            mainStatTriggerKey={`${ci}:${si}`}
                            oncost={(c) => handleSetCost(ci, si, c)}
                            onmainstat={() => toggleMainStatMenu(ci, si)}
                            onclearsubstats={() => handleClearSubstats(ci, si)}
                            onaddsubstat={() =>
                                (showSubstatModal =
                                    showSubstatModal?.ci === ci && showSubstatModal?.si === si ? null : { ci, si })}
                            onsubstatvalue={(idx, value) => handleUpdateSubstatValue(ci, si, idx, value)}
                            onenhance={() => (showEnhanceModal = { ci, si })}
                            dragIndex={dragState?.ci === ci && dragState?.si === si ? dragState.idx : null}
                            dropIndex={dragState?.ci === ci && dragState?.si === si ? dragState.dropIdx : null}
                            dragOutside={dragState?.outside ?? false}
                            ondragstart={(e, idx) => startDrag(e, ci, si, idx)}
                            ondragmove={onDragMove}
                            ondragend={(e, idx) => onDragEnd(e, ci, si, idx)}
                        />
                    {/each}
                </div>
            </div>
        </div>
    {/if}

    <!-- Main stat selector popup -->
    {#if showMainStatMenu && mainStatMenuData}
        {@const menu = showMainStatMenu}
        {@const slot = mainStatMenuData}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            bind:this={mainStatOverlayEl}
            class="fixed inset-0 z-50"
            role="presentation"
            onclick={closeMainStatMenu}
            onkeydown={(e) => e.key === 'Escape' && closeMainStatMenu()}
        >
            <div
                bind:this={mainStatMenuEl}
                class="animate-pop-in theme-scrollbar absolute max-h-48 overflow-y-auto rounded-none border py-1 backdrop-blur-xl"
                style="left: {mainStatMenuPos?.left ?? 0}px; top: {mainStatMenuPos?.top ??
                    0}px; width: {mainStatMenuPos?.width ??
                    0}px; background: color-mix(in srgb, var(--theme-modal-bg) 82%, transparent); border-color: var(--theme-divider-border);"
                onclick={(e) => e.stopPropagation()}
            >
                <button
                    onclick={() => handleSetMainStat(menu.ci, menu.si, null)}
                    class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-(--theme-modal-text)/40 transition-colors hover:bg-(--theme-input-bg)"
                    >未选择</button
                >
                {#each (MAIN_STAT_POOL as Record<string, { label: string; maxValue: number; unit: string }[]>)[slot.cost] || [] as opt}
                    <button
                        onclick={() =>
                            handleSetMainStat(menu.ci, menu.si, {
                                type: opt.label,
                                value: opt.maxValue,
                                unit: opt.unit
                            })}
                        class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-(--theme-modal-text) transition-colors hover:bg-(--theme-input-bg)"
                    >
                        <span class="flex-1 font-black">{opt.label}</span>
                        <span class="font-black text-(--theme-modal-text)/40">{opt.maxValue}{opt.unit}</span>
                        {#if slot.mainStat?.type === opt.label}<Icon
                                icon="mdi:check"
                                class="size-3 text-(--theme-accent-text)"
                            />{/if}
                    </button>
                {/each}
            </div>
        </div>
    {/if}

    <!-- Substat selector modal -->
    <SubstatPickerModal
        open={showSubstatModal !== null}
        existingTypes={showSubstatModal
            ? config.characters[showSubstatModal.ci].echoes[showSubstatModal.si].substats.map((s) => s.type)
            : []}
        onpick={(label) => {
            if (showSubstatModal) handleAddSubstat(showSubstatModal.ci, showSubstatModal.si, label)
            showSubstatModal = null
        }}
        onclose={() => (showSubstatModal = null)}
    />

    <!-- Random enhance modal -->
    {#if showEnhanceModal}
        {@const em = showEnhanceModal}
        {@const emSlot = config.characters[em.ci].echoes[em.si]}
        <RandomEnhanceModal
            existingTypes={emSlot.substats.map((s) => s.type)}
            onclose={() => (showEnhanceModal = null)}
            onresult={handleEnhanceResult(em.ci, em.si)}
        />
    {/if}
</div>

<style>
    .hide-scrollbar {
        scrollbar-width: none;
        -ms-overflow-style: none;
    }
    .hide-scrollbar::-webkit-scrollbar {
        display: none;
    }
</style>
