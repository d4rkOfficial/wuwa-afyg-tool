<script lang="ts">
    import { getToasts, removeToast } from '$lib/data/toast.svelte'
    import { getToastPosition } from '$lib/data/interaction-prefs.svelte'
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

    let toasts = $derived(getToasts())
    let position = $derived(getToastPosition())

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

    /** @desc 容器定位（设置 → 交互相关里可选）：左右角/正上下，none 时不渲染 */
    const POSITION_CLASS: Record<string, string> = {
        'top-right': 'top-4 right-4 items-end',
        'top-left': 'top-4 left-4 items-start',
        'top-center': 'top-4 left-1/2 -translate-x-1/2 items-center',
        'bottom-right': 'bottom-4 right-4 items-end',
        'bottom-left': 'bottom-4 left-4 items-start',
        'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2 items-center'
    }

    let positionClass = $derived(POSITION_CLASS[position] ?? POSITION_CLASS['top-right'])
    /** @desc 从下方弹出的位置用上滑动画，其余用下滑 */
    let fromBottom = $derived(position.startsWith('bottom'))
</script>

{#if position !== 'none' && toasts.length > 0}
    <div
        class={['pointer-events-none fixed z-50 flex flex-col gap-2', positionClass, className || ''].join(' ')}
        style={styleProp}
    >
        {#each toasts as toast (toast.id)}
            <div
                class={[
                    'pointer-events-auto flex items-center gap-3 rounded-none px-5 py-3 text-sm shadow-xl',
                    'theme-glass-surface bg-(--theme-toast-bg) text-(--theme-toast-text)',
                    typeStyles[toast.type] || typeStyles.info,
                    typeBgStyles[toast.type] || '',
                    'min-w-72 max-w-md',
                    fromBottom ? 'animate-slide-up' : 'animate-slide-down'
                ].join(' ')}
                style={mergedStyle}
                role="alert"
            >
                {#if toast.type === 'success'}
                    <Icon icon="mdi:check-circle" class="shrink-0 size-5" />
                {:else if toast.type === 'error'}
                    <Icon icon="mdi:alert-circle" class="shrink-0 size-5" />
                {:else}
                    <Icon icon="mdi:information" class="shrink-0 size-5" />
                {/if}
                <span class="flex-1">{toast.message}</span>
                <button
                    onclick={() => removeToast(toast.id)}
                    class="shrink-0 rounded-none p-0.5 opacity-50 transition-opacity hover:opacity-100"
                    aria-label="Dismiss"
                >
                    <Icon icon="mdi:close" class="size-4" />
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
    @keyframes slide-up {
        from {
            opacity: 0;
            transform: translateY(12px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    :global(.animate-slide-down) {
        animation: slide-down 0.2s ease-out;
    }
    :global(.animate-slide-up) {
        animation: slide-up 0.2s ease-out;
    }
</style>
