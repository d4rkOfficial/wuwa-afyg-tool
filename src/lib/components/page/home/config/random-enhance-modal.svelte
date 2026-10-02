<script lang="ts">
    import { ROLLABLE_TYPES, simulateEnhancement } from '$lib/consts/substat-roll-data'
    import type { EchoStat } from '$lib/types/game-data'
    import type { ComponentsProps } from '$lib/types'
    import Icon from '@iconify/svelte'
    import Modal from '$lib/components/layout/modal.svelte'

    interface Props extends ComponentsProps {
        existingTypes: string[]
        onclose: () => void
        onresult: (result: { substats: EchoStat[]; attempts: number }) => void
    }

    let { existingTypes, onclose, onresult, class: className, style: styleProp }: Props = $props()

    const available = ROLLABLE_TYPES.filter((t) => !existingTypes.includes(t))
    const PRESELECT = available.filter((t) => t === '暴击率' || t === '暴击伤害')
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

<Modal open={true} {onclose} backdropClose class={className} style={styleProp}>
    {#snippet title()}
        <Icon icon="mdi:dice-5" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        <span>随机强化目标</span>
    {/snippet}
    <div class="mb-2 text-[10px] text-(--theme-modal-text)/40">选择希望出现的副词条（最多 5 个）</div>
    <div
        class="theme-scrollbar mb-3 max-h-56 space-y-0.5 overflow-y-auto border-b pb-3"
        style="border-color: var(--theme-divider-border);"
    >
        {#each available as type (type)}
            {@const isSelected = selected.includes(type)}
            <button
                onclick={() => toggleType(type)}
                disabled={running}
                data-sf="widget"
                data-sf-flat
                class={[
                    'flex w-full items-center gap-2 rounded-none border px-3 py-2 text-xs text-left transition-colors',
                    isSelected
                        ? 'border-(--theme-accent-bg) font-black text-(--theme-modal-text)'
                        : 'border-(--theme-divider-border) text-(--theme-modal-text)/60 hover:border-(--theme-accent-bg) hover:text-(--theme-modal-text)'
                ].join(' ')}
                style="--sf-base: var(--theme-input-bg);{isSelected
                    ? ' background: color-mix(in srgb, var(--theme-accent-bg) 12%, var(--sf-mix, transparent));'
                    : ''}"
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
            'w-full rounded-none px-3 py-2 text-xs font-black tracking-tight transition-colors flex items-center justify-center gap-1.5',
            selected.length > 0 && !running
                ? 'hover:opacity-80'
                : 'bg-(--theme-input-bg) text-(--theme-modal-text)/30 cursor-not-allowed'
        ].join(' ')}
        style={selected.length > 0 && !running
            ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);'
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
</Modal>
