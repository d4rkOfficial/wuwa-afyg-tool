<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {
        variant: 'icon' | 'text' | 'icon-text'
        icon?: string
        label?: string
        disabled?: boolean
        onclick?: () => void
    }

    let {
        variant,
        icon,
        label,
        disabled,
        onclick,
        backgroundImage,
        textColor,
        class: className,
        style: styleProp
    }: Props = $props()

    let mergedStyle = $derived(
        [
            `background: var(--theme-btn-bg)`,
            backgroundImage ? `background: ${backgroundImage}` : '',
            textColor ? `color: ${textColor}` : '',
            styleProp || ''
        ]
            .filter(Boolean)
            .join(';')
    )
</script>

<button
    {disabled}
    {onclick}
    class={[
        'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm',
        'text-(--theme-btn-text)',
        'focus-visible:bg-(--theme-btn-bg-focused) focus-visible:text-(--theme-btn-text-focused)',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--theme-btn-text)/30',
        'disabled:opacity-40 disabled:pointer-events-none',
        'transition-colors duration-150',
        variant === 'icon' ? 'p-1.5' : '',
        className || ''
    ]
        .filter(Boolean)
        .join(' ')}
    style={mergedStyle}
>
    {#if icon && variant !== 'text'}
        <Icon {icon} class="shrink-0" />
    {/if}
    {#if label && variant !== 'icon'}
        <span>{label}</span>
    {/if}
</button>
