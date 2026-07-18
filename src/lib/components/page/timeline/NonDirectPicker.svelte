<script lang="ts">
    import type { ComponentsProps } from '$lib/types/component-props'
    import {
        getNonDirectPickerBlockId,
        setNonDirectPickerBlockId,
        getNonDirectPickerData,
        setNonDirectPickerData,
        getNonDirectPickerSelected,
        setNonDirectPickerSelected,
        getNonDirectPickerResponders,
        setNonDirectPickerResponders,
        getSelectedCharNames,
        imgUrl,
        applyNonDirectEntries
    } from '$lib/timeline/store.svelte'
    import { NON_DIRECT_CONFIGS, NON_DIRECT_ELEMENT, ELEMENT_COLORS } from '$lib/timeline/consts'

    interface Props extends ComponentsProps {}
    let { class: _class = '', style = '' }: Props = $props()
</script>

{#if getNonDirectPickerBlockId() !== null}
    <div
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
        role="button"
        tabindex="-1"
        onclick={(e) => {
            if ((e.target as HTMLElement) === e.currentTarget) setNonDirectPickerBlockId(null)
        }}
        onkeydown={(e) => e.key === 'Escape' && setNonDirectPickerBlockId(null)}
    >
        <div
            class="w-full max-h-[70vh] max-w-xl rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl overflow-hidden flex flex-col"
            role="button"
            tabindex="-1"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
        >
            <div class="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
                <h2 class="text-sm font-semibold text-zinc-200">配置非直伤</h2>
            </div>
            <div class="flex-1 overflow-y-auto p-4 space-y-3">
                <!-- 处决/响应 -->
                <div class="text-[11px] font-semibold text-zinc-400 tracking-wider">处决/响应</div>
                {#each NON_DIRECT_CONFIGS.filter((c) => c.name === '谐度破坏' || c.category === '响应') as cfg, ci}
                    <div class="flex flex-col gap-1">
                        <div class="flex items-center gap-2">
                            <button
                                class="h-7 rounded-md px-3 text-xs font-medium transition-colors whitespace-nowrap {getNonDirectPickerSelected().has(
                                    cfg.name
                                )
                                    ? 'bg-blue-500 text-white'
                                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}"
                                onclick={() => {
                                    const next = new Set(getNonDirectPickerSelected())
                                    if (next.has(cfg.name)) next.delete(cfg.name)
                                    else next.add(cfg.name)
                                    setNonDirectPickerSelected(next)
                                }}>{cfg.name}</button
                            >
                            {#if getNonDirectPickerSelected().has(cfg.name)}
                                <div class="flex items-center gap-1">
                                    {#each getSelectedCharNames() as name}
                                        {@const selected = getNonDirectPickerResponders()[cfg.name]?.includes(name)}
                                        <button
                                            class="size-7 rounded-full overflow-hidden {selected
                                                ? 'ring-2 ring-blue-500'
                                                : 'ring-1 ring-zinc-600 opacity-60'}"
                                            onclick={() => {
                                                const list = getNonDirectPickerResponders()[cfg.name] ?? []
                                                const next2 = selected
                                                    ? list.filter((n: string) => n !== name)
                                                    : [...list, name]
                                                setNonDirectPickerResponders({
                                                    ...getNonDirectPickerResponders(),
                                                    [cfg.name]: next2
                                                })
                                            }}
                                        >
                                            {#if imgUrl(name)}
                                                <img src={imgUrl(name)} alt={name} class="size-full object-contain" />
                                            {:else}
                                                <span class="text-[10px] font-medium text-zinc-400">{name[0]}</span>
                                            {/if}
                                        </button>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    </div>
                {/each}

                <!-- 效应结算 -->
                <div class="pt-3 border-t border-zinc-800">
                    <div class="text-[11px] font-semibold text-zinc-400 tracking-wider mb-3">效应结算</div>
                    <div class="grid grid-cols-2 gap-x-4 gap-y-2.5">
                        {#each NON_DIRECT_CONFIGS.filter((c) => c.category === '效应') as cfg}
                            {@const idx = getNonDirectPickerData().findIndex((d) => d.name === cfg.name)}
                            {#if idx >= 0}
                                {@const pct = (getNonDirectPickerData()[idx].layers / cfg.max) * 100}
                                <div class="flex flex-col gap-1 min-w-0">
                                    <div class="flex items-center justify-between text-xs">
                                        <span class="text-zinc-300 truncate">{cfg.name}</span>
                                        <span class="text-zinc-500 tabular-nums shrink-0"
                                            >{getNonDirectPickerData()[idx].layers}/{cfg.max}</span
                                        >
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max={cfg.max}
                                        value={getNonDirectPickerData()[idx].layers}
                                        oninput={(e) => {
                                            const v = parseInt((e.target as HTMLInputElement).value)
                                            setNonDirectPickerData(
                                                getNonDirectPickerData().map((d, i) =>
                                                    i === idx ? { ...d, layers: v } : d
                                                )
                                            )
                                        }}
                                        class="w-full h-2 appearance-none cursor-pointer rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:shadow-blue-500/30"
                                        style="background: linear-gradient(to right, #3b82f6 0%, #3b82f6 {pct}%, #3f3f46 {pct}%, #3f3f46 100%);"
                                    />
                                </div>
                            {/if}
                        {/each}
                    </div>
                </div>
            </div>
            <div class="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-2.5">
                <button
                    class="h-7 rounded-md bg-zinc-800 px-3 text-xs text-zinc-400 transition-colors hover:bg-zinc-700"
                    onclick={() => setNonDirectPickerBlockId(null)}>取消</button
                >
                <button
                    class="h-7 rounded-md bg-blue-600 px-3 text-xs text-white transition-colors hover:bg-blue-500"
                    onclick={applyNonDirectEntries}>确认</button
                >
            </div>
        </div>
    </div>
{/if}
