<script lang="ts">
    import {
        getNonDirectPickerBlockId,
        setNonDirectPickerBlockId,
        getNonDirectPickerData,
        setNonDirectPickerData,
        getNonDirectPickerSelected,
        setNonDirectPickerSelected,
        getNonDirectPickerResponders,
        setNonDirectPickerResponders,
        getNonDirectPickerBurstLayers,
        setNonDirectPickerBurstLayers,
        getNonDirectPickerHarmonyTrigger,
        setNonDirectPickerHarmonyTrigger,
        getTeamCharNames,
        charHasTuneSkills,
        applyNonDirectEntries
    } from './timeline.store.svelte'
    import { getCharIconMap } from './timeline.store.svelte'
    import { NON_DIRECT_CONFIGS, ELEMENT_COLORS } from './timeline.consts'
</script>

{#if getNonDirectPickerBlockId() !== null}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-lg"
        onclick={(e) => {
            if ((e.target as HTMLElement) === e.currentTarget) setNonDirectPickerBlockId(null)
        }}
        onkeydown={(e) => e.key === 'Escape' && setNonDirectPickerBlockId(null)}
    >
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="w-full max-h-[70vh] max-w-xl rounded-lg border border-white/10 bg-[var(--theme-modal-bg)] text-[var(--theme-modal-text)] shadow-xl overflow-hidden flex flex-col"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
        >
            <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <h2 class="text-sm font-semibold">配置非直伤</h2>
            </div>
            <div class="flex-1 overflow-y-auto p-4 space-y-3">
                <div class="text-[11px] font-semibold text-[var(--theme-modal-text)]/60 tracking-wider">处决/响应</div>
                {#each NON_DIRECT_CONFIGS.filter((c) => c.name === '谐度破坏' || c.category === '响应') as cfg}
                    {@const isHarmony = cfg.name === '谐度破坏'}
                    {@const isResp = cfg.category === '响应'}
                    {@const harmonySelected = getNonDirectPickerSelected().has('谐度破坏')}
                    {@const tuneChar = getNonDirectPickerHarmonyTrigger() ?? ''}
                    {@const hasTune = tuneChar ? charHasTuneSkills(tuneChar) : false}
                    {@const disabled = isResp && (!harmonySelected || !hasTune)}
                    <div class="flex flex-col gap-1">
                        <div class="flex items-center gap-2">
                            <button
                                class={[
                                    'h-7 rounded-md px-3 text-xs font-medium transition-colors whitespace-nowrap',
                                    getNonDirectPickerSelected().has(cfg.name)
                                        ? 'bg-indigo-500 text-white'
                                        : disabled
                                          ? 'bg-white/[0.02] text-[var(--theme-modal-text)]/20 cursor-not-allowed'
                                          : 'bg-white/5 text-[var(--theme-modal-text)]/60 hover:bg-white/10'
                                ].join(' ')}
                                onclick={() => {
                                    if (disabled) return
                                    const next = new Set(getNonDirectPickerSelected())
                                    if (next.has(cfg.name)) next.delete(cfg.name)
                                    else next.add(cfg.name)
                                    setNonDirectPickerSelected(next)
                                }}
                            >
                                {cfg.name}
                                {#if isResp && !harmonySelected}
                                    <span class="ml-1 text-[10px] opacity-60">(需先开启谐度破坏)</span>
                                {/if}
                            </button>
                            {#if getNonDirectPickerSelected().has(cfg.name)}
                                <div class="flex items-center gap-3">
                                    {#each getTeamCharNames() as name}
                                        {@const selected = isHarmony
                                            ? getNonDirectPickerHarmonyTrigger() === name
                                            : (getNonDirectPickerResponders()[cfg.name]?.includes(name) ?? false)}
                                        {@const locked =
                                            isHarmony && getNonDirectPickerHarmonyTrigger() !== null && selected}
                                        <button
                                            class={[
                                                'size-9 rounded-full overflow-hidden flex items-center justify-center',
                                                isHarmony
                                                    ? selected
                                                        ? 'ring-2 ring-indigo-500'
                                                        : 'ring-1 ring-white/20 opacity-60'
                                                    : selected
                                                      ? 'ring-2 ring-indigo-500'
                                                      : 'ring-1 ring-white/20 opacity-60'
                                            ].join(' ')}
                                            onclick={() => {
                                                if (locked) return
                                                if (isHarmony) {
                                                    setNonDirectPickerHarmonyTrigger(selected ? null : name)
                                                } else {
                                                    const list = getNonDirectPickerResponders()[cfg.name] ?? []
                                                    const next2 = selected
                                                        ? list.filter((n) => n !== name)
                                                        : [...list, name]
                                                    setNonDirectPickerResponders({
                                                        ...getNonDirectPickerResponders(),
                                                        [cfg.name]: next2
                                                    })
                                                }
                                            }}
                                        >
                                            {#if getCharIconMap()[name]}
                                                <img
                                                    src={getCharIconMap()[name]}
                                                    alt={name}
                                                    draggable="false"
                                                    class="size-full object-cover"
                                                />
                                            {:else}
                                                <span class="text-[10px] font-bold text-[var(--theme-modal-text)]"
                                                    >{name[0]}</span
                                                >
                                            {/if}
                                        </button>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    </div>
                {/each}

                <div class="pt-3 border-t border-white/10">
                    <div class="text-[11px] font-semibold text-[var(--theme-modal-text)]/60 tracking-wider mb-3">
                        效应结算
                    </div>
                    <div class="grid grid-cols-2 gap-x-4 gap-y-2.5">
                        {#each NON_DIRECT_CONFIGS.filter((c) => c.category === '效应') as cfg}
                            {@const idx = getNonDirectPickerData().findIndex((d) => d.name === cfg.name)}
                            {#if idx >= 0}
                                {@const layers = getNonDirectPickerData()[idx].layers}
                                {@const pct = cfg.max > 0 ? (layers / cfg.max) * 100 : 0}
                                <div class="flex flex-col gap-1 min-w-0">
                                    <div class="flex items-center justify-between text-xs">
                                        <span class="text-[var(--theme-modal-text)] truncate">{cfg.name}</span>
                                        <span class="text-[var(--theme-modal-text)]/50 tabular-nums shrink-0"
                                            >{layers}/{cfg.max}</span
                                        >
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max={cfg.max}
                                        value={layers}
                                        oninput={(e) => {
                                            const v = parseInt((e.target as HTMLInputElement).value)
                                            setNonDirectPickerData(
                                                getNonDirectPickerData().map((d, i) =>
                                                    i === idx ? { ...d, layers: v } : d
                                                )
                                            )
                                        }}
                                        class="w-full h-2 appearance-none cursor-pointer rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-500 [&::-webkit-slider-thumb]:shadow-md"
                                        style="background: linear-gradient(to right, #6366f1 0%, #6366f1 {pct}%, rgba(255,255,255,0.1) {pct}%, rgba(255,255,255,0.1) 100%);"
                                    />
                                    {#if cfg.name === '电磁效应'}
                                        {@const burstLayers = getNonDirectPickerBurstLayers()['burst'] ?? 0}
                                        {@const burstPct = cfg.max > 0 ? (burstLayers / cfg.max) * 100 : 0}
                                        <div class="flex items-center justify-between text-xs mt-1">
                                            <span class="text-[var(--theme-modal-text)]/60 truncate">电磁爆发</span>
                                            <span class="text-[var(--theme-modal-text)]/50 tabular-nums shrink-0"
                                                >{burstLayers}/{cfg.max}</span
                                            >
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max={cfg.max}
                                            value={burstLayers}
                                            disabled={layers < 1}
                                            oninput={(e) => {
                                                const v = parseInt((e.target as HTMLInputElement).value)
                                                setNonDirectPickerBurstLayers({ burst: v })
                                            }}
                                            class="w-full h-2 appearance-none cursor-pointer rounded-full disabled:opacity-30 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-500 [&::-webkit-slider-thumb]:shadow-md"
                                            style="background: linear-gradient(to right, #6366f1 0%, #6366f1 {burstPct}%, rgba(255,255,255,0.1) {burstPct}%, rgba(255,255,255,0.1) 100%);"
                                        />
                                    {/if}
                                </div>
                            {/if}
                        {/each}
                    </div>
                </div>
            </div>
            <div class="flex items-center justify-end gap-2 border-t border-white/10 px-4 py-2.5">
                <button
                    class="h-7 rounded-md bg-white/5 px-3 text-xs text-[var(--theme-modal-text)]/60 transition-colors hover:bg-white/10"
                    onclick={() => setNonDirectPickerBlockId(null)}>取消</button
                >
                <button
                    class="h-7 rounded-md bg-indigo-600 px-3 text-xs text-white transition-colors hover:bg-indigo-500"
                    onclick={applyNonDirectEntries}>确认</button
                >
            </div>
        </div>
    </div>
{/if}
