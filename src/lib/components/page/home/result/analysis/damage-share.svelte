<script lang="ts">
    /**
     * @desc 数据分析 → 伤害占比（队伍横向比例条 + 三角色直伤类型环形图）。
     * Phase 5.3：自 `data-analysis-modal.svelte` 原样抽出，标记与行为未改。
     *
     * 环形图的画布、Chart 实例随区块抽出（绘制体在 `./chart-utils`）；
     * 队伍占比色板 `shareItems` 由外壳计算（依赖 KPI 同源口径），此处只渲染。
     */
    import { onMount, untrack } from 'svelte'
    import Icon from '@iconify/svelte'
    import { CARD_SURFACE_STYLE } from '$lib/calc/result.styles'
    import { COMPARISON_PALETTE } from '$lib/calc/comparison'
    import { aggregateDirectDamageByType } from '$lib/calc/utils'
    import type { ResultEntry } from '$lib/calc/result.types'
    import { joinStyle, mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'
    import { cssVar, renderTypeCharts, type DoughnutChartInstance } from './chart-utils'
    import type { ShareItem } from './types'

    interface Props extends ComponentsProps {
        entries: ResultEntry[]
        /** @desc 队伍占比条数据（角色在前、效应在后，已按伤害降序并配好淡化色） */
        shareItems: ShareItem[]
        /** @desc 整段总伤害（占比基准，不随选中时段变化） */
        totalDamage: number
        /** @desc 角色 → 元素 映射（决定类型卡配色） */
        charElements: Record<string, string>
    }

    let { entries, shareItems, totalDamage, charElements, class: className, style: styleProp }: Props = $props()

    // ── 角色直伤类型占比：环形饼图，三角色并排；多类型伤害独立成「a&b」组合类别 ──
    let directDamageByType = $derived(aggregateDirectDamageByType(entries))
    let typeCharts: DoughnutChartInstance[] = []
    const typeChartCanvasMap = new Map<string, HTMLCanvasElement>()

    function registerTypeChartCanvas(node: HTMLCanvasElement, charName: string) {
        typeChartCanvasMap.set(charName, node)
        return {
            destroy() {
                typeChartCanvasMap.delete(charName)
            }
        }
    }

    const drawTypeCharts = () => {
        for (const c of typeCharts) c.destroy()
        typeCharts = renderTypeCharts(directDamageByType, typeChartCanvasMap)
    }

    $effect(() => {
        directDamageByType
        untrack(() => drawTypeCharts())
    })

    onMount(() => {
        return () => {
            for (const c of typeCharts) c.destroy()
        }
    })
</script>

<!-- ── 伤害占比：队伍 + 角色直伤类型 ── -->
<section class={mergeClass(['rounded-none border', className])} style={joinStyle([CARD_SURFACE_STYLE, styleProp])}>
    <div class="border-b px-4 py-3" style="border-color: var(--theme-divider-border);">
        <div class="flex items-center gap-2">
            <Icon icon="mdi:chart-pie" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            <h3 class="text-base font-black tracking-tight" style="color: var(--theme-modal-text);">伤害占比</h3>
            <span class="text-[10px]" style="color: var(--theme-modal-text); opacity: 0.4;"
                >（类型仅直伤，包括视为效应；多类型伤害独立成「a&b」组合类别）</span
            >
        </div>
    </div>
    <div class="p-4">
        <!-- 队伍占比：横向比例条 -->
        <div
            class="mb-4 rounded-none border px-4 py-3"
            style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-bg) 25%, transparent);"
        >
            <div class="mb-2 flex items-center justify-between text-[11px]" style="color: var(--theme-modal-text);">
                <span class="font-black tracking-tight">队伍伤害占比</span>
                <span class="tabular-nums" style="opacity: 0.5;">{Math.round(totalDamage).toLocaleString()}</span>
            </div>
            <div
                class="flex h-3 w-full overflow-hidden rounded-none"
                style="background: color-mix(in srgb, var(--theme-input-bg) 85%, transparent);"
            >
                {#if totalDamage > 0}
                    {#each shareItems as item, i (item.key)}
                        {#if i > 0}
                            <!-- 段间分割：取弹窗背景色（昼夜主题随 --theme-modal-bg 自动切换），使颜色交界清晰 -->
                            <div
                                class="w-0.5 shrink-0"
                                style="background: color-mix(in srgb, var(--theme-modal-bg) 92%, transparent);"
                            ></div>
                        {/if}
                        <div
                            class="h-full transition-all"
                            style="flex-grow: {item.damage}; background: {item.color};"
                            title="{item.label} {((item.damage / totalDamage) * 100).toFixed(1)}%"
                        ></div>
                    {/each}
                {/if}
            </div>
            <div class="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
                {#each shareItems as item (item.key)}
                    <div class="flex items-center gap-1.5 text-xs" style="color: var(--theme-modal-text);">
                        <span class="size-2.5 rounded-none shrink-0" style="background: {item.color};"></span>
                        <span class="truncate font-medium">{item.label}</span>
                        <span class="shrink-0 tabular-nums">
                            {Math.round(item.damage).toLocaleString()}
                            <span style="opacity: 0.5;">({((item.damage / totalDamage) * 100).toFixed(1)}%)</span>
                        </span>
                    </div>
                {/each}
            </div>
        </div>

        <!-- 三角色直伤类型占比，并排 -->
        {#if directDamageByType.length === 0}
            <div class="py-6 text-center text-xs" style="color: var(--theme-modal-text); opacity: 0.4;">
                暂无直伤数据
            </div>
        {:else}
            <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
                {#each directDamageByType as agg (agg.character)}
                    {@const el = charElements[agg.character]}
                    {@const color = el ? cssVar(`--theme-element-${el}`, '#888') : '#888'}
                    <div
                        class="rounded-none border p-4"
                        style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-bg) 30%, transparent);"
                    >
                        <div class="mb-2 flex items-center justify-between gap-2">
                            <span class="flex items-center gap-1.5 text-xs font-black" style="color: {color};">
                                <span class="size-2 rounded-full" style="background: {color};"></span>
                                {agg.character}
                            </span>
                            <span
                                class="text-[10px] tabular-nums"
                                style="color: var(--theme-modal-text); opacity: 0.5;"
                            >
                                {Math.round(agg.total).toLocaleString()}
                            </span>
                        </div>
                        <div class="mx-auto my-3 size-40">
                            <canvas use:registerTypeChartCanvas={agg.character} class="size-full"></canvas>
                        </div>
                        <div class="space-y-1">
                            {#each agg.slices as s, ti (s.label)}
                                <div
                                    class="flex items-center gap-1.5 text-[10px]"
                                    style="color: var(--theme-modal-text);"
                                >
                                    <span
                                        class="size-2 rounded-full shrink-0"
                                        style="background: {COMPARISON_PALETTE[ti % COMPARISON_PALETTE.length]};"
                                    ></span>
                                    <span class="truncate" title={s.label}>{s.label}</span>
                                    <span class="ml-auto shrink-0 tabular-nums" style="opacity: 0.6;">
                                        {s.pct.toFixed(1)}%
                                    </span>
                                </div>
                            {/each}
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
</section>
