<script lang="ts">
    /** @desc 共鸣链/武器精炼对比弹窗：一个配置 = 全队 3 角色各自链阶；折线同图叠加、其余并排对比。只对比用户选定配置（无「当前」列） */
    import Chart from 'chart.js/auto'
    import type { TooltipItem } from 'chart.js'
    import Icon from '@iconify/svelte'
    import { tick, untrack } from 'svelte'
    import { getCharElementMap, getRefLines, getOpBlocks } from '$lib/calc/timeline.store.svelte'
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
    /** @desc 一次可确认的团队配置数上限（超过后禁止确认，避免一次复算过多配置） */
    const MAX_PICKER_CONFIGS = 16
    /** @desc 该链档位是否有生效的条件 buff：挂载 buff 的链门槛正好落在 n（门槛语义是「≥n」，故只有门槛值那一档才是新增档） */
    const chainHasOwnBuff = (chain: number) => eligibility.chains.includes(chain)
    /** @desc 该阶档位是否有专属 buff（0=无专武，为基线） */
    const refinementHasOwnBuff = (refinement: number) => eligibility.refinements.includes(refinement)
    /** @desc 表头档位标签透明度：无专属 buff 的档位压暗，提示「加到这一档不会带来新 buff」；0 链/无专是基线，始终正常显示 */
    const labelOpacity = (level: number, hasOwnBuff: boolean) => (level === 0 || hasOwnBuff ? 0.5 : 0.22)
    const cellStyle = (checked: boolean) =>
        checked
            ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg); border-color: var(--theme-accent-bg);'
            : 'border-color: var(--theme-divider-border); color: var(--theme-modal-text);'

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
        charDamages: Record<string, number>
        otherDamage: number
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
            const charDamages: Record<string, number> = {}
            let otherDamage = 0
            for (const e of segEntries) {
                const character = e.character
                if (character && team.some((s) => s.character === character)) {
                    charDamages[character] = (charDamages[character] ?? 0) + e.totalDamageRaw
                } else {
                    otherDamage += e.totalDamageRaw
                }
            }
            result.push({
                startSeconds: prevSeconds,
                endSeconds: t.seconds!,
                totalDamage: segEntries.reduce((s, e) => s + e.totalDamageRaw, 0),
                charDamages,
                otherDamage
            })
            prevRefPos = currentRefPos
            prevSeconds = t.seconds!
        }
        return result
    }

    // ── 时段选择（含总计）：单选一行，下方明细呈现该范围的段总伤 / 段角色总伤 / 段其它总伤 / DPS ──
    /** @desc 'total' = 总计；数字 = 时段下标（默认总计） */
    let selectedRange = $state<'total' | number>('total')
    /** @desc 每配置的分段（记点相同，段数一致） */
    let configSegments = $derived(configs.map((c) => segmentsOf(c.entries)))
    /** @desc 时段列表（以首个配置为准：渲染行与范围标签） */
    let rangeSegments = $derived(configSegments[0] ?? [])
    /** @desc 记点变化导致段数减少时，失效的下标回落到总计 */
    let activeRange = $derived(
        typeof selectedRange === 'number' && selectedRange >= rangeSegments.length ? 'total' : selectedRange
    )

    interface RangeStat {
        config: Config
        damage: number
        charDamages: Record<string, number>
        otherDamage: number
        span: number
        dps: number
    }

    /** @desc 选中范围的每配置统计：总计用整段数据，时段用该段数据（大卡片与明细表共用） */
    let rangeStats = $derived.by<RangeStat[]>(() =>
        configs.map((c, ci) => {
            if (activeRange === 'total') {
                const charDamages: Record<string, number> = {}
                let otherDamage = 0
                for (const cs of c.charSummaries) {
                    if (team.some((s) => s.character === cs.character)) {
                        charDamages[cs.character] = (charDamages[cs.character] ?? 0) + cs.totalDamage
                    } else {
                        otherDamage += cs.totalDamage
                    }
                }
                return {
                    config: c,
                    damage: c.totalDamage,
                    charDamages,
                    otherDamage,
                    span: totalDur,
                    dps: totalDur > 0 ? c.totalDamage / totalDur : 0
                }
            }
            const seg = (configSegments[ci] ?? [])[activeRange]
            const span = seg ? seg.endSeconds - seg.startSeconds : 0
            return {
                config: c,
                damage: seg?.totalDamage ?? 0,
                charDamages: seg?.charDamages ?? {},
                otherDamage: seg?.otherDamage ?? 0,
                span,
                dps: seg && span > 0 ? seg.totalDamage / span : 0
            }
        })
    )
    /** @desc 选中范围标签（明细表标题用） */
    let rangeLabel = $derived.by(() => {
        if (activeRange === 'total') return '总计'
        const seg = rangeSegments[activeRange]
        return seg ? `${seg.startSeconds.toFixed(1)}s — ${seg.endSeconds.toFixed(1)}s` : '总计'
    })

    /** @desc 选中范围时长（秒）：总计 = 总时长，否则 = 该段跨度 */
    let rangeSpan = $derived.by(() => {
        if (activeRange === 'total') return totalDur
        const seg = rangeSegments[activeRange]
        return seg ? seg.endSeconds - seg.startSeconds : 0
    })

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
            class="animate-pop-in theme-glass-surface theme-scrollbar flex max-h-[92vh] w-[min(96vw,1400px)] flex-col overflow-hidden rounded-none border shadow-2xl"
            style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-bg) var(--theme-modal-opacity, 75%), transparent); color: var(--theme-modal-text);"
            role="dialog"
            aria-modal="true"
        >
            <!-- Header -->
            <div
                class="sticky top-0 z-10 flex shrink-0 flex-wrap items-center gap-3 border-b px-6 py-4"
                style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-bg) var(--theme-modal-opacity, 75%), transparent); backdrop-filter: blur(12px);"
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
                    class="inline-flex items-center gap-1 rounded-none p-1.5 text-xs transition-colors hover:opacity-70"
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
                            class="inline-flex items-center gap-1.5 rounded-none border px-3 py-1.5 text-sm transition-colors hover:opacity-80"
                            style="background: color-mix(in srgb, var(--theme-accent-bg) 18%, transparent); color: var(--theme-accent-text); border-color: var(--theme-accent-bg);"
                        >
                            <Icon icon="mdi:sitemap" class="size-4" />
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
                        class="rounded-none border p-3"
                        style="border-color: var(--theme-divider-border); background: var(--theme-card-bg);"
                    >
                        <div class="mb-2 flex items-center gap-2">
                            <span class="text-xs font-semibold uppercase tracking-wider opacity-50">队伍出伤曲线</span>
                            <div
                                class="ml-auto flex items-center gap-1 rounded-none border p-0.5 text-[11px]"
                                style="border-color: var(--theme-divider-border);"
                            >
                                <button
                                    onclick={() => (curveTab = 'cumulative')}
                                    class="rounded-none px-2 py-0.5 {curveTab === 'cumulative'
                                        ? 'font-medium'
                                        : 'opacity-60'}"
                                    style={curveTab === 'cumulative'
                                        ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);'
                                        : ''}>累计</button
                                >
                                <button
                                    onclick={() => (curveTab = 'window')}
                                    class="rounded-none px-2 py-0.5 {curveTab === 'window'
                                        ? 'font-medium'
                                        : 'opacity-60'}"
                                    style={curveTab === 'window'
                                        ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);'
                                        : ''}>窗口</button
                                >
                            </div>
                        </div>
                        <div class="h-56"><canvas bind:this={curveCanvas}></canvas></div>
                    </section>

                    {#if points.length > 0}
                        <!-- ── 配置 + DPS + 总伤 卡片组（并排；数值随下方选中的时段切换）── -->
                        <section class="space-y-2">
                            <div class="flex items-center gap-2 text-[11px]" style="opacity: 0.6;">
                                <Icon icon="mdi:cursor-default-click-outline" class="size-3.5" />
                                <span>当前口径：{rangeLabel}（时长 {rangeSpan.toFixed(1)}s）· 点下方分段行可切换</span>
                            </div>
                            <div class="theme-scrollbar flex gap-3 overflow-x-auto">
                                {#each rangeStats as stat}
                                    {@const c = stat.config}
                                    <div
                                        class="min-w-44 flex-1 shrink-0 rounded-none border p-3"
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
                                                    >{stat.dps > 0 ? fmt(stat.dps) : '—'}</span
                                                >
                                            </div>
                                            <div class="flex items-center justify-between text-xs">
                                                <span class="opacity-50">总伤</span><span
                                                    class="tabular-nums font-medium"
                                                    style="color: {c.accent};">{fmt(stat.damage)}</span
                                                >
                                            </div>
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        </section>

                        <!-- ── 分段 DPS（版式对齐数据分析页：区块头 + 时段单选 + 选中范围明细）── -->
                        <section
                            class="rounded-none border"
                            style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-card-bg, var(--theme-modal-bg)) 30%, transparent);"
                        >
                            <div
                                class="flex flex-wrap items-center gap-2 border-b px-4 py-3"
                                style="border-color: var(--theme-divider-border);"
                            >
                                <Icon
                                    icon="mdi:chart-timeline-variant"
                                    class="size-4"
                                    style="color: var(--theme-accent-text);"
                                />
                                <span class="text-sm font-semibold" style="color: var(--theme-modal-text);"
                                    >分段 DPS</span
                                >
                                <span class="text-[11px] opacity-50"
                                    >点击时段行切换上方卡片与明细的口径（默认总计）</span
                                >
                            </div>
                            <div class="px-4 py-3">
                                {#if validTimings.length === 0}
                                    <p class="text-xs opacity-40">配置时间记点后显示分段 DPS</p>
                                {:else}
                                    <div class="overflow-x-auto">
                                        <table class="w-full text-xs">
                                            <thead>
                                                <tr style="color: var(--theme-modal-text); opacity: 0.5;">
                                                    <th class="py-1.5 pr-2 text-left font-medium">时段</th>
                                                    <th class="px-2 py-1.5 text-right font-medium">跨度</th>
                                                    {#each configs as c}
                                                        <th
                                                            class="px-2 py-1.5 text-right font-medium"
                                                            style="color: {c.accent};">{c.label}</th
                                                        >
                                                    {/each}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {#each rangeSegments as seg, si}
                                                    {@const span = seg.endSeconds - seg.startSeconds}
                                                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                                                    <tr
                                                        class="cursor-pointer border-t transition-colors"
                                                        style="border-color: var(--theme-divider-border); color: var(--theme-modal-text); background: {activeRange ===
                                                        si
                                                            ? 'color-mix(in srgb, var(--theme-accent-bg) 8%, transparent)'
                                                            : 'transparent'};"
                                                        onclick={() => (selectedRange = si)}
                                                        role="button"
                                                        tabindex="0"
                                                        title="点击查看该时段数据"
                                                    >
                                                        <td
                                                            class="py-2 pr-2 text-[10px] tabular-nums"
                                                            style="opacity: 0.45;"
                                                        >
                                                            {seg.startSeconds.toFixed(1)}s — {seg.endSeconds.toFixed(
                                                                1
                                                            )}s
                                                        </td>
                                                        <td
                                                            class="px-2 py-2 text-right text-[10px] tabular-nums"
                                                            style="opacity: 0.45;"
                                                        >
                                                            {span.toFixed(1)}s
                                                        </td>
                                                        {#each rangeStats as stat, ci}
                                                            {@const segDamage =
                                                                (configSegments[ci] ?? [])[si]?.totalDamage ?? 0}
                                                            <td class="px-2 py-2 text-right">
                                                                <div
                                                                    class="text-sm font-bold tabular-nums"
                                                                    style="color: {stat.config.accent};"
                                                                >
                                                                    {segDamage > 0
                                                                        ? Math.round(segDamage / span).toLocaleString()
                                                                        : '—'}
                                                                </div>
                                                                <div
                                                                    class="text-[10px] tabular-nums"
                                                                    style="opacity: 0.45;"
                                                                >
                                                                    {Math.round(segDamage).toLocaleString()}
                                                                </div>
                                                            </td>
                                                        {/each}
                                                    </tr>
                                                {/each}
                                                <!-- svelte-ignore a11y_click_events_have_key_events -->
                                                <tr
                                                    class="cursor-pointer border-t transition-colors"
                                                    style="border-color: var(--theme-divider-border); color: var(--theme-modal-text); background: {activeRange ===
                                                    'total'
                                                        ? 'color-mix(in srgb, var(--theme-accent-bg) 8%, transparent)'
                                                        : 'transparent'};"
                                                    onclick={() => (selectedRange = 'total')}
                                                    role="button"
                                                    tabindex="0"
                                                    title="点击查看总计数据"
                                                >
                                                    <td
                                                        class="py-2 pr-2 text-[10px] font-semibold"
                                                        style="opacity: 0.6;"
                                                    >
                                                        总计
                                                    </td>
                                                    <td
                                                        class="px-2 py-2 text-right text-[10px] tabular-nums"
                                                        style="opacity: 0.45;"
                                                    >
                                                        {totalDur.toFixed(1)}s
                                                    </td>
                                                    {#each rangeStats as stat}
                                                        <td
                                                            class="px-2 py-2 text-right text-sm font-bold tabular-nums"
                                                            style="color: {stat.config.accent};"
                                                        >
                                                            {Math.round(stat.dps).toLocaleString()}
                                                        </td>
                                                    {/each}
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>

                                    <!-- 选中范围明细：段总伤 / 段角色总伤 / 段其它总伤 / DPS -->
                                    <div class="mt-4">
                                        <div class="mb-1.5 flex items-center gap-2">
                                            <span class="text-xs font-semibold" style="color: var(--theme-modal-text);"
                                                >{rangeLabel} 明细</span
                                            >
                                            <span class="text-[11px] opacity-50">时长 {rangeSpan.toFixed(1)}s</span>
                                        </div>
                                        <div class="overflow-x-auto">
                                            <table class="w-full text-xs">
                                                <thead>
                                                    <tr style="color: var(--theme-modal-text); opacity: 0.5;">
                                                        <th class="py-1.5 pr-2 text-left font-medium">配置</th>
                                                        <th class="px-2 py-1.5 text-right font-medium">段总伤</th>
                                                        {#each team as slot}
                                                            {#if slot.character}
                                                                <th class="px-2 py-1.5 text-right font-medium"
                                                                    >{slot.character}</th
                                                                >
                                                            {/if}
                                                        {/each}
                                                        <th class="px-2 py-1.5 text-right font-medium">其他</th>
                                                        <th class="px-2 py-1.5 text-right font-medium">DPS</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {#each rangeStats as stat}
                                                        <tr
                                                            class="border-t"
                                                            style="border-color: var(--theme-divider-border); color: var(--theme-modal-text);"
                                                        >
                                                            <td
                                                                class="py-2 pr-2 font-medium"
                                                                style="color: {stat.config.accent};"
                                                            >
                                                                {stat.config.label}
                                                            </td>
                                                            <td class="px-2 py-2 text-right tabular-nums"
                                                                >{Math.round(stat.damage).toLocaleString()}</td
                                                            >
                                                            {#each team as slot}
                                                                {#if slot.character}
                                                                    {@const cd = stat.charDamages[slot.character] ?? 0}
                                                                    <td class="px-2 py-2 text-right tabular-nums"
                                                                        >{cd > 0
                                                                            ? Math.round(cd).toLocaleString()
                                                                            : '—'}</td
                                                                    >
                                                                {/if}
                                                            {/each}
                                                            <td class="px-2 py-2 text-right tabular-nums"
                                                                >{stat.otherDamage > 0
                                                                    ? Math.round(stat.otherDamage).toLocaleString()
                                                                    : '—'}</td
                                                            >
                                                            <td
                                                                class="px-2 py-2 text-right text-sm font-bold tabular-nums"
                                                                style="color: var(--theme-accent-text);"
                                                            >
                                                                {stat.dps > 0
                                                                    ? Math.round(stat.dps).toLocaleString()
                                                                    : '—'}
                                                            </td>
                                                        </tr>
                                                    {/each}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                {/if}
                            </div>
                        </section>
                    {:else}
                        <div class="flex flex-col items-center gap-2 py-12 text-center text-sm opacity-50">
                            <Icon icon="mdi:plus-circle-outline" class="size-8" />
                            <span>选择对比配置后展示配置卡片与分段 DPS</span>
                        </div>
                    {/if}

                    <!-- ── 伤害占比（常驻，条形图）：全队占比 + 每角色直伤类型占比 ── -->
                    <section
                        class="rounded-none border p-3"
                        style="border-color: var(--theme-divider-border); background: var(--theme-card-bg);"
                    >
                        <div class="mb-2 flex items-center gap-2">
                            <span class="text-xs font-semibold uppercase tracking-wider opacity-50">全队伤害占比</span>
                            <div
                                class="ml-auto flex items-center gap-1 rounded-none border p-0.5 text-[11px]"
                                style="border-color: var(--theme-divider-border);"
                            >
                                <button
                                    onclick={() => (shareMode = 'total')}
                                    class="rounded-none px-2 py-0.5 {shareMode === 'total'
                                        ? 'font-medium'
                                        : 'opacity-60'}"
                                    style={shareMode === 'total'
                                        ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);'
                                        : ''}>看总伤</button
                                >
                                <button
                                    onclick={() => (shareMode = 'pct')}
                                    class="rounded-none px-2 py-0.5 {shareMode === 'pct'
                                        ? 'font-medium'
                                        : 'opacity-60'}"
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
                        class="rounded-none border p-3"
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
                class="animate-pop-in theme-glass-surface flex max-h-[88vh] w-[min(94vw,760px)] flex-col overflow-hidden rounded-none border shadow-2xl"
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
                            class="rounded-none border p-3"
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
                                            <th
                                                class="py-0.5 font-medium"
                                                style="opacity: {labelOpacity(rf, refinementHasOwnBuff(rf))};"
                                                >{rf === 0 ? '无专' : `${rf}阶`}</th
                                            >
                                        {/each}
                                    </tr>
                                </thead>
                                <tbody>
                                    {#each CHAIN_RANGE as ch}
                                        <tr>
                                            <td
                                                class="pr-1 text-right font-medium"
                                                style="opacity: {labelOpacity(ch, chainHasOwnBuff(ch))};">{ch}链</td
                                            >
                                            {#each REFINEMENT_RANGE as rf}
                                                {@const checked = isSel(si, ch, rf)}
                                                <td>
                                                    <button
                                                        onclick={() => toggleSel(si, ch, rf)}
                                                        class="flex h-7 w-full items-center justify-center border border-dashed text-[10px] transition-colors"
                                                        style={cellStyle(checked)}
                                                        title="{ch}+{rf}"
                                                    >
                                                        {ch}+{rf}
                                                    </button>
                                                </td>
                                            {/each}
                                        </tr>
                                    {/each}
                                </tbody>
                            </table>
                        </div>
                    {/each}
                    <p
                        class="text-center text-[11px]"
                        style={matrixCount > MAX_PICKER_CONFIGS ? 'color: #ef4444;' : 'opacity: 0.5;'}
                    >
                        {matrixCount > MAX_PICKER_CONFIGS
                            ? '配置太多，超过限制，为避免卡顿，无法确认。'
                            : `将按三个角色的选择组合成 ${matrixCount} 个团队配置（笛卡尔积）`}
                    </p>
                </div>
                <div
                    class="flex shrink-0 items-center gap-2 border-t px-5 py-3"
                    style="border-color: var(--theme-divider-border);"
                >
                    <button
                        onclick={() => (perCharSel = [[], [], []])}
                        disabled={perCharSel.every((s) => s.length === 0)}
                        class="inline-flex items-center gap-1 rounded-none px-3 py-1.5 text-sm opacity-70 transition-colors enabled:hover:opacity-100 disabled:opacity-30"
                        title="清空全部角色的选择"
                    >
                        <Icon icon="mdi:broom" class="size-4" />清空
                    </button>
                    <div class="flex-1"></div>
                    <button
                        onclick={() => (pickerOpen = false)}
                        class="rounded-none px-3 py-1.5 text-sm opacity-70 transition-colors hover:opacity-100"
                        >取消</button
                    >
                    <button
                        onclick={confirmMatrix}
                        disabled={perCharSel.some((s) => s.length === 0) || matrixCount > MAX_PICKER_CONFIGS}
                        class="rounded-none px-4 py-1.5 text-sm font-medium transition-all enabled:hover:brightness-125 disabled:cursor-not-allowed disabled:opacity-40"
                        style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
                    >
                        确认（{matrixCount} 个）
                    </button>
                </div>
            </div>
        </div>
    {/if}
{/if}
