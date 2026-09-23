<script lang="ts">
    /** @desc 主词条选择弹窗（词条集的方案编辑器用）：列出该 cost 可选主词条，数值固定取池子上限 */
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

{#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        class="animate-fade-in fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
        onclick={onclose}
    >
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            data-sf="modal"
            class="animate-pop-in w-72 max-h-80 rounded-none border p-4 shadow-2xl {className ?? ''}"
            style="border-color: var(--theme-divider-border); {styleProp || ''}"
            onclick={(e) => e.stopPropagation()}
        >
            <div
                class="mb-3 flex items-center gap-2 border-b pb-2.5"
                style="border-color: var(--theme-divider-border);"
            >
                <Icon icon="mdi:tune-variant" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
                <span class="text-sm font-black tracking-tight text-(--theme-modal-text)"
                    >选择主词条（{cost} COST）</span
                >
                <button
                    onclick={onclose}
                    class="ml-auto rounded-none p-0.5 text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)/70"
                    aria-label="关闭"
                >
                    <Icon icon="mdi:close" class="size-4" />
                </button>
            </div>
            <div class="theme-scrollbar space-y-0.5 max-h-56 overflow-y-auto">
                <button
                    onclick={() => onpick(null)}
                    class="flex w-full items-center gap-2 rounded-none border border-(--theme-divider-border) bg-(--theme-input-bg) px-3 py-2 text-xs text-left text-(--theme-modal-text)/40 transition-colors hover:border-(--theme-accent-bg)"
                    >未选择</button
                >
                {#each pool as opt (opt.label)}
                    <button
                        onclick={() => onpick({ type: opt.label, value: opt.maxValue, unit: opt.unit })}
                        class="flex w-full items-center gap-2 rounded-none border border-(--theme-divider-border) bg-(--theme-input-bg) px-3 py-2 text-xs text-left text-(--theme-modal-text) transition-colors hover:border-(--theme-accent-bg)"
                    >
                        <span class="flex-1 font-black">{opt.label}</span>
                        <span class="text-[10px] font-black text-(--theme-modal-text)/40">{opt.maxValue}{opt.unit}</span
                        >
                        {#if current === opt.label}
                            <Icon icon="mdi:check" class="size-3 shrink-0 text-(--theme-accent-text)" />
                        {/if}
                    </button>
                {/each}
            </div>
        </div>
    </div>
{/if}
