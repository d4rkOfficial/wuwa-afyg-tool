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
                'animate-pop-in theme-scrollbar relative max-h-[85vh] w-[90vw] max-w-4xl overflow-y-auto rounded-xl p-6 shadow-2xl',
                'text-(--theme-modal-text)',
                className || ''
            ]
                .filter(Boolean)
                .join(' ')}
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); {styleProp}"
            role="dialog"
            aria-modal="true"
        >
            <button
                onclick={closeHelp}
                class="absolute right-3 top-3 rounded p-1 transition-colors hover:bg-white/10"
                style="color: var(--theme-modal-text); opacity: 0.4;"
                aria-label="关闭"
            >
                <Icon icon="mdi:close" class="size-4.5" />
            </button>
            {#if state.title}
                <div class="mb-4 pr-6 text-base font-semibold">{state.title}</div>
            {/if}
            {#each state.items as item}
                <div class="mb-5 last:mb-0">
                    <div class="text-sm font-semibold mb-0.5">{item.name}</div>
                    <div class="text-xs opacity-70 mb-1">{item.description}</div>
                    <div class="text-xs opacity-50 leading-relaxed">{item.content}</div>
                </div>
            {/each}
        </div>
    </div>
{/if}
