<script lang="ts">
    /**
     * @desc 杂志风格卡片容器（弹窗用）：直角 + 可选超大英文水印 + 选中态底纹，供列表项 / 入口卡复用。
     * 仅作容器（非按钮），交互由调用方在内层处理，避免 button 嵌套。
     */
    import type { Snippet } from 'svelte'
    import type { ComponentsProps } from '$lib/types'
    import { mergeClass } from '$lib/utils/component-style'

    interface Props extends ComponentsProps {
        /** 右上角超大英文水印（低透明度） */
        watermark?: string
        /** 选中态：accent 边框 + 淡 accent 底纹 */
        active?: boolean
        /** 可选点击（传则呈现 hover 与光标） */
        onclick?: () => void
        children?: Snippet
    }

    let { watermark, active = false, onclick, children, class: className, style: styleProp }: Props = $props()
</script>

<!-- 有 `onclick` 时本容器同时给 `role="button"` + `tabindex` + Enter/Space 处理（下方），
     故 `a11y_no_noninteractive_tabindex` 是对静态分析的误报，按需抑制。 -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
    data-press={onclick ? '' : undefined}
    data-sf="card"
    class={mergeClass([
        'relative overflow-hidden border transition-colors',
        active ? '' : onclick ? 'cursor-pointer hover:bg-(--theme-card-bg-focused)' : '',
        className ?? ''
    ])}
    style="--sf-base: {active
        ? 'color-mix(in srgb, var(--theme-accent-bg) 8%, var(--theme-card-bg))'
        : 'var(--theme-card-bg)'}; border-color: {active
        ? 'var(--theme-accent-bg)'
        : 'var(--theme-card-border)'}; {styleProp ?? ''}"
    role={onclick ? 'button' : undefined}
    tabindex={onclick ? 0 : undefined}
    {onclick}
    onkeydown={onclick
        ? (e: KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onclick()
              }
          }
        : undefined}
>
    {#if watermark}
        <span
            class="pointer-events-none absolute -right-1 -top-2.5 select-none whitespace-nowrap text-[3.5rem] font-black uppercase leading-none tracking-tighter text-(--theme-accent-text) opacity-[0.06]"
            >{watermark}</span
        >
    {/if}
    {@render children?.()}
</div>
