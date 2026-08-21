<script lang="ts">
    import { fade } from 'svelte/transition'
    import { buildDamageSegments, type DamageTraceCtx, type TracePart } from '$lib/calc/damage-trace'
    import type { ResultEntry } from '$lib/calc/result.types'
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {
        entry: ResultEntry
        ctx: DamageTraceCtx
        missed?: boolean
    }

    let { entry, ctx, missed = false, class: className, style: styleProp }: Props = $props()

    let seg = $derived(buildDamageSegments(entry, ctx, missed))

    const fmt = (n: number, d = 1) => n.toLocaleString(undefined, { maximumFractionDigits: d })
    const fmtMult = (n: number) => n.toFixed(4)

    const SRC_COLOR: Record<TracePart['sourceType'], string> = {
        base: '#9aa3ad',
        weapon: '#e0a458',
        echo: '#86b8a0',
        buff: 'var(--theme-accent-text)',
        enemy: '#d18a8a',
        panel: 'var(--theme-modal-text)'
    }

    function partValue(p: TracePart): string {
        if (p.unit === '%') return fmt(p.value) + '%'
        if (p.unit === 'mult') return '× ' + p.value.toFixed(3)
        return fmt(p.value)
    }

    /** @desc 计算链上的一个单项式：数值 + 来源（hover 浮窗展示） */
    interface Chip {
        id: string
        label: string
        value: string
        parts: TracePart[]
        detail?: string
    }

    /** @desc 完整计算过程的多项式链：面板/系数 × 每段倍率 [× 段数] × 各区 = 期望 */
    let chips = $derived.by<Chip[]>(() => {
        const list: Chip[] = []
        // 系数基类（偏谐/效应等）显示「系数」badge，面板基类显示「面板」
        if (seg.isCoeff) {
            list.push({
                id: 'coeff',
                label: '系数',
                value: fmt(seg.totalStat),
                parts: seg.baseParts,
                detail: `${seg.baseLabel} ${fmt(seg.totalStat)}`
            })
        } else {
            list.push({
                id: 'stat',
                label: '面板',
                value: fmt(seg.totalStat),
                parts: seg.baseParts,
                detail: `白值 ${fmt(seg.baseWhite)} + 绿值 ${fmt(seg.baseGreen)} = ${fmt(seg.totalStat)}`
            })
        }
        // 倍率：系数类 ratioNum 已含额外倍率，不再重复加
        const ratioPct = seg.ratioIncludesExtra ? seg.ratioPct : seg.ratioPct + seg.extraRatioPct
        const ratioParts: TracePart[] = [
            {
                sourceType: 'panel',
                source: '技能',
                label: seg.ratioIncludesExtra ? '每段有效倍率' : '基础每段倍率',
                value: seg.ratioPct,
                unit: '%'
            }
        ]
        if (seg.extraRatioPct > 0) {
            ratioParts.push({
                sourceType: 'panel',
                source: 'Buff',
                label: seg.ratioIncludesExtra ? '额外倍率（已含）' : '额外倍率',
                value: seg.extraRatioPct,
                unit: '%'
            })
        }
        const ratioDetail = seg.ratioIncludesExtra
            ? `每段倍率 ${fmt(ratioPct, 2)}%${seg.extraRatioPct > 0 ? `（含额外倍率 ${fmt(seg.extraRatioPct)}%）` : ''}`
            : `每段倍率 ${fmt(ratioPct, 2)}%（基础 ${fmt(seg.ratioPct, 2)}%${seg.extraRatioPct > 0 ? ` + 额外 ${fmt(seg.extraRatioPct)}%` : ''}）`
        list.push({ id: 'ratio', label: '倍率', value: `${fmt(ratioPct, 2)}%`, parts: ratioParts, detail: ratioDetail })
        if (seg.hits > 1) {
            list.push({
                id: 'hits',
                label: '段数',
                value: `${seg.hits}段`,
                parts: [{ sourceType: 'panel', source: '技能', label: '段数', value: seg.hits, unit: 'flat' }],
                detail: '技能多段攻击（排轴配置）'
            })
        }
        for (const s of seg.segments) {
            // 值恰为 1 的乘区（如效应伤害的增伤/易伤/集谐区）无实际作用，不在链上展示
            if (Math.abs(s.value - 1) < 1e-9) continue
            list.push({
                id: s.id,
                label: s.label,
                value: s.id === 'miss' ? '0' : fmtMult(s.value),
                parts: s.parts,
                detail: s.detail
            })
        }
        return list
    })

    let tip = $state<{ left: number; top: number; chip: Chip } | null>(null)
    let pinned = $state(false)
    let closeTimer: ReturnType<typeof setTimeout> | null = null
    let rootEl = $state<HTMLElement | null>(null)

    /** @desc 定位浮窗：默认贴在 badge 下方，空间不足则弹到上方，避让视口边缘 */
    function posAt(e: Event, chip: Chip): { left: number; top: number } {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const w = typeof window !== 'undefined' ? window.innerWidth : 1400
        const h = typeof window !== 'undefined' ? window.innerHeight : 900
        const left = Math.max(8, Math.min(r.left, w - 330))
        const top = r.bottom + 8 <= h - 80 ? r.bottom + 8 : Math.max(8, r.top - 280)
        return { left, top }
    }

    function clearClose() {
        if (closeTimer) {
            clearTimeout(closeTimer)
            closeTimer = null
        }
    }

    /** @desc hover：预览模式（未固定），鼠标移开（含移向浮窗的宽限期）后关闭 */
    function openHover(e: Event, chip: Chip) {
        clearClose()
        pinned = false
        tip = { ...posAt(e, chip), chip }
    }

    function scheduleClose() {
        if (pinned) return
        clearClose()
        closeTimer = setTimeout(() => {
            if (!pinned) tip = null
            closeTimer = null
        }, 180)
    }

    /** @desc click：固定（常开），再点同一 badge 收起；点其它 badge 切到并固定该 badge */
    function togglePin(e: Event, chip: Chip) {
        e.stopPropagation()
        clearClose()
        if (pinned && tip?.chip.id === chip.id) {
            pinned = false
            tip = null
            return
        }
        pinned = true
        tip = { ...posAt(e, chip), chip }
    }

    function closeTip() {
        clearClose()
        pinned = false
        tip = null
    }
