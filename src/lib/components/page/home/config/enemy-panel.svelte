<script lang="ts">
    import { getConfig, updateEnemy, updateResistance } from '$lib/calc/config.store.svelte'
    import { RESISTANCE_KEYS } from '$lib/calc/config.consts'
    import { getElementIcons } from '$lib/api/data-cache'
    import Icon from '@iconify/svelte'

    let config = $derived(getConfig())

    // 元素图标（static/icons/element/*.webp；物理无图标 → 首字徽章占位）
    let elementIcons = $state<Record<string, string>>({})

    $effect(() => {
        getElementIcons().then((v) => (elementIcons = v))
    })

    function computeDefense(lv: number): number {
        return 792 + 8 * lv
    }

    function handleTypeChange(type: 'BOSS' | '精英怪' | '小怪') {
        updateEnemy('type', type)
        updateEnemy('defense', computeDefense(config.enemy.level))
        updateEnemy('defenseLocked', false)
    }

    const LEVEL_PRESETS = [70, 80, 90, 100, 110, 120]

    function handleLevelChange(lv: number) {
        const clamped = Math.min(150, Math.max(0, lv))
        updateEnemy('level', clamped)
        if (!config.enemy.defenseLocked) {
            updateEnemy('defense', computeDefense(clamped))
        }
    }

    function elementColor(el: string): string {
        return `var(--theme-element-${el}, #888)`
    }

    const STEP = 5

    // 全抗预设：一键把 7 元素抗性设为同一值；自定义为派生状态（不相等时自动高亮）
    const RESISTANCE_PRESETS = [10, 20, 40] as const

    let sortedResistanceKeys = $derived(
        [...RESISTANCE_KEYS].sort((a, b) => {
            if (a === '物理') return 1
            if (b === '物理') return -1
            return 0
        })
    )

    const activeResistPreset = $derived(
        RESISTANCE_PRESETS.find((p) => sortedResistanceKeys.every((el) => config.enemy.resistances[el] === p)) ?? null
    )

    function applyResistancePreset(p: number) {
        for (const el of RESISTANCE_KEYS) updateResistance(el, p)
    }
</script>

