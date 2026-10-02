<script lang="ts">
    /**
     * @desc 数据分析 → 声骸词条贡献分析（三角色并排，不切换视图）。
     * Phase 5.3：自 `data-analysis-modal.svelte` 原样抽出，标记与行为未改。
     *
     * 柱状图的画布、Chart 实例随区块抽出（绘制体在 `./chart-utils`）；
     * 算法说明帮助条目由 `algorithmsInfo` 就地派生（原本也在弹窗外壳里算，只此一处消费）。
     */
    import { onMount, untrack } from 'svelte'
    import Icon from '@iconify/svelte'
    import { openHelp } from '$lib/data/help.svelte'
    import { ALGORITHM_HELP } from '$lib/calc/result.consts'
    import { CARD_SURFACE_STYLE, STAT_VALUE_MD } from '$lib/calc/result.styles'
    import type { CharSubstatAnalysis } from '$lib/calc/result.types'
    import type { AlgorithmId, AlgorithmInfo } from '$lib/calc/substat-algorithms/types'
    import { joinStyle, mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'
    import { renderBarCharts, type BarChartInstance } from './chart-utils'

    interface Props extends ComponentsProps {
        substatAnalysis: CharSubstatAnalysis[]
        algorithmsInfo: AlgorithmInfo[]
        selectedAlgorithm: AlgorithmId
        analysisComputing: boolean
        onSelectAlgorithm: (id: AlgorithmId) => void
    }

    let {
        substatAnalysis,
        algorithmsInfo,
        selectedAlgorithm,
        analysisComputing,
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

    // ── bar chart (substat aggregation) ──
    let barCharts: BarChartInstance[] = []
    const barCanvasMap = new Map<string, HTMLCanvasElement>()

    function registerBarCanvas(node: HTMLCanvasElement, charName: string) {
        barCanvasMap.set(charName, node)
        return {
            destroy() {
                barCanvasMap.delete(charName)
            }
        }
    }

    const drawBarCharts = () => {
        for (const c of barCharts) c.destroy()
        barCharts = renderBarCharts(substatAnalysis, barCanvasMap)
    }

    $effect(() => {
        substatAnalysis
        untrack(() => drawBarCharts())
    })

    onMount(() => {
        return () => {
            for (const c of barCharts) c.destroy()
        }
    })
</script>

<!-- ── 声骸词条贡献分析（三角色并排，不切换视图） ── -->
<section class={mergeClass(['rounded-none border', className])} style={joinStyle([CARD_SURFACE_STYLE, styleProp])}>
    <div
        class="flex flex-wrap items-center gap-2 border-b px-4 py-3"
        style="border-color: var(--theme-divider-border);"
    >
        <div class="flex items-center gap-2 shrink-0">
            <Icon icon="mdi:chart-bar" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            <h3 class="text-base font-black tracking-tight" style="color: var(--theme-modal-text);">
                声骸词条贡献分析
            </h3>
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
        {#if analysisComputing}
            <span class="ml-auto text-[10px]" style="color: var(--theme-accent-text); opacity: 0.6;">计算中…</span>
        {/if}
    </div>
    <div class="p-4">
        {#if substatAnalysis.length === 0}
            <div class="py-8 text-center text-xs" style="color: var(--theme-modal-text); opacity: 0.4;">
                {analysisComputing ? '计算中…' : '暂无数据'}
            </div>
        {:else}
            <div class="grid grid-cols-1 gap-3 xl:grid-cols-3">
                {#each substatAnalysis as charSA (charSA.character)}
                    <div
                        class="rounded-none border"
                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                    >
                        <div class="px-4 py-3">
                            <div class="flex items-center justify-between">
                                <div class="flex flex-col gap-0.5">
                                    <div class="flex flex-wrap items-center gap-3">
                                        <span class="text-xs font-black" style="color: var(--theme-modal-text);"
                                            >{charSA.character}</span
                                        >
                                        <span
                                            class="text-[10px] tabular-nums"
                                            style="color: var(--theme-modal-text); opacity: 0.5;"
                                        >
                                            总伤: {Math.round(charSA.totalDamageNorm).toLocaleString()}
                                        </span>
                                        {#if charSA.totalDamageRig !== charSA.totalDamageNorm}
                                            <span class="text-[10px] tabular-nums" style={RIG_GRAD_TEXT}>
                                                [凹暴 {Math.round(charSA.totalDamageRig).toLocaleString()}]
                                            </span>
                                        {/if}
                                        {#if charSA.totalDamageNoCrit !== charSA.totalDamageNorm}
                                            <span class="text-[10px] tabular-nums" style={NOCRIT_GRAD_TEXT}>
                                                [不暴 {Math.round(charSA.totalDamageNoCrit).toLocaleString()}]
                                            </span>
                                        {/if}
                                    </div>
                                    <div class="text-[10px]" style="color: var(--theme-modal-text); opacity: 0.6;">
                                        副词条总贡献:
                                        <span class="font-medium text-(--theme-accent-text)"
                                            >+{Math.round(charSA.substatTotalNorm).toLocaleString()} ({charSA.substatTotalPctNorm.toFixed(
                                                1
                                            )}%)</span
                                        >
                                        {#if charSA.substatTotalRig !== charSA.substatTotalNorm}
                                            <span style={RIG_GRAD_TEXT}>
                                                [凹暴 +{Math.round(charSA.substatTotalRig).toLocaleString()} ({charSA.substatTotalPctRig.toFixed(
                                                    1
                                                )}%)]</span
                                            >
                                        {/if}
                                        {#if charSA.substatTotalNoCrit !== charSA.substatTotalNorm}
                                            <span style={NOCRIT_GRAD_TEXT}>
                                                [不暴 +{Math.round(charSA.substatTotalNoCrit).toLocaleString()} ({charSA.substatTotalPctNoCrit.toFixed(
                                                    1
                                                )}%)]</span
                                            >
                                        {/if}
                                    </div>
                                </div>
                                <div class="flex shrink-0 flex-col items-end gap-0.5">
                                    <div class={`${STAT_VALUE_MD} text-(--theme-accent-text)`}>
                                        {charSA.substatTotalPctNorm.toFixed(1)}
                                    </div>
                                    <div class="text-[9px]" style="color: var(--theme-modal-text); opacity: 0.35;">
                                        总分
                                    </div>
                                </div>
                            </div>

                            {#if charSA.aggregated.length > 0}
                                <div class="pt-3">
                                    <div
                                        class="mb-1 text-[10px] font-medium"
                                        style="color: var(--theme-modal-text); opacity: 0.5;"
                                    >
                                        词条类型汇总
                                    </div>
                                    <div
                                        class="w-full"
                                        style="height: {Math.max(140, charSA.aggregated.length * 26)}px"
                                    >
                                        <canvas use:registerBarCanvas={charSA.character}></canvas>
                                    </div>
                                </div>
                            {/if}

                            <div class="mt-3 space-y-1.5">
                                {#each charSA.echoes as echo, ei (ei)}
                                    <div
                                        class="rounded-none border"
                                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                    >
                                        <div class="px-3 py-2">
                                            <div class="mb-1.5 flex items-center justify-between">
                                                <span
                                                    class="text-[10px] font-medium"
                                                    style="color: var(--theme-modal-text); opacity: 0.6;"
                                                >
                                                    Cost{echo.cost}{echo.mainStat ? ' · ' + echo.mainStat : ''}
                                                </span>
                                                <span
                                                    class="text-sm font-black tabular-nums"
                                                    style="color: var(--theme-accent-text);"
                                                >
                                                    {echo.totalPctNorm.toFixed(1)}<span
                                                        class="ml-0.5 text-[9px] font-normal opacity-70">分</span
                                                    >
                                                </span>
                                            </div>
                                            <div class="space-y-0.5">
                                                {#each echo.substats as sub (sub.type)}
                                                    <div
                                                        class="flex flex-wrap items-center gap-2 text-[10px]"
                                                        style="color: var(--theme-modal-text);"
                                                    >
                                                        <span class="shrink-0 tabular-nums"
                                                            >{sub.type} {sub.value}{sub.unit}</span
                                                        >
                                                        <span
                                                            class="shrink-0 tabular-nums"
                                                            style="color: var(--theme-accent-text);"
                                                        >
                                                            → +{Math.round(sub.contributionNorm).toLocaleString()} ({sub.contribPctNorm.toFixed(
                                                                1
                                                            )}%)
                                                        </span>
                                                        {#if sub.contributionRig !== sub.contributionNorm}
                                                            <span class="shrink-0 tabular-nums" style={RIG_GRAD_TEXT}>
                                                                [凹暴 +{Math.round(
                                                                    sub.contributionRig
                                                                ).toLocaleString()} ({sub.contribPctRig.toFixed(1)}%)]
                                                            </span>
                                                        {/if}
                                                        {#if sub.contributionNoCrit !== sub.contributionNorm}
                                                            <span
                                                                class="shrink-0 tabular-nums"
                                                                style={NOCRIT_GRAD_TEXT}
                                                            >
                                                                [不暴 +{Math.round(
                                                                    sub.contributionNoCrit
                                                                ).toLocaleString()} ({sub.contribPctNoCrit.toFixed(
                                                                    1
                                                                )}%)]
                                                            </span>
                                                        {/if}
                                                    </div>
                                                {/each}
                                            </div>
                                            <div
                                                class="mt-1.5 flex items-center justify-between border-t pt-1.5 text-[10px]"
                                                style="border-color: var(--theme-divider-border); color: var(--theme-modal-text); opacity: 0.6;"
                                            >
                                                <span>
                                                    小计:
                                                    <span class="tabular-nums" style="color: var(--theme-accent-text);"
                                                        >+{Math.round(echo.totalNorm).toLocaleString()} ({echo.totalPctNorm.toFixed(
                                                            1
                                                        )}%)</span
                                                    >
                                                    {#if echo.totalRig !== echo.totalNorm}
                                                        <span class="tabular-nums" style={RIG_GRAD_TEXT}>
                                                            [凹暴 +{Math.round(echo.totalRig).toLocaleString()} ({echo.totalPctRig.toFixed(
                                                                1
                                                            )}%)]
                                                        </span>
                                                    {/if}
                                                    {#if echo.totalNoCrit !== echo.totalNorm}
                                                        <span class="tabular-nums" style={NOCRIT_GRAD_TEXT}>
                                                            [不暴 +{Math.round(echo.totalNoCrit).toLocaleString()} ({echo.totalPctNoCrit.toFixed(
                                                                1
                                                            )}%)]
                                                        </span>
                                                    {/if}
                                                </span>
                                                <span
                                                    class="font-black tabular-nums"
                                                    style="color: var(--theme-accent-text);"
                                                >
                                                    {echo.totalPctNorm.toFixed(1)}<span
                                                        class="ml-0.5 text-[9px] font-normal opacity-70">分</span
                                                    >
                                                </span>
                                            </div>
                                        </div>
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
