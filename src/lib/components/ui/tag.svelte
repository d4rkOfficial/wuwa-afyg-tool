<script lang="ts">
    /**
     * @desc 小标签（tag）：紧凑的纯文本标签壳（伤害类型等短标签）。
     *
     * 抽因（实测）：两张拉表里**跨文件**逐字重复 2 处 —— 铺开表行头的「伤害类型」标签、
     * 下拉表「视为」列的标签；两处 class 集合逐项相同（仅书写顺序不同），
     * 且内联样式同为 `background: var(--theme-input-bg);`（由调用方经 `style` 传入）。
     */
    import type { Snippet } from 'svelte'
    import type { ComponentsProps } from '$lib/types'
    import { mergeClass } from '$lib/utils/component-style'

    interface Props extends ComponentsProps {
        children?: Snippet
    }

    let { class: className, style: styleProp, children }: Props = $props()
    const tagClass = $derived(
        mergeClass(['rounded-none px-1 text-[10px] leading-tight text-(--theme-modal-text)/70', className])
    )
</script>

<span class={tagClass} style={styleProp}>{@render children?.()}</span>
