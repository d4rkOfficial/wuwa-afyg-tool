<script lang="ts">
    /**
     * @desc 设置滑块：标签行（左侧文案或富标签 + 右侧等宽数值）+ range 输入 + 上下限说明行。
     * 原先 `settings-modal.svelte` 里手写了 6 份同样的 7 行结构，且各自重复输入框样式与
     * `Number((e.target as HTMLInputElement).value)` 这段取值代码。
     *
     * 上下限说明条数不定（实测 2~5 条）且可为动态表达式，故用 `captions` snippet 承载。
     */
    import type { Snippet } from 'svelte'
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {
        /** @desc 可见文案；同时作为 `ariaLabel` 的兜底 */
        label: string
        /** @desc 无障碍名称；与可见文案不一致时显式传入（实测有 1 处：可见「发光强度」/ aria「霓虹灯强度」） */
        ariaLabel?: string
        value: number
        min?: number
        max: number
        step?: number
        /** @desc 右侧等宽数值文本（含单位，如 `50%` / `8px`） */
        valueText: string
        /** @desc 取值回调，已转换为 number，调用处不必再写 `Number(...)` */
        oninput?: (value: number) => void
        /** @desc 富标签（如带图标）时用，覆盖 `label` 的显示（`label` 仍用于 aria-label 兜底） */
        labelSnippet?: Snippet
        /** @desc 上下限说明行内容 */
        captions?: Snippet
    }

    let {
        label,
        ariaLabel,
        value,
        min = 0,
        max,
        step = 1,
        valueText,
        oninput,
        labelSnippet,
        captions,
        class: className,
        style: styleProp
    }: Props = $props()
</script>

<div class={className} style={styleProp}>
    <span class="mb-2 flex items-center justify-between text-[11px] text-(--theme-modal-text)/55">
        {#if labelSnippet}{@render labelSnippet()}{:else}<span>{label}</span>{/if}
        <span class="font-mono text-(--theme-accent-text)">{valueText}</span>
    </span>
    <input
        aria-label={ariaLabel ?? label}
        type="range"
        {min}
        {max}
        {step}
        {value}
        oninput={(e) => oninput?.(Number((e.target as HTMLInputElement).value))}
        class="h-1.5 w-full cursor-pointer touch-none appearance-none rounded-full bg-(--theme-modal-text)/10 accent-(--theme-accent-bg)"
    />
    {#if captions}
        <div class="mt-1 flex justify-between text-[9px] text-(--theme-modal-text)/25">{@render captions()}</div>
    {/if}
</div>
