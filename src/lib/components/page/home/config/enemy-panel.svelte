<script lang="ts">
    import { getConfig, updateEnemy, updateResistance } from './config.store.svelte'
    import { RESISTANCE_KEYS } from './config.consts'
    import Icon from '@iconify/svelte'

    let config = $derived(getConfig())

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

    let sortedResistanceKeys = $derived(
        [...RESISTANCE_KEYS].sort((a, b) => {
            if (a === '物理') return 1
            if (b === '物理') return -1
            return 0
        })
    )
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
        <span class="text-xs font-medium text-(--theme-modal-text)/70 block mb-3">抗性</span>
        <div class="grid grid-cols-3 gap-2">
            {#each sortedResistanceKeys as el}
                {@const val = config.enemy.resistances[el]}
                {@const color = elementColor(el)}
                <div
                    class="flex flex-col gap-1.5 rounded-lg border p-2.5"
                    style="background: linear-gradient(135deg, transparent 0%, color-mix(in srgb, {color} 15%, transparent) 100%); border-color: color-mix(in srgb, {color} 25%, transparent);"
                >
                    <span class="text-xs font-medium" style="color: {color}">{el}</span>
                    <div class="flex items-stretch gap-1">
                        <div class="flex items-center gap-1 flex-1 min-w-0">
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
                                class="w-12 rounded border px-1.5 py-0.5 text-xs text-right tabular-nums text-(--theme-modal-text) outline-none"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                            />
                            <span class="text-[10px] text-(--theme-modal-text)/20 w-2.5 shrink-0">%</span>
                        </div>
                        <div class="flex flex-col gap-px rounded bg-(--theme-input-bg) p-px">
                            <button
                                onclick={() => updateResistance(el, Math.min(100, val + STEP))}
                                class="rounded px-1 py-0.5 text-(--theme-modal-text)/20 transition-colors hover:text-(--theme-modal-text)/60 hover:bg-(--theme-modal-text)/5"
                            >
                                <Icon icon="mdi:plus" class="size-3" />
                            </button>
                            <button
                                onclick={() => updateResistance(el, Math.max(-100, val - STEP))}
                                class="rounded px-1 py-0.5 text-(--theme-modal-text)/20 transition-colors hover:text-(--theme-modal-text)/60 hover:bg-(--theme-modal-text)/5"
                            >
                                <Icon icon="mdi:minus" class="size-3" />
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
