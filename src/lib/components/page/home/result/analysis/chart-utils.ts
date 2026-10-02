/**
 * @desc 数据分析弹窗（`data-analysis-modal.svelte`）的图表绘制与配色纯函数。
 *
 * Phase 5.3 第一增量：图表绘制体自弹窗原样抽出，只把「读哪个 `$state`、往哪个数组 push」
 * 改成显式入参 / 返回值。画布与 Chart 实例的持有、销毁时机仍留在各分区组件里：
 *   - `renderCurveChart` = 原 `drawCurveChart` 的绘制体（「空画布 / 空事件」早退与 `destroy` 留在组件侧）；
 *   - `renderBarCharts` / `renderTypeCharts` = 原 `drawBarCharts` / `drawTypeCharts` 的循环体，
 *     批量接收画布表、返回新建实例数组（主题变量仍是每批读一次，读取顺序不变）。
 * 本文件不 import 任何组件、不读写 store，只依赖 chart.js 与项目内的纯数据。
 */
import Chart from 'chart.js/auto'
import { COMPARISON_PALETTE } from '$lib/calc/comparison'
import type { CharSubstatAnalysis } from '$lib/calc/result.types'
import type { DirectDamageByType } from '$lib/calc/utils'

/** @desc 出伤曲线「窗口」模式的时间窗口（秒） */
export const CURVE_WINDOW_SEC = 1
/** @desc 出伤曲线「窗口」模式的采样步长（秒） */
export const CURVE_SAMPLE_SEC = 0.25

/** @desc Chart 实例类型别名（组件只持有实例，不需要 import chart.js） */
export type CurveChartInstance = Chart<'line'>
export type BarChartInstance = Chart<'bar'>
export type DoughnutChartInstance = Chart<'doughnut'>

/** @desc 曲线上的一个伤害事件：期望 / 凹暴 / 不暴三条线各自的纵值 */
export interface CurveEvent {
    time: number
    rig: number
    norm: number
    nocrit: number
}

