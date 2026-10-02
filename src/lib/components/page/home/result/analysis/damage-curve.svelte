<script lang="ts">
    /**
     * @desc 数据分析 → 队伍出伤曲线（Phase 5.3：自 `data-analysis-modal.svelte` 原样抽出，标记与行为未改）。
     *
     * 曲线的画布、Chart 实例与「累计 / 窗口」页签都是本区块私有的，随区块一起抽出；
     * 绘制体在 `./chart-utils`（纯函数），本组件只负责早退判断、销毁旧实例与重绘时机。
     * 重绘依赖沿用抽出前的一组：画布、事件、页签、时间记点（原为 `sortedTimings`，此处用等价的 `validTimings`）。
     */
    import { onMount, untrack } from 'svelte'
    import Icon from '@iconify/svelte'
    import { getModalClosePosition } from '$lib/data/interaction-prefs.svelte'
    import { CARD_SURFACE_STYLE } from '$lib/calc/result.styles'
    import { joinStyle, mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'
    import Tabs from '$lib/components/ui/tabs.svelte'
    import {
        CURVE_SAMPLE_SEC,
        CURVE_WINDOW_SEC,
        renderCurveChart,
        type CurveChartInstance,
        type CurveEvent
    } from './chart-utils'
    import type { Timing } from './types'

    interface Props extends ComponentsProps {
        /** @desc 出伤曲线的事件序列（按时间升序） */
        events: CurveEvent[]
        /** @desc 已填写秒数的时间记点（决定 X 轴总时长与是否显示刻度） */
        validTimings: Timing[]
        /** @desc 凹暴条目（非空时多画一条凹暴线） */
        rigCritEntryIds: string[]
        /** @desc 不暴条目（非空时多画一条不暴线） */
        noCritEntryIds: string[]
    }

    let { events, validTimings, rigCritEntryIds, noCritEntryIds, class: className, style: styleProp }: Props = $props()

    // ── 队伍出伤曲线 ──
    let curveTab = $state<'cumulative' | 'window'>('cumulative')
    let curveCanvas: HTMLCanvasElement | null = $state(null)
    let curveChart: CurveChartInstance | null = $state(null)

    /** @desc 口径页签（等宽分段：累计 / 窗口），交给 ui/tabs 的滑动指示块 */
    const CURVE_TABS = [
        { value: 'cumulative', label: '累计' },
        { value: 'window', label: '窗口' }
    ]
    /** @desc 页签回调入参是分段 value（string），校验后写回受控状态 */
    const pickCurveTab = (next: string) => {
        if (next === 'cumulative' || next === 'window') curveTab = next
    }

    const drawCurveChart = () => {
        if (!curveCanvas || events.length === 0) return
        curveChart?.destroy()
        const totalDur = validTimings.length > 0 ? validTimings[validTimings.length - 1].seconds! : 150
        curveChart = renderCurveChart({
            canvas: curveCanvas,
            events,
            tab: curveTab,
            totalDur,
            hasTicks: validTimings.length > 0,
            hasRigCrit: rigCritEntryIds.length > 0,
            hasNoCrit: noCritEntryIds.length > 0
        })
    }

    $effect(() => {
        curveCanvas
        events
        curveTab
        validTimings
        untrack(() => drawCurveChart())
    })

    onMount(() => {
        return () => {
            curveChart?.destroy()
        }
    })
</script>

<!-- ── 队伍出伤曲线 ── -->
<section class={mergeClass(['rounded-none border', className])} style={joinStyle([CARD_SURFACE_STYLE, styleProp])}>
    <div
        class="flex flex-wrap items-center gap-2 border-b px-4 py-3"
        style="border-color: var(--theme-divider-border);"
    >
        <div class="flex items-center gap-2">
            <Icon icon="mdi:chart-line" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            <h3 class="text-base font-black tracking-tight" style="color: var(--theme-modal-text);">队伍出伤曲线</h3>
        </div>
        <Tabs
            items={CURVE_TABS}
            value={curveTab}
            onchange={pickCurveTab}
            backgroundImage="var(--theme-accent-bg)"
            textColor="var(--theme-accent-text-on-bg, #ffffff)"
            class="{getModalClosePosition() === 'top-left'
                ? ''
                : 'ml-auto '}[&>button]:px-2 [&>button]:py-0.5 [&>button]:text-[11px]"
        />
    </div>
    <div class="px-4 py-3">
        <div
            class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]"
            style="color: var(--theme-modal-text);"
        >
            {#if rigCritEntryIds.length > 0}
                <span class="flex items-center gap-1">
                    <span class="size-2.5 rounded-full" style="background: var(--theme-rigcrit-from);"></span>凹暴
                </span>
            {/if}
            <span class="flex items-center gap-1">
                <span class="size-2.5 rounded-full" style="background: var(--theme-accent-bg);"></span>期望
            </span>
            {#if noCritEntryIds.length > 0}
                <span class="flex items-center gap-1">
                    <span class="size-2.5 rounded-full" style="background: var(--theme-nocrit-from);"></span>不暴
                </span>
            {/if}
            {#if curveTab === 'window'}
                <span style="opacity: 0.4;">窗口 {CURVE_WINDOW_SEC}s · 采样 {CURVE_SAMPLE_SEC}s</span>
            {/if}
            {#if !validTimings.length}
                <span style="opacity: 0.4;">默认 X 轴总时长 150s，配置时间记点后按记点显示刻度</span>
            {/if}
            <span style="opacity: 0.35;">期望 = 暴击加权；凹暴/不暴仅作用于所选条目</span>
        </div>
        {#if events.length === 0}
            <div class="py-8 text-center text-xs" style="color: var(--theme-modal-text); opacity: 0.4;">
                暂无伤害数据
            </div>
        {:else}
            <div class="relative h-56">
                <canvas bind:this={curveCanvas} class="absolute inset-0 h-full w-full"></canvas>
            </div>
        {/if}
    </div>
</section>
