<script lang="ts">
    import { getConfig, updateEnemy, updateResistance } from './config.store.svelte'
    import { RESISTANCE_KEYS } from './config.consts'

    let config = $derived(getConfig())
</script>

<div class="space-y-5">
    <div>
        <label class="text-xs font-medium text-[var(--theme-modal-text)]/70 block mb-2">类型</label>
        <div class="flex gap-2">
            {#each ['BOSS', '精英怪', '小怪'] as t}
                <button
                    onclick={() => updateEnemy('type', t as 'BOSS' | '精英怪' | '小怪')}
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

    <div>
        <label class="text-xs font-medium text-[var(--theme-modal-text)]/70 block mb-2">等级</label>
        <div class="flex items-center gap-3">
            <input
                type="range"
                min="0"
                max="150"
                value={config.enemy.level}
                oninput={(e) => updateEnemy('level', parseInt((e.target as HTMLInputElement).value))}
                class="flex-1 h-2 appearance-none cursor-pointer rounded-full accent-indigo-500 bg-white/10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-500 [&::-webkit-slider-thumb]:shadow-md"
            />
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
                class="w-16 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-right tabular-nums text-[var(--theme-modal-text)] outline-none"
            />
        </div>
    </div>

    <div>
        <label class="text-xs font-medium text-[var(--theme-modal-text)]/70 block mb-2">防御</label>
        <div class="flex items-center gap-3">
            <input
                type="range"
                min="0"
                max="2000"
                value={config.enemy.defense}
                oninput={(e) => updateEnemy('defense', parseInt((e.target as HTMLInputElement).value))}
                class="flex-1 h-2 appearance-none cursor-pointer rounded-full accent-indigo-500 bg-white/10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-500 [&::-webkit-slider-thumb]:shadow-md"
            />
            <input
                type="number"
                value={config.enemy.defense}
                min="0"
                max="2000"
                oninput={(e) =>
                    updateEnemy(
                        'defense',
                        Math.min(2000, Math.max(0, parseInt((e.target as HTMLInputElement).value) || 0))
                    )}
                class="w-20 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-right tabular-nums text-[var(--theme-modal-text)] outline-none"
            />
        </div>
    </div>

    <div>
        <label class="text-xs font-medium text-[var(--theme-modal-text)]/70 block mb-2">抗性</label>
        <div class="grid grid-cols-2 gap-3">
            {#each RESISTANCE_KEYS as el}
                <div>
                    <div class="flex items-center justify-between mb-1">
                        <span class="text-xs text-[var(--theme-modal-text)]/60">{el}</span>
                        <span class="text-xs tabular-nums text-[var(--theme-modal-text)]/40"
                            >{config.enemy.resistances[el]}%</span
                        >
                    </div>
                    <input
                        type="range"
                        min="-100"
                        max="100"
                        value={config.enemy.resistances[el]}
                        oninput={(e) => updateResistance(el, parseInt((e.target as HTMLInputElement).value))}
                        class="w-full h-2 appearance-none cursor-pointer rounded-full accent-indigo-500 bg-white/10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-500 [&::-webkit-slider-thumb]:shadow-md"
                    />
                </div>
            {/each}
        </div>
    </div>

    <div>
        <label class="text-xs font-medium text-[var(--theme-modal-text)]/70 block mb-2">免伤率</label>
        <div class="flex items-center gap-3">
            <input
                type="range"
                min="0"
                max="100"
                value={config.enemy.dmgReduction}
                oninput={(e) => updateEnemy('dmgReduction', parseInt((e.target as HTMLInputElement).value))}
                class="flex-1 h-2 appearance-none cursor-pointer rounded-full accent-indigo-500 bg-white/10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-500 [&::-webkit-slider-thumb]:shadow-md"
            />
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
                class="w-16 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-right tabular-nums text-[var(--theme-modal-text)] outline-none"
            />
        </div>
    </div>
</div>
