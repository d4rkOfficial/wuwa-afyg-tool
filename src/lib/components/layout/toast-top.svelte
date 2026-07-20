<script lang="ts">
    import { getToasts, removeToast } from '$lib/data/toast.svelte'
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {}

    let { backgroundImage, textColor, class: className, style: styleProp }: Props = $props()

    let mergedStyle = $derived(
        [
            backgroundImage ? `background: ${backgroundImage}` : '',
            textColor ? `color: ${textColor}` : '',
            styleProp || ''
        ]
            .filter(Boolean)
            .join(';')
    )

    let toasts = $derived(getToasts().filter((t) => t.position === 'top'))

    let typeIcons: Record<string, string> = {
        info: 'mdi:information',
        success: 'mdi:check-circle',
        error: 'mdi:alert-circle'
    }
</script>

{#if toasts.length > 0}
    <div
        class={[
            'pointer-events-none fixed left-1/2 top-4 z-50 flex -translate-x-1/2 flex-col gap-2',
            className || ''
        ].join(' ')}
        style={styleProp}
    >
        {#each toasts as toast (toast.id)}
            <div
                class={[
                    'pointer-events-auto flex items-center gap-3 rounded-xl px-5 py-3 text-sm shadow-lg',
                    'bg-[var(--theme-toast-top-bg)] text-[var(--theme-toast-top-text)]',
                    'min-w-72 max-w-md',
                    'animate-slide-down'
                ].join(' ')}
                style={mergedStyle}
                role="alert"
            >
                <Icon icon={typeIcons[toast.type] || typeIcons.info} class="shrink-0" />
                <span class="flex-1">{toast.message}</span>
                <button
                    onclick={() => removeToast(toast.id)}
                    class="shrink-0 rounded p-0.5 opacity-50 transition-opacity hover:opacity-100"
                    aria-label="Dismiss"
                >
                    <Icon icon="mdi:close" />
                </button>
            </div>
        {/each}
    </div>
{/if}

<style>
    @keyframes slide-down {
        from {
            opacity: 0;
            transform: translateY(-12px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    :global(.animate-slide-down) {
        animation: slide-down 0.25s ease-out;
    }
</style>
