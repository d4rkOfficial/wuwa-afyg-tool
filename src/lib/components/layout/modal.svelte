<script lang="ts">
    import type { Snippet } from 'svelte'
    import type { ComponentsProps } from '$lib/types'
    import Icon from '@iconify/svelte'

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

    let modalEl = $state<HTMLElement | undefined>()
    let modalWidth = $state<number | null>(null)
    let modalResizing = $state(false)

    $effect(() => {
        if (!modalResizing) return
        const onMove = (e: MouseEvent) => {
            const vw = document.documentElement.clientWidth
            modalWidth = Math.max(320, Math.min(vw - 40, e.clientX * 2))
        }
        const onUp = () => {
            modalResizing = false
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
        }
    })

    function handleResizeStart(e: MouseEvent) {
        e.preventDefault()
        if (modalEl) {
            modalWidth = modalEl.getBoundingClientRect().width
        }
        modalResizing = true
    }

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
        class="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5))"
        onclick={handleBackdropClick}
        onkeydown={handleKeydown}
    >
        <div
            bind:this={modalEl}
            class={[
                'relative max-h-[85vh] min-w-80 overflow-y-auto rounded-xl p-6 shadow-2xl',
                'text-(--theme-modal-text)',
                className || ''
            ]
                .filter(Boolean)
                .join(' ')}
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); max-width: calc(100vw - 40px); {modalWidth
                ? `width: ${modalWidth}px`
                : ''}; {mergedStyle}"
            role="dialog"
            aria-modal="true"
        >
            <button
                onclick={onclose}
                class="absolute right-3 top-3 rounded p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Close"
            >
                <Icon icon="mdi:close" class="size-4.5" />
            </button>
            <div
                class="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-10 transition-colors hover:bg-(--theme-accent-bg)/50 rounded-r-xl"
                onmousedown={handleResizeStart}
            ></div>
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
