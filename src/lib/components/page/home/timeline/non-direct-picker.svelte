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
        getNonDirectPickerTuneTrigger,
        setNonDirectPickerTuneTrigger,
        getTeamCharNames,
        charHasTuneSkills,
        charHasResponseSkill,
        applyNonDirectEntries
    } from './timeline.store.svelte'
    import { getCharIconMap } from './timeline.store.svelte'
    import { NON_DIRECT_CONFIGS, NON_DIRECT_ELEMENT } from './timeline.consts'
    import { fallbackIcon } from '$lib/utils/icons'
    import { focusTrap } from '$lib/utils/focus-trap'
</script>

{#if getNonDirectPickerBlockId() !== null}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        class="fixed inset-0 z-[60] flex items-center justify-center backdrop-blur-sm"
        onclick={(e) => {
            if ((e.target as HTMLElement) === e.currentTarget) setNonDirectPickerBlockId(null)
        }}
    >
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            use:focusTrap
            tabindex="-1"
            class="w-full max-h-[70vh] max-w-xl rounded-lg border text-[var(--theme-modal-text)] shadow-xl overflow-hidden flex flex-col"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => {
                // 放行 ESC/Enter 到 window 层统一处理（保存/关闭），其余按键阻止冒泡
                if (e.key === 'Escape' || e.key === 'Enter') return
                e.stopPropagation()
            }}
        >
            <div
                class="flex items-center justify-between px-4 py-3 border-b"
                style="border-bottom-color: var(--theme-divider-border);"
            >
                <h2 class="text-sm font-semibold">配置非直伤</h2>
            </div>
            <div class="flex-1 overflow-y-auto p-4 space-y-3">
                <div class="text-[11px] font-semibold text-[var(--theme-modal-text)]/60 tracking-wider">处决/响应</div>
                {#each NON_DIRECT_CONFIGS.filter((c) => c.name === '谐度破坏' || c.category === '响应') as cfg}
                    {@const isTuneBreak = cfg.name === '谐度破坏'}
                    {@const isResp = cfg.category === '响应'}
                    {@const disabled = false}
                    <div class="flex flex-col gap-1">
                        <div class="flex items-center gap-2">
                            <button
                                class={[
                                    'h-7 rounded-md px-3 text-xs font-medium transition-colors whitespace-nowrap',
                                    getNonDirectPickerSelected().has(cfg.name)
                                        ? 'text-[var(--theme-accent-text-on-bg)]'
                                        : disabled
                                          ? 'text-[var(--theme-modal-text)]/20 cursor-not-allowed'
                                          : 'text-[var(--theme-modal-text)]/60 hover:bg-[var(--theme-modal-text)]/[0.1]'
                                ].join(' ')}
                                style={getNonDirectPickerSelected().has(cfg.name)
                                    ? 'background: var(--theme-accent-bg);'
                                    : 'background: var(--theme-input-bg);'}
                                onclick={() => {
                                    if (disabled) return
                                    const next = new Set(getNonDirectPickerSelected())
                                    if (next.has(cfg.name)) next.delete(cfg.name)
                                    else next.add(cfg.name)
                                    setNonDirectPickerSelected(next)
                                }}
                            >
                                {cfg.name}
                            </button>
                            {#if getNonDirectPickerSelected().has(cfg.name)}
                                <div class="flex items-center gap-3">
                                    {#each getTeamCharNames() as name}
                                        {@const selected = isTuneBreak
                                            ? getNonDirectPickerTuneTrigger() === name
                                            : (getNonDirectPickerResponders()[cfg.name]?.includes(name) ?? false)}
                                        {@const locked =
                                            isTuneBreak && getNonDirectPickerTuneTrigger() !== null && selected}
                                        {@const hasRespSkill = isResp ? charHasResponseSkill(name, cfg.name) : true}
                                        {@const responderDisabled = isResp && !hasRespSkill}
                                        <button
                                            class={[
                                                'size-9 rounded-full overflow-hidden flex items-center justify-center',
                                                responderDisabled
                                                    ? 'opacity-10 cursor-not-allowed'
                                                    : !selected
                                                      ? 'ring-1 ring-[var(--theme-divider-border)] opacity-60'
                                                      : ''
                                            ].join(' ')}
                                            style={!responderDisabled && selected
                                                ? 'box-shadow: 0 0 0 2px var(--theme-accent-bg);'
                                                : ''}
                                            onclick={() => {
                                                if (locked || responderDisabled) return
                                                if (isTuneBreak) {
                                                    setNonDirectPickerTuneTrigger(selected ? null : name)
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
                                                    use:fallbackIcon={'/icons/placeholder-character.svg'}
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

                <div class="pt-3 border-t" style="border-top-color: var(--theme-divider-border);">
                    <div class="text-[11px] font-semibold text-[var(--theme-modal-text)]/60 tracking-wider mb-3">
                        效应结算
                    </div>
                    <div class="flex flex-col gap-2">
                        {#each NON_DIRECT_CONFIGS.filter((c) => c.category === '效应') as cfg}
                            {@const idx = getNonDirectPickerData().findIndex((d) => d.name === cfg.name)}
                            {@const effectElement = NON_DIRECT_ELEMENT[cfg.name]}
                            {@const effectColor = effectElement
                                ? `var(--theme-element-${effectElement}, #888)`
                                : 'var(--theme-accent-bg)'}
                            {#if idx >= 0}
                                {@const layers = getNonDirectPickerData()[idx].layers}
                                {@const hits = getNonDirectPickerData()[idx].hits}
                                {@const pct = cfg.max > 0 ? (layers / cfg.max) * 100 : 0}
                                <div
                                    class="flex flex-col gap-2 rounded-md border p-2.5"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    <div class="flex items-center justify-between gap-2">
                                        <span class="text-xs text-[var(--theme-modal-text)] truncate">{cfg.name}</span>
                                        <span class="flex items-center gap-3 shrink-0">
                                            <span class="text-xs text-[var(--theme-modal-text)]/50 tabular-nums"
                                                >层数 {layers}/{cfg.max}</span
                                            >
                                            <span class="flex items-center gap-1.5">
                                                <span class="text-xs text-[var(--theme-modal-text)]/50">段数</span>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    value={hits}
                                                    disabled={layers < 1}
                                                    oninput={(e) => {
                                                        const v = parseInt((e.target as HTMLInputElement).value)
                                                        setNonDirectPickerData(
                                                            getNonDirectPickerData().map((d, i) =>
                                                                i === idx
                                                                    ? {
                                                                          ...d,
                                                                          hits: Math.max(1, isNaN(v) ? 1 : v)
                                                                      }
                                                                    : d
                                                            )
                                                        )
                                                    }}
                                                    class="w-12 h-6 bg-[var(--theme-modal-bg)]/60 text-xs text-[var(--theme-modal-text)] text-center rounded outline-none border tabular-nums disabled:opacity-30"
                                                    style="border-color: var(--theme-divider-border);"
                                                />
                                            </span>
                                        </span>
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
                                        class="w-full h-2 appearance-none cursor-pointer rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-(--slider-color) [&::-webkit-slider-thumb]:shadow-md"
                                        style="--slider-color: {effectColor}; background: linear-gradient(to right, var(--slider-color) 0%, var(--slider-color) {pct}%, rgba(255,255,255,0.1) {pct}%, rgba(255,255,255,0.1) 100%);"
                                    />
                                    {#if cfg.name === '电磁效应'}
                                        {@const burstLayers = getNonDirectPickerBurstLayers()['burst'] ?? 0}
                                        {@const burstPct = cfg.max > 0 ? (burstLayers / cfg.max) * 100 : 0}
                                        <div
                                            class="flex flex-col gap-1.5 rounded px-2 py-1.5"
                                            style="background: color-mix(in srgb, var(--theme-modal-text) 5%, transparent);"
                                        >
                                            <div class="flex items-center justify-between gap-2">
                                                <span class="text-xs text-[var(--theme-modal-text)]/60 truncate"
                                                    >电磁爆发</span
                                                >
                                                <span class="text-[10px] text-[var(--theme-modal-text)]/40 shrink-0"
                                                    >随电磁段数 ×{hits}</span
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
                                                class="w-full h-2 appearance-none cursor-pointer rounded-full disabled:opacity-30 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-(--slider-color) [&::-webkit-slider-thumb]:shadow-md"
                                                style="--slider-color: {effectColor}; background: linear-gradient(to right, var(--slider-color) 0%, var(--slider-color) {burstPct}%, rgba(255,255,255,0.1) {burstPct}%, rgba(255,255,255,0.1) 100%);"
                                            />
                                        </div>
                                    {/if}
                                </div>
                            {/if}
                        {/each}
                    </div>
                </div>
            </div>
            <div
                class="flex items-center justify-end gap-2 border-t px-4 py-2.5"
                style="border-top-color: var(--theme-divider-border);"
            >
                <button
                    class="h-7 rounded-md px-3 text-xs text-[var(--theme-modal-text)]/60 transition-colors hover:bg-[var(--theme-modal-text)]/[0.1]"
                    style="background: var(--theme-input-bg);"
                    onclick={() => setNonDirectPickerBlockId(null)}>取消</button
                >
                <button
                    class="h-7 rounded-md px-3 text-xs transition-all hover:brightness-125"
                    style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);"
                    onclick={applyNonDirectEntries}>确认</button
                >
            </div>
        </div>
    </div>
{/if}
