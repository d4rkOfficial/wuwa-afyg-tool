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
    import { totalCost, RESISTANCE_KEYS } from './config.consts'
    import { MAIN_STAT_POOL, SECOND_MAIN_STAT, SUBSTAT_OPTIONS } from '$lib/consts/stat-data'
    import type { CharSlot } from '$lib/data/types'
    import type { ConfigState } from './config.types'
    import EnemyPanel from './enemy-panel.svelte'
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
    let showSubstatMenu = $state<{ ci: number; si: number } | null>(null)
    let substatMenuDir = $state<'down' | 'up'>('down')
    let substatMenuRect = $state<{ top: number; bottom: number; left: number } | null>(null)

    $effect(() => {
        init(data, locked)
    })

    let config = $derived(getConfig())
    let charNames = $derived(team.map((s) => s.character).filter((c): c is string => c !== null))

    const TAB_LABELS = ['角色1', '角色2', '角色3', '敌人配置']
    const COST_OPTIONS = [4, 3, 1]

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
        const slots = config.characters[ci].echoes[si]
        if (slots.substats.length >= 5) showSubstatMenu = null
        onupdate(getCalcState())
    }

    function handleRemoveSubstat(ci: number, si: number, idx: number) {
        removeSubstat(ci, si, idx)
        onupdate(getCalcState())
    }

    function handleUpdateSubstatValue(ci: number, si: number, idx: number, value: number) {
        updateSubstatValue(ci, si, idx, value)
        onupdate(getCalcState())
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
    <div class="flex gap-1 mb-4 border-b border-white/10">
        {#each TAB_LABELS as label, i}
            <button
                onclick={() => {
                    activeTab = i < 3 ? (`char${i}` as const) : 'enemy'
                    showMainStatMenu = null
                    showSubstatMenu = null
                }}
                class={[
                    'px-4 py-2 text-xs font-medium transition-colors relative',
                    (i < 3 ? activeTab === `char${i}` : activeTab === 'enemy')
                        ? 'text-indigo-300'
                        : 'text-[var(--theme-modal-text)]/50 hover:text-[var(--theme-modal-text)]/70'
                ].join(' ')}
            >
                {label}
                {#if i < 3 && charNames[i]}
                    <span class="text-[10px] text-[var(--theme-modal-text)]/40 ml-1">({charNames[i]})</span>
                {/if}
                {#if i < 3 && activeTab === `char${i}`}
                    <div class="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-indigo-500"></div>
                {/if}
                {#if i === 3 && activeTab === 'enemy'}
                    <div class="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-indigo-500"></div>
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
                    <div class="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                        <!-- Cost selector -->
                        <div class="flex items-center justify-between mb-3">
                            <span class="text-xs font-medium text-[var(--theme-modal-text)]/60">声骸 {si + 1}</span>
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
                                            'w-7 h-6 rounded text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed',
                                            slot.cost === c
                                                ? 'bg-indigo-500/15 text-indigo-300'
                                                : 'bg-white/5 text-[var(--theme-modal-text)]/40 hover:bg-white/10'
                                        ].join(' ')}>C{c}</button
                                    >
                                {/each}
                            </div>
                        </div>

                        <!-- Cost total -->
                        <div class="text-[10px] text-[var(--theme-modal-text)]/30 mb-3">
                            合计: {totalCost(config.characters[ci].echoes)}/12
                        </div>

                        <!-- Second main stat -->
                        {#if second}
                            <div class="flex items-center gap-2 mb-2 text-xs">
                                <span class="text-[var(--theme-modal-text)]/40">副属性</span>
                                <span class="text-[var(--theme-modal-text)]/70">{second.label} +{second.value}</span>
                            </div>
                        {/if}

                        <!-- Main stat -->
                        <div class="mb-3">
                            <span class="text-[10px] text-[var(--theme-modal-text)]/40 block mb-1">主词条</span>
                            <div class="relative">
                                <button
                                    onclick={() =>
                                        (showMainStatMenu =
                                            showMainStatMenu?.ci === ci && showMainStatMenu?.si === si
                                                ? null
                                                : { ci, si })}
                                    class="w-full flex items-center justify-between rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-[var(--theme-modal-text)] transition-colors hover:bg-white/10"
                                >
                                    <span
                                        >{slot.mainStat
                                            ? slot.mainStat.type + ' ' + slot.mainStat.value + slot.mainStat.unit
                                            : '未选择'}</span
                                    >
                                    <svg
                                        class="size-3 text-[var(--theme-modal-text)]/40"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        stroke-width="2"><path d="M6 9l6 6 6-6" /></svg
                                    >
                                </button>
                                {#if showMainStatMenu?.ci === ci && showMainStatMenu?.si === si}
                                    <div
                                        class="absolute left-0 top-full z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-[var(--theme-modal-bg)] py-1 shadow-xl backdrop-blur-lg"
                                        onclick={(e) => e.stopPropagation()}
                                    >
                                        <button
                                            onclick={() => handleSetMainStat(ci, si, null)}
                                            class="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left text-[var(--theme-modal-text)]/40 transition-colors hover:bg-white/5"
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
                                                class="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left text-[var(--theme-modal-text)] transition-colors hover:bg-white/5"
                                            >
                                                <span class="flex-1">{opt.label}</span>
                                                <span class="text-[var(--theme-modal-text)]/40"
                                                    >{opt.maxValue}{opt.unit}</span
                                                >
                                                {#if slot.mainStat?.type === opt.label}<svg
                                                        class="size-3 text-indigo-400"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        stroke-width="3"><path d="M5 13l4 4L19 7" /></svg
                                                    >{/if}
                                            </button>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        </div>

                        <!-- Substats -->
                        <div>
                            <span class="text-[10px] text-[var(--theme-modal-text)]/40 block mb-1"
                                >副词条 ({slot.substats.length}/5)</span
                            >
                            <div class="space-y-1">
                                {#each slot.substats as sub, idx}
                                    {@const opt = SUBSTAT_OPTIONS.find((o) => o.label === sub.type)}
                                    {#if opt}
                                        <div class="flex items-center gap-2 rounded bg-white/5 px-2 py-1.5">
                                            <span class="text-xs text-[var(--theme-modal-text)]/70 w-16 shrink-0"
                                                >{sub.type}</span
                                            >
                                            <input
                                                type="range"
                                                min="0"
                                                max={opt.tiers.length - 1}
                                                value={getTierIndex(opt, sub.value) > 0
                                                    ? getTierIndex(opt, sub.value)
                                                    : 0}
                                                oninput={(e) => {
                                                    const idx2 = parseInt((e.target as HTMLInputElement).value)
                                                    handleUpdateSubstatValue(ci, si, idx, opt.tiers[idx2])
                                                }}
                                                class="flex-1 h-1.5 appearance-none cursor-pointer rounded-full accent-indigo-500 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-500"
                                            />
                                            <span
                                                class="text-xs tabular-nums text-[var(--theme-modal-text)]/50 w-12 text-right"
                                                >{sub.value}{opt.unit}</span
                                            >
                                            <button
                                                onclick={() => handleRemoveSubstat(ci, si, idx)}
                                                class="shrink-0 rounded p-0.5 text-zinc-500 transition-colors hover:text-red-400"
                                            >
                                                <Icon icon="mdi:close" class="size-3" />
                                            </button>
                                        </div>
                                    {/if}
                                {/each}
                            </div>
                            {#if slot.substats.length < 5}
                                <div class="mt-1">
                                    <button
                                        onclick={(e) => {
                                            const next =
                                                showSubstatMenu?.ci === ci && showSubstatMenu?.si === si
                                                    ? null
                                                    : { ci, si }
                                            if (next) {
                                                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                                                substatMenuRect = { top: r.top, bottom: r.bottom, left: r.left }
                                                substatMenuDir = window.innerHeight - r.bottom - 8 < 300 ? 'up' : 'down'
                                            }
                                            showSubstatMenu = next
                                        }}
                                        class="flex items-center gap-1 rounded px-2 py-1 text-xs text-indigo-400 transition-colors hover:bg-white/5"
                                    >
                                        <Icon
                                            icon={showSubstatMenu?.ci === ci && showSubstatMenu?.si === si
                                                ? 'mdi:chevron-up'
                                                : 'mdi:plus'}
                                            class="size-3"
                                        />
                                        {showSubstatMenu?.ci === ci && showSubstatMenu?.si === si
                                            ? '收起'
                                            : '添加副词条'}
                                    </button>
                                    {#if showSubstatMenu?.ci === ci && showSubstatMenu?.si === si && substatMenuRect}
                                        <div
                                            class="fixed z-20 min-w-40 max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-[var(--theme-modal-bg)] py-1 shadow-xl backdrop-blur-lg"
                                            style={substatMenuDir === 'up'
                                                ? `bottom: ${window.innerHeight - substatMenuRect.top + 4}px; left: ${substatMenuRect.left}px`
                                                : `top: ${substatMenuRect.bottom + 4}px; left: ${substatMenuRect.left}px`}
                                            onclick={(e) => e.stopPropagation()}
                                        >
                                            {#each SUBSTAT_OPTIONS as opt}
                                                {@const exists = slot.substats.some((s) => s.type === opt.label)}
                                                <button
                                                    onclick={() => !exists && handleAddSubstat(ci, si, opt.label)}
                                                    disabled={exists}
                                                    class={[
                                                        'flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                                                        exists
                                                            ? 'text-[var(--theme-modal-text)]/20 cursor-not-allowed'
                                                            : 'text-[var(--theme-modal-text)] hover:bg-white/5'
                                                    ].join(' ')}
                                                >
                                                    <span class="flex-1">{opt.label}</span>
                                                    <span class="text-[10px] text-[var(--theme-modal-text)]/40"
                                                        >{opt.unit}</span
                                                    >
                                                    {#if exists}<svg
                                                            class="size-3 text-indigo-400"
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            stroke="currentColor"
                                                            stroke-width="3"><path d="M5 13l4 4L19 7" /></svg
                                                        >{/if}
                                                </button>
                                            {/each}
                                        </div>
                                    {/if}
                                </div>
                            {/if}
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    {/if}
</div>
