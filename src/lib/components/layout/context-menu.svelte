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
</script>

{#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="fixed inset-0 z-50" onclick={onclose} oncontextmenu={(e) => e.preventDefault()}>
        <div
            class={[
                'absolute min-w-36 rounded-lg border border-white/10 py-1 shadow-xl backdrop-blur-lg',
                'bg-[var(--theme-context-menu-bg)] text-[var(--theme-context-menu-text)]',
                className || ''
            ]
                .filter(Boolean)
                .join(' ')}
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
                        'hover:bg-[var(--theme-context-menu-bg-focused)] hover:text-[var(--theme-context-menu-text-focused)]',
                        'focus-visible:bg-[var(--theme-context-menu-bg-focused)] focus-visible:text-[var(--theme-context-menu-text-focused)]',
                        'focus-visible:outline-none'
                    ].join(' ')}
                >
                    {#if item.icon}
                        <Icon icon={item.icon} class="size-4 shrink-0" />
                    {/if}
                    {item.label}
                </button>
            {/each}
        </div>
    </div>
{/if}
