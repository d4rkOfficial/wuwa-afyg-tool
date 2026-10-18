<script lang="ts">
    /**
     * @desc 数据分析 → 副词条贡献（单角色视图）。
     *
     * 旧版是「三角色并排」的窄栏（每栏约 1/3 宽），塞不下 Buff 明细；现在改成
     * 「角色页签 + 左右两栏（副词条 / Buff）」，本组件只负责其中一个角色的副词条那一栏。
     * 柱状图（按词条类型汇总）的画布与 Chart 实例仍在此持有，绘制体在 ./chart-utils。
     */
    import { onMount, untrack } from 'svelte'
    import Icon from '@iconify/svelte'
    import { openHelp } from '$lib/data/help.svelte'
    import { ALGORITHM_HELP } from '$lib/calc/result.consts'
    import { CARD_SURFACE_STYLE, SECTION_LABEL, STAT_VALUE_MD, STAT_VALUE_SM } from '$lib/calc/result.styles'
    import type { CharSubstatAnalysis } from '$lib/calc/result.types'
    import type { AlgorithmId, AlgorithmInfo } from '$lib/calc/substat-algorithms/types'
    import { joinStyle, mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'
    import { renderBarCharts, type BarChartInstance } from './chart-utils'

    interface Props extends ComponentsProps {
        /** @desc 该角色的副词条分析结果（undefined = 尚未算出） */
        analysis: CharSubstatAnalysis | undefined
        algorithmsInfo: AlgorithmInfo[]
        selectedAlgorithm: AlgorithmId
        computing: boolean
        onSelectAlgorithm: (id: AlgorithmId) => void
    }

    let {
        analysis,
        algorithmsInfo,
        selectedAlgorithm,
        computing,
        onSelectAlgorithm,
        class: className,
        style: styleProp
    }: Props = $props()

    let helpItems = $derived(
        algorithmsInfo.map((algo) => ({
            name: algo.name,
            description: algo.description,
            content: ALGORITHM_HELP[algo.id]
        }))
    )

    const RIG_GRAD_TEXT =
        'background: var(--theme-rigcrit-grad); -webkit-background-clip: text; background-clip: text; color: transparent;'
    const NOCRIT_GRAD_TEXT =
        'background: var(--theme-nocrit-grad); -webkit-background-clip: text; background-clip: text; color: transparent;'

    // ── 柱状图（词条类型汇总） ──
    let barChart: BarChartInstance | null = null
    let barCanvas = $state<HTMLCanvasElement | null>(null)

    const drawBarChart = () => {
        barChart?.destroy()
        barChart = null
        if (!analysis || !barCanvas || analysis.aggregated.length === 0) return
        const canvases = new Map([[analysis.character, barCanvas]])
        barChart = renderBarCharts([analysis], canvases)[0] ?? null
    }

    $effect(() => {
        analysis
        barCanvas
        untrack(() => drawBarChart())
    })

    onMount(() => () => barChart?.destroy())
</script>

<section
    class={mergeClass(['flex min-w-0 flex-col rounded-none border', className])}
    style={joinStyle([CARD_SURFACE_STYLE, styleProp])}
>
    <div
        class="flex flex-wrap items-center gap-2 border-b px-4 py-3"
        style="border-color: var(--theme-divider-border);"
    >
        <div class="flex shrink-0 items-center gap-2">
            <Icon icon="mdi:chart-bar" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            <h3 class="text-sm font-black tracking-tight" style="color: var(--theme-modal-text);">副词条贡献</h3>
            <button
                onclick={() => openHelp('算法说明', helpItems)}
                class="flex h-5 w-5 items-center justify-center rounded-none text-xs font-black transition-colors hover:bg-(--theme-modal-text)/10"
                style="color: var(--theme-accent-text);"
                title="算法说明"
            >
                ?
            </button>
        </div>
        <div
            class="flex items-center gap-1 rounded-none border px-1 py-1"
            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
        >
            {#each algorithmsInfo as algo (algo.id)}
                <button
                    onclick={() => onSelectAlgorithm(algo.id)}
                    class={[
                        'rounded-none px-2 py-1 text-[11px] transition-all',
                        selectedAlgorithm === algo.id
                            ? 'font-black'
                            : 'font-medium text-(--theme-modal-text)/50 hover:text-(--theme-modal-text)/70'
                    ].join(' ')}
                    style="background: {selectedAlgorithm === algo.id
                        ? 'var(--theme-accent-bg)'
                        : 'transparent'}; color: {selectedAlgorithm === algo.id
                        ? 'var(--theme-accent-text-on-bg, #ffffff)'
                        : ''};"
                    title={algo.description}
                >
                    {algo.name}
                </button>
            {/each}
        </div>
        {#if computing}
            <span class="ml-auto text-[10px]" style="color: var(--theme-accent-text); opacity: 0.6;">计算中…</span>
        {/if}
    </div>

    <div class="min-h-0 flex-1 p-4">
        {#if !analysis}
            <div class="py-8 text-center text-xs" style="color: var(--theme-modal-text); opacity: 0.4;">
                {computing ? '计算中…' : '暂无数据'}
            </div>
        {:else}
            <!-- 统计头：角色总伤 / 副词条总贡献 / 总分 -->
            <div class="grid grid-cols-3 gap-2">
                <div class="rounded-none border px-3 py-2" style="border-color: var(--theme-divider-border);">
                    <div class="{SECTION_LABEL} text-(--theme-modal-text)/45">角色总伤</div>
                    <div class="mt-1 {STAT_VALUE_SM} text-(--theme-modal-text)">
                        {Math.round(analysis.totalDamageNorm).toLocaleString()}
                    </div>
                    {#if analysis.totalDamageRig !== analysis.totalDamageNorm}
                        <div class="text-[10px] tabular-nums" style={RIG_GRAD_TEXT}>
                            凹暴 {Math.round(analysis.totalDamageRig).toLocaleString()}
                        </div>
                    {/if}
                    {#if analysis.totalDamageNoCrit !== analysis.totalDamageNorm}
                        <div class="text-[10px] tabular-nums" style={NOCRIT_GRAD_TEXT}>
                            不暴 {Math.round(analysis.totalDamageNoCrit).toLocaleString()}
                        </div>
                    {/if}
                </div>
                <div class="rounded-none border px-3 py-2" style="border-color: var(--theme-divider-border);">
                    <div class="{SECTION_LABEL} text-(--theme-modal-text)/45">副词条总贡献</div>
                    <!-- 占比直接跟在数值后面（同一行括号），不再单独占一行灰字 -->
                    <div class="mt-1 flex items-baseline gap-1 text-(--theme-accent-text)">
                        <span class={STAT_VALUE_SM}>
                            +{Math.round(analysis.substatTotalNorm).toLocaleString()}
                        </span>
                        <span class="text-[11px] font-medium tabular-nums"
                            >({analysis.substatTotalPctNorm.toFixed(1)}%)</span
                        >
                    </div>
                    {#if analysis.substatTotalRig !== analysis.substatTotalNorm || analysis.substatTotalNoCrit !== analysis.substatTotalNorm}
                        <div
                            class="mt-0.5 text-[10px] tabular-nums"
                            style="color: var(--theme-modal-text); opacity: 0.55;"
                        >
                            {#if analysis.substatTotalRig !== analysis.substatTotalNorm}
                                <span style={RIG_GRAD_TEXT}
                                    >凹暴 +{Math.round(analysis.substatTotalRig).toLocaleString()} ({analysis.substatTotalPctRig.toFixed(
                                        1
                                    )}%)</span
                                >
                            {/if}
                            {#if analysis.substatTotalNoCrit !== analysis.substatTotalNorm}
                                <span class="ml-1" style={NOCRIT_GRAD_TEXT}
                                    >不暴 +{Math.round(analysis.substatTotalNoCrit).toLocaleString()} ({analysis.substatTotalPctNoCrit.toFixed(
                                        1
                                    )}%)</span
                                >
                            {/if}
                        </div>
                    {/if}
                </div>
                <div
                    class="rounded-none border px-3 py-2"
                    style="border-color: var(--theme-divider-border);"
                    title="总分 = 副词条贡献占角色总伤的百分比；表级14词分 = 把声骸换成「标准 14 词条」方案后的同样分数"
                >
                    <div class="{SECTION_LABEL} text-(--theme-modal-text)/45">总分 / 表级14词分</div>
                    <div class="mt-1 flex items-baseline gap-1">
                        <span class="{STAT_VALUE_MD} text-(--theme-accent-text)">
                            {analysis.substatTotalPctNorm.toFixed(1)}
                        </span>
                        <span class={STAT_VALUE_MD} style="color: var(--theme-modal-text); opacity: 0.45">
                            / {analysis.standardSubstatPctNorm === null
                                ? '—'
                                : analysis.standardSubstatPctNorm.toFixed(1)}
                        </span>
                    </div>
                </div>
            </div>

            {#if analysis.aggregated.length > 0}
                <div class="pt-4">
                    <div class="mb-1 text-[10px] font-medium" style="color: var(--theme-modal-text); opacity: 0.5;">
                        词条类型汇总（按贡献降序）
                    </div>
                    <div class="w-full" style="height: {Math.max(140, analysis.aggregated.length * 26)}px">
                        <canvas bind:this={barCanvas}></canvas>
                    </div>
                </div>
            {/if}

            <div class="mt-4 space-y-1.5">
                {#each analysis.echoes as echo, ei (ei)}
                    <div class="rounded-none border" style="border-color: var(--theme-divider-border);">
                        <div class="px-3 py-2">
                            <!-- 只保留这块声骸的分数（右侧、放大）；不再有底部「小计」行 -->
                            <div class="mb-1.5 flex items-start justify-between gap-2">
                                <span
                                    class="pt-0.5 text-[10px] font-medium"
                                    style="color: var(--theme-modal-text); opacity: 0.6;"
                                >
                                    Cost{echo.cost}{echo.mainStat ? ' · ' + echo.mainStat : ''}
                                </span>
                                <span class="{STAT_VALUE_MD} text-(--theme-accent-text)">
                                    {echo.totalPctNorm.toFixed(1)}<span
                                        class="ml-0.5 text-[10px] font-normal opacity-60">分</span
                                    >
                                </span>
                            </div>
                            <div class="space-y-0.5">
                                {#each echo.substats as sub, si (si)}
                                    <div
                                        class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]"
                                        style="color: var(--theme-modal-text);"
                                    >
                                        <span class="shrink-0 tabular-nums">{sub.type} {sub.value}{sub.unit}</span>
                                        <span class="shrink-0 tabular-nums" style="color: var(--theme-accent-text);">
                                            → +{Math.round(sub.contributionNorm).toLocaleString()} ({sub.contribPctNorm.toFixed(
                                                1
                                            )}%)
                                        </span>
                                        {#if sub.contributionRig !== sub.contributionNorm}
                                            <span class="shrink-0 tabular-nums" style={RIG_GRAD_TEXT}>
                                                [凹暴 +{Math.round(sub.contributionRig).toLocaleString()} ({sub.contribPctRig.toFixed(
                                                    1
                                                )}%)]
                                            </span>
                                        {/if}
                                        {#if sub.contributionNoCrit !== sub.contributionNorm}
                                            <span class="shrink-0 tabular-nums" style={NOCRIT_GRAD_TEXT}>
                                                [不暴 +{Math.round(sub.contributionNoCrit).toLocaleString()} ({sub.contribPctNoCrit.toFixed(
                                                    1
                                                )}%)]
                                            </span>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
</section>
