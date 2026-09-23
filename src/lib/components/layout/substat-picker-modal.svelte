<script lang="ts">
    /** @desc 副词条选择弹窗（工程-词条配置页与词条集的方案编辑器共用）：已存在的词条置灰不可重复选择 */
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

    const mergedStyle = $derived(
        `border-color: var(--theme-divider-border); ${styleProp || ''}`
    )
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
            class="animate-pop-in w-72 max-h-80 rounded-none border p-4 shadow-2xl backdrop-blur-lg {className ?? ''}"
            style={mergedStyle}
            onclick={(e) => e.stopPropagation()}
        >
            <div
                class="mb-3 flex items-center gap-2 border-b pb-2.5"
                style="border-color: var(--theme-divider-border);"
            >
                <Icon icon="mdi:tune-variant" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
                <span class="text-sm font-black tracking-tight text-(--theme-modal-text)">选择副词条</span>
                <button
                    onclick={onclose}
                    class="ml-auto rounded-none p-0.5 text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)/70"
                    aria-label="关闭"
                >
                    <Icon icon="mdi:close" class="size-4" />
                </button>
            </div>
            <div class="theme-scrollbar space-y-0.5 max-h-56 overflow-y-auto">
                {#each SUBSTAT_OPTIONS as opt (opt.label)}
                    {@const exists = existingTypes.includes(opt.label)}
                    <button
                        onclick={() => {
                            if (!exists) onpick(opt.label)
                        }}
                        disabled={exists}
                        class={[
                            'flex w-full items-center gap-2 rounded-none border px-3 py-2 text-xs text-left transition-colors',
                            exists
                                ? 'border-(--theme-divider-border) bg-(--theme-input-bg) text-(--theme-modal-text)/20 cursor-not-allowed'
                                : 'border-(--theme-divider-border) bg-(--theme-input-bg) text-(--theme-modal-text) hover:border-(--theme-accent-bg)'
                        ].join(' ')}
                    >
                        <span class="flex-1 font-black">{opt.label}</span>
                        <span class="text-[10px] font-black text-(--theme-modal-text)/40">{opt.unit}</span>
                        {#if exists}
                            <Icon icon="mdi:check" class="size-3 shrink-0 text-(--theme-accent-text)" />
                        {/if}
                    </button>
                {/each}
            </div>
        </div>
    </div>
{/if}
