<script lang="ts">
    import type { EchoConfig, Echo, ComponentsProps } from '$lib/types'
    import { resources } from '$lib/data/resources.svelte'
    import SelectorModal, { type SelectorItem } from './SelectorModal.svelte'
    import { MAIN_STAT_POOL, SECOND_MAIN_STAT, SUBSTAT_OPTIONS } from '$lib/consts/stat-data'

    interface Props extends ComponentsProps {
        show: boolean
        slotData: EchoConfig
        slotIndex: number
        echoes: Echo[]
        echoGroups: {
            label: string
            icon?: string
            items: {
                name: string
                subtitle?: string
                badge: number
                badgeColor: string
                color: string
                icon: string
            }[]
        }[]
        echoFilterOptions: { label: string; value: string }[]
        echoFilterValues?: string[]
        filterFn: (item: SelectorItem, values: string[]) => boolean
        echoIconMap: Record<string, string>
        echoSetIconMap: Record<string, string>
        onClose: () => void
    }

    let {
        show,
        slotData,
        slotIndex,
        echoes,
        echoGroups,
        echoFilterOptions,
        echoFilterValues = $bindable(['4', '3', '1']),
        filterFn,
        echoIconMap,
        echoSetIconMap,
        onClose,
        class: className,
        style
    }: Props = $props()

    let showEchoSelector = $state(false)

    const handleKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && !showEchoSelector) onClose()
    }

    const handleBackdrop = (e: MouseEvent) => {
        if ((e.target as HTMLElement).dataset?.modal === 'echo-config-backdrop') onClose()
    }

    const img = (path: string) => resources.icons[path] || ''

    const onEchoSelect = (item: { name: string; meta?: Record<string, string> }) => {
        const found = echoes.find((e) => e.name === item.name)
        if (found) {
            slotData.name = item.name
            slotData.cost = found.cost
            slotData.set = item.meta?.group ?? null
            slotData.mainStat = null
            slotData.secondMainStat = null
            slotData.substats = []
        }
    }

    const setMainStat = (type: string | null) => {
        if (!type || !slotData.cost) {
            slotData.mainStat = null
            return
        }
        const pool = MAIN_STAT_POOL[slotData.cost] ?? []
        const found = pool.find((m) => m.label === type)
        if (found) {
            slotData.mainStat = { type: found.label, value: found.maxValue, unit: found.unit }
        }
    }

    const setSubstatType = (subIdx: number, label: string | null) => {
        const cur = [...slotData.substats]
        const occupied = new Set(cur.map((s) => s.type))
        if (!label) {
            slotData.substats = cur.filter((_, i) => i !== subIdx)
        } else {
            if (occupied.has(label) && cur[subIdx]?.type !== label) return
            const opt = SUBSTAT_OPTIONS.find((o) => o.label === label)
            if (!opt) return
            const val = opt.tiers.length > 0 ? opt.tiers[Math.floor(opt.tiers.length / 2)] : 0
            if (cur[subIdx]) {
                cur[subIdx] = { type: opt.label, value: val, unit: opt.unit }
            } else {
                cur.push({ type: opt.label, value: val, unit: opt.unit })
            }
            slotData.substats = cur
        }
    }

    const costColorFn = (c: number) => {
        const m: Record<number, string> = { 4: '#f87171', 3: '#fbbf24', 1: '#4ade80' }
        return m[c] ?? '#71717a'
    }
    const costTextFn = (c: number) => {
        const m: Record<number, string> = {
            4: 'text-red-400',
            3: 'text-yellow-400',
            1: 'text-green-400'
        }
        return m[c] ?? 'text-zinc-500'
    }
    const costBgFn = (c: number) => {
        const m: Record<number, string> = {
            4: 'bg-red-950/40',
            3: 'bg-yellow-950/40',
            1: 'bg-green-950/40'
        }
        return m[c] ?? 'bg-zinc-800'
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<SelectorModal
    show={showEchoSelector}
    title="选择声骸"
    groups={echoGroups}
    selected={slotData.name}
    onSelect={onEchoSelect}
    onClose={() => (showEchoSelector = false)}
    filterOptions={echoFilterOptions}
    bind:filterValues={echoFilterValues}
    {filterFn}
/>

{#if show}
    <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 {className ?? ''}"
        {style}
        role="button"
        tabindex="-1"
        data-modal="echo-config-backdrop"
        onclick={handleBackdrop}
        onkeydown={handleKeydown}
    >
        <div
            class="mx-4 flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        >
            <div class="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
                <h2 class="text-base font-semibold text-zinc-100">编辑声骸 #{slotIndex + 1}</h2>
                <button
                    class="flex size-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                    onclick={onClose}>✕</button
                >
            </div>

            <div class="flex-1 overflow-y-auto px-5 py-4">
                <!-- Echo selector -->
                <div class="mb-4">
                    <div class="mb-1.5 text-[11px] text-zinc-500">声骸</div>
                    <button
                        class="flex w-full items-center gap-2.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-left transition-colors hover:border-zinc-500"
                        onclick={() => (showEchoSelector = true)}
                    >
                        {#if slotData.name}
                            {@const ei = img(echoIconMap[slotData.name] ?? '')}
                            {#if ei}
                                <img src={ei} alt="" class="size-7 shrink-0 rounded object-contain" />
                            {/if}
                            <span class="text-sm text-zinc-200">{slotData.name}</span>
                            {#if slotData.set}
                                {@const si = img(echoSetIconMap[slotData.set] ?? '')}
                                {#if si}
                                    <img src={si} alt="" class="size-5 shrink-0 rounded object-contain" />
                                {/if}
                                <span class="text-[11px] text-zinc-500">{slotData.set}</span>
                            {/if}
                            <span
                                class="ml-auto rounded px-1.5 py-0.5 text-[10px] font-bold {costTextFn(
                                    slotData.cost
                                )} {costBgFn(slotData.cost)}">{slotData.cost}</span
                            >
                        {:else}
                            <span class="text-sm text-zinc-500">点击选择声骸</span>
                        {/if}
                    </button>
                </div>

                {#if slotData.name && slotData.cost > 0}
                    <div class="grid grid-cols-2 gap-4">
                        <!-- LEFT: Main stat options + substat pool -->
                        <div>
                            <div class="mb-3">
                                <div class="mb-1.5 text-[11px] text-zinc-500">第一主属性</div>
                                <div class="flex flex-col gap-1">
                                    {#each MAIN_STAT_POOL[slotData.cost] ?? [] as opt}
                                        {@const active = slotData.mainStat?.type === opt.label}
                                        <button
                                            class="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition-colors {active
                                                ? 'border-blue-500/50 bg-blue-500/15 text-blue-400'
                                                : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'}"
                                            onclick={() => setMainStat(active ? null : opt.label)}
                                        >
                                            <span>{opt.label}</span>
                                        </button>
                                    {/each}
                                </div>
                            </div>
                            <div>
                                <div class="mb-1.5 text-[11px] text-zinc-500">
                                    副词条（{slotData.substats.length}/5）
                                </div>
                                <div class="flex flex-col gap-1">
                                    {#each SUBSTAT_OPTIONS as opt}
                                        {@const taken = slotData.substats.some((s) => s.type === opt.label)}
                                        <button
                                            class="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition-colors {taken
                                                ? 'border-blue-500/50 bg-blue-500/15 text-blue-400'
                                                : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'}"
                                            onclick={() => {
                                                if (taken) {
                                                    const idx = slotData.substats.findIndex((s) => s.type === opt.label)
                                                    if (idx >= 0) setSubstatType(idx, null)
                                                } else if (slotData.substats.length < 5) {
                                                    setSubstatType(slotData.substats.length, opt.label)
                                                }
                                            }}
                                        >
                                            <span>{opt.label}</span>
                                        </button>
                                    {/each}
                                </div>
                            </div>
                        </div>

                        <!-- RIGHT: Values + substat sliders -->
                        <div>
                            <!-- Selected main stat value -->
                            <div class="mb-3 p-3 rounded-lg bg-zinc-900 border border-zinc-800">
                                {#if slotData.mainStat}
                                    <div class="text-sm font-semibold text-blue-400 tabular-nums">
                                        {slotData.mainStat.type}
                                        <span class="ml-1 text-zinc-300"
                                            >{slotData.mainStat.value}{slotData.mainStat.unit}</span
                                        >
                                    </div>
                                {:else}
                                    <div class="text-xs text-zinc-600">未选择主属性</div>
                                {/if}
                                <!-- Second main stat -->
                                <div class="mt-1.5 text-xs text-zinc-500">
                                    +{SECOND_MAIN_STAT[slotData.cost]?.label ?? ''}
                                    {SECOND_MAIN_STAT[slotData.cost]?.value ?? ''}
                                    {SECOND_MAIN_STAT[slotData.cost]?.unit ?? ''}
                                    <span class="text-zinc-600">（固定）</span>
                                </div>
                            </div>

                            <!-- Substat slots with sliders -->
                            <div>
                                <div class="flex flex-col gap-1.5">
                                    {#each { length: 5 } as _, subIdx}
                                        {@const sub = slotData.substats[subIdx] ?? null}
                                        <div
                                            class="flex items-center gap-1.5 rounded-lg bg-zinc-950 px-2.5 py-2 {sub
                                                ? 'border border-zinc-800'
                                                : ''}"
                                        >
                                            <span class="text-[10px] text-zinc-600 w-3 shrink-0">{subIdx + 1}</span>
                                            {#if sub}
                                                <span class="w-14 text-[10px] text-zinc-200 truncate shrink-0"
                                                    >{sub.type}</span
                                                >
                                                {#if SUBSTAT_OPTIONS.find((x) => x.label === sub.type)?.tiers.length}
                                                    {@const tiers = SUBSTAT_OPTIONS.find(
                                                        (x) => x.label === sub.type
                                                    )!.tiers}
                                                    {@const idx = tiers.indexOf(sub.value)}
                                                    <input
                                                        type="range"
                                                        class="h-0.5 flex-1 cursor-pointer appearance-none rounded bg-zinc-700 accent-blue-500 min-w-0"
                                                        min={0}
                                                        max={tiers.length - 1}
                                                        step={1}
                                                        value={idx >= 0 ? idx : Math.floor(tiers.length / 2)}
                                                        oninput={(e) => {
                                                            sub.value =
                                                                tiers[
                                                                    parseInt(
                                                                        (e.currentTarget as HTMLInputElement).value
                                                                    )
                                                                ]
                                                        }}
                                                    />
                                                {/if}
                                                <span
                                                    class="w-8 text-right text-[10px] text-zinc-400 tabular-nums shrink-0"
                                                    >{sub.value}{sub.unit}</span
                                                >
                                                <button
                                                    class="text-zinc-600 hover:text-red-400 text-[9px] shrink-0"
                                                    onclick={() => setSubstatType(subIdx, null)}>✕</button
                                                >
                                            {:else}
                                                <span class="text-[10px] text-zinc-600">空</span>
                                            {/if}
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        </div>
                    </div>
                {/if}
            </div>

            <div class="border-t border-zinc-800 px-5 py-3 text-right">
                <button
                    class="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500"
                    onclick={onClose}>完成</button
                >
            </div>
        </div>
    </div>
{/if}
