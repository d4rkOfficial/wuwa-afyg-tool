<script lang="ts">
    /** @desc 紧凑自定义下拉（非原生 select）：触发按钮 + fixed 高 z 弹层，供对比配置的链/阶选择 */
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'

    interface Option {
        value: string
        label: string
    }

    interface Props extends ComponentsProps {
        options: Option[]
        value: string
        onchange?: (v: string) => void
        disabled?: boolean
    }

    let { options, value, onchange, disabled = false, class: className, style: styleProp }: Props = $props()
    let open = $state(false)
    let pos = $state<{ left: number; top: number; width: number } | null>(null)
    let triggerEl: HTMLButtonElement | undefined = $state()
    let menuEl: HTMLDivElement | undefined = $state()

    let current = $derived(options.find((o) => o.value === value))

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
        pos = null
    }
    $effect(() => {
        if (!open) return
        const onScroll = () => close()
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
            if (r.right > cw - 8) el.style.left = `${cw - r.width - 8}px`
            if (r.bottom > ch - 8) el.style.top = `${ch - r.height - 8}px`
        })
    })
</script>

<button
    bind:this={triggerEl}
    onclick={toggle}
    {disabled}
    type="button"
    class="flex w-full items-center justify-between gap-1 rounded-md border px-2 py-1 text-xs outline-none transition-colors focus:border-(--theme-accent-bg) {disabled
        ? 'cursor-not-allowed opacity-50'
        : 'cursor-pointer hover:border-(--theme-accent-bg)'} {className ?? ''}"
    style={`border-color: var(--theme-divider-border); color: var(--theme-modal-text); background: transparent;${styleProp ?? ''}`}
>
    <span class="tabular-nums">{current?.label ?? value}</span>
    <Icon icon={open ? 'mdi:chevron-up' : 'mdi:chevron-down'} class="size-3 shrink-0 opacity-40" />
</button>

{#if open && pos}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-70 outline-none"
        role="presentation"
        tabindex="-1"
        onclick={close}
        onkeydown={(e) => e.key === 'Escape' && close()}
    >
        <div
            bind:this={menuEl}
            class="animate-pop-in theme-scrollbar absolute max-h-56 overflow-y-auto rounded-lg border py-1 shadow-xl backdrop-blur-lg"
            style="left: {pos.left}px; top: {pos.top}px; width: max({pos.width}px, 56px); background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
        >
            {#each options as opt}
                <button
                    onclick={() => select(opt.value)}
                    type="button"
                    class="flex w-full items-center justify-between gap-2 px-3 py-1 text-left text-xs transition-colors {opt.value ===
                    value
                        ? 'text-(--theme-accent-text)'
                        : 'text-(--theme-modal-text) hover:bg-(--theme-modal-text)/5'}"
                >
                    <span class="tabular-nums">{opt.label}</span>
                    {#if opt.value === value}<Icon
                            icon="mdi:check"
                            class="size-3 shrink-0 text-(--theme-accent-text)"
                        />{/if}
                </button>
            {/each}
        </div>
    </div>
{/if}
