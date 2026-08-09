<script lang="ts">
    import type { Snippet } from 'svelte'
    import { fade } from 'svelte/transition'
    import { popOut } from '$lib/utils/motion'
    import type { ComponentsProps } from '$lib/types'
    import Icon from '@iconify/svelte'

    interface Props extends ComponentsProps {
        open: boolean
        onclose?: () => void
        backdropClose?: boolean
        children?: Snippet
        title?: Snippet
        footer?: Snippet
    }

    let {
        open,
        onclose,
        backdropClose = true,
        backgroundImage,
        textColor,
        class: className,
        style: styleProp,
        children,
        title,
        footer
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
        // rAF 节流：mousemove 只记录目标值，每帧合并一次写入
        let pending: number | null = null
        let target = modalWidth ?? 640
        const onMove = (e: MouseEvent) => {
            const vw = document.documentElement.clientWidth
            target = Math.max(320, Math.min(vw - 40, e.clientX * 2))
            if (pending !== null) return
            pending = requestAnimationFrame(() => {
                pending = null
                modalWidth = target
            })
        }
        const onUp = () => {
            if (pending !== null) {
                cancelAnimationFrame(pending)
                pending = null
            }
            modalWidth = target
            modalResizing = false
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            if (pending !== null) {
                cancelAnimationFrame(pending)
                pending = null
            }
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
        if (backdropClose && e.target === e.currentTarget) onclose?.()
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') onclose?.()
    }
</script>

{#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="animate-fade-in fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5))"
        onclick={handleBackdropClick}
        onkeydown={handleKeydown}
        out:fade={{ duration: 130 }}
    >
        <div
            bind:this={modalEl}
            class={[
                'animate-pop-in theme-glass-surface theme-scrollbar relative max-h-[85vh] min-w-80 rounded-xl p-6 shadow-2xl',
                footer ? 'flex flex-col overflow-hidden' : 'overflow-y-auto',
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
            out:popOut
        >
            <button
                onclick={onclose}
                class="absolute right-3 top-3 rounded p-1 text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)/70"
                aria-label="Close"
            >
                <Icon icon="mdi:close" class="size-4.5" />
            </button>
            <div
                class="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-10 transition-colors hover:bg-(--theme-accent-bg)/50 rounded-r-xl"
                onmousedown={handleResizeStart}
            ></div>
            {#if title}
                <div class="mb-4 pr-6 text-base font-semibold {footer ? 'shrink-0' : ''}">
                    {@render title()}
                </div>
            {/if}
            {#if footer}
                <div class="theme-scrollbar min-h-0 flex-1 overflow-y-auto">
                    {@render children?.()}
                </div>
                <div class="shrink-0">
                    {@render footer()}
                </div>
            {:else}
                <div>
                    {@render children?.()}
                </div>
            {/if}
        </div>
    </div>
{/if}
