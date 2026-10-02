<script lang="ts">
    import Icon from '@iconify/svelte'
    import { fade } from 'svelte/transition'
    import type { ComponentsProps } from '$lib/types'
    import { mergeClass, mergeComponentsStyle } from '$lib/utils/component-style'
    import { MOTION_MS, slideParams } from '$lib/utils/motion'

    interface MenuItem {
        label: string
        action: () => void
        icon?: string
        disabled?: boolean
    }

    interface Props extends ComponentsProps {
        x: number
        y: number
        items: MenuItem[]
        open: boolean
        onclose?: () => void
    }

    let { x, y, items, open, onclose, backgroundImage, textColor, class: className, style: styleProp }: Props = $props()

    let mergedStyle = $derived(mergeComponentsStyle({ backgroundImage, textColor, style: styleProp }))

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
    <!-- @desc 退场动效：挂在遮罩这一层而不是里面那块菜单面板上——面板负责进场（`animate-pop-in`），
         同一节点再挂过渡就会与它叠成双重动画；本层没有 animate-* 类，淡出它即连菜单一起淡出
         （opacity 分组作用于整棵子树）。时长取 --motion-fast 档：浮层菜单要短促，与 modal 外壳
         130ms 的退场同感；减弱动态效果由 slideParams 压到 1ms。 -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-(--z-modal)"
        onclick={onclose}
        oncontextmenu={(e) => e.preventDefault()}
        out:fade={slideParams(MOTION_MS.fast)}
    >
        <div
            class={mergeClass([
                'animate-pop-in theme-glass-surface absolute min-w-36 rounded-none border border-(--theme-divider-border) py-1',
                'bg-(--theme-context-menu-bg) text-(--theme-context-menu-text)',
                className || ''
            ])}
            bind:this={menuEl}
            style="left: {x}px; top: {y}px; {mergedStyle}"
            onclick={(e) => e.stopPropagation()}
            role="menu"
            tabindex="-1"
        >
            {#each items as item (item.label)}
                <button
                    role="menuitem"
                    disabled={item.disabled}
                    onclick={() => handleItemClick(item)}
                    class={[
                        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
                        item.disabled
                            ? 'cursor-not-allowed opacity-40'
                            : 'hover:bg-(--theme-context-menu-bg-focused) hover:text-(--theme-context-menu-text-focused) focus-visible:bg-(--theme-context-menu-bg-focused) focus-visible:text-(--theme-context-menu-text-focused)',
                        'focus-visible:outline-none'
                    ].join(' ')}
                >
                    {#if item.icon === 'mdi:rename-outline'}
                        <Icon icon="mdi:rename-outline" class="size-4 shrink-0" />
                    {:else if item.icon === 'mdi:rename-box'}
                        <Icon icon="mdi:rename-box" class="size-4 shrink-0" />
                    {:else if item.icon === 'mdi:content-copy'}
                        <Icon icon="mdi:content-copy" class="size-4 shrink-0" />
                    {:else if item.icon === 'mdi:file-export'}
                        <Icon icon="mdi:file-export" class="size-4 shrink-0" />
                    {:else if item.icon === 'mdi:share-variant'}
                        <Icon icon="mdi:share-variant" class="size-4 shrink-0" />
                    {:else if item.icon === 'mdi:archive-outline'}
                        <Icon icon="mdi:archive-outline" class="size-4 shrink-0" />
                    {:else if item.icon === 'mdi:delete-outline'}
                        <Icon icon="mdi:delete-outline" class="size-4 shrink-0" />
                    {:else if item.icon === 'mdi:crown-outline'}
                        <Icon icon="mdi:crown-outline" class="size-4 shrink-0" />
                    {:else if item.icon === 'mdi:minus-circle-outline'}
                        <Icon icon="mdi:minus-circle-outline" class="size-4 shrink-0" />
                    {/if}
                    {item.label}
                </button>
            {/each}
        </div>
    </div>
{/if}
