<script lang="ts">
    /** @desc 主词条选择弹窗（词条集的方案编辑器用）：列出该 cost 可选主词条，数值固定取池子上限 */
    import Modal from '$lib/components/layout/modal.svelte'
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import { MAIN_STAT_POOL } from '$lib/consts/stat-data'

    interface Props extends ComponentsProps {
        open: boolean
        /** @desc 该声骸的 cost（决定可选主词条池） */
        cost: number
        /** @desc 当前主词条类型（打勾） */
        current: string | null
        onpick: (stat: { type: string; value: number; unit: string } | null) => void
        onclose: () => void
    }

    let { open, cost, current, onpick, onclose, class: className, style: styleProp }: Props = $props()

    const pool = $derived(MAIN_STAT_POOL[cost] ?? [])
</script>

<Modal {open} {onclose} backdropClose class={className} style={styleProp}>
    {#snippet title()}
        <Icon icon="mdi:tune-variant" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        <span>选择主词条（{cost} COST）</span>
    {/snippet}
    <div class="theme-scrollbar space-y-0.5 max-h-56 overflow-y-auto">
        <button
            onclick={() => onpick(null)}
            data-sf="widget"
            data-sf-flat
            class="flex w-full items-center gap-2 rounded-none border border-(--theme-divider-border) px-3 py-2 text-xs text-left text-(--theme-modal-text)/40 transition-colors hover:border-(--theme-accent-bg)"
            style="--sf-base: var(--theme-input-bg)">未选择</button
        >
        {#each pool as opt (opt.label)}
            <button
                onclick={() => onpick({ type: opt.label, value: opt.maxValue, unit: opt.unit })}
                data-sf="widget"
                data-sf-flat
                class="flex w-full items-center gap-2 rounded-none border border-(--theme-divider-border) px-3 py-2 text-xs text-left text-(--theme-modal-text) transition-colors hover:border-(--theme-accent-bg)"
                style="--sf-base: var(--theme-input-bg)"
            >
                <span class="flex-1 font-black">{opt.label}</span>
                <span class="text-[10px] font-black text-(--theme-modal-text)/40">{opt.maxValue}{opt.unit}</span>
                {#if current === opt.label}
                    <Icon icon="mdi:check" class="size-3 shrink-0 text-(--theme-accent-text)" />
                {/if}
            </button>
        {/each}
    </div>
</Modal>
