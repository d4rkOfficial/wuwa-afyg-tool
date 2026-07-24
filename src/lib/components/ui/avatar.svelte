<script lang="ts">
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {
        src?: string
        alt: string
        size?: 'sm' | 'md' | 'lg'
    }

    let { src, alt, size = 'md', backgroundImage, textColor, class: className, style: styleProp }: Props = $props()

    let sizeClass = $derived(
        size === 'sm' ? 'h-8 w-8 text-xs' : size === 'lg' ? 'h-14 w-14 text-lg' : 'h-10 w-10 text-sm'
    )

    let mergedStyle = $derived(
        [
            src ? `background-image: url(${src})` : backgroundImage ? `background: ${backgroundImage}` : '',
            textColor ? `color: ${textColor}` : '',
            styleProp || ''
        ]
            .filter(Boolean)
            .join(';')
    )
</script>

<div
    class={[
        'inline-flex shrink-0 items-center justify-center rounded-full bg-cover bg-center',
        'bg-(--theme-avatar-bg) text-(--theme-avatar-text)',
        'focus-visible:bg-(--theme-avatar-bg-focused) focus-visible:text-(--theme-avatar-text-focused)',
        sizeClass,
        className || ''
    ]
        .filter(Boolean)
        .join(' ')}
    style={mergedStyle}
    role="img"
    aria-label={alt}
>
    {#if !src}
        {alt.charAt(0).toUpperCase()}
    {/if}
</div>
