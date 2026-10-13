<script lang="ts">
    /**
     * @desc 上下文用量圈：composer 工具条上紧贴发送按钮的小环，表示**最近一次请求**的 prompt token
     * 占该配置「上下文窗口」的比例。
     *
     * - 分子取 `turn-state.svelte.ts` 的 `getLastPromptTokens()`（最近一次请求，不是本轮累计）。
     * - 分母取配置文件里声明的 `contextWindow` —— 服务商不下发窗口大小，本应用也没有 `pi-ai`
     *   那样的模型目录可查，故只能由用户按模型填写（见 `config.svelte.ts`）。
     * - 分档配色：<70% 主题强调色 / 70~90% 琥珀 / ≥90% 红。只在快满时才变色，
     *   否则平时就一直挂着警示色，反而失去提示意义。
     * - 无法计算（还没发过请求）时画空环并在 title 里说明，**不臆造分母**。
     */
    import type { ComponentsProps } from '$lib/types'
    import { mergeClass } from '$lib/utils/component-style'
    import { contextUsageRatio, formatPercent, formatTokens } from '$lib/ai/token-usage'

    interface Props extends ComponentsProps {
        /** @desc 最近一次请求的 prompt token（`undefined` = 还没发出过请求） */
        used?: number
        /** @desc 上下文窗口（token） */
        total: number
    }

    let { used, total, class: className, style: styleProp }: Props = $props()

    /** @desc 环几何：viewBox 是 20×20，圆心 (10,10)；半径与线宽在此唯一声明，模板直接引用 */
    const RING_RADIUS = 8
    const RING_WIDTH = 2.5
    const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

    const ratio = $derived(contextUsageRatio(used, total))
    /** @desc 进度弧长（未画时按 0 处理，真实占比由 title 文案给出） */
    const dash = $derived((ratio ?? 0) * CIRCUMFERENCE)
    const tone = $derived(
        ratio === null || ratio < 0.7
            ? 'var(--theme-accent-bg)'
            : ratio < 0.9
              ? 'var(--theme-warning-text, #f59e0b)'
              : 'var(--theme-danger-text, #ef4444)'
    )
    const label = $derived(
        ratio === null
            ? `上下文占用：—（窗口 ${formatTokens(total)}）`
            : `上下文占用：${formatTokens(used)} / ${formatTokens(total)}（${formatPercent(ratio)}）`
    )
</script>

<!-- 用 `size-[18px]` 而不是 `size-4.5`：任意值一定生成 CSS，而这个元素一旦尺寸失效就整个看不见（静默失败） -->
<span
    role="img"
    aria-label={label}
    title={label}
    class={mergeClass(['inline-flex size-[18px] shrink-0 items-center justify-center', className])}
    style="color: {tone}; {styleProp || ''}"
>
    <svg viewBox="0 0 20 20" class="size-full -rotate-90">
        <circle
            cx="10"
            cy="10"
            r={RING_RADIUS}
            fill="none"
            stroke-width={RING_WIDTH}
            stroke="color-mix(in srgb, var(--theme-modal-text) 18%, transparent)"
        />
        {#if ratio !== null}
            <circle
                cx="10"
                cy="10"
                r={RING_RADIUS}
                fill="none"
                stroke-width={RING_WIDTH}
                stroke="currentColor"
                stroke-linecap="round"
                stroke-dasharray="{dash} {CIRCUMFERENCE}"
            />
        {/if}
    </svg>
</span>
