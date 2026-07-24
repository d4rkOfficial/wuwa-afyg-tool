<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {
        value: string
        placeholder?: string
        oninput?: (e: Event) => void
        onfocus?: (e: FocusEvent) => void
        onblur?: (e: FocusEvent) => void
    }

    let {
        value,
        placeholder,
        oninput,
        onfocus,
        onblur,
        backgroundImage,
        textColor,
        class: className,
        style: styleProp
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

    function handleClear() {
        const input = document.querySelector<HTMLInputElement>(`[data-search-id="${id}"]`)
        if (input) {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '')
            input.dispatchEvent(new Event('input', { bubbles: true }))
        }
    }

    let id = crypto.randomUUID()
</script>

<div
    class={[
        'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm',
        'bg-(--theme-search-box-bg) text-(--theme-search-box-text)',
        'focus-within:bg-(--theme-search-box-bg-focused) focus-within:text-(--theme-search-box-text-focused)',
        'ring-1 ring-inset ring-white/5 focus-within:ring-white/10',
        'transition-colors duration-150',
        className || ''
    ]
        .filter(Boolean)
        .join(' ')}
    style={mergedStyle}
>
    <Icon icon="mdi:magnify" class="shrink-0 opacity-50" />
    <input
        data-search-id={id}
        {value}
        {placeholder}
        {oninput}
        {onfocus}
        {onblur}
        class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-white/30"
    />
    {#if value}
        <button
            onclick={handleClear}
            class="shrink-0 rounded p-0.5 opacity-50 transition-opacity hover:opacity-100"
            aria-label="Clear"
        >
            <Icon icon="mdi:close" />
        </button>
    {/if}
</div>
