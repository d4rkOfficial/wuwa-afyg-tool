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
        const card = el.closest('.rounded-xl') as HTMLElement | null
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
    class="theme-glass-surface flex h-full flex-col p-5 {className}"
    style="background: var(--theme-modal-bg); color: var(--theme-modal-text); {styleProp || ''}"
>
    <!-- Tabs -->
    <div class="flex gap-2 mb-4">
        {#each TAB_LABELS as label, i}
            {@const isActive = i < 3 ? activeTab === `char${i}` : activeTab === 'enemy'}
            <button
                onclick={() => {
                    activeTab = i < 3 ? (`char${i}` as 'char0' | 'char1' | 'char2') : 'enemy'
                    closeMainStatMenu()
                    showSubstatModal = null
                }}
                class={[
                    'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-2',
                    isActive && i >= 3 && 'bg-(--theme-modal-text)/10 text-(--theme-modal-text)',
                    !isActive && 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'
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
                        {@const second = SECOND_MAIN_STAT[slot.cost as keyof typeof SECOND_MAIN_STAT]}
                        <div
                            class="relative rounded-xl shrink-0 w-72"
                            style="background: linear-gradient(135deg, transparent 0%, color-mix(in srgb, var(--theme-modal-text) 6%, transparent) 100%);"
                        >
                            <!-- COST overlay -->
                            <div
                                class="pointer-events-none absolute inset-0 flex select-none items-center justify-center overflow-hidden"
                            >
                                <span
                                    class="text-[200px] font-black leading-none opacity-[0.06] text-(--theme-accent-text)"
                                    >{slot.cost}</span
                                >
                            </div>

                            <div class="relative z-1 p-4">
                                <!-- Cost selector -->
                                <div class="flex items-center justify-between mb-3">
                                    <button
                                        onclick={() => handleClearSubstats(ci, si)}
                                        class="rounded p-0.5 text-(--theme-muted-text) transition-colors hover:text-red-500"
                                    >
                                        <Icon icon="mdi:refresh" class="size-3.5" />
                                    </button>
                                    <div class="flex gap-1">
                                        {#each COST_OPTIONS as c}
                                            <button
                                                onclick={() => handleSetCost(ci, si, c)}
                                                disabled={c !== slot.cost &&
                                                    !(() => {
                                                        const other = config.characters[ci].echoes.reduce(
                                                            (s, e, i) => s + (i === si ? 0 : e.cost),
                                                            0
                                                        )
                                                        return other + c <= 12
                                                    })()}
                                                class={[
                                                    'min-w-7 px-2 h-6 rounded text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed',
                                                    slot.cost === c
                                                        ? costBtnCls(slot.cost)
                                                        : 'bg-(--theme-input-bg) text-(--theme-modal-text)/40 hover:bg-(--theme-modal-text)/10'
                                                ].join(' ')}>{c} COST</button
                                            >
                                        {/each}
                                    </div>
                                </div>

                                <!-- Main stat + second stat combined -->
                                <div class="relative z-20 mb-2">
                                    <button
                                        data-main-stat-trigger={`${ci}:${si}`}
                                        onclick={() => toggleMainStatMenu(ci, si)}
                                        class="w-full rounded border px-3 py-2 transition-colors hover:bg-(--theme-modal-text)/10"
                                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                    >
                                        <div class="flex items-center justify-between">
                                            <div class="flex flex-col text-left">
                                                <span class="text-sm font-medium text-(--theme-modal-text)">
                                                    {slot.mainStat
                                                        ? shortLabel(slot.mainStat.type) +
                                                          ' ' +
                                                          slot.mainStat.value +
                                                          slot.mainStat.unit
                                                        : '未选择'}
                                                </span>
                                                {#if second}
                                                    <span class="text-xs text-(--theme-modal-text)/60"
                                                        >{second.label} +{second.value}</span
                                                    >
                                                {/if}
                                            </div>
                                            <Icon
                                                icon="mdi:chevron-down"
                                                class="size-3.5 text-(--theme-modal-text)/40 shrink-0"
                                            />
                                        </div>
                                    </button>
                                </div>

                                <!-- Substats -->
                                <div>
                                    <span class="text-[10px] text-(--theme-modal-text)/40 block mb-1"
                                        >副词条 ({slot.substats.length}/5)</span
                                    >
                                    <div class="space-y-1">
                                        {#each slot.substats as sub, idx (sub.type)}
                                            {@const opt = SUBSTAT_OPTIONS.find((o) => o.label === sub.type)}
                                            {#if opt}
                                                {@const tierIdx = getTierIndex(opt, sub.value)}
                                                {@const maxTier = opt.tiers.length - 1}
                                                {@const pct = tierIdx > 0 ? (tierIdx / maxTier) * 100 : 0}
                                                {@const isDragged =
                                                    dragState?.ci === ci &&
                                                    dragState?.si === si &&
                                                    dragState?.idx === idx}
                                                {#if dragState?.ci === ci && dragState?.si === si && !dragState?.outside && dragState?.dropIdx === idx}
                                                    <div class="h-0.5 rounded-full bg-(--theme-accent-bg)"></div>
                                                {/if}
                                                <!-- svelte-ignore a11y_no_static_element_interactions -->
                                                <div
                                                    data-substat
                                                    role="listitem"
                                                    transition:slide={{ duration: 200 }}
                                                    class={[
                                                        'flex items-center gap-2 rounded px-2 py-1.5 transition-all touch-none',
                                                        'cursor-grab active:cursor-grabbing',
                                                        isDragged &&
                                                            !dragState?.outside &&
                                                            'ring-2 ring-(--theme-accent-bg)',
                                                        isDragged &&
                                                            dragState?.outside &&
                                                            'ring-2 ring-red-500 opacity-50'
                                                    ].join(' ')}
                                                    style="background: var(--theme-input-bg);"
                                                    onpointerdown={(e) => startDrag(e, ci, si, idx)}
                                                    onpointermove={onDragMove}
                                                    onpointerup={(e) => onDragEnd(e, ci, si, idx)}
                                                >
                                                    <span
                                                        class="text-xs text-(--theme-modal-text)/70 w-20 shrink-0 mr-2"
                                                        >{shortLabel(sub.type)}</span
                                                    >
                                                    <div class="relative flex-1 h-5">
                                                        <div
                                                            class="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-(--theme-modal-text)/10"
                                                        >
                                                            <div
                                                                class="h-full rounded-full"
                                                                style="width: {pct}%; background: var(--theme-accent-bg)"
                                                            ></div>
                                                        </div>
                                                        <div
                                                            class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap pointer-events-none z-10"
                                                            style="left: {pct}%; background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);"
                                                        >
                                                            {sub.value}{opt.unit}
                                                        </div>
                                                        <input
                                                            type="range"
                                                            min="0"
                                                            max={maxTier}
                                                            value={tierIdx > 0 ? tierIdx : 0}
                                                            oninput={(e) => {
                                                                const idx2 = parseInt(
                                                                    (e.target as HTMLInputElement).value
                                                                )
                                                                handleUpdateSubstatValue(ci, si, idx, opt.tiers[idx2])
                                                            }}
                                                            class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-0"
                                                        />
                                                    </div>
                                                </div>
                                            {/if}
                                        {/each}
                                        {#if dragState?.ci === ci && dragState?.si === si && !dragState?.outside && dragState?.dropIdx === slot.substats.length}
                                            <div class="h-0.5 rounded-full bg-(--theme-accent-bg)"></div>
                                        {/if}
                                    </div>
                                    {#if slot.substats.length === 0}
                                        <div class="mt-1 flex gap-2">
                                            <button
                                                onclick={() =>
                                                    (showSubstatModal =
                                                        showSubstatModal?.ci === ci && showSubstatModal?.si === si
                                                            ? null
                                                            : { ci, si })}
                                                class="flex items-center gap-1 rounded px-2 py-1 text-xs text-(--theme-accent-text) transition-colors hover:bg-(--theme-input-bg)"
                                            >
                                                <Icon icon="mdi:plus" class="size-3" />
                                                选择副词条
                                            </button>
                                            <button
                                                onclick={() => (showEnhanceModal = { ci, si })}
                                                class="flex items-center gap-1 rounded px-2 py-1 text-xs text-(--theme-accent-text) transition-colors hover:bg-(--theme-input-bg)"
                                            >
                                                <Icon icon="mdi:dice-5" class="size-3" />
                                                随机强化
                                            </button>
                                        </div>
                                    {:else if slot.substats.length < 5}
                                        <div class="mt-1">
                                            <button
                                                onclick={() =>
                                                    (showSubstatModal =
                                                        showSubstatModal?.ci === ci && showSubstatModal?.si === si
                                                            ? null
                                                            : { ci, si })}
                                                class="flex items-center gap-1 rounded px-2 py-1 text-xs text-(--theme-accent-text) transition-colors hover:bg-(--theme-input-bg)"
                                            >
                                                <Icon icon="mdi:plus" class="size-3" />
                                                选择副词条
                                            </button>
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        </div>
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
                class="animate-pop-in theme-scrollbar absolute max-h-48 overflow-y-auto rounded-lg border py-1 shadow-xl backdrop-blur-xl"
                style="left: {mainStatMenuPos?.left ?? 0}px; top: {mainStatMenuPos?.top ??
                    0}px; width: {mainStatMenuPos?.width ??
                    0}px; background: color-mix(in srgb, var(--theme-modal-bg) 82%, transparent); border-color: var(--theme-divider-border);"
                onclick={(e) => e.stopPropagation()}
            >
                <button
                    onclick={() => handleSetMainStat(menu.ci, menu.si, null)}
                    class="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left text-(--theme-modal-text)/40 transition-colors hover:bg-(--theme-input-bg)"
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
                        class="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left text-(--theme-modal-text) transition-colors hover:bg-(--theme-input-bg)"
                    >
                        <span class="flex-1">{opt.label}</span>
                        <span class="text-(--theme-modal-text)/40">{opt.maxValue}{opt.unit}</span>
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
    {#if showSubstatModal}
        {@const ms = showSubstatModal}
        {@const mSlot = config.characters[ms.ci].echoes[ms.si]}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
            class="animate-fade-in fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
            onclick={() => (showSubstatModal = null)}
        >
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
                class="animate-pop-in w-72 max-h-80 rounded-xl border p-4 shadow-2xl backdrop-blur-lg"
                style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); border-color: var(--theme-divider-border);"
                onclick={(e) => e.stopPropagation()}
            >
                <div class="flex items-center justify-between mb-3">
                    <span class="text-sm font-medium text-(--theme-modal-text)">选择副词条</span>
                    <button
                        onclick={() => (showSubstatModal = null)}
                        class="rounded p-0.5 text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)/70"
                    >
                        <Icon icon="mdi:close" class="size-4" />
                    </button>
                </div>
                <div class="theme-scrollbar space-y-0.5 max-h-56 overflow-y-auto">
                    {#each SUBSTAT_OPTIONS as opt}
                        {@const exists = mSlot.substats.some((s) => s.type === opt.label)}
                        <button
                            onclick={() => {
                                if (!exists) handleAddSubstat(ms.ci, ms.si, opt.label)
                            }}
                            disabled={exists}
                            class={[
                                'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-left transition-colors',
                                exists
                                    ? 'text-(--theme-modal-text)/20 cursor-not-allowed'
                                    : 'text-(--theme-modal-text) hover:bg-(--theme-input-bg)'
                            ].join(' ')}
                        >
                            <span class="flex-1">{opt.label}</span>
                            <span class="text-[10px] text-(--theme-modal-text)/40">{opt.unit}</span>
                            {#if exists}
                                <Icon icon="mdi:check" class="size-3 shrink-0 text-(--theme-accent-text)" />
                            {/if}
                        </button>
                    {/each}
                </div>
            </div>
        </div>
    {/if}

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
