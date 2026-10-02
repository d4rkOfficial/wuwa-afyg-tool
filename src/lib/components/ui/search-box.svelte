<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import { mergeClass, mergeComponentsStyle } from '$lib/utils/component-style'

    interface Props extends ComponentsProps {
        value: string
        placeholder?: string
        oninput?: (e: Event) => void
        onfocus?: (e: FocusEvent) => void
        onblur?: (e: FocusEvent) => void
    }

    let {
        value,
        placeholder,
        oninput,
        onfocus,
        onblur,
        backgroundImage,
        textColor,
        class: className,
        style: styleProp
    }: Props = $props()

    let mergedStyle = $derived(mergeComponentsStyle({ backgroundImage, textColor, style: styleProp }))

    function handleClear() {
        const input = document.querySelector<HTMLInputElement>(`[data-search-id="${id}"]`)
        if (input) {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '')
            input.dispatchEvent(new Event('input', { bubbles: true }))
        }
    }

    let id = crypto.randomUUID()
</script>

<div
    class={mergeClass([
        'flex items-center gap-2 rounded-none border px-3 py-1.5 text-sm',
        'bg-(--theme-search-box-bg) text-(--theme-search-box-text)',
        'focus-within:bg-(--theme-search-box-bg-focused) focus-within:text-(--theme-search-box-text-focused)',
        'border-(--theme-divider-border) focus-within:border-(--theme-accent-bg)/50 hover:border-(--theme-accent-bg)/30',
        'transition-colors duration-[var(--motion-fast)] ease-out',
        className || ''
    ])}
    style={mergedStyle}
>
    <Icon icon="mdi:magnify" class="shrink-0 opacity-50" />
    <input
        data-search-id={id}
        {value}
        {placeholder}
        {oninput}
        {onfocus}
        {onblur}
        class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-(--theme-search-box-text)/40"
    />
    {#if value}
        <!-- 动效：`hover:opacity-100` 的**颜色/透明度反馈**在本组件里是纯状态层；但要注意
             layout.css 全局 `:where(button:not(:disabled))` 的 transition 带 !important 且用简写列出
             transition-property（transform/color/background/border/box-shadow），
             层优先级高于工具类 → 按钮上任何 `transition-opacity` / `transition-all` 的 transition-property
             都会被它整条替换，`opacity` 的过渡**不生效**（实测：Tailwind 编译产物里工具类只剩
             transition-duration 生效）。因此这里不写无效的 transition-* 类，只提供 active 状态。
             该缺陷需在 layout.css 的基础规则里补 `opacity`（本任务禁止改该文件）。 -->
        <button
            onclick={handleClear}
            class="shrink-0 rounded-none p-0.5 opacity-50 hover:opacity-100 active:opacity-70"
            aria-label="Clear"
        >
            <Icon icon="mdi:close" />
        </button>
    {/if}
</div>
