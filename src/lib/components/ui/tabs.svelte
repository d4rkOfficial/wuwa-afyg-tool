<script lang="ts">
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {
        tabs: string[]
        active: number
        onchange?: (index: number) => void
    }

    let { tabs, active, onchange, backgroundImage, textColor, class: className, style: styleProp }: Props = $props()

    let mergedStyle = $derived(
        [
            backgroundImage ? `background: ${backgroundImage}` : '',
            textColor ? `color: ${textColor}` : '',
            styleProp || ''
        ]
            .filter(Boolean)
            .join(';')
    )
</script>

<div
    class={['flex rounded-none border border-(--theme-divider-border) bg-(--theme-input-bg) p-0.5', className || '']
        .filter(Boolean)
        .join(' ')}
    style={styleProp}
    role="tablist"
>
    {#each tabs as tab, i}
        <button
            role="tab"
            aria-selected={i === active}
            onclick={() => onchange?.(i)}
            class={[
                'rounded-none px-3 py-1 text-sm font-medium transition-colors duration-150',
                i === active
                    ? 'bg-(--theme-tabs-bg) text-(--theme-tabs-text)'
                    : 'text-(--theme-modal-text)/50 hover:text-(--theme-modal-text)/80',
                className || ''
            ]
                .filter(Boolean)
                .join(' ')}
            style={i === active ? mergedStyle : ''}
        >
            {tab}
        </button>
    {/each}
</div>
