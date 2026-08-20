<script lang="ts">
    import { onMount, untrack } from 'svelte'
    import { slide } from 'svelte/transition'
    import Chart from 'chart.js/auto'
    import { getCharElementMap, getRefLines, getOpBlocks } from '$lib/calc/timeline.store.svelte'
    import type { ResultEntry, CharSummary, CharSubstatAnalysis } from '$lib/calc/result.types'
    import type { CharSlot, ResultAnalysisData } from '$lib/types/project'
    import type { AlgorithmId, AlgorithmInfo } from '$lib/calc/substat-algorithms/types'
    import Icon from '@iconify/svelte'
    import { ALGORITHM_HELP } from '$lib/calc/result.consts'
    import { openHelp } from '$lib/data/help.svelte'
    import { getActiveProject } from '$lib/data/project.svelte'
    import { openPanel } from '$lib/ai/panels.svelte'
    import { aggregateDirectDamageByType } from '$lib/calc/utils'
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {
        entries: ResultEntry[]
        charSummaries: CharSummary[]
        team: [CharSlot, CharSlot, CharSlot]
        totalDamage: number
        resultAnalysis: ResultAnalysisData | undefined
        substatAnalysis: CharSubstatAnalysis[]
        analysisComputing: boolean
        algorithmsInfo: AlgorithmInfo[]
        selectedAlgorithm: AlgorithmId
        rigCritEntryIds: string[]
        noCritEntryIds: string[]
        onSelectAlgorithm: (id: AlgorithmId) => void
        onUpdateResultAnalysis: (data: ResultAnalysisData) => void
        onclose: () => void
    }

    let {
        entries,
        charSummaries,
        team,
        totalDamage,
        resultAnalysis,
        substatAnalysis,
        analysisComputing,
        algorithmsInfo,
        selectedAlgorithm,
        rigCritEntryIds,
        noCritEntryIds,
        onSelectAlgorithm,
        onUpdateResultAnalysis,
        onclose,
        class: className,
        style: styleProp
    }: Props = $props()

    let charElements = $derived(getCharElementMap())
    let helpItems = $derived(
        algorithmsInfo.map((algo) => ({
            name: algo.name,
            description: algo.description,
            content: ALGORITHM_HELP[algo.id]
        }))
    )

    // ── 当前工程名（标题栏展示）──
    let projectName = $derived(getActiveProject()?.name ?? '未命名项目')

    // ── 时间记点规则帮助 ──
    const refLineHelpItems: { name: string; description: string; content: string }[] = [
        {
            name: '命名解析',
            description: '参考线名称中的数字自动转为秒数',
            content:
                '启用参考线作为时间记点时，会解析其名称并自动填入秒数：名称含数字即填入第一个数字；数字紧邻单位时按单位换算——分 / min / m ×60，秒 / sec / s ×1，帧 / f ÷100（1 秒 = 100 帧）。支持混合单位，如「1min30s50f」= 60 + 30 + 0.5 = 90.5 秒。'
        },
        {
            name: '相对加算',
            description: '数字前带 + 号时按上一记点加算',
            content:
                '若数字前有加号（如 +25s、+25s30f），启用该记点时，时间 = 上一记点的秒数 + 解析出的秒数，而不是绝对时间。'
        },
        {
            name: '单调约束',
            description: '绝对时间不得早于上一记点',
            content:
                '若后续参考线解析出绝对时间，但数值早于上一记点，则自动填入与上一记点相同的时间，保证各记点时间单调递增。'
        }
    ]

    // ── timing state ──
    let timings = $state<{ refLineId: string; seconds: number }[]>([])

    $effect(() => {
        timings = resultAnalysis?.timings ?? []
    })

    function handleClose() {
        onUpdateResultAnalysis({ timings })
        onclose()
    }

    // ref lines from timeline (exclude 'left')
    let refLines = $derived(getRefLines().filter((rl) => rl.id !== 'left'))

    let opBlocks = $derived(getOpBlocks())

    let blockPosMap = $derived.by(() => {
        const map = new Map<string, number>()
        for (const b of opBlocks) map.set(b.id, b.pos)
        for (const rl of refLines) map.set(rl.id, rl.pos)
        return map
    })

    /** @desc 参考线命名 → 时间解析：数字+单位（分/秒/帧、min/sec/m/s/f），'+' 前缀表示相对上一记点加算 */
    function parseRefLineSeconds(raw: string): { relative: boolean; seconds: number } | null {
        if (!raw) return null
        const relative = /^\s*\+/.test(raw)
        const body = raw.replace(/^\s*\+/, '').trim()
        const firstNum = body.match(/\d+(?:\.\d+)?/)
        if (!firstNum) return null
        // 数字紧邻单位 → 解析整段「数字+单位」序列（支持 1min30s50f 等混合单位；1 秒 = 100 帧）
        const rest = body.slice((firstNum.index ?? 0) + firstNum[0].length).trimStart()
        if (/^(?:分|秒|帧|min|sec|m|s|f)/.test(rest)) {
            let seconds = 0
            let matched = false
            const re = /(\d+(?:\.\d+)?)\s*(分|秒|帧|min|sec|m|s|f)/g
            let m: RegExpExecArray | null
            while ((m = re.exec(body)) !== null) {
                matched = true
                const v = parseFloat(m[1])
                const u = m[2]
                if (u === '分' || u === 'min' || u === 'm') seconds += v * 60
                else if (u === '帧' || u === 'f') seconds += v / 100
                else seconds += v // 秒 / sec / s
            }
            return matched ? { relative, seconds } : null
        }
        // 数字无单位 → 直接作为秒数
        return { relative, seconds: parseFloat(firstNum[0]) }
    }

    /** @desc 启用参考线作为时间记点时，按其命名解析秒数（相对加算/绝对），并施加单调约束 */
    function resolveRefLineSeconds(id: string): number {
        const rl = refLines.find((r) => r.id === id)
        const raw = rl?.time ?? ''
        // 候选集合 = 现有记点 + 新记点，按参考线位置排序
        const candidate = [...timings, { refLineId: id, seconds: 0 }]
            .filter((t) => refLines.some((r) => r.id === t.refLineId))
            .sort((a, b) => {
                const aRl = refLines.find((r) => r.id === a.refLineId)
                const bRl = refLines.find((r) => r.id === b.refLineId)
                return (aRl?.pos ?? 0) - (bRl?.pos ?? 0)
            })
        const idx = candidate.findIndex((t) => t.refLineId === id)
        const prevSeconds = idx > 0 ? candidate[idx - 1].seconds : 0
        const parsed = parseRefLineSeconds(raw)
        if (!parsed) return prevSeconds + 25 // 无法解析 → 相对上一记点 +25s
        let seconds = parsed.relative ? prevSeconds + parsed.seconds : parsed.seconds
        // 单调约束：绝对时间不得早于上一记点（早于则与上一记点相等）
        if (!parsed.relative && seconds < prevSeconds) seconds = prevSeconds
        return seconds
    }

    function toggleRefLine(id: string) {
        if (timings.some((t) => t.refLineId === id)) {
            timings = timings.filter((t) => t.refLineId !== id)
        } else {
            timings = [...timings, { refLineId: id, seconds: resolveRefLineSeconds(id) }]
        }
    }

    function updateSeconds(id: string, raw: string) {
        const val = parseFloat(raw)
        if (isNaN(val) || val < 0) return
        timings = timings.map((t) => (t.refLineId === id ? { ...t, seconds: val } : t))
    }

    // sorted timings by ref line pos (timeline order)
    let sortedTimings = $derived(
        [...timings]
            .filter((t) => refLines.some((r) => r.id === t.refLineId))
            .sort((a, b) => {
                const aRl = refLines.find((r) => r.id === a.refLineId)
                const bRl = refLines.find((r) => r.id === b.refLineId)
                return (aRl?.pos ?? 0) - (bRl?.pos ?? 0)
            })
    )

    // 总时长与总 DPS（强调 DPS）
    let totalDur = $derived(sortedTimings.length > 0 ? sortedTimings[sortedTimings.length - 1].seconds : 0)
    let overallDps = $derived(totalDur > 0 ? totalDamage / totalDur : null)

    // ── DPS segments ──
    let segments = $derived.by(() => {
        if (sortedTimings.length === 0) return []

        const result: {
            startSeconds: number
            endSeconds: number
            totalDamage: number
            charDamages: Record<string, number>
            otherDamage: number
        }[] = []

        let prevRefPos = 0
        let prevSeconds = 0
        for (const t of sortedTimings) {
            const rl = refLines.find((r) => r.id === t.refLineId)
            if (!rl) continue
            const span = t.seconds - prevSeconds
            if (span <= 0) continue
            const currentRefPos = rl.pos
            const segEntries = entries.filter((e) => {
                const entryPos = blockPosMap.get(e.sourceTimelineBlockId)
                return entryPos !== undefined && entryPos >= prevRefPos && entryPos < currentRefPos
            })
            const totalDmg = segEntries.reduce((s, e) => s + e.totalDamage, 0)
            const charDmg: Record<string, number> = {}
            let otherDmg = 0
            for (const e of segEntries) {
                if (team.some((s) => s.character === e.character)) {
                    charDmg[e.character] = (charDmg[e.character] ?? 0) + e.totalDamage
                } else {
                    otherDmg += e.totalDamage
                }
            }
            result.push({
                startSeconds: prevSeconds,
                endSeconds: t.seconds,
                totalDamage: totalDmg,
                charDamages: charDmg,
                otherDamage: otherDmg
            })
            prevRefPos = currentRefPos
            prevSeconds = t.seconds
        }

        return result
    })

    // 分段合计（与表格内部一致）
    let segTotals = $derived.by(() => {
        const perChar: Record<string, number> = {}
        let other = 0
        let total = 0
        for (const seg of segments) {
            total += seg.totalDamage
            for (const [c, d] of Object.entries(seg.charDamages)) perChar[c] = (perChar[c] ?? 0) + d
            other += seg.otherDamage
        }
        return { perChar, other, total }
    })
    let segTotalDps = $derived(totalDur > 0 ? segTotals.total / totalDur : 0)

    // ── 时间记点配置折叠 ──
    let timingOpen = $state(true)

    // ── 队伍出伤曲线 ──
    let curveTab = $state<'cumulative' | 'window'>('cumulative')
    const CURVE_WINDOW_SEC = 1
    const CURVE_SAMPLE_SEC = 0.25
    let curveCanvas: HTMLCanvasElement | null = $state(null)
    let curveChart: Chart<'line'> | null = $state(null)

    let curveEvents = $derived.by(() => {
        const withPos = entries
            .map((e) => ({ entry: e, pos: blockPosMap.get(e.sourceTimelineBlockId) }))
            .filter((x): x is { entry: ResultEntry; pos: number } => x.pos !== undefined)
            .sort((a, b) => a.pos - b.pos)
        const totalDur = sortedTimings.length > 0 ? sortedTimings[sortedTimings.length - 1].seconds : 150

        const segs: { startPos: number; endPos: number; startSec: number; endSec: number }[] = []
        if (sortedTimings.length === 0) {
            segs.push({ startPos: -Infinity, endPos: Infinity, startSec: 0, endSec: totalDur })
        } else {
            let prevPos = 0
            let prevSec = 0
            for (const t of sortedTimings) {
                const rl = refLines.find((r) => r.id === t.refLineId)
                if (!rl) continue
                segs.push({ startPos: prevPos, endPos: rl.pos, startSec: prevSec, endSec: t.seconds })
                prevPos = rl.pos
                prevSec = t.seconds
            }
            segs.push({ startPos: prevPos, endPos: Infinity, startSec: prevSec, endSec: totalDur })
        }

        const events: { time: number; rig: number; norm: number; nocrit: number }[] = []
        let cursor = 0
        for (const seg of segs) {
            if (seg.endSec <= seg.startSec) continue
            const segEntries: typeof withPos = []
            while (cursor < withPos.length && withPos[cursor].pos < seg.endPos) {
                if (withPos[cursor].pos >= seg.startPos) segEntries.push(withPos[cursor])
                cursor++
            }
            const n = segEntries.length
            if (n === 0) continue
            const dur = seg.endSec - seg.startSec
            segEntries.forEach((x, j) => {
                const e = x.entry
                // 期望线 = 暴击加权期望（totalDamageRaw 未被凹暴/不暴模式覆盖，始终为原始期望，per-hit 口径）；
                // 凹暴/不暴线 = 仅将所选条目替换为全暴击 / 全非暴击伤害，其余条目保持期望（与词条贡献分析基准一致）
                const norm = e.totalDamageRaw
                const rig = rigCritEntryIds.includes(e.id) ? (e.canCrit ? e.critPerHit : norm) : norm
                const nocrit = noCritEntryIds.includes(e.id) ? (e.canCrit ? e.nonCritPerHit : norm) : norm
                events.push({ time: seg.startSec + ((j + 0.5) * dur) / n, rig, norm, nocrit })
            })
        }
        events.sort((a, b) => a.time - b.time)
        return events
    })

    function drawCurveChart() {
        if (!curveCanvas || curveEvents.length === 0) return
        curveChart?.destroy()
        const textColor = cssVar('--theme-modal-text', '#e2e8f0')
        const totalDur = sortedTimings.length > 0 ? sortedTimings[sortedTimings.length - 1].seconds : 150
        const hasTicks = sortedTimings.length > 0

        const rigData: { x: number; y: number }[] = []
        const normData: { x: number; y: number }[] = []
        const nocritData: { x: number; y: number }[] = []

        if (curveTab === 'cumulative') {
            let a = 0
            let b = 0
            let c = 0
            for (const e of curveEvents) {
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
                while (right < curveEvents.length && curveEvents[right].time <= t + w) {
                    sRig += curveEvents[right].rig
                    sNorm += curveEvents[right].norm
                    sNo += curveEvents[right].nocrit
                    right++
                }
                while (left < curveEvents.length && curveEvents[left].time < t) {
                    sRig -= curveEvents[left].rig
                    sNorm -= curveEvents[left].norm
                    sNo -= curveEvents[left].nocrit
                    left++
                }
                rigData.push({ x: t, y: sRig })
                normData.push({ x: t, y: sNorm })
                nocritData.push({ x: t, y: sNo })
            }
        }

        const stepped: boolean | 'before' | 'after' | 'middle' = curveTab === 'cumulative' ? 'after' : false
        curveChart = new Chart(curveCanvas, {
            type: 'line',
            data: {
                datasets: [
                    ...(rigCritEntryIds.length > 0
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
                    ...(noCritEntryIds.length > 0
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

    $effect(() => {
        curveCanvas
        curveEvents
        curveTab
        sortedTimings
        untrack(() => drawCurveChart())
    })

    // ── theme-aware colors ──
    function cssVar(name: string, fallback: string): string {
        if (typeof document === 'undefined') return fallback
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
    }

    function hexToRgba(hex: string, alpha: number): string {
        if (hex.startsWith('#')) {
            const r = parseInt(hex.slice(1, 3), 16)
            const g = parseInt(hex.slice(3, 5), 16)
            const b = parseInt(hex.slice(5, 7), 16)
            return `rgba(${r}, ${g}, ${b}, ${alpha})`
        }
        return hex
    }

    const RIG_GRAD_TEXT =
        'background: var(--theme-rigcrit-grad); -webkit-background-clip: text; background-clip: text; color: transparent;'
    const NOCRIT_GRAD_TEXT =
        'background: var(--theme-nocrit-grad); -webkit-background-clip: text; background-clip: text; color: transparent;'

    function chartGradient(
        chart: { ctx: CanvasRenderingContext2D; chartArea?: { left: number; right: number } },
        from: string,
        to: string
    ) {
        const area = chart.chartArea
        if (!area) return cssVar(from, '#ef4444')
        const g = chart.ctx.createLinearGradient(area.left, 0, area.right, 0)
        g.addColorStop(0, cssVar(from, '#ef4444'))
        g.addColorStop(1, cssVar(to, '#f97316'))
        return g
    }

    function fadedColor(hex: string, index: number): string {
        if (index === 0) return hex
        const alpha = Math.max(0.42, 1 - index * 0.18)
        return hexToRgba(hex, alpha)
    }

    const OTHER_PIE_COLOR = 'rgba(210, 214, 220, 0.5)'

    let sortedSummaries = $derived([...charSummaries].sort((a, b) => b.totalDamage - a.totalDamage))
    let sortedPieColors = $derived.by(() => {
        let rank = 0
        return sortedSummaries.map((cs) => {
            if (!cs.character) return OTHER_PIE_COLOR
            const el = charElements[cs.character]
            const base = el ? cssVar(`--theme-element-${el}`, '#888') : '#888'
            const color = fadedColor(base, rank)
            rank++
            return color
        })
    })

    // ── team share：横向比例条（纯 HTML 渲染，无需 chart.js）──
    // 色板复用 sortedPieColors（按贡献降序 + 淡出），模板中用宽度百分比绘制分段

    // ── bar chart (substat aggregation) ──
    let barCharts: Chart<'bar'>[] = []
    const barCanvasMap = new Map<string, HTMLCanvasElement>()

    function registerBarCanvas(node: HTMLCanvasElement, charName: string) {
        barCanvasMap.set(charName, node)
        return {
            destroy() {
                barCanvasMap.delete(charName)
            }
        }
    }

    function drawBarCharts() {
        for (const c of barCharts) c.destroy()
        barCharts = []

        const textColor = cssVar('--theme-modal-text', '#e2e8f0')
        const accentColor = cssVar('--theme-accent-bg', '#6366f1')
        const dividerColor = cssVar('--theme-divider-border', '#334155')

        for (const sa of substatAnalysis) {
            const canvas = barCanvasMap.get(sa.character)
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
            barCharts.push(chart)
        }
    }

    $effect(() => {
        substatAnalysis
        untrack(() => drawBarCharts())
    })

    // ── 角色直伤类型占比：环形饼图，三角色并排；多类型伤害独立成「a&b」组合类别 ──
    let directDamageByType = $derived(aggregateDirectDamageByType(entries))
    let typeCharts: Chart<'doughnut'>[] = []
    const typeChartCanvasMap = new Map<string, HTMLCanvasElement>()

    function registerTypeChartCanvas(node: HTMLCanvasElement, charName: string) {
        typeChartCanvasMap.set(charName, node)
        return {
            destroy() {
                typeChartCanvasMap.delete(charName)
            }
        }
    }

    function drawTypeCharts() {
        for (const c of typeCharts) c.destroy()
        typeCharts = []

        const textColor = cssVar('--theme-modal-text', '#e2e8f0')
        const bgColor = cssVar('--theme-modal-bg', '#1e293b')
        const dividerColor = cssVar('--theme-divider-border', '#334155')

        for (const agg of directDamageByType) {
            const canvas = typeChartCanvasMap.get(agg.character)
            if (!canvas || agg.total <= 0 || agg.slices.length === 0) continue

            const labels = agg.slices.map((s) => s.label)
            const data = agg.slices.map((s) => s.value)
            const colors = agg.slices.map((s) => s.color)

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
            typeCharts.push(chart)
        }
    }

    $effect(() => {
        directDamageByType
        untrack(() => drawTypeCharts())
    })

    onMount(() => {
        return () => {
            curveChart?.destroy()
            for (const c of barCharts) c.destroy()
            for (const c of typeCharts) c.destroy()
        }
    })

    // ── 通用样式常量 ──
    const cardBg = 'color-mix(in srgb, var(--theme-card-bg, var(--theme-modal-bg)) 42%, transparent)'
    const mutedText = 'color: var(--theme-modal-text); opacity: 0.45;'
</script>

<!-- svelte-ignore a11y_interactive_supports_focus -->
<div
    class="animate-fade-in fixed inset-0 z-50 flex items-center justify-center p-4 overflow-hidden backdrop-blur-sm {className}"
    style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5)); {styleProp || ''}"
    role="presentation"
>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
        class="animate-pop-in theme-scrollbar flex max-h-[94vh] w-[min(1500px,96vw)] flex-col overflow-hidden rounded-2xl border shadow-2xl"
        style="background: color-mix(in srgb, var(--theme-modal-bg) 80%, transparent); border-color: var(--theme-divider-border);"
        onclick={(e) => e.stopPropagation()}
    >
        <!-- Header -->
        <div
            class="sticky top-0 z-10 flex shrink-0 items-center gap-3 border-b px-6 py-4"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 92%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-color: var(--theme-divider-border);"
        >
            <div class="flex items-center gap-2.5">
                <Icon icon="mdi:chart-box-outline" class="size-5" style="color: var(--theme-accent-text);" />
                <span class="text-base font-semibold" style="color: var(--theme-modal-text);">数据分析</span>
                <span
                    class="hidden max-w-56 truncate rounded-full border px-2 py-0.5 text-[10px] font-medium md:inline-block"
                    style="color: var(--theme-modal-text); opacity: 0.5; border-color: var(--theme-divider-border);"
                    title={projectName}>{projectName}</span
                >
            </div>
            <div
                class="ml-auto flex items-center gap-2 text-[11px]"
                style="color: var(--theme-modal-text); opacity: 0.55;"
            >
                {#if totalDur > 0}
                    <span class="tabular-nums">总时长 {totalDur.toFixed(1)}s</span>
                    <span class="size-1 rounded-full" style="background: var(--theme-divider-border);"></span>
                    <span class="flex items-center gap-1">
                        总 DPS
                        <span class="text-sm font-bold tabular-nums" style="color: var(--theme-accent-text);"
                            >{overallDps ? Math.round(overallDps).toLocaleString() : '—'}</span
                        >
                    </span>
                {:else}
                    <span style="opacity: 0.6;">配置时间记点后显示 DPS</span>
                {/if}
            </div>
            <button
                onclick={() => openPanel('character-detail', true)}
                class="rounded p-1 transition-colors hover:opacity-70"
                style="color: var(--theme-accent-text);"
                title="打开角色详情配置"
                aria-label="打开角色详情配置"
            >
                <Icon icon="mdi:account-details-outline" class="size-5" />
            </button>
            <button
                onclick={handleClose}
                class="rounded p-1 transition-colors hover:opacity-70"
                style="color: var(--theme-modal-text); opacity: 0.45;"
                aria-label="关闭"
            >
                <Icon icon="mdi:close" class="size-5" />
            </button>
        </div>

        <!-- Scrollable body -->
        <div class="theme-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            <!-- ── KPI 总览 ── -->
            <section class="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <div
                    class="relative col-span-2 overflow-hidden rounded-xl border p-4 lg:col-span-1"
                    style="border-color: var(--theme-divider-border); background: linear-gradient(135deg, color-mix(in srgb, var(--theme-accent-bg) 16%, transparent), transparent 65%);"
                >
                    <div class="text-[10px] font-semibold uppercase tracking-wider" style={mutedText}>总伤害</div>
                    <div
                        class="mt-1.5 text-2xl font-bold leading-none tabular-nums"
                        style="color: var(--theme-accent-text);"
                    >
                        {Math.round(totalDamage).toLocaleString()}
                    </div>
                    <div class="mt-1 text-[10px] tabular-nums" style={mutedText}>{entries.length} 条伤害记录</div>
                </div>
                {#each charSummaries as cs, i}
                    {@const el = charElements[cs.character]}
                    {@const color = el ? cssVar(`--theme-element-${el}`, '#888') : '#888'}
                    <div
                        class="rounded-xl border p-4"
                        style="border-color: var(--theme-divider-border); background: {cardBg};"
                    >
                        <div class="flex items-center gap-1.5">
                            <span class="size-2 rounded-full shrink-0" style="background: {color};"></span>
                            <span class="truncate text-[10px] font-semibold" style="color: {color};"
                                >{cs.character || '其它'}</span
                            >
                        </div>
                        <div
                            class="mt-1.5 text-lg font-bold leading-none tabular-nums"
                            style="color: var(--theme-modal-text);"
                        >
                            {Math.round(cs.totalDamage).toLocaleString()}
                        </div>
                        <div class="mt-1 text-[10px] tabular-nums" style={mutedText}>
                            占比 {((cs.totalDamage / totalDamage) * 100).toFixed(1)}% · {cs.entryCount} 条
                        </div>
                    </div>
                {/each}
                <div
                    class="relative overflow-hidden rounded-xl border p-4"
                    style="border-color: color-mix(in srgb, var(--theme-accent-bg) 35%, transparent); background: linear-gradient(135deg, color-mix(in srgb, var(--theme-accent-bg) 10%, transparent), transparent 70%);"
                >
                    <div class="text-[10px] font-semibold uppercase tracking-wider" style={mutedText}>总 DPS</div>
                    <div
                        class="mt-1.5 text-2xl font-bold leading-none tabular-nums"
                        style="color: var(--theme-accent-text);"
                    >
                        {overallDps ? Math.round(overallDps).toLocaleString() : '—'}
                    </div>
                    <div class="mt-1 text-[10px]" style={mutedText}>配置时间记点后计算</div>
                </div>
            </section>

            <!-- ── 时间记点 + 分段 DPS ── -->
            <section
                class="rounded-xl border"
                style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-card-bg, var(--theme-modal-bg)) 30%, transparent);"
            >
                <div
                    class="flex flex-wrap items-center gap-2 border-b px-4 py-3"
                    style="border-color: var(--theme-divider-border);"
                >
                    <div class="flex items-center gap-2">
                        <Icon
                            icon="mdi:chart-timeline-variant"
                            class="size-4"
                            style="color: var(--theme-accent-text);"
                        />
                        <span class="text-sm font-semibold" style="color: var(--theme-modal-text);">分段 DPS</span>
                        <button
                            onclick={() => openHelp('时间记点规则', refLineHelpItems)}
                            class="flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold transition-colors hover:bg-white/10"
                            style="color: var(--theme-accent-text);"
                            title="时间参考线命名解析与限制规则"
                        >
                            ?
                        </button>
                        {#if overallDps}
                            <span
                                class="rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums"
                                style="background: color-mix(in srgb, var(--theme-accent-bg) 16%, transparent); color: var(--theme-accent-text);"
                            >
                                总 DPS {Math.round(overallDps).toLocaleString()}
                            </span>
                        {/if}
                    </div>
                    <div class="ml-auto">
                        <button
                            onclick={() => (timingOpen = !timingOpen)}
                            class="flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:opacity-80"
                            style="border-color: var(--theme-divider-border); color: var(--theme-modal-text);"
                        >
                            <Icon icon="mdi:tune-variant" class="size-3.5" />
                            <span>时间记点</span>
                            <span class="text-[10px] tabular-nums" style="opacity: 0.5;">{timings.length}</span>
                            <Icon icon={timingOpen ? 'mdi:chevron-up' : 'mdi:chevron-down'} class="size-3.5" />
                        </button>
                    </div>
                </div>

                {#if timingOpen}
                    <div class="border-b px-4 py-3" style="border-color: var(--theme-divider-border);">
                        <div transition:slide|local={{ duration: 200 }}>
                            {#if refLines.length === 0}
                                <div class="text-[11px]" style="color: var(--theme-modal-text); opacity: 0.4;">
                                    暂无时间参考线，请先在时间轴添加参考线
                                </div>
                            {:else}
                                <div class="flex flex-wrap gap-2">
                                    {#each refLines as rl}
                                        {@const isSelected = timings.some((t) => t.refLineId === rl.id)}
                                        {@const selIdx = sortedTimings.findIndex((t) => t.refLineId === rl.id)}
                                        {@const prevSeconds = selIdx > 0 ? sortedTimings[selIdx - 1].seconds : 0}
                                        <div
                                            class="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs select-none transition-colors"
                                            style="border-color: {isSelected
                                                ? 'var(--theme-accent-bg)'
                                                : 'var(--theme-divider-border)'}; background: {isSelected
                                                ? 'color-mix(in srgb, var(--theme-accent-bg) 8%, transparent)'
                                                : 'transparent'}; color: var(--theme-modal-text);"
                                            onclick={() => toggleRefLine(rl.id)}
                                            role="button"
                                            tabindex="0"
                                        >
                                            <span class="truncate opacity-60">{rl.time || '—'}</span>
                                            {#if isSelected}
                                                <input
                                                    type="number"
                                                    value={timings.find((t) => t.refLineId === rl.id)?.seconds ?? 0}
                                                    oninput={(e) =>
                                                        updateSeconds(rl.id, (e.target as HTMLInputElement).value)}
                                                    min={prevSeconds}
                                                    step="0.1"
                                                    class="w-16 rounded border px-1.5 py-0.5 text-right text-[11px] tabular-nums outline-none"
                                                    style="background: var(--theme-input-bg); border-color: var(--theme-divider-border); color: var(--theme-modal-text);"
                                                    onclick={(e) => e.stopPropagation()}
                                                />
                                                <span class="text-[10px] opacity-40">秒</span>
                                                {#if selIdx > 0}
                                                    <span
                                                        class="text-[10px]"
                                                        style="color: var(--theme-accent-text); opacity: 0.6;"
                                                        >(≥ {prevSeconds.toFixed(1)}s)</span
                                                    >
                                                {/if}
                                            {/if}
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    </div>
                {/if}

                <div class="overflow-x-auto px-4 py-3">
                    {#if segments.length === 0}
                        <div class="py-4 text-center text-xs" style="color: var(--theme-modal-text); opacity: 0.4;">
                            请先在上方选择时间记点以计算分段 DPS
                        </div>
                    {:else}
                        <table class="w-full text-xs">
                            <thead>
                                <tr style="color: var(--theme-modal-text); opacity: 0.5;">
                                    <th class="py-1.5 pr-2 text-left font-medium">时段</th>
                                    <th class="px-2 py-1.5 text-right font-medium">跨度</th>
                                    <th class="px-2 py-1.5 text-right font-medium">总伤</th>
                                    <th class="px-2 py-1.5 text-right font-medium">总 DPS</th>
                                    {#each team as slot}
                                        {#if slot.character}
                                            <th class="py-1.5 pl-2 text-right font-medium">{slot.character}</th>
                                        {/if}
                                    {/each}
                                    <th class="py-1.5 pl-2 text-right font-medium">其他</th>
                                </tr>
                            </thead>
                            <tbody>
                                {#each segments as seg}
                                    {@const span = seg.endSeconds - seg.startSeconds}
                                    <tr
                                        class="border-t"
                                        style="border-color: var(--theme-divider-border); color: var(--theme-modal-text);"
                                    >
                                        <td class="py-2 pr-2 text-[10px] tabular-nums" style="opacity: 0.45;">
                                            {seg.startSeconds.toFixed(1)}s — {seg.endSeconds.toFixed(1)}s
                                        </td>
                                        <td
                                            class="px-2 py-2 text-right text-[10px] tabular-nums"
                                            style="opacity: 0.45;"
                                        >
                                            {span.toFixed(1)}s
                                        </td>
                                        <td class="px-2 py-2 text-right tabular-nums"
                                            >{Math.round(seg.totalDamage).toLocaleString()}</td
                                        >
                                        <td
                                            class="px-2 py-2 text-right text-sm font-bold tabular-nums"
                                            style="color: var(--theme-accent-text);"
                                        >
                                            {Math.round(seg.totalDamage / span).toLocaleString()}
                                        </td>
                                        {#each team as slot}
                                            {#if slot.character}
                                                {@const cd = seg.charDamages[slot.character] ?? 0}
                                                <td class="py-2 pl-2 text-right tabular-nums"
                                                    >{cd > 0 ? Math.round(cd / span).toLocaleString() : '—'}</td
                                                >
                                            {/if}
                                        {/each}
                                        <td class="py-2 pl-2 text-right tabular-nums">
                                            {seg.otherDamage > 0
                                                ? Math.round(seg.otherDamage / span).toLocaleString()
                                                : '—'}
                                        </td>
                                    </tr>
                                {/each}
                                <tr class="border-t" style="border-color: var(--theme-divider-border);">
                                    <td
                                        class="py-2 pr-2 text-[10px] font-semibold"
                                        style="color: var(--theme-modal-text); opacity: 0.6;"
                                        colspan="2">合计</td
                                    >
                                    <td
                                        class="px-2 py-2 text-right font-semibold tabular-nums"
                                        style="color: var(--theme-modal-text);"
                                        >{Math.round(segTotals.total).toLocaleString()}</td
                                    >
                                    <td
                                        class="px-2 py-2 text-right text-sm font-bold tabular-nums"
                                        style="color: var(--theme-accent-text);"
                                    >
                                        {Math.round(segTotalDps).toLocaleString()}
                                    </td>
                                    {#each team as slot}
                                        {#if slot.character}
                                            {@const cd = segTotals.perChar[slot.character] ?? 0}
                                            <td class="py-2 pl-2 text-right font-medium tabular-nums"
                                                >{cd > 0 ? Math.round(cd / totalDur).toLocaleString() : '—'}</td
                                            >
                                        {/if}
                                    {/each}
                                    <td class="py-2 pl-2 text-right font-medium tabular-nums"
                                        >{segTotals.other > 0
                                            ? Math.round(segTotals.other / totalDur).toLocaleString()
                                            : '—'}</td
                                    >
                                </tr>
                            </tbody>
                        </table>
                    {/if}
                </div>
            </section>

            <!-- ── 队伍出伤曲线 ── -->
            <section
                class="rounded-xl border"
                style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-card-bg, var(--theme-modal-bg)) 30%, transparent);"
            >
                <div
                    class="flex flex-wrap items-center gap-2 border-b px-4 py-3"
                    style="border-color: var(--theme-divider-border);"
                >
                    <div class="flex items-center gap-2">
                        <Icon icon="mdi:chart-line" class="size-4" style="color: var(--theme-accent-text);" />
                        <span class="text-sm font-semibold" style="color: var(--theme-modal-text);">队伍出伤曲线</span>
                    </div>
                    <div
                        class="ml-auto flex items-center gap-1 rounded-lg border p-0.5"
                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                    >
                        <button
                            onclick={() => (curveTab = 'cumulative')}
                            class="rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors"
                            style="background: {curveTab === 'cumulative'
                                ? 'var(--theme-accent-bg)'
                                : 'transparent'}; color: {curveTab === 'cumulative'
                                ? 'var(--theme-accent-text-on-bg, #ffffff)'
                                : 'var(--theme-modal-text)/50'};"
                        >
                            累计
                        </button>
                        <button
                            onclick={() => (curveTab = 'window')}
                            class="rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors"
                            style="background: {curveTab === 'window'
                                ? 'var(--theme-accent-bg)'
                                : 'transparent'}; color: {curveTab === 'window'
                                ? 'var(--theme-accent-text-on-bg, #ffffff)'
                                : 'var(--theme-modal-text)/50'};"
                        >
                            窗口
                        </button>
                    </div>
                </div>
                <div class="px-4 py-3">
                    <div
                        class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]"
                        style="color: var(--theme-modal-text);"
                    >
                        {#if rigCritEntryIds.length > 0}
                            <span class="flex items-center gap-1">
                                <span class="size-2.5 rounded-full" style="background: var(--theme-rigcrit-from);"
                                ></span>凹暴
                            </span>
                        {/if}
                        <span class="flex items-center gap-1">
                            <span class="size-2.5 rounded-full" style="background: var(--theme-accent-bg);"></span>期望
                        </span>
                        {#if noCritEntryIds.length > 0}
                            <span class="flex items-center gap-1">
                                <span class="size-2.5 rounded-full" style="background: var(--theme-nocrit-from);"
                                ></span>不暴
                            </span>
                        {/if}
                        {#if curveTab === 'window'}
                            <span style="opacity: 0.4;">窗口 {CURVE_WINDOW_SEC}s · 采样 {CURVE_SAMPLE_SEC}s</span>
                        {/if}
                        {#if !timings.length}
                            <span style="opacity: 0.4;">默认 X 轴总时长 150s，配置时间记点后按记点显示刻度</span>
                        {/if}
                        <span style="opacity: 0.35;">期望 = 暴击加权；凹暴/不暴仅作用于所选条目</span>
                    </div>
                    {#if curveEvents.length === 0}
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

            <!-- ── 伤害占比：队伍 + 角色直伤类型 ── -->
            <section
                class="rounded-xl border"
                style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-card-bg, var(--theme-modal-bg)) 30%, transparent);"
            >
                <div class="border-b px-4 py-3" style="border-color: var(--theme-divider-border);">
                    <div class="flex items-center gap-2">
                        <Icon icon="mdi:chart-pie" class="size-4" style="color: var(--theme-accent-text);" />
                        <span class="text-sm font-semibold" style="color: var(--theme-modal-text);">伤害占比</span>
                        <span class="text-[10px]" style="color: var(--theme-modal-text); opacity: 0.45;"
                            >（类型仅直伤，包括视为效应；多类型伤害独立成「a&b」组合类别）</span
                        >
                    </div>
                </div>
                <div class="p-4">
                    <!-- 队伍占比：横向比例条 -->
                    <div
                        class="mb-4 rounded-lg border px-4 py-3"
                        style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-bg) 25%, transparent);"
                    >
                        <div
                            class="mb-2 flex items-center justify-between text-[11px]"
                            style="color: var(--theme-modal-text);"
                        >
                            <span class="font-medium">队伍伤害占比</span>
                            <span class="tabular-nums" style="opacity: 0.5;"
                                >{Math.round(totalDamage).toLocaleString()}</span
                            >
                        </div>
                        <div
                            class="flex h-3 w-full overflow-hidden rounded-full"
                            style="background: color-mix(in srgb, var(--theme-input-bg) 85%, transparent);"
                        >
                            {#each sortedSummaries as cs, i}
                                <div
                                    class="h-full transition-all"
                                    style="width: {totalDamage > 0
                                        ? ((cs.totalDamage / totalDamage) * 100).toFixed(2)
                                        : 0}%; background: {sortedPieColors[i]};"
                                    title="{cs.character || '其它'} {totalDamage > 0
                                        ? ((cs.totalDamage / totalDamage) * 100).toFixed(1)
                                        : 0}%"
                                ></div>
                            {/each}
                        </div>
                        <div class="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
                            {#each sortedSummaries as cs, i}
                                <div class="flex items-center gap-1.5 text-xs" style="color: var(--theme-modal-text);">
                                    <span class="size-2.5 rounded-sm shrink-0" style="background: {sortedPieColors[i]};"
                                    ></span>
                                    <span class="truncate font-medium">{cs.character || '其它'}</span>
                                    <span class="shrink-0 tabular-nums">
                                        {Math.round(cs.totalDamage).toLocaleString()}
                                        <span style="opacity: 0.5;"
                                            >({((cs.totalDamage / totalDamage) * 100).toFixed(1)}%)</span
                                        >
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
                            {#each directDamageByType as agg}
                                {@const el = charElements[agg.character]}
                                {@const color = el ? cssVar(`--theme-element-${el}`, '#888') : '#888'}
                                <div
                                    class="rounded-xl border p-4"
                                    style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-bg) 30%, transparent);"
                                >
                                    <div class="mb-2 flex items-center justify-between gap-2">
                                        <span
                                            class="flex items-center gap-1.5 text-xs font-semibold"
                                            style="color: {color};"
                                        >
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
                                        {#each agg.slices as s}
                                            <div
                                                class="flex items-center gap-1.5 text-[10px]"
                                                style="color: var(--theme-modal-text);"
                                            >
                                                <span
                                                    class="size-2 rounded-full shrink-0"
                                                    style="background: {s.color};"
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

            <!-- ── 声骸词条贡献分析（三角色并排，不切换视图） ── -->
            <section
                class="rounded-xl border"
                style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-card-bg, var(--theme-modal-bg)) 30%, transparent);"
            >
                <div
                    class="flex flex-wrap items-center gap-2 border-b px-4 py-3"
                    style="border-color: var(--theme-divider-border);"
                >
                    <div class="flex items-center gap-2 shrink-0">
                        <Icon icon="mdi:chart-bar" class="size-4" style="color: var(--theme-accent-text);" />
                        <span class="text-sm font-semibold" style="color: var(--theme-modal-text);"
                            >声骸词条贡献分析</span
                        >
                        <button
                            onclick={() => openHelp('算法说明', helpItems)}
                            class="flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold transition-colors hover:bg-white/10"
                            style="color: var(--theme-accent-text);"
                            title="算法说明"
                        >
                            ?
                        </button>
                    </div>
                    <div
                        class="flex items-center gap-1 rounded-lg border px-1 py-1"
                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                    >
                        {#each algorithmsInfo as algo}
                            <button
                                onclick={() => onSelectAlgorithm(algo.id)}
                                class={[
                                    'rounded-md px-2 py-1 text-[11px] font-medium transition-all',
                                    selectedAlgorithm === algo.id
                                        ? 'shadow-sm'
                                        : 'text-(--theme-modal-text)/50 hover:text-(--theme-modal-text)/70'
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
                        <span class="ml-auto text-[10px]" style="color: var(--theme-accent-text); opacity: 0.6;"
                            >计算中…</span
                        >
                    {/if}
                </div>
                <div class="p-4">
                    {#if substatAnalysis.length === 0}
                        <div class="py-8 text-center text-xs" style="color: var(--theme-modal-text); opacity: 0.4;">
                            {analysisComputing ? '计算中…' : '暂无数据'}
                        </div>
                    {:else}
                        <div class="grid grid-cols-1 gap-3 xl:grid-cols-3">
                            {#each substatAnalysis as charSA}
                                <div
                                    class="rounded-xl border backdrop-blur-lg"
                                    style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-bg) 40%, transparent);"
                                >
                                    <div class="px-4 py-3">
                                        <div class="flex items-center justify-between">
                                            <div class="flex flex-col gap-0.5">
                                                <div class="flex flex-wrap items-center gap-3">
                                                    <span
                                                        class="text-xs font-semibold"
                                                        style="color: var(--theme-modal-text);">{charSA.character}</span
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
                                                            [不暴 {Math.round(
                                                                charSA.totalDamageNoCrit
                                                            ).toLocaleString()}]
                                                        </span>
                                                    {/if}
                                                </div>
                                                <div
                                                    class="text-[10px]"
                                                    style="color: var(--theme-modal-text); opacity: 0.6;"
                                                >
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
                                                            [不暴 +{Math.round(
                                                                charSA.substatTotalNoCrit
                                                            ).toLocaleString()} ({charSA.substatTotalPctNoCrit.toFixed(
                                                                1
                                                            )}%)]</span
                                                        >
                                                    {/if}
                                                </div>
                                            </div>
                                            <div class="flex shrink-0 flex-col items-end gap-0.5">
                                                <div
                                                    class="text-xl font-bold leading-none tabular-nums"
                                                    style="color: var(--theme-accent-text);"
                                                >
                                                    {charSA.substatTotalPctNorm.toFixed(1)}
                                                </div>
                                                <div
                                                    class="text-[9px]"
                                                    style="color: var(--theme-modal-text); opacity: 0.35;"
                                                >
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
                                            {#each charSA.echoes as echo}
                                                <div
                                                    class="rounded-lg border backdrop-blur-md"
                                                    style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-bg) 50%, transparent);"
                                                >
                                                    <div class="px-3 py-2">
                                                        <div class="mb-1.5 flex items-center justify-between">
                                                            <span
                                                                class="text-[10px] font-medium"
                                                                style="color: var(--theme-modal-text); opacity: 0.6;"
                                                            >
                                                                Cost{echo.cost}{echo.mainStat
                                                                    ? ' · ' + echo.mainStat
                                                                    : ''}
                                                            </span>
                                                            <span
                                                                class="text-sm font-bold tabular-nums"
                                                                style="color: var(--theme-accent-text);"
                                                            >
                                                                {echo.totalPctNorm.toFixed(1)}<span
                                                                    class="ml-0.5 text-[9px] font-normal opacity-70"
                                                                    >分</span
                                                                >
                                                            </span>
                                                        </div>
                                                        <div class="space-y-0.5">
                                                            {#each echo.substats as sub}
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
                                                                        → +{Math.round(
                                                                            sub.contributionNorm
                                                                        ).toLocaleString()} ({sub.contribPctNorm.toFixed(
                                                                            1
                                                                        )}%)
                                                                    </span>
                                                                    {#if sub.contributionRig !== sub.contributionNorm}
                                                                        <span
                                                                            class="shrink-0 tabular-nums"
                                                                            style={RIG_GRAD_TEXT}
                                                                        >
                                                                            [凹暴 +{Math.round(
                                                                                sub.contributionRig
                                                                            ).toLocaleString()} ({sub.contribPctRig.toFixed(
                                                                                1
                                                                            )}%)]
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
                                                                <span
                                                                    class="tabular-nums"
                                                                    style="color: var(--theme-accent-text);"
                                                                    >+{Math.round(echo.totalNorm).toLocaleString()} ({echo.totalPctNorm.toFixed(
                                                                        1
                                                                    )}%)</span
                                                                >
                                                                {#if echo.totalRig !== echo.totalNorm}
                                                                    <span class="tabular-nums" style={RIG_GRAD_TEXT}>
                                                                        [凹暴 +{Math.round(
                                                                            echo.totalRig
                                                                        ).toLocaleString()} ({echo.totalPctRig.toFixed(
                                                                            1
                                                                        )}%)]
                                                                    </span>
                                                                {/if}
                                                                {#if echo.totalNoCrit !== echo.totalNorm}
                                                                    <span class="tabular-nums" style={NOCRIT_GRAD_TEXT}>
                                                                        [不暴 +{Math.round(
                                                                            echo.totalNoCrit
                                                                        ).toLocaleString()} ({echo.totalPctNoCrit.toFixed(
                                                                            1
                                                                        )}%)]
                                                                    </span>
                                                                {/if}
                                                            </span>
                                                            <span
                                                                class="font-bold tabular-nums"
                                                                style="color: var(--theme-accent-text);"
                                                            >
                                                                {echo.totalPctNorm.toFixed(1)}<span
                                                                    class="ml-0.5 text-[9px] font-normal opacity-70"
                                                                    >分</span
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
        </div>
    </div>
</div>
