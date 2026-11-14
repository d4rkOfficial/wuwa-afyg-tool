<script lang="ts">
    import type { Snippet } from 'svelte'
    import type { ComponentsProps } from '$lib/types'
    import Icon from '@iconify/svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import { popOut } from '$lib/utils/motion'

    export interface SelectOption {
        value: string
        label: string
        icon?: string
    }

    interface Props extends ComponentsProps {
        options: SelectOption[]
        value: string
        onchange?: (value: string) => void
        placeholder?: string
        disabled?: boolean
        /** @desc 紧凑尺寸（行内条件编辑器等窄空间用；默认 md） */
        size?: 'sm' | 'md'
        renderOption?: Snippet<[SelectOption]>
    }

    let {
        options,
        value,
        onchange,
        placeholder = '请选择',
        disabled = false,
        size = 'md',
        renderOption,
        backgroundImage,
        textColor,
        class: className,
        style: styleProp
    }: Props = $props()

    let open = $state(false)
    let pos = $state<{ left: number; top: number; width: number } | null>(null)
    let triggerEl: HTMLButtonElement | undefined = $state()
    let overlayEl: HTMLDivElement | undefined = $state()
    let menuEl: HTMLDivElement | undefined = $state()

    /**
     * @desc 减弱动态效果跟随系统设置。
     * `layout.css` 的 `prefers-reduced-motion` 只关 CSS 动画/keyframes，管不到 JS 过渡，
     * 故按仓库既有做法（`ai-context-panel.svelte`）在这里自行判定。
     */
    let reducedMotion = $state(false)

    $effect(() => {
        const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
        reducedMotion = motion.matches
        const onMotion = (e: MediaQueryListEvent) => (reducedMotion = e.matches)
        motion.addEventListener('change', onMotion)
        return () => motion.removeEventListener('change', onMotion)
    })

    /** @desc 关场动效参数：减弱动态效果时压到 1ms（保留过渡钩子，避免结构分支变化） */
    let outParams = $derived(reducedMotion ? { duration: 1 } : undefined)

    let current = $derived(options.find((o) => o.value === value))

    /**
     * @desc 菜单挂到 `document.body`：祖先只要有 `transform` / `backdrop-filter`（弹窗面板就是），
     * `position: fixed` 就会变成「相对该祖先定位」并被裁切 —— 视口坐标会整体错位。
     */
    const portal = (node: HTMLElement) => {
        document.body.appendChild(node)
        return { destroy: () => node.remove() }
    }

    function toggle() {
        if (disabled) return
        if (open) {
            close()
            return
        }
        if (!triggerEl) return
        const r = triggerEl.getBoundingClientRect()
        pos = { left: r.left, top: r.bottom + 4, width: r.width }
        open = true
    }

    function select(v: string) {
        onchange?.(v)
        close()
    }

    function close() {
        open = false
        // 注：`pos` 刻意**不在这里**清空——菜单的退场过渡（out:popOut）需要它继续提供定位，
        // 待过渡结束的回调里再清（见模板的 onoutroend），否则退场元素一帧就被擦掉。
    }

    $effect(() => {
        if (!open) return
        overlayEl?.focus()
        // 菜单自身滚动（选项多时）不应关闭菜单；只有外层滚动才重新定位
        const onScroll = (e: Event) => {
            if (e.target instanceof Node && menuEl?.contains(e.target)) return
            close()
        }
        window.addEventListener('scroll', onScroll, true)
        return () => window.removeEventListener('scroll', onScroll, true)
    })

    $effect(() => {
        if (!open || !menuEl || !pos) return
        requestAnimationFrame(() => {
            const el = menuEl
            const p = pos
            if (!el || !p) return
            const r = el.getBoundingClientRect()
            const cw = document.documentElement.clientWidth
            const ch = document.documentElement.clientHeight
            if (r.right > cw - 8) el.style.left = cw - r.width - 8 + 'px'
            if (r.bottom > ch - 8) el.style.top = ch - r.height - 8 + 'px'
        })
    })
</script>

<button
    bind:this={triggerEl}
    onclick={toggle}
    {disabled}
    type="button"
    class={mergeClass([
        'flex w-full items-center justify-between gap-2 rounded-none border border-(--theme-card-border) bg-(--theme-input-bg) outline-none transition-colors focus:border-(--theme-accent-bg)',
        size === 'sm' ? 'px-2 py-1 text-xs' : 'px-2 py-1.5 text-sm',
        'hover:brightness-110 active:brightness-95 disabled:active:brightness-100',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className || ''
    ])}
    style={styleProp}
>
    <span class="min-w-0 flex-1 truncate text-left">
        {#if current}
            {#if current.icon}<Icon icon={current.icon} class="mr-1 inline size-3.5 align-[-2px]" />{/if}
            <span class="text-(--theme-modal-text)">{current.label}</span>
        {:else}
            <span class="text-(--theme-modal-text)/40">{placeholder}</span>
        {/if}
    </span>
    <Icon icon={open ? 'mdi:chevron-up' : 'mdi:chevron-down'} class="size-3.5 shrink-0 text-(--theme-modal-text)/40" />
</button>

{#if open && pos}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        use:portal
        bind:this={overlayEl}
        class="fixed inset-0 z-(--z-popover) outline-none"
        role="presentation"
        tabindex="-1"
        onclick={close}
        onkeydown={(e) => e.key === 'Escape' && close()}
    >
        <div
            bind:this={menuEl}
            class="animate-pop-in theme-scrollbar absolute max-h-64 overflow-y-auto rounded-none border py-1 backdrop-blur-lg"
            style="left: {pos.left}px; top: {pos.top}px; width: {pos.width}px; background: color-mix(in srgb, var(--theme-modal-bg) 70%, transparent); border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
            out:popOut={outParams}
            onoutroend={() => (pos = null)}
        >
            {#each options as opt (opt.value)}
                <button
                    onclick={() => select(opt.value)}
                    type="button"
                    class={[
                        'flex w-full items-center gap-2 text-left transition-colors',
                        size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-xs',
                        opt.value === value
                            ? 'bg-(--theme-accent-bg)/10 text-(--theme-accent-text)'
                            : 'text-(--theme-modal-text) hover:bg-(--theme-modal-text)/5'
                    ].join(' ')}
                >
                    {#if renderOption}
                        {@render renderOption(opt)}
                    {:else}
                        {#if opt.icon}<Icon icon={opt.icon} class="size-3.5 shrink-0" />{/if}
                        <span class="flex-1">{opt.label}</span>
                        {#if opt.value === value}
                            <Icon icon="mdi:check" class="size-3 shrink-0 text-(--theme-accent-text)" />
                        {/if}
                    {/if}
                </button>
            {/each}
        </div>
    </div>
{/if}
