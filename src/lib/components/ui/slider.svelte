<script lang="ts">
    /**
     * @desc 滑块：默认档 = 标签行（左侧文案或富标签 + 右侧等宽数值）+ range 输入 + 上下限说明行。
     * 原先 `settings-modal.svelte` 里手写了 6 份同样的 7 行结构，且各自重复输入框样式与
     * `Number((e.target as HTMLInputElement).value)` 这段取值代码。
     *
     * 两个可选档位（都为「行头已有名称」的密集列表服务，默认档零漂移）：
     *  - `inline`：只发一条轨道 + 右侧数值，**不渲染可见标签**（`label` 仅作 aria-label）；
     *  - `thumbBadge`：数值不进右侧，而是做成**骑在拇指上的小标签**（与 `config/echo-slot-card`
     *    的副词条滑杆同一视觉：轨道 + 已选段填充 + 跟随位置的数值胶囊），胶囊位置用 `clamp()`
     *    夹在轨道内，两端不溢出。
     *
     * 上下限说明条数不定（实测 2~5 条）且可为动态表达式，故用 `captions` snippet 承载。
     */
    import type { Snippet } from 'svelte'
    import type { ComponentsProps } from '$lib/types'
    import { mergeClass } from '$lib/utils/component-style'

    interface Props extends ComponentsProps {
        /** @desc 可见文案；同时作为 `ariaLabel` 的兜底 */
        label: string
        /** @desc 无障碍名称；与可见文案不一致时显式传入（实测有 1 处：可见「发光强度」/ aria「霓虹灯强度」） */
        ariaLabel?: string
        value: number
        min?: number
        max: number
        step?: number
        /** @desc 数值文本（含单位，如 `50%` / `8px`）：默认档在标签行右侧，`inline` 在轨道右侧，`thumbBadge` 在拇指胶囊里 */
        valueText: string
        /**
         * @desc 染色（如按元素上色）：给了就同时改拇指/胶囊底色与轨道已选段底色；不给则沿用全局 accent
         * 与素色轨道（设置面板那一批保持原样）。
         */
        color?: string
        /** @desc 取值回调，已转换为 number，调用处不必再写 `Number(...)` */
        oninput?: (value: number) => void
        /** @desc 单行档：只发一条轨道，**不渲染可见标签**（`label` 仅作 aria-label） */
        inline?: boolean
        /** @desc 数值胶囊档：把 `valueText` 放到跟随拇指的胶囊上（`inline` 时效果最紧凑） */
        thumbBadge?: boolean
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
        color,
        oninput,
        inline = false,
        thumbBadge = false,
        labelSnippet,
        captions,
        class: className,
        style: styleProp
    }: Props = $props()

    /** @desc 已选段占比（染色轨道/胶囊定位用；`min === max` 时按 100% 处理，避免除零） */
    let fillPct = $derived(max > min ? ((value - min) / (max - min)) * 100 : 100)

    const EMPTY_TRACK = 'color-mix(in srgb, var(--theme-modal-text) 10%, transparent)'
    const activeColor = $derived(color ?? 'var(--theme-accent-bg)')

    /** @desc 未染色时不写内联样式，保持设置面板那一批的既有外观 */
    let trackStyle = $derived(
        color
            ? `accent-color: ${color}; background: linear-gradient(to right, ${color} 0%, ${color} ${fillPct}%, ${EMPTY_TRACK} ${fillPct}%, ${EMPTY_TRACK} 100%);`
            : ''
    )

    /** @desc 轨道与取值回调：三种排版共用，只差外层结构与宽度类 */
    const TRACK_CLASS =
        'h-1.5 cursor-pointer touch-none appearance-none rounded-full bg-(--theme-modal-text)/10 accent-(--theme-accent-bg)'
    const onInput = (e: Event) => oninput?.(Number((e.target as HTMLInputElement).value))
</script>

{#if thumbBadge}
    <!-- @desc 数值胶囊档：range 本体透明铺满行，轨道/填充/胶囊都是自己画的（同声骸卡片副词条滑杆） -->
    <div class={mergeClass(['relative h-5 min-w-0 flex-1', className])} style={styleProp}>
        <div class="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full" style="background: {EMPTY_TRACK};">
            <div class="h-full rounded-full" style="width: {fillPct}%; background: {activeColor};"></div>
        </div>
        <div
            class="pointer-events-none absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-none px-1.5 py-0.5 text-[10px] font-black whitespace-nowrap tabular-nums"
            style="left: clamp(1.25rem, {fillPct}%, calc(100% - 1.25rem)); background: {activeColor}; color: var(--theme-accent-text-on-bg, #ffffff);"
        >
            {valueText}
        </div>
        <input
            aria-label={ariaLabel ?? label}
            type="range"
            {min}
            {max}
            {step}
            {value}
            oninput={onInput}
            class="absolute inset-0 z-0 h-full w-full cursor-pointer opacity-0"
        />
    </div>
{:else if inline}
    <div class={mergeClass(['flex items-center gap-2', className])} style={styleProp}>
        <input
            aria-label={ariaLabel ?? label}
            type="range"
            {min}
            {max}
            {step}
            {value}
            oninput={onInput}
            style={trackStyle}
            class={mergeClass([TRACK_CLASS, 'min-w-0 flex-1'])}
        />
        <span class="shrink-0 font-mono text-[11px] text-(--theme-accent-text)">{valueText}</span>
    </div>
{:else}
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
            oninput={onInput}
            style={trackStyle}
            class={mergeClass([TRACK_CLASS, 'w-full'])}
        />
        {#if captions}
            <div class="mt-1 flex justify-between text-[9px] text-(--theme-modal-text)/25">{@render captions()}</div>
        {/if}
    </div>
{/if}