/** @desc 主题变量取值：非浏览器环境（SSR）回退到 fallback */
export const cssVar = (name: string, fallback: string): string => {
    if (typeof document === 'undefined') return fallback
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

export const hexToRgba = (hex: string, alpha: number): string => {
    if (hex.startsWith('#')) {
        const r = parseInt(hex.slice(1, 3), 16)
        const g = parseInt(hex.slice(3, 5), 16)
        const b = parseInt(hex.slice(5, 7), 16)
        return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }
    return hex
}

export const chartGradient = (
    chart: { ctx: CanvasRenderingContext2D; chartArea?: { left: number; right: number } },
    from: string,
    to: string
) => {
    const area = chart.chartArea
    if (!area) return cssVar(from, '#ef4444')
    const g = chart.ctx.createLinearGradient(area.left, 0, area.right, 0)
    g.addColorStop(0, cssVar(from, '#ef4444'))
    g.addColorStop(1, cssVar(to, '#f97316'))
    return g
}

/** @desc 同一色相按贡献次序淡化（0 号原色，其余 ≥0.42 透明度） */
export const fadedColor = (hex: string, index: number): string => {
    if (index === 0) return hex
    const alpha = Math.max(0.42, 1 - index * 0.18)
    return hexToRgba(hex, alpha)
}

/** @desc 队伍出伤曲线（累计 / 窗口两种口径） */
export const renderCurveChart = ({
    canvas,
    events,
    tab,
    totalDur,
    hasTicks,
    hasRigCrit,
    hasNoCrit
}: {
    canvas: HTMLCanvasElement
    events: CurveEvent[]
    tab: 'cumulative' | 'window'
    totalDur: number
    hasTicks: boolean
    hasRigCrit: boolean
    hasNoCrit: boolean
}): CurveChartInstance => {
    const textColor = cssVar('--theme-modal-text', '#e2e8f0')

    const rigData: { x: number; y: number }[] = []
    const normData: { x: number; y: number }[] = []
    const nocritData: { x: number; y: number }[] = []

    if (tab === 'cumulative') {
        let a = 0
        let b = 0
        let c = 0
        for (const e of events) {
            a += e.rig
            b += e.norm
            c += e.nocrit
            rigData.push({ x: e.time, y: a })
            normData.push({ x: e.time, y: b })
            nocritData.push({ x: e.time, y: c })
        }
    } else {
        const w = CURVE_WINDOW_SEC
        let left = 0
        let right = 0
        let sRig = 0
        let sNorm = 0
        let sNo = 0
        for (let t = 0; t <= totalDur + 1e-6; t += CURVE_SAMPLE_SEC) {
            while (right < events.length && events[right].time <= t + w) {
                sRig += events[right].rig
                sNorm += events[right].norm
                sNo += events[right].nocrit
                right++
            }
            while (left < events.length && events[left].time < t) {
                sRig -= events[left].rig
                sNorm -= events[left].norm
                sNo -= events[left].nocrit
                left++
            }
            rigData.push({ x: t, y: sRig })
            normData.push({ x: t, y: sNorm })
            nocritData.push({ x: t, y: sNo })
        }
    }

    const stepped: boolean | 'before' | 'after' | 'middle' = tab === 'cumulative' ? 'after' : false
    return new Chart(canvas, {
        type: 'line',
        data: {
            datasets: [
                ...(hasRigCrit
                    ? [
                          {
                              label: '凹暴',
                              data: rigData,
                              borderColor: cssVar('--theme-rigcrit-from', '#ef4444'),
                              backgroundColor: 'transparent',
                              borderWidth: 2,
                              pointRadius: 0,
                              tension: 0.25,
                              stepped
                          }
                      ]
                    : []),
                {
                    label: '期望',
                    data: normData,
                    borderColor: cssVar('--theme-accent-bg', '#6366f1'),
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.25,
                    stepped
                },
                ...(hasNoCrit
                    ? [
                          {
                              label: '不暴',
                              data: nocritData,
                              borderColor: cssVar('--theme-nocrit-from', '#22c55e'),
                              backgroundColor: 'transparent',
                              borderWidth: 2,
                              pointRadius: 0,
                              tension: 0.25,
                              stepped
                          }
                      ]
                    : [])
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    bodyColor: textColor,
                    titleColor: textColor,
                    backgroundColor: cssVar('--theme-modal-bg', '#1e293b'),
                    borderColor: cssVar('--theme-divider-border', '#334155'),
                    borderWidth: 1,
                    callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: ${Math.round(ctx.parsed.y ?? 0).toLocaleString()}`
                    }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    min: 0,
                    max: totalDur,
                    ticks: { display: hasTicks, color: textColor, stepSize: 10 },
                    grid: { color: cssVar('--theme-divider-border', '#334155') }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: textColor },
                    grid: { color: cssVar('--theme-divider-border', '#334155') }
                }
            }
        }
    })
}

/** @desc 声骸词条贡献：逐角色横向柱状图（调用方先行销毁旧实例） */
export const renderBarCharts = (
    analysis: CharSubstatAnalysis[],
    canvases: Map<string, HTMLCanvasElement>
): BarChartInstance[] => {
    const charts: BarChartInstance[] = []

    const textColor = cssVar('--theme-modal-text', '#e2e8f0')
    const accentColor = cssVar('--theme-accent-bg', '#6366f1')
    const dividerColor = cssVar('--theme-divider-border', '#334155')

    for (const sa of analysis) {
        const canvas = canvases.get(sa.character)
        if (!canvas || sa.aggregated.length === 0) continue

        const labels = sa.aggregated.map((a) => a.type).reverse()
        const normData = sa.aggregated.map((a) => +a.contribPctNorm.toFixed(1)).reverse()
        const rigData = sa.aggregated.map((a) => +a.contribPctRig.toFixed(1)).reverse()
        const noCritData = sa.aggregated.map((a) => +a.contribPctNoCrit.toFixed(1)).reverse()
        const hasRig = sa.totalDamageRig !== sa.totalDamageNorm
        const hasNoCrit = sa.totalDamageNoCrit !== sa.totalDamageNorm

        const chart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: '期望',
                        data: normData,
                        backgroundColor: hexToRgba(accentColor, 0.85),
                        borderColor: 'transparent',
                        borderRadius: 3
                    },
                    ...(hasRig
                        ? [
                              {
                                  label: '凹暴',
                                  data: rigData,
                                  backgroundColor: (context: unknown) =>
                                      chartGradient(
                                          (context as { chart: Parameters<typeof chartGradient>[0] }).chart,
                                          '--theme-rigcrit-from',
                                          '--theme-rigcrit-to'
                                      ),
                                  borderColor: 'transparent',
                                  borderRadius: 3
                              }
                          ]
                        : []),
                    ...(hasNoCrit
                        ? [
                              {
                                  label: '不暴',
                                  data: noCritData,
                                  backgroundColor: (context: unknown) =>
                                      chartGradient(
                                          (context as { chart: Parameters<typeof chartGradient>[0] }).chart,
                                          '--theme-nocrit-from',
                                          '--theme-nocrit-to'
                                      ),
                                  borderColor: 'transparent',
                                  borderRadius: 3
                              }
                          ]
                        : [])
                ]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 4, bottom: 4, left: 4, right: 8 } },
                scales: {
                    x: {
                        stacked: false,
                        beginAtZero: true,
                        max: Math.max(...normData, ...rigData, ...noCritData) * 1.3 || 10,
                        grid: { color: hexToRgba(dividerColor, 0.3) },
                        ticks: {
                            color: textColor,
                            font: { size: 9 },
                            padding: 6,
                            callback: (v) => (+v).toFixed(1) + '%'
                        }
                    },
                    y: {
                        stacked: false,
                        grid: { display: false },
                        ticks: { color: textColor, font: { size: 10 }, padding: 8 }
                    }
                },
                plugins: {
                    legend: {
                        display: hasRig || hasNoCrit,
                        labels: { color: textColor, font: { size: 9 }, boxWidth: 10, padding: 8 }
                    },
                    tooltip: {
                        bodyColor: textColor,
                        titleColor: textColor,
                        backgroundColor: cssVar('--theme-modal-bg', '#1e293b'),
                        borderColor: dividerColor,
                        borderWidth: 1,
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${(ctx.parsed.x ?? 0).toFixed(1)}%`
                        }
                    }
                }
            }
        })
        charts.push(chart)
    }

    return charts
}

