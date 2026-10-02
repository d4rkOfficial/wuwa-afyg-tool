<script lang="ts">
    /** @desc 副词条选择弹窗（工程-词条配置页与词条集的方案编辑器共用）：已存在的词条置灰不可重复选择 */
    import Modal from '$lib/components/layout/modal.svelte'
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import { SUBSTAT_OPTIONS } from '$lib/consts/stat-data'

    interface Props extends ComponentsProps {
        open: boolean
        /** @desc 该声骸已有的副词条类型（置灰） */
        existingTypes: string[]
        onpick: (label: string) => void
        onclose: () => void
    }

    let { open, existingTypes, onpick, onclose, class: className, style: styleProp }: Props = $props()
</script>

<Modal {open} {onclose} backdropClose class={className} style={styleProp}>
    {#snippet title()}
        <Icon icon="mdi:tune-variant" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        <span>选择副词条</span>
    {/snippet}
    <div class="theme-scrollbar space-y-0.5 max-h-56 overflow-y-auto">
        {#each SUBSTAT_OPTIONS as opt (opt.label)}
            {@const exists = existingTypes.includes(opt.label)}
            <button
                onclick={() => {
                    if (!exists) onpick(opt.label)
                }}
                disabled={exists}
                data-sf="widget"
                data-sf-flat
                class={[
                    'flex w-full items-center gap-2 rounded-none border px-3 py-2 text-xs text-left transition-colors',
                    exists
                        ? 'border-(--theme-divider-border) text-(--theme-modal-text)/20 cursor-not-allowed'
                        : 'border-(--theme-divider-border) text-(--theme-modal-text) hover:border-(--theme-accent-bg)'
                ].join(' ')}
                style="--sf-base: var(--theme-input-bg)"
            >
                <span class="flex-1 font-black">{opt.label}</span>
                <span class="text-[10px] font-black text-(--theme-modal-text)/40">{opt.unit}</span>
                {#if exists}
                    <Icon icon="mdi:check" class="size-3 shrink-0 text-(--theme-accent-text)" />
                {/if}
            </button>
        {/each}
    </div>
</Modal>
