<script lang="ts">
    import type { ComponentsProps } from '$lib/types'
    import { getHelpState, closeHelp } from '$lib/data/help.svelte'
    import Icon from '@iconify/svelte'

    interface Props extends ComponentsProps {}

    let { class: className, style: styleProp }: Props = $props()

    let state = $derived(getHelpState())

    function handleBackdropClick(e: MouseEvent) {
        if (e.target === e.currentTarget) closeHelp()
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') closeHelp()
    }
</script>

{#if state.open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="animate-fade-in fixed inset-0 z-60 flex items-center justify-center backdrop-blur-sm"
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        onclick={handleBackdropClick}
        onkeydown={handleKeydown}
        role="presentation"
    >
        <div
            class={[
                'animate-pop-in theme-scrollbar relative max-h-[85vh] w-[90vw] max-w-4xl overflow-y-auto rounded-none p-6 shadow-2xl',
                'text-(--theme-modal-text)',
                className || ''
            ]
                .filter(Boolean)
                .join(' ')}
            style="background: color-mix(in srgb, var(--theme-modal-bg) var(--theme-modal-opacity, 75%), transparent); {styleProp}"
            role="dialog"
            aria-modal="true"
        >
            <button
                onclick={closeHelp}
                class="absolute right-3 top-3 rounded-none p-1 text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)/70"
                aria-label="关闭"
            >
                <Icon icon="mdi:close" class="size-4.5" />
            </button>
            {#if state.title}
                <div
                    class="mb-4 flex items-center gap-2 border-b pb-2.5 pr-6 text-base font-black tracking-tight"
                    style="border-color: var(--theme-divider-border);"
                >
                    <Icon
                        icon="mdi:help-circle-outline"
                        class="size-4 shrink-0"
                        style="color: var(--theme-accent-text);"
                    />
                    <span>{state.title}</span>
                </div>
            {/if}
            {#each state.items as item}
                <div
                    class="mb-3 rounded-none border p-3 last:mb-0"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                >
                    <div class="text-sm font-black tracking-tight text-(--theme-modal-text)">{item.name}</div>
                    <div class="mt-0.5 mb-1 text-xs text-(--theme-modal-text)/70">{item.description}</div>
                    <div class="text-xs leading-relaxed text-(--theme-modal-text)/40">{item.content}</div>
                </div>
            {/each}
        </div>
    </div>
{/if}
