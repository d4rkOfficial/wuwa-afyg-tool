<script lang="ts">
    import Icon from '@iconify/svelte'
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
    } from '$lib/calc/timeline.store.svelte'
    import { getCharIconMap } from '$lib/calc/timeline.store.svelte'
    import { NON_DIRECT_CONFIGS, NON_DIRECT_ELEMENT } from '$lib/calc/timeline.consts'
    import { fallbackIcon } from '$lib/utils/icons'
    import Modal from '$lib/components/layout/modal.svelte'
    import Button from '$lib/components/ui/button.svelte'
</script>

<!-- escapable={false}：Esc 由宿主（timeline.svelte 的 window 监听）处理为「保存并关闭」，
     外壳若自行 onclose 会先清空 blockId，使 applyNonDirectEntries() 直接 return -->
<Modal
    open={getNonDirectPickerBlockId() !== null}
    onclose={() => setNonDirectPickerBlockId(null)}
    backdropClose
    layer="nested"
    escapable={false}
    blockPageShortcuts
    class="w-full max-w-xl"
>
    {#snippet title()}
        <Icon icon="mdi:tune-variant" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        <span>配置非直伤</span>
    {/snippet}
    <div class="space-y-3">
        <div class="text-xs font-black tracking-tight text-(--theme-modal-text)">处决/响应</div>
        {#each NON_DIRECT_CONFIGS.filter((c) => c.name === '谐度破坏' || c.category === '响应') as cfg (cfg.name)}
            {@const isTuneBreak = cfg.name === '谐度破坏'}
            {@const isResp = cfg.category === '响应'}
            {@const disabled = false}
            <div class="flex flex-col gap-1">
                <div class="flex items-center gap-2">
                    <button
                        class={[
                            'h-7 rounded-none px-3 text-xs font-medium transition-colors whitespace-nowrap',
                            getNonDirectPickerSelected().has(cfg.name)
                                ? 'text-(--theme-accent-text-on-bg)'
                                : disabled
                                  ? 'text-(--theme-modal-text)/20 cursor-not-allowed'
                                  : 'text-(--theme-modal-text)/60 hover:bg-(--theme-modal-text)/10'
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
                            {#each getTeamCharNames() as name (name)}
                                {@const selected = isTuneBreak
                                    ? getNonDirectPickerTuneTrigger() === name
                                    : (getNonDirectPickerResponders()[cfg.name]?.includes(name) ?? false)}
                                {@const locked = isTuneBreak && getNonDirectPickerTuneTrigger() !== null && selected}
                                {@const hasRespSkill = isResp ? charHasResponseSkill(name, cfg.name) : true}
                                {@const responderDisabled = isResp && !hasRespSkill}
                                <button
                                    class={[
                                        'size-9 rounded-full overflow-hidden flex items-center justify-center',
                                        responderDisabled
                                            ? 'opacity-10 cursor-not-allowed'
                                            : !selected
                                              ? 'ring-1 ring-(--theme-divider-border) opacity-60'
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
                                            const next2 = selected ? list.filter((n) => n !== name) : [...list, name]
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
                                        <span class="text-[10px] font-bold text-(--theme-modal-text)">{name[0]}</span>
                                    {/if}
                                </button>
                            {/each}
                        </div>
                    {/if}
                </div>
            </div>
        {/each}

        <div class="border-t pt-4" style="border-top-color: var(--theme-divider-border);">
            <div class="mb-3 text-xs font-black tracking-tight text-(--theme-modal-text)">效应结算</div>
            <div class="flex flex-col gap-2">
                {#each NON_DIRECT_CONFIGS.filter((c) => c.category === '效应') as cfg (cfg.name)}
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
                            class="flex flex-col gap-2 rounded-none border p-2.5"
                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                        >
                            <div class="flex items-center justify-between gap-2">
                                <span class="truncate text-xs font-black tracking-tight text-(--theme-modal-text)"
                                    >{cfg.name}</span
                                >
                                <span class="flex items-center gap-3 shrink-0">
                                    <span class="text-xs text-(--theme-modal-text)/50 tabular-nums"
                                        >层数 {layers}/{cfg.max}</span
                                    >
                                    <span class="flex items-center gap-1.5">
                                        <span class="text-xs text-(--theme-modal-text)/50">段数</span>
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
                                            class="w-12 h-6 bg-(--theme-modal-bg)/60 text-xs text-(--theme-modal-text) text-center rounded-none outline-none border tabular-nums disabled:opacity-30"
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
                                        getNonDirectPickerData().map((d, i) => (i === idx ? { ...d, layers: v } : d))
                                    )
                                }}
                                class="w-full h-2 appearance-none cursor-pointer rounded-full [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-(--slider-color)"
                                style="--slider-color: {effectColor}; background: linear-gradient(to right, var(--slider-color) 0%, var(--slider-color) {pct}%, rgba(255,255,255,0.1) {pct}%, rgba(255,255,255,0.1) 100%);"
                            />
                            {#if cfg.name === '电磁效应'}
                                {@const burstLayers = getNonDirectPickerBurstLayers()['burst'] ?? 0}
                                {@const burstPct = cfg.max > 0 ? (burstLayers / cfg.max) * 100 : 0}
                                <div
                                    class="flex flex-col gap-1.5 rounded-none px-2 py-1.5"
                                    style="background: color-mix(in srgb, var(--theme-modal-text) 5%, transparent);"
                                >
                                    <div class="flex items-center justify-between gap-2">
                                        <span
                                            class="truncate text-xs font-black tracking-tight text-(--theme-modal-text)/60"
                                            >电磁爆发</span
                                        >
                                        <span class="text-[10px] text-(--theme-modal-text)/40 shrink-0"
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
                                        class="w-full h-2 appearance-none cursor-pointer rounded-full disabled:opacity-30 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-(--slider-color)"
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
    {#snippet footer()}
        <div class="mt-4 flex items-center justify-end gap-2">
            <Button
                variant="text"
                compact
                bare
                onclick={() => setNonDirectPickerBlockId(null)}
                backgroundImage="var(--theme-input-bg)"
                class="text-(--theme-modal-text)/60 transition-colors hover:bg-(--theme-modal-text)/10">取消</Button
            >
            <Button
                variant="text"
                compact
                bare
                onclick={applyNonDirectEntries}
                backgroundImage="var(--theme-accent-bg)"
                textColor="var(--theme-accent-text-on-bg, #ffffff)">确认</Button
            >
        </div>
    {/snippet}
</Modal>
