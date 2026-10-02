<script lang="ts">
    /**
     * @desc 设置区块标题：统一字号/字重/间距的标题行（内含强调色图标的场景直接作为 children 传入）。
     * 原先 `settings-modal.svelte` 里手写了 16 份逐字相同的
     * `<span class="mb-1 flex items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text)">`。
     */
    import type { Snippet } from 'svelte'
    import type { ComponentsProps } from '$lib/types'
    import { mergeClass } from '$lib/utils/component-style'

    interface Props extends ComponentsProps {
        children?: Snippet
    }

    let { class: className, style: styleProp, children }: Props = $props()
</script>

<span
    class={mergeClass([
        'mb-1 flex items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text)',
        className
    ])}
    style={styleProp}
>
    {@render children?.()}
</span>
