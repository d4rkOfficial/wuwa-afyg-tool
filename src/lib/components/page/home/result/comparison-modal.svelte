<script lang="ts">
    /** @desc 共鸣链/武器精炼对比弹窗：一个配置 = 全队 3 角色各自链阶；折线同图叠加、其余并排对比。只对比用户选定配置（无「当前」列） */
    import Chart from 'chart.js/auto'
    import type { TooltipItem } from 'chart.js'
    import Icon from '@iconify/svelte'
    import { tick, untrack } from 'svelte'
    import { getCharElementMap, getRefLines, getOpBlocks } from '$lib/calc/timeline.store.svelte'
    import { buildLoopIntervals } from '$lib/calc/loop-expand'
    import { getConditionProfile } from '$lib/calc/calculation.store.svelte'
    import type { ResultEntry, CharSummary } from '$lib/calc/result.types'
    import type { CharSlot, ResultAnalysisData } from '$lib/types/project'
    import { aggregateDirectDamageByType } from '$lib/calc/utils'
    import { COMPARISON_PALETTE, type ComparisonEligibility } from '$lib/calc/comparison'
    import type { ComponentsProps } from '$lib/types'

    interface TeamConfig {
        chains: [number, number, number]
        refinements: [number, number, number]
    }

    interface Props extends ComponentsProps {
        open: boolean
        team: [CharSlot, CharSlot, CharSlot]
        timings: { refLineId: string; seconds: number | null }[]
        /** 分段 DPS 轴循环配置：key = 记点 refLineId，value = 该小节重复次数（≥2 生效） */
        loopCounts?: Record<string, number>
        eligibility: ComparisonEligibility
        /** 复算回调：给定完整队伍链/阶 profile，复算原始期望（不套凹暴/不暴/未命中） */
        recompute: (
            chains: number[],
            refinements: number[]
        ) => {
            entries: ResultEntry[]
            charSummaries: CharSummary[]
            totalDamage: number
        }
        /** 已持久化的对比配置（打开时作为初始值） */
        initialPoints: { chains: number[]; refinements: number[] }[]
        /** 返回数据分析弹窗（兄弟互斥），携带最新对比配置用于持久化 */
        onBack: (points: { chains: number[]; refinements: number[] }[]) => void
    }

    let {
        open,
        team,
        timings,
        loopCounts = {},
        eligibility,
        recompute,
        initialPoints,
        onBack,
        class: className,
        style: styleProp
    }: Props = $props()

    let charElements = $derived(getCharElementMap())
    let refLines = $derived(getRefLines().filter((rl) => rl.id !== 'left'))
    let opBlocks = $derived(getOpBlocks())
    let blockPosMap = $derived.by(() => {
        const map = new Map<string, number>()
        for (const b of opBlocks) map.set(b.id, b.pos)
        for (const rl of refLines) map.set(rl.id, rl.pos)
        return map
    })

    let points = $state<TeamConfig[]>([])

    // 打开时以持久化的对比配置作为初始值（兄弟弹窗每次重新进入都刷新）
    $effect(() => {
        if (open) {
            points = initialPoints.map((p) => ({
                chains: [p.chains[0] ?? 0, p.chains[1] ?? 0, p.chains[2] ?? 0] as [number, number, number],
                refinements: [p.refinements[0] ?? 0, p.refinements[1] ?? 0, p.refinements[2] ?? 0] as [
                    number,
                    number,
                    number
                ]
            }))
        }
    })
    let curveTab = $state<'cumulative' | 'window'>('window')
    /** @desc 伤害占比条形图模式：total=看总伤（数值轴）；pct=看占比（百分比轴） */
    let shareMode = $state<'total' | 'pct'>('total')

    const CHAIN_RANGE = [0, 1, 2, 3, 4, 5, 6]
    const REFINEMENT_RANGE = [0, 1, 2, 3, 4, 5]

    let sortedTimings = $derived(
        [...timings]
            .filter((t) => refLines.some((r) => r.id === t.refLineId))
            .sort((a, b) => {
                const aRl = refLines.find((r) => r.id === a.refLineId)
                const bRl = refLines.find((r) => r.id === b.refLineId)
                return (aRl?.pos ?? 0) - (bRl?.pos ?? 0)
            })
    )
    let validTimings = $derived(sortedTimings.filter((t) => t.seconds !== null))
    // 轴循环（与数据分析弹窗同口径，$lib/calc/loop-expand）
    let loopActive = $derived(Object.values(loopCounts).some((k) => (k ?? 1) >= 2))
    let loopIntervals = $derived(loopActive ? buildLoopIntervals(timings, refLines, loopCounts) : [])
    let totalDur = $derived(
        loopActive && loopIntervals.length > 0
            ? loopIntervals[loopIntervals.length - 1]!.endSeconds
            : validTimings.length > 0
              ? validTimings[validTimings.length - 1]!.seconds!
              : 0
    )

    interface Config {
        key: string
        label: string
        chains: number[]
        refinements: number[]
        entries: ResultEntry[]
        charSummaries: CharSummary[]
        totalDamage: number
        accent: string
    }

    const PALETTE = COMPARISON_PALETTE
    /** @desc 紧凑配置标签：3 角色 chain+ref 直接拼接，如 6+1/0+1/0+1 → 610101 */
    function compactLabel(chains: number[], refinements: number[]): string {
        return chains.map((c, j) => `${c}${refinements[j]}`).join('')
    }
    /** @desc 配置颜色：7 色循环保证同组内不重复；超出 7 个后每组透明度对半砍（100% → 50% → 25%…） */
    function configColor(i: number): string {
        const base = PALETTE[i % PALETTE.length]
        const group = Math.floor(i / PALETTE.length)
        const alpha = 1 / Math.pow(2, group)
        if (alpha >= 1) return base
        const r = parseInt(base.slice(1, 3), 16)
        const g = parseInt(base.slice(3, 5), 16)
        const b = parseInt(base.slice(5, 7), 16)
        return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 100) / 100})`
    }
    let configs = $derived.by<Config[]>(() =>
        points.map((p, i) => {
            const r = recompute(p.chains, p.refinements)
            return {
                key: `cfg-${i}`,
                label: compactLabel(p.chains, p.refinements),
                chains: p.chains,
                refinements: p.refinements,
                entries: r.entries,
                charSummaries: r.charSummaries,
                totalDamage: r.totalDamage,
                accent: configColor(i)
            }
        })
    )

    /** @desc 折线图数据源：有配置用配置；无配置时显示「当前」真实 profile 的期望曲线（一进弹窗即可渲染） */
    let curveConfigs = $derived.by<Config[]>(() => {
        if (points.length > 0) return configs
        const p = getConditionProfile()
        const r = recompute(p.chains, p.refinements)
        return [
            {
                key: 'current',
                label: '当前',
                chains: p.chains,
                refinements: p.refinements,
                entries: r.entries,
                charSummaries: r.charSummaries,
                totalDamage: r.totalDamage,
                accent: 'var(--theme-accent-bg, #6366f1)'
            }
        ]
    })

    /** @desc 条形图数据源（与折线图同源）：无配置时也显示「当前」，保证初次进入即渲染 */
    let barConfigs = $derived.by<Config[]>(() => [...curveConfigs].sort((a, b) => a.totalDamage - b.totalDamage))

    // ── 配置选择：矩阵多选弹窗，3 角色各自勾选多个 (链,阶)，笛卡尔积组合成团队配置 ──
    let pickerOpen = $state(false)
    let perCharSel = $state<{ chain: number; refinement: number }[][]>([[], [], []])

    function openPicker() {
        // 从当前 points 反推每角色已选 (链,阶)，保留上次选择
        const sel: { chain: number; refinement: number }[][] = [[], [], []]
        for (const p of points) {
            for (let i = 0; i < 3; i++) {
                const pair = { chain: p.chains[i], refinement: p.refinements[i] }
                if (!sel[i].some((x) => x.chain === pair.chain && x.refinement === pair.refinement)) sel[i].push(pair)
            }
        }
        perCharSel = sel
        pickerOpen = true
    }
    function isSel(si: number, chain: number, refinement: number): boolean {
        return perCharSel[si].some((x) => x.chain === chain && x.refinement === refinement)
    }
    function toggleSel(si: number, chain: number, refinement: number) {
        perCharSel = perCharSel.map((s, i) =>
            i === si
                ? s.some((x) => x.chain === chain && x.refinement === refinement)
                    ? s.filter((x) => !(x.chain === chain && x.refinement === refinement))
                    : [...s, { chain, refinement }]
                : s
        )
    }
    /** @desc 笛卡尔积组合后的团队配置数 */
    let matrixCount = $derived(perCharSel.reduce((acc, s) => acc * Math.max(1, s.length), 1))
    function confirmMatrix() {
        if (perCharSel.some((s) => s.length === 0)) return
        const out: TeamConfig[] = []
        for (const a of perCharSel[0])
            for (const b of perCharSel[1])
                for (const c of perCharSel[2])
                    out.push({
                        chains: [a.chain, b.chain, c.chain],
                        refinements: [a.refinement, b.refinement, c.refinement]
                    })
        points = out
        pickerOpen = false
    }

    function removePoint(idx: number) {
        points = points.filter((_, i) => i !== idx)
    }

    function fmt(n: number): string {
        return Math.round(n).toLocaleString()
    }

    // ── 出伤曲线：每配置一条事件序列 ──
    const CURVE_WINDOW_SEC = 1
    const CURVE_SAMPLE_SEC = 0.25

    function curveEventsOf(entries: ResultEntry[]): { time: number; dmg: number }[] {
        const withPos = entries
            .map((e) => ({ entry: e, pos: blockPosMap.get(e.sourceTimelineBlockId) }))
            .filter((x): x is { entry: ResultEntry; pos: number } => x.pos !== undefined)
            .sort((a, b) => a.pos - b.pos)
        const dur = totalDur || 150
        const segs: { startPos: number; endPos: number; startSec: number; endSec: number }[] = []
        if (validTimings.length === 0) {
            segs.push({ startPos: -Infinity, endPos: Infinity, startSec: 0, endSec: dur })
        } else if (loopActive) {
            for (const iv of loopIntervals) {
                segs.push({
                    startPos: iv.startPos,
                    endPos: iv.endPos,
                    startSec: iv.startSeconds,
                    endSec: iv.endSeconds
                })
            }
        } else {
            let prevPos = 0
            let prevSec = 0
            for (const t of validTimings) {
                const rl = refLines.find((r) => r.id === t.refLineId)
                if (!rl) continue
                segs.push({ startPos: prevPos, endPos: rl.pos, startSec: prevSec, endSec: t.seconds! })
                prevPos = rl.pos
                prevSec = t.seconds!
            }
            segs.push({ startPos: prevPos, endPos: Infinity, startSec: prevSec, endSec: dur })
        }
        const events: { time: number; dmg: number }[] = []
        for (const seg of segs) {
            if (seg.endSec <= seg.startSec) continue
            // 按位置区间独立过滤（循环展开后同一区间出现多份，不能用共享游标）
            const segEntries = withPos.filter((x) => x.pos >= seg.startPos && x.pos < seg.endPos)
            const n = segEntries.length
            if (n === 0) continue
            const d = seg.endSec - seg.startSec
            segEntries.forEach((x, j) => {
                events.push({ time: seg.startSec + ((j + 0.5) * d) / n, dmg: x.entry.totalDamageRaw })
            })
        }
        events.sort((a, b) => a.time - b.time)
        return events
    }

    function curveDataOf(events: { time: number; dmg: number }[]): { x: number; y: number }[] {
        if (curveTab === 'cumulative') {
            let a = 0
            const out: { x: number; y: number }[] = []
            for (const e of events) {
                a += e.dmg
                out.push({ x: e.time, y: a })
            }
            return out
        }
        const w = CURVE_WINDOW_SEC
        const out: { x: number; y: number }[] = []
        let left = 0
        let right = 0
        let s = 0
        for (let t = 0; t <= totalDur + 1e-6; t += CURVE_SAMPLE_SEC) {
            while (right < events.length && events[right].time <= t + w) {
                s += events[right].dmg
                right++
            }
            while (left < events.length && events[left].time < t) {
                s -= events[left].dmg
                left++
            }
            out.push({ x: t, y: s })
        }
        return out
    }

    // ── 分段 DPS（每配置）──
    interface Segment {
        startSeconds: number
        endSeconds: number
        totalDamage: number
    }
    function segmentsOf(entries: ResultEntry[]): Segment[] {
        if (validTimings.length === 0) return []
        const result: Segment[] = []
        const segs = loopActive
            ? loopIntervals.map((iv) => ({
                  startPos: iv.startPos,
                  endPos: iv.endPos,
                  startSec: iv.startSeconds,
                  endSec: iv.endSeconds
              }))
            : (() => {
                  const out: { startPos: number; endPos: number; startSec: number; endSec: number }[] = []
                  let prevRefPos = 0
                  let prevSeconds = 0
                  for (const t of validTimings) {
                      const rl = refLines.find((r) => r.id === t.refLineId)
                      if (!rl) continue
                      const span = t.seconds! - prevSeconds
                      if (span <= 0) {
                          prevRefPos = rl.pos
                          prevSeconds = t.seconds!
                          continue
                      }
                      out.push({ startPos: prevRefPos, endPos: rl.pos, startSec: prevSeconds, endSec: t.seconds! })
                      prevRefPos = rl.pos
                      prevSeconds = t.seconds!
                  }
                  return out
              })()
        for (const seg of segs) {
            if (seg.endSec <= seg.startSec) continue
            const segEntries = entries.filter((e) => {
                const p = blockPosMap.get(e.sourceTimelineBlockId)
                return p !== undefined && p >= seg.startPos && p < seg.endPos
            })
            result.push({
                startSeconds: seg.startSec,
                endSeconds: seg.endSec,
                totalDamage: segEntries.reduce((s, e) => s + e.totalDamageRaw, 0)
            })
        }
        return result
    }

    /** @desc 循环展开后的总伤（分段合计 ×K + 未入段条目一次），供总伤/总 DPS 与分段口径一致 */
    function expandedTotalDamageOf(entries: ResultEntry[]): number {
        const segTotal = segmentsOf(entries).reduce((s, seg) => s + seg.totalDamage, 0)
        const withPos = new Set(
            entries.filter((e) => blockPosMap.get(e.sourceTimelineBlockId) !== undefined).map((e) => e.id)
        )
        const outside = entries.filter((e) => !withPos.has(e.id)).reduce((s, e) => s + e.totalDamageRaw, 0)
        return segTotal + outside
    }

    // ── 图表 ──
    let curveCanvas = $state<HTMLCanvasElement | null>(null)
    let curveChart: Chart<'line'> | null = null
    let teamShareCanvas = $state<HTMLCanvasElement | null>(null)
    let teamShareChart: Chart<'bar'> | null = null
    const charTypeCanvases = $state<Record<string, HTMLCanvasElement | null>>({})
    const charTypeCharts = new Map<string, Chart<'bar'>>()

    function cssVar(name: string, fallback: string): string {
        if (typeof document === 'undefined') return fallback
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
    }

    /** @desc hex → rgba（hex 需为 #rrggbb） */
    function hexToRgba(hex: string, alpha: number): string {
        const r = parseInt(hex.slice(1, 3), 16)
        const g = parseInt(hex.slice(3, 5), 16)
        const b = parseInt(hex.slice(5, 7), 16)
        return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }

    /** @desc 按位置淡化（与数据分析弹窗一致）：0 位全色，后续 alpha = max(0.42, 1 - index*0.18) */
    function fadedColor(hex: string, index: number): string {
        if (index === 0) return hex
        const alpha = Math.max(0.42, 1 - index * 0.18)
        return hexToRgba(hex, alpha)
    }

    /** @desc 角色元素名 → 主题色（getCharElementMap 返回元素名如「冷凝」，需转 --theme-element-* 颜色） */
    function elementColor(character: string | null | undefined): string {
        const el = charElements[character ?? '']
        return el ? cssVar(`--theme-element-${el}`, '#888') : '#888'
    }

    function drawCurve() {
        if (!curveCanvas) return
        curveChart?.destroy()
        const textColor = cssVar('--theme-modal-text', '#e2e8f0')
        const dur = totalDur || 150
        const hasTicks = validTimings.length > 0
        const stepped: boolean | 'before' | 'after' | 'middle' = curveTab === 'cumulative' ? 'after' : false
        curveChart = new Chart(curveCanvas, {
            type: 'line',
            data: {
                datasets: curveConfigs.map((c) => ({
                    label: c.label,
                    data: curveDataOf(curveEventsOf(c.entries)),
                    borderColor: c.accent,
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0.25,
                    stepped
                }))
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { color: textColor, boxWidth: 12, font: { size: 11 } } },
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
                        max: dur,
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

    function drawBars() {
        const textColor = cssVar('--theme-modal-text', '#e2e8f0')
        const labels = barConfigs.map((c) => c.label)
        const grid = cssVar('--theme-divider-border', '#334155')
        const isPct = shareMode === 'pct'
        const xTicks = {
            color: textColor,
            callback: isPct ? (v: number | string) => `${v}%` : undefined
        }
        const tooltip = {
            bodyColor: textColor,
            titleColor: textColor,
            backgroundColor: cssVar('--theme-modal-bg', '#1e293b'),
            borderColor: grid,
            borderWidth: 1,
            callbacks: {
                label: (ctx: TooltipItem<'bar'>) =>
                    `${ctx.dataset.label ?? ''}: ${Math.round(ctx.parsed?.x ?? 0)}${isPct ? '%' : ''}`
            }
        }
        // ── 全队伤害占比：每配置一根横条，按角色堆叠 ──
        if (teamShareCanvas) {
            teamShareChart?.destroy()
            const raw = team.map((slot, si) =>
                barConfigs.map((c) => c.charSummaries.find((s) => s.character === slot.character)?.totalDamage ?? 0)
            )
            const data = isPct
                ? raw.map((row, si) =>
                      row.map((v, ci) => {
                          const total = barConfigs[ci]?.totalDamage ?? 1
                          return total > 0 ? (v / total) * 100 : 0
                      })
                  )
                : raw
            teamShareChart = new Chart(teamShareCanvas, {
                type: 'bar',
                data: {
                    labels,
                    datasets: team.map((slot, si) => ({
                        label: slot.character ?? `槽${si + 1}`,
                        data: data[si],
                        backgroundColor: fadedColor(elementColor(slot.character), si),
                        stack: 'team'
                    }))
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: {
                            stacked: true,
                            beginAtZero: true,
                            max: isPct ? 100 : undefined,
                            ticks: xTicks,
                            grid: { color: grid }
                        },
                        y: { stacked: true, ticks: { color: textColor }, grid: { color: grid } }
                    },
                    plugins: { legend: { labels: { color: textColor, boxWidth: 12, font: { size: 11 } } }, tooltip }
                }
            })
        }
        // ── 角色直伤类型伤害占比：每角色一组，每配置一根横条按类型堆叠 ──
        for (let si = 0; si < team.length; si++) {
            const cv = charTypeCanvases[String(si)]
            if (!cv) continue
            charTypeCharts.get(String(si))?.destroy()
            const typeSet = new Set<string>()
            const perConfig: Record<string, number>[] = barConfigs.map((c) => {
                const agg = aggregateDirectDamageByType(c.entries).find((x) => x.character === team[si].character)
                const map: Record<string, number> = {}
                for (const s of agg?.slices ?? []) {
                    map[s.label] = (map[s.label] ?? 0) + s.value
                    typeSet.add(s.label)
                }
                return map
            })
            const types = [...typeSet]
            const data = isPct
                ? types.map((t) =>
                      perConfig.map((m, ci) => {
                          const total = Object.values(perConfig[ci]).reduce((s, v) => s + v, 0)
                          return total > 0 ? ((m[t] ?? 0) / total) * 100 : 0
                      })
                  )
                : types.map((t) => perConfig.map((m) => m[t] ?? 0))
            charTypeCharts.set(
                String(si),
                new Chart(cv, {
                    type: 'bar',
                    data: {
                        labels,
                        datasets: types.map((t, ti) => ({
                            label: t,
                            data: data[ti],
                            backgroundColor: PALETTE[(si + ti * 2) % PALETTE.length],
                            stack: `char-${si}`
                        }))
                    },
                    options: {
                        indexAxis: 'y',
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            x: {
                                stacked: true,
                                beginAtZero: true,
                                max: isPct ? 100 : undefined,
                                ticks: xTicks,
                                grid: { color: grid }
                            },
                            y: { stacked: true, ticks: { color: textColor }, grid: { color: grid } }
                        },
                        plugins: { legend: { labels: { color: textColor, boxWidth: 12, font: { size: 11 } } }, tooltip }
                    }
                })
            )
        }
    }

    $effect(() => {
        if (!open) return
        configs
        curveTab
        shareMode
        // tick 等待 canvas bind:this 完成，避免初次进入时图表在 canvas 就绪前初始化（空白）
        void tick().then(() => {
            if (!open) return
            untrack(() => {
                drawCurve()
                drawBars()
            })
        })
    })

    $effect(() => {
        return () => {
            curveChart?.destroy()
            teamShareChart?.destroy()
            for (const ch of charTypeCharts.values()) ch.destroy()
            charTypeCharts.clear()
        }
    })
</script>

{#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="animate-fade-in fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        onclick={(e) => {
            if (e.target === e.currentTarget) onBack(points)
        }}
        onkeydown={(e) => {
            if (e.key === 'Escape') onBack(points)
        }}
    >
        <div
            class="animate-pop-in theme-glass-surface theme-scrollbar flex max-h-[92vh] w-[min(96vw,1400px)] flex-col overflow-hidden rounded-xl border shadow-2xl"
            style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-bg) 92%, transparent); color: var(--theme-modal-text);"
            role="dialog"
            aria-modal="true"
        >
            <!-- Header -->
            <div
                class="sticky top-0 z-10 flex shrink-0 flex-wrap items-center gap-3 border-b px-6 py-4"
                style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-bg) 92%, transparent); backdrop-filter: blur(12px);"
            >
                <Icon icon="mdi:compare-horizontal" class="size-5" style="color: var(--theme-accent-text);" />
                <span class="text-base font-semibold">链/阶对比</span>
                <div class="ml-auto flex items-center gap-2 text-[11px] opacity-55">
                    {#if totalDur > 0}
                        <span class="tabular-nums">总时长 {totalDur.toFixed(1)}s</span>
                    {/if}
                </div>
                <button
                    onclick={() => onBack(points)}
                    class="inline-flex items-center gap-1 rounded p-1.5 text-xs transition-colors hover:opacity-70"
                    style="color: var(--theme-accent-text);"
                    title="返回数据分析"
                >
                    <Icon icon="mdi:arrow-left" class="size-4" />
                    返回数据分析
                </button>
            </div>

            <!-- Body -->
            <div class="theme-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
                {#if !eligibility.eligible}
                    <div class="flex flex-col items-center gap-2 py-12 text-center text-sm opacity-60">
                        <Icon icon="mdi:lock-outline" class="size-8" />
                        <span>{eligibility.reason ?? '本工程不支持对比'}</span>
                    </div>
                {:else}
                    <!-- 配置选择入口 -->
                    <div class="flex flex-wrap items-center gap-2">
                        <button
                            onclick={openPicker}
                            class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors hover:border-(--theme-accent-bg)"
                            style="border-color: var(--theme-divider-border); color: var(--theme-modal-text);"
                        >
                            <Icon icon="mdi:sitemap" class="size-4" style="color: var(--theme-accent-text);" />
                            选择对比配置
                        </button>
                        {#if points.length > 0}
                            <span class="text-xs opacity-50">已选 {points.length} 个：</span>
                            {#each points as p, i}
                                <span
                                    class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    {compactLabel(p.chains, p.refinements)}
                                    <button
                                        onclick={() => removePoint(i)}
                                        class="opacity-50 hover:opacity-100"
                                        title="移除"><Icon icon="mdi:close" class="size-3" /></button
                                    >
                                </span>
                            {/each}
                        {:else}
                            <span class="text-xs opacity-40"
                                >点击「选择对比配置」，为 3 个角色各自选链阶组成队伍配置</span
                            >
                        {/if}
                    </div>

                    <!-- ── 队伍出伤曲线（常驻渲染，同图叠加）── -->
                    <section
                        class="rounded-lg border p-3"
                        style="border-color: var(--theme-divider-border); background: var(--theme-card-bg);"
                    >
                        <div class="mb-2 flex items-center gap-2">
                            <span class="text-xs font-semibold uppercase tracking-wider opacity-50">队伍出伤曲线</span>
                            <div
                                class="ml-auto flex items-center gap-1 rounded-lg border p-0.5 text-[11px]"
                                style="border-color: var(--theme-divider-border);"
                            >
                                <button
                                    onclick={() => (curveTab = 'cumulative')}
                                    class="rounded px-2 py-0.5 {curveTab === 'cumulative'
                                        ? 'font-medium'
                                        : 'opacity-60'}"
                                    style={curveTab === 'cumulative'
                                        ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);'
                                        : ''}>累计</button
                                >
                                <button
                                    onclick={() => (curveTab = 'window')}
                                    class="rounded px-2 py-0.5 {curveTab === 'window' ? 'font-medium' : 'opacity-60'}"
                                    style={curveTab === 'window'
                                        ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);'
                                        : ''}>窗口</button
                                >
                            </div>
                        </div>
                        <div class="h-56"><canvas bind:this={curveCanvas}></canvas></div>
                    </section>

                    {#if points.length > 0}
                        <!-- ── 配置 + DPS + 总伤 卡片组（并排）── -->
                        <section class="theme-scrollbar flex gap-3 overflow-x-auto">
                            {#each configs as c}
                                <div
                                    class="min-w-44 flex-1 shrink-0 rounded-lg border p-3"
                                    style="border-color: {c.accent}; background: var(--theme-card-bg);"
                                >
                                    <div
                                        class="flex items-center gap-1.5 text-sm font-semibold"
                                        style="color: {c.accent};"
                                    >
                                        <span class="size-2.5 rounded-full" style="background: {c.accent};"
                                        ></span>{c.label}
                                    </div>
                                    <div class="mt-2 space-y-1.5">
                                        <div class="flex items-end justify-between gap-2">
                                            <span class="pb-0.5 text-xs opacity-50">DPS</span><span
                                                class="text-2xl font-bold leading-none tabular-nums"
                                                style="color: {c.accent};"
                                                >{totalDur > 0
                                                    ? fmt(expandedTotalDamageOf(c.entries) / totalDur)
                                                    : '—'}</span
                                            >
                                        </div>
                                        <div class="flex items-center justify-between text-xs">
                                            <span class="opacity-50">总伤</span><span
                                                class="tabular-nums font-medium"
                                                style="color: {c.accent};">{fmt(expandedTotalDamageOf(c.entries))}</span
                                            >
                                        </div>
                                    </div>
                                </div>
                            {/each}
                        </section>

                        <!-- ── 分段 DPS（并排：每配置一列）── -->
                        <section
                            class="rounded-lg border p-3"
                            style="border-color: var(--theme-divider-border); background: var(--theme-card-bg);"
                        >
                            <div class="mb-2 text-xs font-semibold uppercase tracking-wider opacity-50">分段 DPS</div>
                            {#if validTimings.length === 0}
                                <p class="text-xs opacity-40">配置时间记点后显示分段 DPS</p>
                            {:else}
                                <div class="overflow-x-auto">
                                    <table class="w-full text-xs tabular-nums">
                                        <thead>
                                            <tr class="text-left opacity-50">
                                                <th class="py-1 pr-3 font-medium">区间</th>
                                                {#each configs as c}<th
                                                        class="px-2 py-1 font-medium"
                                                        style="color: {c.accent};">{c.label}</th
                                                    >{/each}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {#each segmentsOf(configs[0].entries) as seg, si}
                                                <tr class="border-t" style="border-color: var(--theme-divider-border);">
                                                    <td class="py-1 pr-3 opacity-60"
                                                        >{seg.startSeconds.toFixed(1)}–{seg.endSeconds.toFixed(1)}s</td
                                                    >
                                                    {#each configs as c}
                                                        {@const segs = segmentsOf(c.entries)}
                                                        <td class="px-2 py-1"
                                                            >{(
                                                                (segs[si]?.totalDamage ?? 0) /
                                                                (seg.endSeconds - seg.startSeconds)
                                                            ).toFixed(0)}</td
                                                        >
                                                    {/each}
                                                </tr>
                                            {/each}
                                        </tbody>
                                    </table>
                                </div>
                            {/if}
                        </section>
                    {:else}
                        <div class="flex flex-col items-center gap-2 py-12 text-center text-sm opacity-50">
                            <Icon icon="mdi:plus-circle-outline" class="size-8" />
                            <span>选择对比配置后展示配置卡片与分段 DPS</span>
                        </div>
                    {/if}

                    <!-- ── 伤害占比（常驻，条形图）：全队占比 + 每角色直伤类型占比 ── -->
                    <section
                        class="rounded-lg border p-3"
                        style="border-color: var(--theme-divider-border); background: var(--theme-card-bg);"
                    >
                        <div class="mb-2 flex items-center gap-2">
                            <span class="text-xs font-semibold uppercase tracking-wider opacity-50">全队伤害占比</span>
                            <div
                                class="ml-auto flex items-center gap-1 rounded-lg border p-0.5 text-[11px]"
                                style="border-color: var(--theme-divider-border);"
                            >
                                <button
                                    onclick={() => (shareMode = 'total')}
                                    class="rounded px-2 py-0.5 {shareMode === 'total' ? 'font-medium' : 'opacity-60'}"
                                    style={shareMode === 'total'
                                        ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);'
                                        : ''}>看总伤</button
                                >
                                <button
                                    onclick={() => (shareMode = 'pct')}
                                    class="rounded px-2 py-0.5 {shareMode === 'pct' ? 'font-medium' : 'opacity-60'}"
                                    style={shareMode === 'pct'
                                        ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);'
                                        : ''}>看占比</button
                                >
                            </div>
                        </div>
                        <div style="height: {Math.max(180, barConfigs.length * 44)}px;">
                            <canvas bind:this={teamShareCanvas}></canvas>
                        </div>
                    </section>

                    <section
                        class="rounded-lg border p-3"
                        style="border-color: var(--theme-divider-border); background: var(--theme-card-bg);"
                    >
                        <div class="mb-2 text-xs font-semibold uppercase tracking-wider opacity-50">
                            角色直伤类型伤害占比
                        </div>
                        <div class="space-y-4">
                            {#each team as slot, si}
                                <div>
                                    <div class="mb-1 text-xs opacity-60">
                                        {slot.character ?? `槽${si + 1}`}
                                    </div>
                                    <div style="height: {Math.max(140, barConfigs.length * 44)}px;">
                                        <canvas bind:this={charTypeCanvases[String(si)]}></canvas>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    </section>
                {/if}
            </div>
        </div>
    </div>

    <!-- 独立配置选择弹窗：3 角色矩阵多选（链 0-6 × 阶 0-5），笛卡尔积组合成团队配置 -->
    {#if pickerOpen}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="animate-fade-in fixed inset-0 z-60 flex items-center justify-center p-4 backdrop-blur-sm"
            style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
            onclick={(e) => {
                if (e.target === e.currentTarget) pickerOpen = false
            }}
        >
            <div
                class="animate-pop-in theme-glass-surface flex max-h-[88vh] w-[min(94vw,760px)] flex-col overflow-hidden rounded-xl border shadow-2xl"
                style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-bg) 95%, transparent); color: var(--theme-modal-text);"
                role="dialog"
                aria-modal="true"
            >
                <div
                    class="flex shrink-0 items-center gap-2 border-b px-5 py-3"
                    style="border-color: var(--theme-divider-border);"
                >
                    <Icon icon="mdi:sitemap" class="size-4" style="color: var(--theme-accent-text);" />
                    <span class="text-sm font-semibold">选择对比配置</span>
                    <span class="text-[11px] opacity-50">三个角色各自勾选多个 (链,阶)，自动组合成队伍配置</span>
                </div>
                <div class="theme-scrollbar min-h-0 flex-1 space-y-4 overflow-auto p-4">
                    {#each team as slot, si}
                        <div
                            class="rounded-lg border p-3"
                            style="border-color: var(--theme-divider-border); background: var(--theme-card-bg);"
                        >
                            <div class="mb-2 flex items-center gap-2">
                                <span class="text-sm font-medium" style="color: var(--theme-modal-text);">
                                    {slot.character ?? `槽${si + 1}`}
                                </span>
                                <span class="ml-auto text-[11px] opacity-50">已选 {perCharSel[si].length} 个</span>
                            </div>
                            <table class="w-full border-separate border-spacing-0.5 text-center text-[11px]">
                                <thead>
                                    <tr>
                                        <th class="w-9"></th>
                                        {#each REFINEMENT_RANGE as rf}
                                            <th class="py-0.5 font-medium opacity-50">阶{rf}</th>
                                        {/each}
                                    </tr>
                                </thead>
                                <tbody>
                                    {#each CHAIN_RANGE as ch}
                                        <tr>
                                            <td class="pr-1 text-right font-medium opacity-50">链{ch}</td>
                                            {#each REFINEMENT_RANGE as rf}
                                                {@const checked = isSel(si, ch, rf)}
                                                <td>
                                                    <button
                                                        onclick={() => toggleSel(si, ch, rf)}
                                                        class="flex h-7 w-full items-center justify-center rounded-md border text-[10px] transition-colors"
                                                        style={checked
                                                            ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg); border-color: var(--theme-accent-bg);'
                                                            : 'border-color: var(--theme-divider-border); color: var(--theme-modal-text);'}
                                                        title="{ch}+{rf}"
                                                    >
                                                        {#if checked}<Icon icon="mdi:check" class="size-3.5" />{:else}
                                                            {ch}+{rf}{/if}
                                                    </button>
                                                </td>
                                            {/each}
                                        </tr>
                                    {/each}
                                </tbody>
                            </table>
                        </div>
                    {/each}
                    <p class="text-center text-[11px] opacity-50">
                        将按三个角色的选择组合成 {matrixCount} 个团队配置（笛卡尔积）
                    </p>
                </div>
                <div
                    class="flex shrink-0 items-center gap-2 border-t px-5 py-3"
                    style="border-color: var(--theme-divider-border);"
                >
                    <button
                        onclick={() => (perCharSel = [[], [], []])}
                        disabled={perCharSel.every((s) => s.length === 0)}
                        class="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm opacity-70 transition-colors enabled:hover:opacity-100 disabled:opacity-30"
                        title="清空全部角色的选择"
                    >
                        <Icon icon="mdi:broom" class="size-4" />清空
                    </button>
                    <div class="flex-1"></div>
                    <button
                        onclick={() => (pickerOpen = false)}
                        class="rounded-lg px-3 py-1.5 text-sm opacity-70 transition-colors hover:opacity-100"
                        >取消</button
                    >
                    <button
                        onclick={confirmMatrix}
                        disabled={perCharSel.some((s) => s.length === 0)}
                        class="rounded-lg px-4 py-1.5 text-sm font-medium transition-all enabled:hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-40"
                        style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
                    >
                        确认（{matrixCount} 个）
                    </button>
                </div>
            </div>
        </div>
    {/if}
{/if}
