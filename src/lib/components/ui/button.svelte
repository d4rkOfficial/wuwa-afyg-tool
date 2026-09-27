<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import { resolveButtonSurface, type ButtonSurface } from '$lib/utils/button-surface'

    interface Props extends ComponentsProps {
        variant: 'icon' | 'text' | 'icon-text'
        icon?: string
        label?: string
        disabled?: boolean
        /**
         * 区域质感归属：`'widget'` = 底色交给「设置-外观主题-背景质感-小部件」管理（不再写死按钮自身底色），
         * `'none'` = 保持按钮自身底色。不传时按变体判定：图标型 → `'widget'`，文字型 / 图标+文字型 → `'none'`。
         * 注：`--theme-btn-bg` 在预设主题里是渐变（不能当 `color-mix` 的基色），故 widget 模式下不覆盖 `--sf-base`，
         * 需要指定基色的调用方可在 `style` 里自行传 `--sf-base`（如 `--sf-base: var(--theme-btn-bg-focused)`）。
         */
        surface?: ButtonSurface
        onclick?: () => void
    }

    let {
        variant,
        icon,
        label,
        disabled,
        surface,
        onclick,
        backgroundImage,
        textColor,
        class: className,
        style: styleProp
    }: Props = $props()

    const isWidget = $derived(resolveButtonSurface(variant, surface) === 'widget')

    let mergedStyle = $derived(
        [
            isWidget ? '' : `background: var(--theme-btn-bg)`,
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
    data-sf={isWidget ? 'widget' : undefined}
    data-sf-flat={isWidget ? '' : undefined}
    class={[
        'inline-flex items-center justify-center gap-1.5 rounded-none px-3 py-1.5 text-sm font-medium tracking-tight',
        'text-(--theme-btn-text)',
        'focus-visible:bg-(--theme-btn-bg-focused) focus-visible:text-(--theme-btn-text-focused)',
        'focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-(--theme-btn-text)',
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
