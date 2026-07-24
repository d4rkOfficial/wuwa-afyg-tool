<script lang="ts">
    import { onMount } from 'svelte'
    import Chart from 'chart.js/auto'
    import { PPS, ELEMENT_COLORS } from '../timeline/timeline.consts'
    import { getCharElementMap, getRefLines, getOpBlocks } from '../timeline/timeline.store.svelte'
    import type { ResultEntry, CharSummary } from './result.types'
    import type { CharSlot, ResultAnalysisData } from '$lib/data/types'
    import Icon from '@iconify/svelte'

    interface Props {
        entries: ResultEntry[]
        charSummaries: CharSummary[]
        team: [CharSlot, CharSlot, CharSlot]
        totalDamage: number
        resultAnalysis: ResultAnalysisData | undefined
        onUpdateResultAnalysis: (data: ResultAnalysisData) => void
        onclose: () => void
    }

    let { entries, charSummaries, team, totalDamage, resultAnalysis, onUpdateResultAnalysis, onclose }: Props = $props()

    let charElements = $derived(getCharElementMap())

    // ── pie chart refs ──
    let pieCanvas: HTMLCanvasElement | null = $state(null)
    let pieContainer: HTMLDivElement | null = $state(null)
    let pieChart: Chart<'doughnut'> | null = $state(null)
    let chartDrawn = $state(false)

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

    function toggleRefLine(id: string) {
        if (timings.some((t) => t.refLineId === id)) {
            timings = timings.filter((t) => t.refLineId !== id)
        } else {
            timings = [...timings, { refLineId: id, seconds: 25 }]
        }
    }

    function updateSeconds(id: string, raw: string) {
        const val = parseFloat(raw)
        if (isNaN(val) || val < 0) return
        timings = timings.map((t) => (t.refLineId === id ? { ...t, seconds: val } : t))
    }

    function setQuickSeconds(id: string, offset: number) {
        const sorted = [...timings]
            .filter((t) => refLines.some((r) => r.id === t.refLineId))
            .sort((a, b) => {
                const aRl = refLines.find((r) => r.id === a.refLineId)
                const bRl = refLines.find((r) => r.id === b.refLineId)
                return (aRl?.pos ?? 0) - (bRl?.pos ?? 0)
            })
        const idx = sorted.findIndex((t) => t.refLineId === id)
        const prevSeconds = idx > 0 ? sorted[idx - 1].seconds : 0
        timings = timings.map((t) => (t.refLineId === id ? { ...t, seconds: prevSeconds + offset } : t))
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

    // ── theme-aware colors ──
    function cssVar(name: string, fallback: string): string {
        if (typeof document === 'undefined') return fallback
        return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
    }

    function hexToRgba(hex: string, alpha: number): string {
        const r = parseInt(hex.slice(1, 3), 16)
        const g = parseInt(hex.slice(3, 5), 16)
        const b = parseInt(hex.slice(5, 7), 16)
        return `rgba(${r}, ${g}, ${b}, ${alpha})`
    }

    function fadedColor(hex: string, index: number): string {
        if (index === 0) return hex
        const alpha = index === 1 ? 0.5 : 0.25
        return hexToRgba(hex, alpha)
    }

    // ── pie chart lifecycle ──
    function drawChart() {
        if (!pieCanvas || charSummaries.length === 0 || chartDrawn) return
        chartDrawn = true
        pieChart?.destroy()

        const labels = charSummaries.map((cs) => cs.character || '—')
        const data = charSummaries.map((cs) => cs.totalDamage)
        const colors = charSummaries.map((cs, i) => {
            const el = charElements[cs.character]
            const base = el ? ((ELEMENT_COLORS as Record<string, string>)[el] ?? '#6366f1') : '#6366f1'
            return fadedColor(base, i)
        })

        const textColor = cssVar('--theme-modal-text', '#e2e8f0')

        pieChart = new Chart(pieCanvas, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{ data, backgroundColor: colors, borderColor: 'transparent' }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                cutout: '55%',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        bodyColor: textColor,
                        backgroundColor: cssVar('--theme-modal-bg', '#1e293b'),
                        borderColor: cssVar('--theme-divider-border', '#334155'),
                        borderWidth: 1,
                        callbacks: {
                            label: (ctx) => {
                                const val = ctx.parsed as number
                                const pct = ((val / totalDamage) * 100).toFixed(1)
                                return `${ctx.label}: ${Math.round(val).toLocaleString()} (${pct}%)`
                            }
                        }
                    }
                }
            }
        })
    }

    onMount(() => {
        drawChart()
        return () => pieChart?.destroy()
    })
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_interactive_supports_focus -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
    class="fixed inset-0 z-50 flex items-start justify-center pt-12 pb-8 backdrop-blur-sm"
    style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
    onclick={handleClose}
    role="dialog"
    tabindex="-1"
