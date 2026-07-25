<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'

    interface MenuItem {
        label: string
        action: () => void
        icon?: string
    }

    interface Props extends ComponentsProps {
        x: number
        y: number
        items: MenuItem[]
        open: boolean
        onclose?: () => void
    }

    let { x, y, items, open, onclose, backgroundImage, textColor, class: className, style: styleProp }: Props = $props()

    let mergedStyle = $derived(
        [
            backgroundImage ? `background: ${backgroundImage}` : '',
            textColor ? `color: ${textColor}` : '',
            styleProp || ''
        ]
            .filter(Boolean)
            .join(';')
    )

    function handleItemClick(item: MenuItem) {
        item.action()
        onclose?.()
    }

    let menuEl: HTMLElement | undefined = $state()

    $effect(() => {
        if (!open || !menuEl) return
        requestAnimationFrame(() => {
            const r = menuEl!.getBoundingClientRect()
            const cw = document.documentElement.clientWidth
            const ch = document.documentElement.clientHeight
            if (r.right > cw - 8) menuEl!.style.left = cw - r.width - 8 + 'px'
            if (r.bottom > ch - 8) menuEl!.style.top = ch - r.height - 8 + 'px'
        })
    })
</script>

{#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 z-50" onclick={onclose} oncontextmenu={(e) => e.preventDefault()}>
        <div
            class={[
                'absolute min-w-36 rounded-lg border border-white/10 py-1 shadow-xl backdrop-blur-lg',
                'bg-(--theme-context-menu-bg) text-(--theme-context-menu-text)',
                className || ''
            ]
                .filter(Boolean)
                .join(' ')}
            bind:this={menuEl}
            style="left: {x}px; top: {y}px; {mergedStyle}"
            onclick={(e) => e.stopPropagation()}
            role="menu"
            tabindex="-1"
        >
            {#each items as item}
                <button
                    role="menuitem"
                    onclick={() => handleItemClick(item)}
                    class={[
                        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
                        'hover:bg-(--theme-context-menu-bg-focused) hover:text-(--theme-context-menu-text-focused)',
                        'focus-visible:bg-(--theme-context-menu-bg-focused) focus-visible:text-(--theme-context-menu-text-focused)',
                        'focus-visible:outline-none'
                    ].join(' ')}
                >
                    {#if item.icon === 'mdi:rename-outline'}
                        <Icon icon="mdi:rename-outline" class="size-4 shrink-0" />
                    {:else if item.icon === 'mdi:content-copy'}
                        <Icon icon="mdi:content-copy" class="size-4 shrink-0" />
                    {:else if item.icon === 'mdi:file-export'}
                        <Icon icon="mdi:file-export" class="size-4 shrink-0" />
                    {:else if item.icon === 'mdi:delete-outline'}
                        <Icon icon="mdi:delete-outline" class="size-4 shrink-0" />
                    {/if}
                    {item.label}
                </button>
            {/each}
        </div>
    </div>
{/if}
