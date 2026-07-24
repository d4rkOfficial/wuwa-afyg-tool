<script lang="ts">
    import {
        init,
        getConfig,
        getEchoSlot,
        setEchoCost,
        setMainStat,
        addSubstat,
        removeSubstat,
        updateSubstatValue,
        getCalcState
    } from './config.store.svelte'
    import { RESISTANCE_KEYS } from './config.consts'
    import { MAIN_STAT_POOL, SECOND_MAIN_STAT, SUBSTAT_OPTIONS } from '$lib/consts/stat-data'
    import { simulateEnhancement } from '$lib/consts/substat-roll-data'
    import { addToast } from '$lib/data/toast.svelte'
    import type { CharSlot } from '$lib/data/types'
    import type { ConfigState } from './config.types'
    import { getCharIconMap, elementColor } from '../timeline/timeline.store.svelte'
    import EnemyPanel from './enemy-panel.svelte'
    import RandomEnhanceModal from './random-enhance-modal.svelte'
    import Icon from '@iconify/svelte'

    interface Props {
        team: [CharSlot, CharSlot, CharSlot]
        data: ConfigState | null
        locked?: boolean
        onupdate: (state: ConfigState) => void
    }

    let { team, data, locked = false, onupdate }: Props = $props()

    let activeTab = $state<'char0' | 'char1' | 'char2' | 'enemy'>('char0')
    let showMainStatMenu = $state<{ ci: number; si: number } | null>(null)
    let showSubstatModal = $state<{ ci: number; si: number } | null>(null)
    let showEnhanceModal = $state<{ ci: number; si: number } | null>(null)

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

    function costColor(cost: number): string {
        if (cost === 4) return '#ef4444'
        if (cost === 3) return '#ca8a04'
        return '#22c55e'
    }
    function costBorder(cost: number): string {
        if (cost === 4) return 'border-red-500/40'
        if (cost === 3) return 'border-yellow-600/40'
        return 'border-green-500/40'
    }
    function costLabel(cost: number): string {
        if (cost === 4) return 'text-red-600'
        if (cost === 3) return 'text-yellow-700'
        return 'text-green-600'
    }
    function costBtnCls(cost: number): string {
        if (cost === 4) return 'bg-red-500/15 text-red-500'
        if (cost === 3) return 'bg-yellow-500/15 text-yellow-600'
        return 'bg-green-500/15 text-green-600'
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
        showMainStatMenu = null
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

    function getTierIndex(option: (typeof SUBSTAT_OPTIONS)[number], value: number): number {
        if (value <= 0) return -1
        let closest = 0
        for (let i = 0; i < option.tiers.length; i++) {
            if (Math.abs(option.tiers[i] - value) < Math.abs(option.tiers[closest] - value)) closest = i
        }
        return closest
    }
</script>

<div class="flex h-full flex-col p-5" style="background: var(--theme-modal-bg); color: var(--theme-modal-text)">
    <!-- Tabs -->
    <div class="flex gap-1 mb-4 border-b" style="border-color: var(--theme-divider-border)">
        {#each TAB_LABELS as label, i}
            <button
                onclick={() => {
                    activeTab = i < 3 ? (`char${i}` as 'char0' | 'char1' | 'char2') : 'enemy'
                    showMainStatMenu = null
                    showSubstatModal = null
                }}
                class={[
                    'px-3 py-2 text-xs font-medium transition-colors relative flex items-center gap-2',
                    (i < 3 ? activeTab === `char${i}` : activeTab === 'enemy')
                        ? 'text-[var(--theme-accent-text)]'
                        : 'text-[var(--theme-modal-text)]/50 hover:text-[var(--theme-modal-text)]/70'
                ].join(' ')}
            >
                {#if i < 3 && charNames[i]}
                    {#if charIcons[charNames[i]]}
                        <img src={charIcons[charNames[i]]} alt="" class="size-6 rounded-full shrink-0" />
                    {:else}
                        <div
                            class="size-6 rounded-full bg-[var(--theme-modal-text)]/10 flex items-center justify-center text-[10px] shrink-0"
                        >
                            {charNames[i]!.charAt(0)}
                        </div>
                    {/if}
                    <span style="color: {elementColor(charNames[i])}">{charNames[i]}</span>
                    <span class="text-[10px] text-[var(--theme-modal-text)]/40">({charCostStrings[i]})</span>
                {:else if i === 3}
                    {label}
                {:else}
                    {label}
                {/if}
                {#if i < 3 && activeTab === `char${i}`}
                    <div class="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-[var(--theme-accent-bg)]"></div>
                {/if}
                {#if i === 3 && activeTab === 'enemy'}
                    <div class="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-[var(--theme-accent-bg)]"></div>
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
        <div class="flex-1 overflow-y-auto">
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {#each config.characters[ci].echoes as slot, si}
                    {@const second = SECOND_MAIN_STAT[slot.cost as keyof typeof SECOND_MAIN_STAT]}
                    <div
                        class={['rounded-xl border p-4', costBorder(slot.cost)].join(' ')}
                        style="background: linear-gradient(135deg, transparent 0%, color-mix(in srgb, {costColor(
                            slot.cost
                        )} 15%, transparent) 100%);"
                    >
                        <!-- Cost selector -->
                        <div class="flex items-center justify-between mb-3">
                            <div class="flex items-center gap-1">
                                <span class={['text-sm font-medium', costLabel(slot.cost)].join(' ')}
                                    >声骸 {si + 1}</span
                                >
                                <button
                                    onclick={() => handleClearSubstats(ci, si)}
                                    class="rounded p-0.5 text-[var(--theme-muted-text)] transition-colors hover:text-red-500"
                                >
                                    <Icon icon="mdi:refresh" class="size-3.5" />
                                </button>
                            </div>
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
                                                : 'bg-[var(--theme-input-bg)] text-[var(--theme-modal-text)]/40 hover:bg-[var(--theme-modal-text)]/10'
                                        ].join(' ')}>{c} COST</button
                                    >
                                {/each}
                            </div>
                        </div>

                        <!-- Main stat -->
                        <div class="mb-2">
                            <span class="text-[10px] text-[var(--theme-modal-text)]/40 block mb-1">主词条</span>
                            <div class="relative z-20">
                                <button
                                    onclick={() =>
                                        (showMainStatMenu =
                                            showMainStatMenu?.ci === ci && showMainStatMenu?.si === si
                                                ? null
                                                : { ci, si })}
                                    class="w-full flex items-center justify-between rounded border px-2 py-1 text-xs text-[var(--theme-modal-text)] transition-colors hover:bg-[var(--theme-modal-text)]/10"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    <span
                                        >{slot.mainStat
                                            ? slot.mainStat.type + ' ' + slot.mainStat.value + slot.mainStat.unit
                                            : '未选择'}</span
                                    >
                                    <Icon icon="mdi:chevron-down" class="size-3 text-[var(--theme-modal-text)]/40" />
                                </button>
                                {#if showMainStatMenu?.ci === ci && showMainStatMenu?.si === si}
                                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                                    <div
                                        class="absolute left-0 top-full mt-1 w-full max-h-48 overflow-y-auto rounded-lg border py-1 shadow-xl backdrop-blur-lg"
                                        style="background: color-mix(in srgb, var(--theme-modal-bg) 85%, transparent); border-color: var(--theme-divider-border);"
                                        onclick={(e) => e.stopPropagation()}
                                    >
                                        <button
                                            onclick={() => handleSetMainStat(ci, si, null)}
                                            class="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left text-[var(--theme-modal-text)]/40 transition-colors hover:bg-[var(--theme-input-bg)]"
                                            >未选择</button
                                        >
                                        {#each (MAIN_STAT_POOL as Record<string, { label: string; maxValue: number; unit: string }[]>)[slot.cost] || [] as opt}
                                            <button
                                                onclick={() =>
                                                    handleSetMainStat(ci, si, {
                                                        type: opt.label,
                                                        value: opt.maxValue,
                                                        unit: opt.unit
                                                    })}
                                                class="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left text-[var(--theme-modal-text)] transition-colors hover:bg-[var(--theme-input-bg)]"
                                            >
                                                <span class="flex-1">{opt.label}</span>
                                                <span class="text-[var(--theme-modal-text)]/40"
                                                    >{opt.maxValue}{opt.unit}</span
                                                >
                                                {#if slot.mainStat?.type === opt.label}<Icon
                                                        icon="mdi:check"
                                                        class="size-3 text-[var(--theme-accent-text)]"
                                                    />{/if}
                                            </button>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        </div>

                        <!-- Second main stat -->
                        {#if second}
                            <div class="flex items-center gap-2 mb-2 text-xs">
                                <span class="text-[var(--theme-modal-text)]/40">副属性</span>
                                <span class="text-[var(--theme-modal-text)]/70">{second.label} +{second.value}</span>
                            </div>
                        {/if}

                        <!-- Substats -->
                        <div>
                            <span class="text-[10px] text-[var(--theme-modal-text)]/40 block mb-1"
                                >副词条 ({slot.substats.length}/5)</span
                            >
                            <div class="space-y-1">
                                {#each slot.substats as sub, idx}
                                    {@const opt = SUBSTAT_OPTIONS.find((o) => o.label === sub.type)}
                                    {#if opt}
                                        {@const tierIdx = getTierIndex(opt, sub.value)}
                                        {@const maxTier = opt.tiers.length - 1}
                                        {@const pct = tierIdx > 0 ? (tierIdx / maxTier) * 100 : 0}
                                        <div
                                            class="flex items-center gap-2 rounded px-2 py-1.5"
                                            style="background: var(--theme-input-bg);"
                                        >
                                            <span class="text-xs text-[var(--theme-modal-text)]/70 w-20 shrink-0 mr-2"
                                                >{sub.type}</span
                                            >
                                            <div class="relative flex-1 h-5">
                                                <div
                                                    class="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-[var(--theme-modal-text)]/10"
                                                >
                                                    <div
                                                        class="h-full rounded-full"
                                                        style="width: {pct}%; background: var(--theme-accent-bg)"
                                                    ></div>
                                                </div>
                                                <div
                                                    class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap pointer-events-none z-10"
                                                    style="left: {pct}%; background: var(--theme-accent-bg); color: var(--theme-btn-text);"
                                                >
                                                    {sub.value}{opt.unit}
                                                </div>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max={maxTier}
                                                    value={tierIdx > 0 ? tierIdx : 0}
                                                    oninput={(e) => {
                                                        const idx2 = parseInt((e.target as HTMLInputElement).value)
                                                        handleUpdateSubstatValue(ci, si, idx, opt.tiers[idx2])
                                                    }}
                                                    class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-0"
                                                />
                                            </div>
                                            <button
                                                onclick={() => handleRemoveSubstat(ci, si, idx)}
                                                class="shrink-0 rounded p-0.5 ml-2 text-[var(--theme-muted-text)] transition-colors hover:text-red-600"
                                            >
                                                <Icon icon="mdi:close" class="size-3" />
                                            </button>
                                        </div>
                                    {/if}
                                {/each}
                            </div>
                            {#if slot.substats.length === 0}
                                <div class="mt-1 flex gap-2">
                                    <button
                                        onclick={() =>
                                            (showSubstatModal =
                                                showSubstatModal?.ci === ci && showSubstatModal?.si === si
                                                    ? null
                                                    : { ci, si })}
                                        class="flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--theme-accent-text)] transition-colors hover:bg-[var(--theme-input-bg)]"
                                    >
                                        <Icon icon="mdi:plus" class="size-3" />
                                        选择副词条
                                    </button>
                                    <button
                                        onclick={() => (showEnhanceModal = { ci, si })}
                                        class="flex items-center gap-1 rounded px-2 py-1 text-xs text-emerald-600 transition-colors hover:bg-[var(--theme-input-bg)]"
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
                                        class="flex items-center gap-1 rounded px-2 py-1 text-xs text-[var(--theme-accent-text)] transition-colors hover:bg-[var(--theme-input-bg)]"
                                    >
                                        <Icon icon="mdi:plus" class="size-3" />
                                        选择副词条
                                    </button>
                                </div>
                            {/if}
                        </div>
                    </div>
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
            class="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
            onclick={() => (showSubstatModal = null)}
        >
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
                class="w-72 max-h-80 rounded-xl border p-4 shadow-2xl backdrop-blur-lg"
                style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); border-color: var(--theme-divider-border);"
                onclick={(e) => e.stopPropagation()}
            >
                <div class="flex items-center justify-between mb-3">
                    <span class="text-sm font-medium text-[var(--theme-modal-text)]">选择副词条</span>
                    <button
                        onclick={() => (showSubstatModal = null)}
                        class="rounded p-0.5 text-[var(--theme-modal-text)]/40 transition-colors hover:text-[var(--theme-modal-text)]/70"
                    >
                        <Icon icon="mdi:close" class="size-4" />
                    </button>
                </div>
                <div class="space-y-0.5 max-h-56 overflow-y-auto">
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
                                    ? 'text-[var(--theme-modal-text)]/20 cursor-not-allowed'
                                    : 'text-[var(--theme-modal-text)] hover:bg-[var(--theme-input-bg)]'
                            ].join(' ')}
                        >
                            <span class="flex-1">{opt.label}</span>
                            <span class="text-[10px] text-[var(--theme-modal-text)]/40">{opt.unit}</span>
                            {#if exists}
                                <Icon icon="mdi:check" class="size-3 shrink-0 text-[var(--theme-accent-text)]" />
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