</script>

<svelte:window
    onmousedown={(e) => {
        if (tip && rootEl && !rootEl.contains(e.target as Node)) closeTip()
    }}
    onkeydown={(e) => {
        if (e.key === 'Escape') closeTip()
    }}
/>

<div bind:this={rootEl} class="space-y-2 text-xs {className}" style={styleProp || ''}>
    <!-- 计算过程多项式链：每个单项式可 hover/click 查看来源（hover 预览，click 固定常开） -->
    <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
        {#each chips as c, i}
            {#if i > 0}
                <span class="select-none opacity-50">×</span>
            {/if}
            <button
                type="button"
                onclick={(e) => togglePin(e, c)}
                onpointerenter={(e) => openHover(e, c)}
                onpointerleave={scheduleClose}
                onfocus={(e) => openHover(e, c)}
                onblur={() => {
                    if (!pinned) tip = null
                }}
                class="inline-flex cursor-help items-baseline gap-1 rounded-md border px-1.5 py-0.5 transition-all hover:opacity-75 hover:shadow-md"
                style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-bg) 30%, transparent);"
            >
                <span class="text-[10px] font-medium" style="color: var(--theme-modal-text); opacity: 0.55;"
                    >{c.label}</span
                >
                <span class="font-mono tabular-nums" style="color: var(--theme-accent-text);">{c.value}</span>
            </button>
        {/each}
        <span class="select-none opacity-50">=</span>
        <span
            class="rounded-md px-1.5 py-0.5 font-mono text-[13px] font-bold tabular-nums"
            style="color: var(--theme-accent-text);"
        >
            {fmt(seg.expected)}
        </span>
    </div>

    <!-- 汇总：每段/不暴击/暴击/未命中 -->
    <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]" style="color: var(--theme-modal-text);">
        {#if missed}
            <span class="tabular-nums"
                ><span style="color: var(--theme-rigcrit-from);">未命中</span> 每段期望
                <span style="text-decoration: line-through; opacity: 0.6;">{fmt(seg.perHit)}</span> →
                <span style="color: var(--theme-accent-text); font-weight: 600;">0</span></span
            >
        {:else}
            <span class="tabular-nums"
                >每段期望 <span style="color: var(--theme-accent-text);">{fmt(seg.perHit)}</span></span
            >
        {/if}
        {#if seg.canCrit}
            <span class="tabular-nums"
                >不暴击 <span style="color: var(--theme-nocrit-from);">{fmt(seg.nonCrit)}</span></span
            >
            <span class="tabular-nums">暴击 <span style="color: var(--theme-rigcrit-from);">{fmt(seg.crit)}</span></span
            >
        {/if}
    </div>

    <!-- 来源浮窗 -->
    {#if tip}
        <div
            in:fade={{ duration: 100 }}
            role="tooltip"
            onpointerenter={clearClose}
            onpointerleave={scheduleClose}
            class="fixed z-100 w-72 max-w-[85vw] overflow-hidden rounded-lg border shadow-2xl backdrop-blur-xl"
            style="left: {tip.left}px; top: {tip.top}px; background: color-mix(in srgb, var(--theme-modal-bg) 94%, transparent); border-color: var(--theme-divider-border);"
        >
            <div
                class="flex items-center justify-between gap-2 border-b px-3 py-1.5"
                style="border-color: var(--theme-divider-border);"
            >
                <span class="text-[11px] font-semibold" style="color: var(--theme-modal-text);">{tip.chip.label}</span>
                <span class="flex items-center gap-2">
                    <span class="font-mono text-[11px]" style="color: var(--theme-accent-text);">{tip.chip.value}</span>
                    <button
                        type="button"
                        onclick={(e) => {
                            e.stopPropagation()
                            closeTip()
                        }}
                        class="shrink-0 rounded text-[11px] leading-none transition-colors hover:opacity-70"
                        style="color: var(--theme-modal-text); opacity: 0.5;"
                        aria-label="收起来源"
                    >
                        ✕
                    </button>
                </span>
            </div>
            <div class="theme-scrollbar max-h-56 space-y-1 overflow-y-auto px-3 py-2">
                {#each tip.chip.parts as p}
                    <div class="flex items-center gap-1.5">
                        <span class="size-2 shrink-0 rounded-full" style="background: {SRC_COLOR[p.sourceType]};"
                        ></span>
                        <span class="truncate" style="color: var(--theme-modal-text);">{p.source}</span>
                        <span class="shrink-0" style="opacity: 0.5;">{p.label}</span>
                        <span class="ml-auto shrink-0 tabular-nums" style="color: var(--theme-accent-text);">
                            {partValue(p)}{#if p.contribution !== undefined && p.unit === 'mult'}
                                <span style="opacity: 0.5;">（× {p.contribution.toFixed(3)}）</span>
                            {/if}
                        </span>
                    </div>
                {/each}
                {#if !tip.chip.parts.length}
                    <div class="text-[10px]" style="opacity: 0.5;">无细分来源</div>
                {/if}
            </div>
            {#if tip.chip.detail}
                <div
                    class="border-t px-3 py-1.5 text-[10px]"
                    style="border-color: var(--theme-divider-border); color: var(--theme-modal-text); opacity: 0.6;"
                >
                    {tip.chip.detail}
                </div>
            {/if}
        </div>
    {/if}
</div>
