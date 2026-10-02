<script lang="ts">
    /**
     * @desc picker 弹窗标题行里的**搜索框**（放大镜图标 + 无边框透明输入 + 条件清除钮）。
     *
     * 抽因（T14 实测，非「看起来像」）：三个 picker 的搜索块是**逐字相同的 21 行**，
     * 唯一差异是 `placeholder` 文案（`搜索角色...` / `搜索声骸...` / `搜索武器...`）——
     * 实测脚本 `.tmp/t14-shell-measure.mjs` 归一化后比对：三者除 placeholder 外完全相同。
     *
     * 为什么放在**标题行**：这三个 picker 都用 `{#snippet title()}` 承载搜索框
     * （标题即搜索栏），故本组件刻意**不带边框/底色**（与 `ui/search-box` 的独立输入控件不同），
     * 也不要 `class`/`style` 之外的容器外观 —— 外观差异一律由调用方经 `class` 传入。
     *
     * `value` 用 `$bindable`：三个调用点原本都是 `bind:value={query}`，保持同一写法可让
     * 本次改动对调用方**只删不增**（无需改写绑定）。
     */
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import { mergeClass } from '$lib/utils/component-style'

    interface Props extends ComponentsProps {
        /** @desc 搜索关键词（双向绑定；清除钮会置空并触发 oninput 语义） */
        value: string
        /** @desc 占位文案（各 picker 唯一的外观差异） */
        placeholder: string
        /** @desc 清除钮的无障碍标签（各 picker 原本都是 `Clear search`） */
        clearLabel?: string
    }

    let {
        value = $bindable(),
        placeholder,
        clearLabel = 'Clear search',
        class: className,
        style: styleProp
    }: Props = $props()
</script>

<div class={mergeClass(['flex w-full items-center gap-2 pr-4', className || ''])} style={styleProp}>
    <Icon icon="mdi:magnify" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
    <input
        bind:value
        {placeholder}
        class="min-w-0 flex-1 bg-transparent text-sm outline-none text-(--theme-modal-text) placeholder:text-(--theme-modal-text)/30"
    />
    {#if value}
        <button
            onclick={() => (value = '')}
            data-sf="widget"
            data-sf-flat
            class="rounded-none p-0.5 text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)/70"
            style="--sf-base: var(--theme-input-bg)"
            aria-label={clearLabel}
        >
            <Icon icon="mdi:close" class="size-4" />
        </button>
    {/if}
</div>
