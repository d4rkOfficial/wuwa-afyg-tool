<script lang="ts">
    /** @desc 共鸣链/武器精炼对比弹窗：一个配置 = 全队 3 角色各自链阶；折线同图叠加、其余并排对比。只对比用户选定配置（无「当前」列） */
    import Chart from 'chart.js/auto'
    import type { TooltipItem } from 'chart.js'
    import Icon from '@iconify/svelte'
    import { untrack } from 'svelte'
    import { getCharElementMap, getRefLines, getOpBlocks } from '$lib/calc/timeline.store.svelte'
    import { getConditionProfile } from '$lib/calc/calculation.store.svelte'
    import type { ResultEntry, CharSummary } from '$lib/calc/result.types'
    import type { CharSlot, ResultAnalysisData } from '$lib/types/project'
    import { aggregateDirectDamageByType } from '$lib/calc/utils'
    import type { ComparisonEligibility } from '$lib/calc/comparison'
    import type { ComponentsProps } from '$lib/types'
    import MiniDropdown from '$lib/components/ui/mini-dropdown.svelte'

    interface TeamConfig {
        chains: [number, number, number]
        refinements: [number, number, number]
    }

    interface Props extends ComponentsProps {
        open: boolean
        team: [CharSlot, CharSlot, CharSlot]
        timings: { refLineId: string; seconds: number | null }[]
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
    let curveTab = $state<'cumulative' | 'window'>('cumulative')

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
    let totalDur = $derived(validTimings.length > 0 ? validTimings[validTimings.length - 1].seconds! : 0)

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

    const PALETTE = ['#6363f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#a855f7', '#ec4899']
    /** @desc 紧凑配置标签：3 角色 chain+ref 直接拼接，如 6+1/0+1/0+1 → 610101 */
    function compactLabel(chains: number[], refinements: number[]): string {
        return chains.map((c, j) => `${c}${refinements[j]}`).join('')
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
                accent: PALETTE[i % PALETTE.length]
            }
        })
    )

    // ── 配置选择：独立弹窗，3 角色各自选链阶组成队伍配置 ──
    let pickerOpen = $state(false)
    let draftConfig = $state<TeamConfig>({ chains: [0, 0, 0], refinements: [0, 0, 0] })
    let draftList = $state<TeamConfig[]>([])
    const CHAIN_OPTIONS = CHAIN_RANGE.map((c) => ({ value: String(c), label: String(c) }))
    const REFINEMENT_OPTIONS = REFINEMENT_RANGE.map((r) => ({ value: String(r), label: String(r) }))

    function cloneProfile(): TeamConfig {
        const p = getConditionProfile()
        return {
            chains: [p.chains[0] ?? 0, p.chains[1] ?? 0, p.chains[2] ?? 0],
            refinements: [p.refinements[0] ?? 0, p.refinements[1] ?? 0, p.refinements[2] ?? 0]
        }
    }
    /** @desc 两个队伍配置是否完全相同（链阶逐位比对） */
    function sameConfig(
        a: { chains: number[]; refinements: number[] },
        b: { chains: number[]; refinements: number[] }
    ): boolean {
        return a.chains.every((c, i) => c === b.chains[i]) && a.refinements.every((r, i) => r === b.refinements[i])
    }
    let draftDup = $derived(draftList.some((p) => sameConfig(p, draftConfig)))
    function openPicker() {
        draftConfig = cloneProfile()
        draftList = [...points]
        pickerOpen = true
    }
    function addDraft() {
        if (draftDup) return
        draftList = [
            ...draftList,
            {
                chains: [...draftConfig.chains] as [number, number, number],
                refinements: [...draftConfig.refinements] as [number, number, number]
            }
        ]
    }
    function removeDraft(idx: number) {
        draftList = draftList.filter((_, i) => i !== idx)
    }
    function donePicker() {
        points = [...draftList]
        pickerOpen = false
    }
    function draftLabel(p: TeamConfig): string {
        return compactLabel(p.chains, p.refinements)
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
        let prevRefPos = 0
        let prevSeconds = 0
        for (const t of validTimings) {
            const rl = refLines.find((r) => r.id === t.refLineId)
            if (!rl) continue
            const span = t.seconds! - prevSeconds
            if (span <= 0) continue
            const currentRefPos = rl.pos
            const segEntries = entries.filter((e) => {
                const p = blockPosMap.get(e.sourceTimelineBlockId)
                return p !== undefined && p >= prevRefPos && p < currentRefPos
            })
            result.push({
                startSeconds: prevSeconds,
                endSeconds: t.seconds!,
                totalDamage: segEntries.reduce((s, e) => s + e.totalDamageRaw, 0)
            })
            prevRefPos = currentRefPos
            prevSeconds = t.seconds!
        }
        return result
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
                datasets: configs.map((c) => ({
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
        const labels = configs.map((c) => c.label)
        const grid = cssVar('--theme-divider-border', '#334155')
        const tooltip = {
            bodyColor: textColor,
            titleColor: textColor,
            backgroundColor: cssVar('--theme-modal-bg', '#1e293b'),
            borderColor: grid,
            borderWidth: 1,
            callbacks: {
                label: (ctx: TooltipItem<'bar'>) =>
                    `${ctx.dataset.label ?? ''}: ${Math.round(ctx.parsed?.x ?? 0).toLocaleString()}`
            }
        }
        // ── 全队伤害占比：每配置一根横条，按角色堆叠 ──
        if (teamShareCanvas) {
            teamShareChart?.destroy()
            teamShareChart = new Chart(teamShareCanvas, {
                type: 'bar',
                data: {
                    labels,
                    datasets: team.map((slot, si) => ({
                        label: slot.character ?? `槽${si + 1}`,
                        data: configs.map(
                            (c) => c.charSummaries.find((s) => s.character === slot.character)?.totalDamage ?? 0
                        ),
                        backgroundColor: charElements[slot.character ?? ''] ?? PALETTE[si % PALETTE.length],
                        stack: 'team'
                    }))
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { stacked: true, beginAtZero: true, ticks: { color: textColor }, grid: { color: grid } },
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
            const perConfig: Record<string, number>[] = configs.map((c) => {
                const agg = aggregateDirectDamageByType(c.entries).find((x) => x.character === team[si].character)
                const map: Record<string, number> = {}
                for (const s of agg?.slices ?? []) {
                    map[s.label] = (map[s.label] ?? 0) + s.value
                    typeSet.add(s.label)
                }
                return map
            })
            const types = [...typeSet]
            charTypeCharts.set(
                String(si),
                new Chart(cv, {
                    type: 'bar',
                    data: {
                        labels,
                        datasets: types.map((t, ti) => ({
                            label: t,
                            data: perConfig.map((m) => m[t] ?? 0),
                            backgroundColor: PALETTE[(si + ti * 2) % PALETTE.length],
                            stack: `char-${si}`
                        }))
                    },
                    options: {
                        indexAxis: 'y',
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            x: { stacked: true, beginAtZero: true, ticks: { color: textColor }, grid: { color: grid } },
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
        untrack(() => {
            drawCurve()
            drawBars()
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
                                    {draftLabel(p)}
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

                    {#if points.length > 0}
                        <!-- ── 队伍出伤曲线（同图叠加）── -->
                        <section
                            class="rounded-lg border p-3"
                            style="border-color: var(--theme-divider-border); background: var(--theme-card-bg);"
                        >
                            <div class="mb-2 flex items-center gap-2">
                                <span class="text-xs font-semibold uppercase tracking-wider opacity-50"
                                    >队伍出伤曲线</span
                                >
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
                                        class="rounded px-2 py-0.5 {curveTab === 'window'
                                            ? 'font-medium'
                                            : 'opacity-60'}"
                                        style={curveTab === 'window'
                                            ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);'
                                            : ''}>{CURVE_WINDOW_SEC}s 窗口</button
                                    >
                                </div>
                            </div>
                            <div class="h-56"><canvas bind:this={curveCanvas}></canvas></div>
                        </section>

                        <!-- ── 配置 + 总伤 + DPS 卡片组（并排）── -->
                        <section class="flex gap-3 overflow-x-auto">
                            {#each configs as c, i}
                                <div
                                    class="min-w-44 flex-1 rounded-lg border p-3"
                                    style="border-color: {c.accent}; background: var(--theme-card-bg);"
                                >
                                    <div
                                        class="flex items-center gap-1.5 text-sm font-semibold"
                                        style="color: {c.accent};"
                                    >
                                        <span class="size-2.5 rounded-full" style="background: {c.accent};"
                                        ></span>{c.label}
                                        <button
                                            onclick={() => removePoint(i)}
                                            class="ml-auto rounded p-0.5 opacity-50 hover:opacity-100"
                                            title="移除"><Icon icon="mdi:close" class="size-3.5" /></button
                                        >
                                    </div>
                                    <div class="mt-2 space-y-1 text-xs">
                                        <div class="flex items-center justify-between">
                                            <span class="opacity-50">总伤</span><span class="tabular-nums font-medium"
                                                >{fmt(c.totalDamage)}</span
                                            >
                                        </div>
                                        <div class="flex items-center justify-between">
                                            <span class="opacity-50">DPS</span><span
                                                class="tabular-nums font-medium"
                                                style="color: var(--theme-accent-text);"
                                                >{totalDur > 0 ? fmt(c.totalDamage / totalDur) : '—'}</span
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

                        <!-- ── 伤害占比（条形图）：全队占比 + 每角色直伤类型占比 ── -->
                        <section
                            class="rounded-lg border p-3"
                            style="border-color: var(--theme-divider-border); background: var(--theme-card-bg);"
                        >
                            <div class="mb-2 text-xs font-semibold uppercase tracking-wider opacity-50">
                                全队伤害占比
                            </div>
                            <div class="h-56"><canvas bind:this={teamShareCanvas}></canvas></div>
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
                                        <div class="h-40">
                                            <canvas bind:this={charTypeCanvases[String(si)]}></canvas>
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        </section>
                    {:else}
                        <div class="flex flex-col items-center gap-2 py-12 text-center text-sm opacity-50">
                            <Icon icon="mdi:plus-circle-outline" class="size-8" />
                            <span>选择对比配置后展示出伤曲线 / 卡片 / 分段 DPS / 伤害占比</span>
                        </div>
                    {/if}
                {/if}
            </div>
        </div>
    </div>

    <!-- 独立配置选择弹窗：3 角色各自选链阶 → 组成队伍配置 -->
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
                class="animate-pop-in theme-glass-surface flex max-h-[88vh] w-[min(92vw,640px)] flex-col overflow-hidden rounded-xl border shadow-2xl"
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
                    <span class="text-[11px] opacity-50">每个角色分别选 链(0-6) + 阶(0-5)，组成一支队伍配置</span>
                    <span class="ml-auto text-[11px] opacity-60">已添加 {draftList.length}</span>
                    <button
                        onclick={() => (pickerOpen = false)}
                        class="rounded p-1 opacity-50 hover:opacity-100"
                        aria-label="关闭"
                    >
                        <Icon icon="mdi:close" class="size-4" />
                    </button>
                </div>
                <div class="theme-scrollbar min-h-0 flex-1 space-y-4 overflow-auto p-4">
                    <!-- 3 角色链阶选择 -->
                    <div class="space-y-2">
                        {#each team as slot, si}
                            <div
                                class="flex items-center gap-3 rounded-lg border px-3 py-2"
                                style="border-color: var(--theme-divider-border); background: var(--theme-card-bg);"
                            >
                                <span
                                    class="min-w-20 truncate text-sm font-medium"
                                    style="color: var(--theme-modal-text);"
                                >
                                    {slot.character ?? `槽${si + 1}`}
                                </span>
                                <span class="ml-auto flex items-center gap-1 text-xs opacity-60">
                                    链
                                    <div class="w-14">
                                        <MiniDropdown
                                            options={CHAIN_OPTIONS}
                                            value={String(draftConfig.chains[si])}
                                            onchange={(v) => (draftConfig.chains[si] = Number(v))}
                                        />
                                    </div>
                                </span>
                                <span class="flex items-center gap-1 text-xs opacity-60">
                                    阶
                                    <div class="w-14">
                                        <MiniDropdown
                                            options={REFINEMENT_OPTIONS}
                                            value={String(draftConfig.refinements[si])}
                                            onchange={(v) => (draftConfig.refinements[si] = Number(v))}
                                        />
                                    </div>
                                </span>
                            </div>
                        {/each}
                    </div>
                    <button
                        onclick={addDraft}
                        disabled={draftDup}
                        class="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed py-2 text-sm transition-colors enabled:hover:border-(--theme-accent-bg) disabled:cursor-not-allowed disabled:opacity-40"
                        style="border-color: var(--theme-divider-border); color: var(--theme-accent-text);"
                        title={draftDup ? '该配置已存在，不可重复添加' : '添加此队伍配置'}
                    >
                        <Icon icon="mdi:plus" class="size-4" />添加此队伍配置（{draftLabel(draftConfig)}）
                    </button>
                    {#if draftList.length > 0}
                        <div class="space-y-1.5">
                            <div class="text-[11px] opacity-50">已添加的对比配置：</div>
                            {#each draftList as p, i}
                                <div
                                    class="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    <span class="size-2 rounded-full" style="background: {PALETTE[i % PALETTE.length]};"
                                    ></span>
                                    <span class="font-medium tabular-nums">{draftLabel(p)}</span>
                                    <button
                                        onclick={() => removeDraft(i)}
                                        class="ml-auto rounded p-0.5 opacity-50 hover:opacity-100"
                                        title="移除"><Icon icon="mdi:close" class="size-3.5" /></button
                                    >
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
                <div
                    class="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3"
                    style="border-color: var(--theme-divider-border);"
                >
                    <button
                        onclick={() => (pickerOpen = false)}
                        class="rounded-lg px-3 py-1.5 text-sm opacity-70 transition-colors hover:opacity-100"
                        >取消</button
                    >
                    <button
                        onclick={donePicker}
                        class="rounded-lg px-4 py-1.5 text-sm font-medium transition-all hover:brightness-125"
                        style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
                    >
                        完成（{draftList.length}）
                    </button>
                </div>
            </div>
        </div>
    {/if}
{/if}
