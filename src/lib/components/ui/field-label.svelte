<script lang="ts">
    /**
     * @desc 设置项的标签(+可选提示)：统一标签与提示的字号/字重/次要色。
     *
     * 注：`class` / `style` 作用于**标签行**；提示行样式固定，不受其影响。
     * `hint` 省略时只渲染标签行。
     */
    import type { ComponentsProps } from '$lib/types'
    import { mergeClass } from '$lib/utils/component-style'

    interface Props extends ComponentsProps {
        /** @desc 标签文案 */
        label: string
        /** @desc 提示文案（省略则不渲染提示行） */
        hint?: string
    }

    let { label, hint, class: className, style: styleProp }: Props = $props()
</script>

<span class={mergeClass(['block text-xs font-medium text-(--theme-modal-text)/70', className])} style={styleProp}
    >{label}</span
>
{#if hint}<span class="mt-0.5 block text-[10px] leading-4 text-(--theme-modal-text)/40">{hint}</span>{/if}
