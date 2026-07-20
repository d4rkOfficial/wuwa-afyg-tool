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

    let toasts = $derived(getToasts().filter((t) => t.position === 'bottom-right'))

    let typeStyles: Record<string, string> = {
        info: 'border-l-2 border-l-sky-500',
        success: 'border-l-2 border-l-emerald-500',
        error: 'border-l-2 border-l-red-500'
    }

    let typeBgStyles: Record<string, string> = {
        info: 'bg-sky-500/10',
        success: 'bg-emerald-500/10',
        error: 'bg-red-500/10'
    }

    let typeIcons: Record<string, string> = {
        info: 'mdi:information',
        success: 'mdi:check-circle',
        error: 'mdi:alert-circle'
    }
</script>

{#if toasts.length > 0}
    <div
        class={['pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col gap-3', className || ''].join(' ')}
        style={styleProp}
    >
        {#each toasts as toast (toast.id)}
            <div
                class={[
                    'pointer-events-auto flex items-center gap-3 rounded-xl px-5 py-3.5 text-sm shadow-xl',
                    'bg-[var(--theme-toast-bg)] text-[var(--theme-toast-text)] backdrop-blur-lg',
                    typeStyles[toast.type] || typeStyles.info,
                    typeBgStyles[toast.type] || '',
                    'animate-slide-up'
                ].join(' ')}
                style={mergedStyle}
                role="alert"
            >
                <Icon icon={typeIcons[toast.type] || typeIcons.info} class="shrink-0 size-5" />
                <span class="flex-1 text-base">{toast.message}</span>
                <button
                    onclick={() => removeToast(toast.id)}
                    class="shrink-0 rounded p-0.5 opacity-50 transition-opacity hover:opacity-100"
                    aria-label="Dismiss"
                >
                    <Icon icon="mdi:close" class="size-4" />
                </button>
            </div>
        {/each}
    </div>
{/if}

<style>
    @keyframes slide-up {
        from {
            opacity: 0;
            transform: translateY(8px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    :global(.animate-slide-up) {
        animation: slide-up 0.2s ease-out;
    }
</style>