>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
        class="w-[740px] max-h-[85vh] rounded-xl border shadow-2xl overflow-y-auto"
        style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); border-color: var(--theme-divider-border);"
        onclick={(e) => e.stopPropagation()}
    >
        <!-- Header -->
        <div
            class="flex items-center justify-between px-6 py-4 border-b"
            style="border-color: var(--theme-divider-border);"
        >
            <div class="flex items-center gap-2">
                <Icon icon="mdi:chart-box-outline" class="size-4" style="color: var(--theme-accent-text);" />
                <span class="text-sm font-medium" style="color: var(--theme-modal-text);">数据分析</span>
            </div>
            <button
                onclick={handleClose}
                class="rounded p-0.5 transition-colors hover:opacity-70"
                style="color: var(--theme-modal-text); opacity: 0.4;"
            >
                <Icon icon="mdi:close" class="size-4" />
            </button>
        </div>

        <!-- Damage numbers -->
        <div class="px-6 py-4 border-b" style="border-color: var(--theme-divider-border);">
            <div class="grid grid-cols-4 gap-4">
                {#each charSummaries as cs, i}
                    {@const el = charElements[cs.character]}
                    {@const color = el ? ((ELEMENT_COLORS as Record<string, string>)[el] ?? '#6366f1') : '#6366f1'}
                    <div>
                        <div class="text-[10px] mb-1" style="color: {color};">{cs.character || '—'}</div>
                        <div class="text-xs tabular-nums" style="color: var(--theme-modal-text);">
                            {Math.round(cs.totalDamage).toLocaleString()}
                        </div>
                        <div class="text-[10px] tabular-nums" style="color: var(--theme-modal-text); opacity: 0.4;">
                            {((cs.totalDamage / totalDamage) * 100).toFixed(1)}%
                        </div>
                    </div>
                {/each}
                <div>
                    <div class="text-[10px] mb-1 font-semibold" style="color: var(--theme-accent-text);">总伤害</div>
                    <div class="text-xs tabular-nums font-bold" style="color: var(--theme-accent-text);">
                        {Math.round(totalDamage).toLocaleString()}
                    </div>
                    <div
                        class="text-[10px] tabular-nums font-semibold"
                        style="color: var(--theme-accent-text); opacity: 0.6;"
                    >
                        100%
                    </div>
                </div>
            </div>
        </div>

        <!-- Timing configuration -->
        <div class="px-6 py-4 border-b" style="border-color: var(--theme-divider-border);">
            <div class="text-xs font-medium mb-3" style="color: var(--theme-modal-text);">时间记点配置</div>
            {#if refLines.length === 0}
                <div class="text-[11px]" style="color: var(--theme-modal-text); opacity: 0.4;">暂无时间参考线</div>
            {:else}
                <div class="space-y-1.5">
                    {#each refLines as rl}
                        {@const isSelected = timings.some((t) => t.refLineId === rl.id)}
                        {@const selIdx = sortedTimings.findIndex((t) => t.refLineId === rl.id)}
                        {@const prevSeconds = selIdx > 0 ? sortedTimings[selIdx - 1].seconds : 0}
                        <div
                            class="flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer text-xs select-none transition-colors"
                            style="border-color: {isSelected
                                ? 'var(--theme-accent-bg)'
                                : 'var(--theme-divider-border)'}; background: {isSelected
                                ? 'color-mix(in srgb, var(--theme-accent-bg) 8%, transparent)'
                                : 'transparent'}; color: var(--theme-modal-text);"
                            onclick={() => toggleRefLine(rl.id)}
                            role="button"
                            tabindex="0"
                        >
                            <span class="w-16 truncate opacity-60">{rl.time || '—'}</span>
                            {#if isSelected}
                                <input
                                    type="number"
                                    value={timings.find((t) => t.refLineId === rl.id)?.seconds ?? 0}
                                    oninput={(e) => updateSeconds(rl.id, (e.target as HTMLInputElement).value)}
                                    min={prevSeconds}
                                    step="0.1"
                                    class="w-20 rounded border px-2 py-1 text-xs text-right tabular-nums outline-none"
                                    style="background: var(--theme-input-bg); border-color: var(--theme-divider-border); color: var(--theme-modal-text);"
                                    onclick={(e) => e.stopPropagation()}
                                />
                                <span class="text-[10px] opacity-40">秒</span>
                                <button
                                    onclick={(e) => {
                                        e.stopPropagation()
                                        setQuickSeconds(rl.id, 25)
                                    }}
                                    class="rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:opacity-80"
                                    style="background: var(--theme-accent-bg); color: white;">+25s</button
                                >
                                <button
                                    onclick={(e) => {
                                        e.stopPropagation()
                                        setQuickSeconds(rl.id, 30)
                                    }}
                                    class="rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:opacity-80"
                                    style="background: var(--theme-accent-bg); color: white;">+30s</button
                                >
                                {#if selIdx > 0}
                                    <span class="text-[10px]" style="color: var(--theme-accent-text); opacity: 0.6;"
                                        >(≥ {prevSeconds.toFixed(1)}s)</span
                                    >
                                {/if}
                            {/if}
                        </div>
                    {/each}
                </div>
            {/if}
        </div>

        <!-- DPS table -->
        <div class="px-6 py-4 border-b" style="border-color: var(--theme-divider-border);">
            <div class="text-xs font-medium mb-3" style="color: var(--theme-modal-text);">分段 DPS</div>
            {#if segments.length === 0}
                <div class="text-xs" style="color: var(--theme-modal-text); opacity: 0.4;">请先在上方选择时间记点</div>
            {:else}
                <div class="overflow-x-auto">
                    <table class="w-full text-xs">
                        <thead>
                            <tr style="color: var(--theme-modal-text); opacity: 0.5;">
                                <th class="text-left font-medium py-1.5 pr-2">时段</th>
                                <th class="text-right font-medium py-1.5 px-2">跨度</th>
                                <th class="text-right font-medium py-1.5 px-2">总伤</th>
                                <th class="text-right font-medium py-1.5 pl-2">总 DPS</th>
                                {#each team as slot}
                                    {#if slot.character}
                                        <th class="text-right font-medium py-1.5 pl-2">{slot.character}</th>
                                    {/if}
                                {/each}
                                <th class="text-right font-medium py-1.5 pl-2">其他</th>
                            </tr>
                        </thead>
                        <tbody>
                            {#each segments as seg}
                                {@const span = seg.endSeconds - seg.startSeconds}
                                <tr
                                    class="border-t"
                                    style="border-color: var(--theme-divider-border); color: var(--theme-modal-text);"
                                >
                                    <td class="py-1.5 pr-2 tabular-nums opacity-60">
                                        {seg.startSeconds.toFixed(1)}s — {seg.endSeconds.toFixed(1)}s
                                    </td>
                                    <td class="text-right py-1.5 px-2 tabular-nums">{span.toFixed(1)}s</td>
                                    <td class="text-right py-1.5 px-2 tabular-nums"
                                        >{Math.round(seg.totalDamage).toLocaleString()}</td
                                    >
                                    <td
                                        class="text-right py-1.5 pl-2 tabular-nums font-medium"
                                        style="color: var(--theme-accent-text);"
                                    >
                                        {Math.round(seg.totalDamage / span).toLocaleString()}
                                    </td>
                                    {#each team as slot}
                                        {#if slot.character}
                                            {@const cd = seg.charDamages[slot.character] ?? 0}
                                            <td class="text-right py-1.5 pl-2 tabular-nums">
                                                {cd > 0 ? Math.round(cd / span).toLocaleString() : '—'}
                                            </td>
                                        {/if}
                                    {/each}
                                    <td class="text-right py-1.5 pl-2 tabular-nums">
                                        {seg.otherDamage > 0
                                            ? Math.round(seg.otherDamage / span).toLocaleString()
                                            : '—'}
                                    </td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                </div>
            {/if}
        </div>

        <!-- Pie chart (at bottom) -->
        <div class="px-6 py-4">
            <div class="text-xs font-medium mb-3" style="color: var(--theme-modal-text);">伤害占比</div>
            <div class="flex items-center gap-6">
                <div class="shrink-0 w-48 h-48" bind:this={pieContainer}>
                    <canvas bind:this={pieCanvas}></canvas>
                </div>
                <div class="space-y-2">
                    {#each charSummaries as cs, i}
                        {@const el = charElements[cs.character]}
                        {@const baseColor = el
                            ? ((ELEMENT_COLORS as Record<string, string>)[el] ?? '#6366f1')
                            : '#6366f1'}
                        <div class="flex items-center gap-2 text-xs" style="color: var(--theme-modal-text);">
                            <span class="size-2.5 rounded-full shrink-0" style="background: {fadedColor(baseColor, i)};"
                            ></span>
                            <span class="tabular-nums">
                                {cs.character || '—'}
                                <span style="opacity: 0.5;">
                                    {Math.round(cs.totalDamage).toLocaleString()} ({(
                                        (cs.totalDamage / totalDamage) *
                                        100
                                    ).toFixed(1)}%)
                                </span>
                            </span>
                        </div>
                    {/each}
                </div>
            </div>
        </div>
    </div>
</div>