<div class="space-y-4">
    <!-- Enemy card (type + level + defense) -->
    <div
        class="rounded-lg border p-3.5"
        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
    >
        <span class="text-xs font-medium text-(--theme-modal-text)/70 block mb-3">怪物属性</span>

        <div class="flex items-center gap-1 min-w-0">
            {#each ['BOSS', '精英怪', '小怪'] as t}
                {@const icon = t === 'BOSS' ? 'mdi:skull' : t === '精英怪' ? 'mdi:sword' : 'mdi:bug'}
                <button
                    onclick={() => handleTypeChange(t as 'BOSS' | '精英怪' | '小怪')}
                    class={[
                        'rounded-lg text-[10px] font-medium transition-colors flex flex-col items-center justify-center gap-0.5 w-12 aspect-square',
                        config.enemy.type === t
                            ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text) ring-1 ring-(--theme-accent-bg)/30'
                            : 'bg-(--theme-input-bg) text-(--theme-modal-text)/60 hover:bg-(--theme-modal-text)/10'
                    ].join(' ')}
                >
                    <Icon {icon} class="size-4 shrink-0" />
                    {t}
                </button>
            {/each}

            <!-- Divider -->
            <div
                class="border-l border-dashed self-stretch mx-2"
                style="border-color: var(--theme-divider-border);"
            ></div>

            <!-- Right: level + defense -->
            <div class="flex flex-col gap-2 min-w-0 flex-1">
                <!-- Level -->
                <div class="flex items-center gap-1.5">
                    <span class="text-[10px] text-(--theme-modal-text)/50 shrink-0 w-6">等级</span>
                    <div class="relative">
                        <input
                            type="number"
                            value={config.enemy.level}
                            min="0"
                            max="150"
                            oninput={(e) => handleLevelChange(parseInt((e.target as HTMLInputElement).value) || 0)}
                            disabled={config.enemy.defenseLocked}
                            class="w-28 h-6 rounded-md border px-2 text-xs text-right tabular-nums text-(--theme-modal-text) outline-none"
                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                            class:opacity-70={config.enemy.defenseLocked}
                        />
                    </div>
                    <div class="flex items-center gap-1.5">
                        {#each LEVEL_PRESETS as lv}
                            <button
                                onclick={() => handleLevelChange(lv)}
                                disabled={config.enemy.defenseLocked}
                                class={[
                                    'min-w-7 h-6 rounded-md text-xs font-medium transition-colors',
                                    config.enemy.level === lv
                                        ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text) ring-1 ring-(--theme-accent-bg)/30'
                                        : 'bg-(--theme-input-bg) text-(--theme-modal-text)/50 hover:bg-(--theme-modal-text)/10'
                                ].join(' ')}>{lv}</button
                            >
                        {/each}
                    </div>
                </div>

                <!-- Defense -->
                <div class="flex items-center gap-1.5">
                    <span class="text-[10px] text-(--theme-modal-text)/50 shrink-0 w-6">防御</span>
                    <input
                        type="number"
                        value={config.enemy.defense}
                        min="0"
                        max="5000"
                        oninput={(e) => {
                            updateEnemy(
                                'defense',
                                Math.min(5000, Math.max(0, parseInt((e.target as HTMLInputElement).value) || 0))
                            )
                            updateEnemy('defenseLocked', true)
                        }}
                        disabled={config.enemy.defenseLocked}
                        class="w-28 h-6 rounded-md border px-2 text-xs text-right tabular-nums text-(--theme-modal-text) outline-none"
                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                        class:opacity-70={config.enemy.defenseLocked}
                    />
                </div>
            </div>
        </div>
    </div>

    <!-- Resistances card -->
    <div
        class="rounded-lg border p-3.5"
        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
    >
        <div class="mb-3 flex items-center justify-between gap-2">
            <span class="text-xs font-medium text-(--theme-modal-text)/70">抗性</span>
            <div
                class="flex gap-1 rounded-lg border p-0.5"
                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
            >
                {#each RESISTANCE_PRESETS as p}
                    <button
                        onclick={() => applyResistancePreset(p)}
                        class={[
                            'rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors',
                            activeResistPreset === p
                                ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text) ring-1 ring-(--theme-accent-bg)/30'
                                : 'text-(--theme-modal-text)/50 hover:bg-(--theme-modal-text)/10'
                        ].join(' ')}
                    >
                        {p}%全抗
                    </button>
                {/each}
                <span
                    class={[
                        'rounded-md px-2 py-0.5 text-[10px] font-medium',
                        activeResistPreset === null
                            ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text) ring-1 ring-(--theme-accent-bg)/30'
                            : 'text-(--theme-modal-text)/50'
                    ].join(' ')}>自定义</span
                >
            </div>
        </div>
        <div class="flex flex-wrap justify-center gap-2.5">
            {#each sortedResistanceKeys as el}
                {@const val = config.enemy.resistances[el]}
                {@const color = elementColor(el)}
                <div
                    class="relative w-[calc(25%-7.5px)] min-w-28 overflow-hidden rounded-xl border p-2.5 transition-all duration-200 hover:-translate-y-px hover:border-(--card-color)"
                    style="--card-color: {color}; background: linear-gradient(135deg, color-mix(in srgb, {color} 14%, transparent) 0%, transparent 65%), radial-gradient(ellipse at 85% 8%, color-mix(in srgb, {color} 12%, transparent) 0%, transparent 55%); border-color: color-mix(in srgb, {color} 18%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, {color} 8%, transparent), inset 0 1px 0 rgba(255,255,255,0.04);"
                >
                    <!-- 顶部高光线（元素色，弱） -->
                    <div
                        class="pointer-events-none absolute inset-x-2 top-0 h-px bg-linear-to-r from-transparent via-[color-mix(in_srgb,var(--card-color)_20%,transparent)] to-transparent"
                    ></div>
                    <!-- 大数值水印（遮罩层，放大带 %，百分号缩小靠下） -->
                    <div
                        class="pointer-events-none absolute inset-y-0 right-2 flex select-none items-center overflow-hidden"
                    >
                        <span class="text-7xl font-black leading-none opacity-10 tabular-nums" style="color: {color};"
                            >{val}</span
                        ><span class="self-end pb-1 text-2xl font-black opacity-10" style="color: {color};">%</span>
                    </div>
                    <!-- 顶行：图标徽章 + 名称 -->
                    <div class="relative flex items-center gap-1.5">
                        <span
                            class="flex size-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold"
                            style="background: color-mix(in srgb, {color} 12%, transparent); color: {color};"
                        >
                            {#if elementIcons[el]}
                                <img
                                    src={elementIcons[el]}
                                    alt={el}
                                    draggable="false"
                                    class="size-4.5 object-contain"
                                />
                            {:else}
                                <span>{el.charAt(0)}</span>
                            {/if}
                        </span>
                        <span class="min-w-0 flex-1 truncate text-sm font-bold" style="color: {color};">{el}</span>
                    </div>
                    <!-- 底行：输入（左对齐属性色）+ 横排步进 -->
                    <div class="relative mt-2 flex items-stretch gap-1">
                        <div
                            class="flex min-w-0 flex-1 items-center rounded-md border transition-colors focus-within:border-(--card-color)"
                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                        >
                            <input
                                type="number"
                                value={val}
                                min="-100"
                                max="100"
                                oninput={(e) =>
                                    updateResistance(
                                        el,
                                        Math.min(
                                            100,
                                            Math.max(-100, parseInt((e.target as HTMLInputElement).value) || 0)
                                        )
                                    )}
                                class="w-full min-w-0 bg-transparent px-1.5 py-1 text-sm font-semibold text-left tabular-nums outline-none"
                                style="color: {color};"
                            />
                            <span class="shrink-0 pr-1 text-[10px] text-(--theme-modal-text)/25">%</span>
                        </div>
                        <div class="flex items-stretch gap-px rounded-md bg-(--theme-input-bg) p-px">
                            <button
                                onclick={() => updateResistance(el, Math.min(100, val + STEP))}
                                class="rounded px-1.5 text-(--theme-modal-text)/25 transition-colors hover:bg-(--theme-modal-text)/5 hover:text-[color-mix(in_srgb,var(--card-color)_80%,transparent)]"
                            >
                                <Icon icon="mdi:plus" class="size-3.5" />
                            </button>
                            <button
                                onclick={() => updateResistance(el, Math.max(-100, val - STEP))}
                                class="rounded px-1.5 text-(--theme-modal-text)/25 transition-colors hover:bg-(--theme-modal-text)/5 hover:text-[color-mix(in_srgb,var(--card-color)_80%,transparent)]"
                            >
                                <Icon icon="mdi:minus" class="size-3.5" />
                            </button>
                        </div>
                    </div>
                </div>
            {/each}
        </div>
    </div>

    <!-- Damage reduction card -->
    <div
        class="rounded-lg border p-3.5"
        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
    >
        <div class="flex items-center gap-2">
            <span class="text-xs font-medium text-(--theme-modal-text)/70">免伤率</span>
            <div class="flex items-center gap-1 ml-auto">
                <input
                    type="number"
                    value={config.enemy.dmgReduction}
                    min="0"
                    max="100"
                    oninput={(e) =>
                        updateEnemy(
                            'dmgReduction',
                            Math.min(100, Math.max(0, parseInt((e.target as HTMLInputElement).value) || 0))
                        )}
                    class="w-16 rounded-md border px-2 py-1 text-xs text-right tabular-nums text-(--theme-modal-text) outline-none"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                />
                <span class="text-[10px] text-(--theme-modal-text)/30 w-3">%</span>
                <button
                    onclick={() =>
                        updateEnemy('dmgReduction', Math.min(100, Math.max(0, config.enemy.dmgReduction - STEP)))}
                    class="rounded p-0.5 text-(--theme-modal-text)/20 transition-colors hover:text-(--theme-modal-text)/60 hover:bg-(--theme-modal-text)/5"
                >
                    <Icon icon="mdi:minus" class="size-3.5" />
                </button>
                <button
                    onclick={() =>
                        updateEnemy('dmgReduction', Math.min(100, Math.max(0, config.enemy.dmgReduction + STEP)))}
                    class="rounded p-0.5 text-(--theme-modal-text)/20 transition-colors hover:text-(--theme-modal-text)/60 hover:bg-(--theme-modal-text)/5"
                >
                    <Icon icon="mdi:plus" class="size-3.5" />
                </button>
            </div>
        </div>
    </div>
</div>
