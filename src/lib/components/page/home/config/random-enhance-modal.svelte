<script lang="ts">
    import { ROLLABLE_TYPES, simulateEnhancement } from '$lib/consts/substat-roll-data'
    import type { EchoStat } from '$lib/types/game-data'
    import Icon from '@iconify/svelte'

    interface Props {
        existingTypes: string[]
        onclose: () => void
        onresult: (result: { substats: EchoStat[]; attempts: number }) => void
    }

    let { existingTypes, onclose, onresult }: Props = $props()

    const available = ROLLABLE_TYPES.filter((t) => !existingTypes.includes(t))
    const PRESELECT = ['暴击率', '暴击伤害'].filter((t) => available.includes(t))
    let selected = $state<string[]>(PRESELECT)
    let running = $state(false)

    function toggleType(type: string) {
        if (selected.includes(type)) {
            selected = selected.filter((t) => t !== type)
        } else if (selected.length < 5) {
            selected = [...selected, type]
        }
    }

    function handleStart() {
        if (selected.length === 0) return
        running = true
        setTimeout(() => {
            const result = simulateEnhancement(selected)
            onresult(result)
            running = false
            onclose()
        }, 50)
    }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
    style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
    class="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
    onclick={() => !running && onclose()}
>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
        class="w-72 rounded-xl border p-4 shadow-2xl backdrop-blur-lg"
        style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); border-color: var(--theme-divider-border);"
        onclick={(e) => e.stopPropagation()}
    >
        <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium text-(--theme-modal-text)">随机强化目标</span>
            <button
                onclick={onclose}
                disabled={running}
                class="rounded p-0.5 text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)/70"
            >
                <Icon icon="mdi:close" class="size-4" />
            </button>
        </div>
        <div class="text-xs text-(--theme-modal-text)/50 mb-2">选择希望出现的副词条（最多 5 个）</div>
        <div class="space-y-0.5 max-h-56 overflow-y-auto mb-3">
            {#each available as type}
                {@const isSelected = selected.includes(type)}
                <button
                    onclick={() => toggleType(type)}
                    disabled={running}
                    class={[
                        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-left transition-colors',
                        isSelected
                            ? 'text-(--theme-modal-text)'
                            : 'text-(--theme-modal-text)/60 hover:bg-(--theme-input-bg)'
                    ].join(' ')}
                    style={isSelected ? 'background: color-mix(in srgb, var(--theme-accent-bg) 12%, transparent);' : ''}
                >
                    <span class="flex-1">{type}</span>
                    {#if isSelected}
                        <Icon icon="mdi:check" class="size-3 shrink-0" />
                    {/if}
                </button>
            {/each}
        </div>
        <button
            onclick={handleStart}
            disabled={selected.length === 0 || running}
            class={[
                'w-full rounded-lg px-3 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5',
                selected.length > 0 && !running
                    ? 'hover:opacity-80'
                    : 'bg-(--theme-input-bg) text-(--theme-modal-text)/30 cursor-not-allowed'
            ].join(' ')}
            style={selected.length > 0 && !running
                ? 'background: var(--theme-accent-bg); color: var(--theme-btn-text, #fff);'
                : ''}
        >
            {#if running}
                <Icon icon="mdi:loading" class="size-3.5 animate-spin" />
                强化中…
            {:else}
                <Icon icon="mdi:dice-5" class="size-3.5" />
                开始强化
            {/if}
        </button>
    </div>
</div>