/** @desc 角色直伤类型占比：逐角色环形图（调用方先行销毁旧实例） */
export const renderTypeCharts = (
    byType: DirectDamageByType[],
    canvases: Map<string, HTMLCanvasElement>
): DoughnutChartInstance[] => {
    const charts: DoughnutChartInstance[] = []

    const textColor = cssVar('--theme-modal-text', '#e2e8f0')
    const bgColor = cssVar('--theme-modal-bg', '#1e293b')
    const dividerColor = cssVar('--theme-divider-border', '#334155')

    for (const agg of byType) {
        const canvas = canvases.get(agg.character)
        if (!canvas || agg.total <= 0 || agg.slices.length === 0) continue

        const labels = agg.slices.map((s) => s.label)
        const data = agg.slices.map((s) => s.value)
        // 与链阶对比弹窗共用色板：按类型索引取 COMPARISON_PALETTE（保证两弹窗配色一致）
        const colors = agg.slices.map((_, ti) => COMPARISON_PALETTE[ti % COMPARISON_PALETTE.length])

        const chart = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [
                    {
                        data,
                        backgroundColor: colors,
                        borderColor: bgColor,
                        borderWidth: 2,
                        hoverOffset: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '62%',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        bodyColor: textColor,
                        titleColor: textColor,
                        backgroundColor: bgColor,
                        borderColor: dividerColor,
                        borderWidth: 1,
                        callbacks: {
                            label: (ctx) => {
                                const val = ctx.parsed as number
                                const pct = ((val / agg.total) * 100).toFixed(1)
                                return `${ctx.label}: ${Math.round(val).toLocaleString()} (${pct}%)`
                            }
                        }
                    }
                }
            }
        })
        charts.push(chart)
    }

    return charts
}
