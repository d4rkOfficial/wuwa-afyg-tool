<script lang="ts">
    import { getModalClosePosition } from '$lib/data/interaction-prefs.svelte'
    import { getCharElementMap, getCharIconMap, getRefLines, getOpBlocks } from '$lib/calc/timeline.store.svelte'
    import { resolveRefLineSeconds, autoConfigureTimings as autoConfigureTimingsPure } from '$lib/calc/ref-line-timing'
    import type { ResultEntry, CharSummary, CharSubstatAnalysis } from '$lib/calc/result.types'
    import type { CharSlot, ResultAnalysisData } from '$lib/types/project'
    import type { AlgorithmId, AlgorithmInfo } from '$lib/calc/substat-algorithms/types'
    import Icon from '@iconify/svelte'
    import { getActiveProject } from '$lib/data/project.svelte'
    import { openPanel } from '$lib/ai/panels.svelte'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import KpiOverview from './analysis/kpi-overview.svelte'
    import SegmentDps from './analysis/segment-dps.svelte'
    import DamageCurve from './analysis/damage-curve.svelte'
    import DamageShare from './analysis/damage-share.svelte'
    import SubstatContribution from './analysis/substat-contribution.svelte'
    import { cssVar, fadedColor } from './analysis/chart-utils'
    import type { CharCard, DpsSegment, EffectCard, RangeStats, SegTotals, ShareItem, Timing } from './analysis/types'

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
        comparisonEligible?: boolean
        comparisonReason?: string | null
        oncompare?: () => void
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
        comparisonEligible = false,
        comparisonReason = null,
        oncompare,
        onSelectAlgorithm,
        onUpdateResultAnalysis,
        onclose,
        class: className,
        style: styleProp
    }: Props = $props()

    let charElements = $derived(getCharElementMap())
    let charIcons = $derived(getCharIconMap())

    // ── 当前工程名（标题栏展示）──
    let projectName = $derived(getActiveProject()?.name ?? '未命名工程')

    // ── timing state ──
    let timings = $state<Timing[]>([])

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

    /** @desc 启用参考线作为时间记点时解析秒数（共享 $lib/calc/ref-line-timing） */

    function toggleRefLine(id: string) {
        if (timings.some((t) => t.refLineId === id)) {
            timings = timings.filter((t) => t.refLineId !== id)
        } else {
            timings = [...timings, { refLineId: id, seconds: resolveRefLineSeconds(id, refLines, timings) }]
        }
    }

    /** @desc 手动填秒数：空/非法/负数 → 未解析(null)；合法则作为覆盖值 */
    function updateSeconds(id: string, raw: string) {
        const val = parseFloat(raw)
        timings = timings.map((t) =>
            t.refLineId === id ? { ...t, seconds: raw.trim() !== '' && !isNaN(val) && val >= 0 ? val : null } : t
        )
    }

    // ── 自动配置时间记点 ──
    /** @desc 该时间轴位置之后是否还有伤害（决定「结束」用尾部 +50 帧还是 120s 起递增） */
    const hasDamageAfter = (pos: number) =>
        entries.some((e) => {
            const entryPos = blockPosMap.get(e.sourceTimelineBlockId)
            return entryPos !== undefined && entryPos > pos
        })

    /** @desc 自动配置：从左到右启用可解析出时间的参考线（解析不出的跳过），「结束」按尾部有无伤害两档收尾 */
    function autoConfigureTimings() {
        timings = autoConfigureTimingsPure(refLines, hasDamageAfter)
        timingOpen = true
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

    // 已填写秒数的记点（「未填写」记点不参与 DPS 分段/曲线）
    let validTimings = $derived(sortedTimings.filter((t) => t.seconds !== null))

    /** @desc 该记点之前的最近一个已填写秒数（供输入 min / 提示） */
    function prevValidSeconds(selIdx: number): number {
        if (selIdx <= 0) return 0
        for (let i = selIdx - 1; i >= 0; i--) {
            const s = sortedTimings[i].seconds
            if (s !== null) return s
        }
        return 0
    }

    // 总时长与总 DPS（强调 DPS）
    let totalDur = $derived(validTimings.length > 0 ? validTimings[validTimings.length - 1].seconds! : 0)
    let overallDps = $derived(totalDur > 0 ? totalDamage / totalDur : null)

    // ── 非配队条目（效应结算 / 处决 / 响应）按来源效应分流 ──
    interface EffectAgg {
        damages: Record<string, number>
        elements: Record<string, string>
        counts: Record<string, number>
    }

    /** @desc 非配队条目的展示名：效应结算 →「XX效应伤害」，处决/响应 →「XX伤害」 */
    const effectLabelOf = (e: ResultEntry) =>
        e.skillType === '效应结算' ? `${e.hitName}伤害` : `${e.hitName || e.displayName}伤害`

    const emptyEffectAgg = (): EffectAgg => ({ damages: {}, elements: {}, counts: {} })

    /** @desc 把一个非配队条目累加进分流聚合：同 label 合并，元素取首个非空值 */
    const addEffectEntry = (agg: EffectAgg, e: ResultEntry) => {
        const label = effectLabelOf(e)
        agg.damages[label] = (agg.damages[label] ?? 0) + e.totalDamage
        agg.counts[label] = (agg.counts[label] ?? 0) + 1
        if (!agg.elements[label]) agg.elements[label] = e.element
    }

    /** @desc 整段（总计口径）的非配队条目分流聚合 */
    let effectTotals = $derived.by(() => {
        const agg = emptyEffectAgg()
        for (const e of entries) {
            if (!team.some((s) => s.character === e.character)) addEffectEntry(agg, e)
        }
        return agg
    })

    // ── DPS segments ──
    let segments = $derived.by(() => {
        if (validTimings.length === 0) return []

        const result: DpsSegment[] = []

        let prevRefPos = 0
        let prevSeconds = 0
        for (const t of validTimings) {
            const rl = refLines.find((r) => r.id === t.refLineId)
            if (!rl) continue
            const span = t.seconds! - prevSeconds
            if (span <= 0) continue
            const currentRefPos = rl.pos
            const segEntries = entries.filter((e) => {
                const entryPos = blockPosMap.get(e.sourceTimelineBlockId)
                return entryPos !== undefined && entryPos >= prevRefPos && entryPos < currentRefPos
            })
            const totalDmg = segEntries.reduce((s, e) => s + e.totalDamage, 0)
            const charDmg: Record<string, number> = {}
            const charCounts: Record<string, number> = {}
            const effects = emptyEffectAgg()
            for (const e of segEntries) {
                if (team.some((s) => s.character === e.character)) {
                    charDmg[e.character] = (charDmg[e.character] ?? 0) + e.totalDamage
                    charCounts[e.character] = (charCounts[e.character] ?? 0) + 1
                } else {
                    addEffectEntry(effects, e)
                }
            }
            result.push({
                startSeconds: prevSeconds,
                endSeconds: t.seconds!,
                totalDamage: totalDmg,
                entryCount: segEntries.length,
                charDamages: charDmg,
                charCounts,
                effectDamages: effects.damages,
                effectElements: effects.elements,
                effectCounts: effects.counts
            })
            prevRefPos = currentRefPos
            prevSeconds = t.seconds!
        }

        return result
    })

    // ── 时段选择（含总计）：点行切换，上方 KPI 大卡片按选中范围呈现 ──
    /** @desc 'total' = 总计；数字 = 时段下标（默认总计） */
    let selectedRange = $state<'total' | number>('total')
    /** @desc 时段变化导致下标失效时回落总计 */
    let activeRange = $derived(
        typeof selectedRange === 'number' && selectedRange >= segments.length ? 'total' : selectedRange
    )

    /** @desc 选中范围标签 */
    let rangeLabel = $derived.by(() => {
        if (activeRange === 'total') return '总计'
        const seg = segments[activeRange]
        return seg ? `${seg.startSeconds.toFixed(1)}s — ${seg.endSeconds.toFixed(1)}s` : '总计'
    })

    /** @desc 选中范围统计：总计用整段数据，时段用该段数据（KPI 大卡片与合计行共用） */
    let rangeStats = $derived.by<RangeStats>(() => {
        if (activeRange === 'total') {
            const perChar: Record<string, { damage: number; count: number }> = {}
            for (const cs of charSummaries) {
                if (team.some((s) => s.character === cs.character)) {
                    perChar[cs.character] = { damage: cs.totalDamage, count: cs.entryCount }
                }
            }
            return {
                damage: totalDamage,
                entryCount: entries.length,
                perChar,
                effectDamages: effectTotals.damages,
                effectElements: effectTotals.elements,
                effectCounts: effectTotals.counts,
                span: totalDur,
                dps: overallDps ?? 0
            }
        }
        const seg = segments[activeRange]
        const perChar: Record<string, { damage: number; count: number }> = {}
        for (const [character, damage] of Object.entries(seg?.charDamages ?? {})) {
            perChar[character] = { damage, count: seg?.charCounts[character] ?? 0 }
        }
        const span = seg ? seg.endSeconds - seg.startSeconds : 0
        return {
            damage: seg?.totalDamage ?? 0,
            entryCount: seg?.entryCount ?? 0,
            perChar,
            effectDamages: seg?.effectDamages ?? {},
            effectElements: seg?.effectElements ?? {},
            effectCounts: seg?.effectCounts ?? {},
            span,
            dps: seg && span > 0 ? seg.totalDamage / span : 0
        }
    })

    // 分段合计（与表格内部一致）
    let segTotals: SegTotals = $derived.by(() => {
        const perChar: Record<string, number> = {}
        const effectDamages: Record<string, number> = {}
        let total = 0
        for (const seg of segments) {
            total += seg.totalDamage
            for (const [c, d] of Object.entries(seg.charDamages)) perChar[c] = (perChar[c] ?? 0) + d
            for (const [label, d] of Object.entries(seg.effectDamages))
                effectDamages[label] = (effectDamages[label] ?? 0) + d
        }
        return { perChar, effectDamages, total }
    })
    let segTotalDps = $derived(totalDur > 0 ? segTotals.total / totalDur : 0)

    /** @desc 分段表的效应列：整段与分段口径的并集，按整段伤害降序（保证各时段列序一致） */
    let effectColumns = $derived.by(() => {
        const labels = new Set([...Object.keys(effectTotals.damages), ...Object.keys(segTotals.effectDamages)])
        return [...labels].sort((a, b) => (effectTotals.damages[b] ?? 0) - (effectTotals.damages[a] ?? 0))
    })

    // ── 时间记点配置折叠 ──
    let timingOpen = $state(true)

    // ── 队伍出伤曲线 ──
    let curveEvents = $derived.by(() => {
        const withPos = entries
            .map((e) => ({ entry: e, pos: blockPosMap.get(e.sourceTimelineBlockId) }))
            .filter((x): x is { entry: ResultEntry; pos: number } => x.pos !== undefined)
            .sort((a, b) => a.pos - b.pos)
        const totalDur = validTimings.length > 0 ? validTimings[validTimings.length - 1].seconds! : 150

        const segs: { startPos: number; endPos: number; startSec: number; endSec: number }[] = []
        if (validTimings.length === 0) {
            segs.push({ startPos: -Infinity, endPos: Infinity, startSec: 0, endSec: totalDur })
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

    // ── KPI 大卡片：① 总伤害 ② 总 DPS ③ 角色伤害（降序）④ 效应伤害（永远最后，降序）──
    /** @desc 角色伤害卡片：配队角色按当前口径伤害降序（头像叠底、元素色上色） */
    let charCards: CharCard[] = $derived.by(() =>
        team
            .filter((s) => !!s.character)
            .map((s) => {
                const character = s.character as string
                const stat = rangeStats.perChar[character] ?? { damage: 0, count: 0 }
                return {
                    character,
                    damage: stat.damage,
                    count: stat.count,
                    element: charElements[character] ?? '',
                    icon: charIcons[character] ?? ''
                }
            })
            .sort((a, b) => b.damage - a.damage)
    )

    /** @desc 效应伤害卡片：非配队条目按来源效应分流，按当前口径伤害降序（元素色上色，无叠底图） */
    let effectCards: EffectCard[] = $derived.by(() =>
        Object.entries(rangeStats.effectDamages)
            .map(([label, damage]) => ({
                label,
                damage,
                count: rangeStats.effectCounts[label] ?? 0,
                element: rangeStats.effectElements[label] ?? ''
            }))
            .sort((a, b) => b.damage - a.damage)
    )

    /** @desc 伤害占比：配队角色在前、效应分流在后，各自按伤害降序；颜色为元素色 + 按贡献淡化 */
    let shareItems = $derived.by(() => {
        const items: ShareItem[] = []
        const charBase = (character: string) => {
            const el = charElements[character]
            return el ? cssVar(`--theme-element-${el}`, '#888') : '#888'
        }
        const elementBase = (element: string) => (element ? cssVar(`--theme-element-${element}`, '#888') : '#888')
        const charRows = charSummaries
            .filter((cs) => team.some((s) => s.character === cs.character))
            .sort((a, b) => b.totalDamage - a.totalDamage)
        charRows.forEach((cs, i) => {
            items.push({
                key: `char:${cs.character}`,
                label: cs.character,
                damage: cs.totalDamage,
                color: fadedColor(charBase(cs.character), i)
            })
        })
        const effectRows = Object.entries(effectTotals.damages).sort((a, b) => b[1] - a[1])
        effectRows.forEach(([label, damage], i) => {
            items.push({
                key: `effect:${label}`,
                label,
                damage,
                color: fadedColor(elementBase(effectTotals.elements[label] ?? ''), charRows.length + i)
            })
        })
        return items
    })
</script>

<Modal
    open={true}
    onclose={handleClose}
    noScroll
    class={mergeClass(['w-[min(1500px,96vw)]', className])}
    style={styleProp}
>
    {#snippet title()}
        <div class="flex items-center gap-2.5">
            <Icon icon="mdi:chart-box-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            <h2>数据分析</h2>
            <span
                class="hidden max-w-56 truncate rounded-none border px-2 py-0.5 text-[10px] tracking-[0.22em] md:inline-block"
                style="color: var(--theme-modal-text); opacity: 0.5; border-color: var(--theme-divider-border);"
                title={projectName}>{projectName}</span
            >
        </div>
        <div
            class="flex items-center gap-2 text-[11px] {getModalClosePosition() === 'top-left' ? '' : 'ml-auto'}"
            style="color: var(--theme-modal-text); opacity: 0.55;"
        >
            {#if totalDur > 0}
                <span class="tabular-nums tracking-[0.22em]">总时长 {totalDur.toFixed(1)}s</span>
                <span class="size-1 rounded-full" style="background: var(--theme-divider-border);"></span>
                <span class="flex items-center gap-1">
                    总 DPS
                    <span
                        class="text-sm font-black tabular-nums [text-shadow:0_0_3px_var(--theme-halo-color)]"
                        style="color: var(--theme-accent-text);"
                        >{overallDps ? Math.round(overallDps).toLocaleString() : '—'}</span
                    >
                </span>
            {:else}
                <span style="opacity: 0.6;">配置时间记点后显示 DPS</span>
            {/if}
        </div>
        <button
            onclick={() => {
                // 切换前先把局部 timings（含模式）写回，保证对比弹窗读到最新时间记点
                onUpdateResultAnalysis({
                    timings,
                    rigCritEntryIds,
                    noCritEntryIds,
                    missEntryIds: resultAnalysis?.missEntryIds ?? []
                })
                oncompare?.()
            }}
            disabled={!comparisonEligible}
            class="inline-flex items-center gap-1 rounded-none px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:opacity-70"
            style="color: var(--theme-accent-text);"
            title={comparisonEligible ? '共鸣链/武器精炼对比' : (comparisonReason ?? '本工程不支持对比')}
            aria-label="链/阶对比"
        >
            <Icon icon="mdi:compare-horizontal" class="size-4" />
            <span class="hidden md:inline">{comparisonEligible ? '对比' : '本工程不支持对比'}</span>
        </button>
        <button
            onclick={() => openPanel('character-detail', true)}
            class="rounded-none p-1 transition-colors hover:opacity-70"
            style="color: var(--theme-accent-text);"
            title="打开角色详情配置"
            aria-label="打开角色详情配置"
        >
            <Icon icon="mdi:account-details-outline" class="size-5" />
        </button>
    {/snippet}

    <!-- Scrollable body -->
    <div class="theme-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <!-- ── KPI 总览（口径随「分段 DPS」里选中的时段切换，默认总计）── -->
        <KpiOverview {rangeLabel} {rangeStats} {charCards} {effectCards} />

        <!-- ── 时间记点 + 分段 DPS ── -->
        <SegmentDps
            {team}
            {effectColumns}
            {segments}
            {segTotals}
            {segTotalDps}
            {totalDur}
            {timings}
            {sortedTimings}
            {refLines}
            {activeRange}
            bind:selectedRange
            bind:timingOpen
            {overallDps}
            onToggleRefLine={toggleRefLine}
            onUpdateSeconds={updateSeconds}
            onPrevValidSeconds={prevValidSeconds}
            onAutoConfigure={autoConfigureTimings}
        />

        <!-- ── 队伍出伤曲线 ── -->
        <DamageCurve events={curveEvents} {validTimings} {rigCritEntryIds} {noCritEntryIds} />

        <!-- ── 伤害占比：队伍 + 角色直伤类型 ── -->
        <DamageShare {entries} {shareItems} {totalDamage} {charElements} />

        <!-- ── 声骸词条贡献分析（三角色并排，不切换视图） ── -->
        <SubstatContribution
            {substatAnalysis}
            {algorithmsInfo}
            {selectedAlgorithm}
            {analysisComputing}
            {onSelectAlgorithm}
        />
    </div>
</Modal>
