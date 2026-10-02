<script lang="ts">
    /**
     * @desc 空态 / 加载态占位文案：居中、次要色、无数据或加载中的统一样式。
     * 原先在 6 个组件里手写了 9 份同样的 `<div class="py-N text-center …">`。
     */
    import type { Snippet } from 'svelte'
    import type { ComponentsProps } from '$lib/types'
    import { mergeClass } from '$lib/utils/component-style'

    interface Props extends ComponentsProps {
        /** @desc 垂直留白档位（sm=`py-6`、md=`py-8`、lg=`py-12`） */
        size?: 'sm' | 'md' | 'lg'
        children?: Snippet
    }

    let { size = 'md', class: className, style: styleProp, children }: Props = $props()

    const pad = $derived(size === 'sm' ? 'py-6' : size === 'lg' ? 'py-12' : 'py-8')
</script>

<div class={mergeClass(['text-center text-xs text-(--theme-modal-text)/40', pad, className])} style={styleProp}>
    {@render children?.()}
</div>
