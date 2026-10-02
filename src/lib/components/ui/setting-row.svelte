<script lang="ts">
    /**
     * @desc 设置行：左侧标签(+提示)、右侧控件的横向布局，自带分隔线与输入底色。
     * 原先 `settings-modal.svelte` 里手写了 12 份相同的
     * `<div class="flex items-center justify-between gap-3 rounded-none border px-3 py-2">`，
     * 且各自重复内联 `border-color` / `background` 两条样式。
     * 需要额外上边距的实例用 `class="mt-2"` 传入（原文件 5 处）。
     */
    import type { Snippet } from 'svelte'
    import type { ComponentsProps } from '$lib/types'
    import { joinStyle, mergeClass } from '$lib/utils/component-style'

    interface Props extends ComponentsProps {
        children?: Snippet
    }

    let { class: className, style: styleProp, children }: Props = $props()
</script>

<div
    class={mergeClass(['flex items-center justify-between gap-3 rounded-none border px-3 py-2', className])}
    style={joinStyle(['border-color: var(--theme-divider-border); background: var(--theme-input-bg)', styleProp])}
>
    {@render children?.()}
</div>
