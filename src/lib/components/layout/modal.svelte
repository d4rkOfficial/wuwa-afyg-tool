<script lang="ts">
    import type { Snippet } from 'svelte'
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {
        open: boolean
        onclose?: () => void
        children?: Snippet
        title?: Snippet
    }

    let {
        open,
        onclose,
        backgroundImage,
        textColor,
        class: className,
        style: styleProp,
        children,
        title
    }: Props = $props()

    let mergedStyle = $derived(
        [
            backgroundImage ? `background: ${backgroundImage}` : '',
            textColor ? `color: ${textColor}` : '',
            styleProp || ''
        ]
            .filter(Boolean)
            .join(';')
    )

    function handleBackdropClick(e: MouseEvent) {
        if (e.target === e.currentTarget) onclose?.()
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') onclose?.()
    }
</script>

{#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
        onclick={handleBackdropClick}
        onkeydown={handleKeydown}
    >
        <div
            class={[
                'relative max-h-[85vh] min-w-80 max-w-lg overflow-y-auto rounded-xl p-6 shadow-2xl',
                'bg-[var(--theme-modal-bg)] text-[var(--theme-modal-text)]',
                className || ''
            ]
                .filter(Boolean)
                .join(' ')}
            style={mergedStyle}
            role="dialog"
            aria-modal="true"
        >
            <button
                onclick={onclose}
                class="absolute right-3 top-3 rounded p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Close"
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24">
                    <path
                        fill="currentColor"
                        d="M18.3 5.71a1 1 0 0 0-1.42 0L12 10.59L7.12 5.71a1 1 0 1 0-1.42 1.42L10.59 12l-4.89 4.88a1 1 0 1 0 1.42 1.42L12 13.41l4.88 4.89a1 1 0 0 0 1.42-1.42L13.41 12l4.89-4.88a1 1 0 0 0 0-1.41"
                    />
                </svg>
            </button>
            {#if title}
                <div class="mb-4 pr-6 text-base font-semibold">
                    {@render title()}
                </div>
            {/if}
            <div>
                {@render children?.()}
            </div>
        </div>
    </div>
{/if}
