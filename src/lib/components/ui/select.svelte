<script lang="ts">
    import type { Snippet } from 'svelte'
    import type { ComponentsProps } from '$lib/types'
    import Icon from '@iconify/svelte'

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
        renderOption?: Snippet<[SelectOption]>
    }

    let {
        options,
        value,
        onchange,
        placeholder = '请选择',
        disabled = false,
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
        overlayEl?.focus()
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
    class={[
        'flex w-full items-center justify-between gap-2 rounded-lg border border-(--theme-card-border) bg-(--theme-input-bg) px-2 py-1.5 text-sm outline-none transition-colors focus:border-(--theme-accent-bg)',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className || ''
    ]
        .filter(Boolean)
        .join(' ')}
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
        bind:this={overlayEl}
        class="fixed inset-0 z-50 outline-none"
        role="presentation"
        tabindex="-1"
        onclick={close}
        onkeydown={(e) => e.key === 'Escape' && close()}
    >
        <div
            bind:this={menuEl}
            class="absolute max-h-64 overflow-y-auto rounded-lg border py-1 shadow-xl backdrop-blur-lg"
            style="left: {pos.left}px; top: {pos.top}px; width: {pos.width}px; background: color-mix(in srgb, var(--theme-modal-bg) 70%, transparent); border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
        >
            {#each options as opt}
                <button
                    onclick={() => select(opt.value)}
                    type="button"
                    class={[
                        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
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
