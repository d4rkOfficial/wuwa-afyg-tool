<script lang="ts">
    import { getConfig, updateEnemy, updateResistance } from './config.store.svelte'
    import { RESISTANCE_KEYS } from './config.consts'
    import { ELEMENT_COLORS } from '../timeline/timeline.consts'
    import Icon from '@iconify/svelte'

    let config = $derived(getConfig())

    function handleTypeChange(type: 'BOSS' | '精英怪' | '小怪') {
        updateEnemy('type', type)
        updateEnemy('defense', 1592)
    }

    const LEVEL_PRESETS = [70, 80, 90, 100, 110, 120]

    function elementColor(el: string): string {
        return (ELEMENT_COLORS as Record<string, string>)[el] ?? '#888'
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
    <!-- Type card -->
    <div class="rounded-lg border border-white/10 bg-white/[0.02] p-3.5">
        <div class="flex items-center justify-between mb-2.5">
            <span class="text-xs font-medium text-[var(--theme-modal-text)]/70">类型</span>
        </div>
        <div class="flex gap-2">
            {#each ['BOSS', '精英怪', '小怪'] as t}
                <button
                    onclick={() => handleTypeChange(t as 'BOSS' | '精英怪' | '小怪')}
                    class={[
                        'rounded-lg px-4 py-2 text-xs font-medium transition-colors',
                        config.enemy.type === t
                            ? 'bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30'
                            : 'bg-white/5 text-[var(--theme-modal-text)]/60 hover:bg-white/10'
                    ].join(' ')}>{t}</button
                >
            {/each}
        </div>
    </div>

    <!-- Stats card -->
    <div class="rounded-lg border border-white/10 bg-white/[0.02] p-3.5">
        <span class="text-xs font-medium text-[var(--theme-modal-text)]/70 block mb-3">基础属性</span>

        <div class="space-y-3">
            <!-- Level -->
            <div>
                <span class="text-[10px] text-[var(--theme-modal-text)]/50 block mb-1.5">等级</span>
                <div class="flex items-center gap-1.5">
                    {#each LEVEL_PRESETS as lv}
                        <button
                            onclick={() => updateEnemy('level', lv)}
                            class={[
                                'min-w-9 h-7 rounded-md text-xs font-medium transition-colors',
                                config.enemy.level === lv
                                    ? 'bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/30'
                                    : 'bg-white/5 text-[var(--theme-modal-text)]/50 hover:bg-white/10'
                            ].join(' ')}>{lv}</button
                        >
                    {/each}
                    <div class="relative ml-1">
                        <input
                            type="number"
                            value={config.enemy.level}
                            min="0"
                            max="150"
                            oninput={(e) =>
                                updateEnemy(
                                    'level',
                                    Math.min(150, Math.max(0, parseInt((e.target as HTMLInputElement).value) || 0))
                                )}
                            class="w-14 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-right tabular-nums text-[var(--theme-modal-text)] outline-none"
                        />
                    </div>
                </div>
            </div>

            <!-- Defense -->
            <div>
                <div class="flex items-center justify-between mb-1.5">
                    <span class="text-[10px] text-[var(--theme-modal-text)]/50">防御</span>
                    <span class="text-[9px] text-[var(--theme-modal-text)]/30">切换类型自动推荐 1592</span>
                </div>
                <div class="flex items-center gap-2">
                    <input
                        type="number"
                        value={config.enemy.defense}
                        min="0"
                        max="5000"
                        oninput={(e) =>
                            updateEnemy(
                                'defense',
                                Math.min(5000, Math.max(0, parseInt((e.target as HTMLInputElement).value) || 0))
                            )}
                        class="flex-1 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs tabular-nums text-[var(--theme-modal-text)] outline-none"
                    />
                </div>
            </div>
        </div>
    </div>

    <!-- Resistances card -->
    <div class="rounded-lg border border-white/10 bg-white/[0.02] p-3.5">
        <span class="text-xs font-medium text-[var(--theme-modal-text)]/70 block mb-3">抗性</span>
        <div class="grid grid-cols-2 gap-x-3 gap-y-1">
            {#each sortedResistanceKeys as el}
                {@const val = config.enemy.resistances[el]}
                <div class="flex items-center gap-1.5 rounded-md bg-white/[0.015] px-2 py-1.5">
                    <span class="text-xs font-medium w-7 shrink-0" style="color: {elementColor(el)}">{el}</span>
                    <input
                        type="number"
                        value={val}
                        min="-100"
                        max="100"
                        oninput={(e) =>
                            updateResistance(
                                el,
                                Math.min(100, Math.max(-100, parseInt((e.target as HTMLInputElement).value) || 0))
                            )}
                        class="w-12 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-xs text-right tabular-nums text-[var(--theme-modal-text)] outline-none"
                    />
                    <span class="text-[10px] text-[var(--theme-modal-text)]/20 w-2.5 shrink-0">%</span>
                    <button
                        onclick={() => updateResistance(el, Math.max(-100, val - STEP))}
                        class="rounded p-0.5 text-[var(--theme-modal-text)]/20 transition-colors hover:text-[var(--theme-modal-text)]/60 hover:bg-white/5"
                    >
                        <Icon icon="mdi:minus" class="size-3.5" />
                    </button>
                    <button
                        onclick={() => updateResistance(el, Math.min(100, val + STEP))}
                        class="rounded p-0.5 text-[var(--theme-modal-text)]/20 transition-colors hover:text-[var(--theme-modal-text)]/60 hover:bg-white/5"
                    >
                        <Icon icon="mdi:plus" class="size-3.5" />
                    </button>
                </div>
            {/each}
        </div>
    </div>

    <!-- Damage reduction card -->
    <div class="rounded-lg border border-white/10 bg-white/[0.02] p-3.5">
        <div class="flex items-center gap-2">
            <span class="text-xs font-medium text-[var(--theme-modal-text)]/70">免伤率</span>
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
                    class="w-16 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-right tabular-nums text-[var(--theme-modal-text)] outline-none"
                />
                <span class="text-[10px] text-[var(--theme-modal-text)]/30 w-3">%</span>
                <button
                    onclick={() =>
                        updateEnemy('dmgReduction', Math.min(100, Math.max(0, config.enemy.dmgReduction - STEP)))}
                    class="rounded p-0.5 text-[var(--theme-modal-text)]/20 transition-colors hover:text-[var(--theme-modal-text)]/60 hover:bg-white/5"
                >
                    <Icon icon="mdi:minus" class="size-3.5" />
                </button>
                <button
                    onclick={() =>
                        updateEnemy('dmgReduction', Math.min(100, Math.max(0, config.enemy.dmgReduction + STEP)))}
                    class="rounded p-0.5 text-[var(--theme-modal-text)]/20 transition-colors hover:text-[var(--theme-modal-text)]/60 hover:bg-white/5"
                >
                    <Icon icon="mdi:plus" class="size-3.5" />
                </button>
            </div>
        </div>
    </div>
</div>
