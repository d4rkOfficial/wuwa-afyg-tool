<script lang="ts">
    import { fade } from 'svelte/transition'
    import { onMount } from 'svelte'
    import {
        buildDamageSegments,
        type CritDisplayMode,
        type DamageTraceCtx,
        type TracePart
    } from '$lib/calc/damage-trace'
    import type { ResultEntry } from '$lib/calc/result.types'
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {
        entry: ResultEntry
        ctx: DamageTraceCtx
        missed?: boolean
        /** @desc 该条目当前口径：expected 期望 / rig 凹暴 / noCrit 不暴（决定暴击段文案，不靠数值反推） */
        critMode?: CritDisplayMode
    }

    let { entry, ctx, missed = false, critMode = 'expected', class: className, style: styleProp }: Props = $props()

    let seg = $derived(buildDamageSegments(entry, ctx, missed, critMode))

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
            const extraParts = seg.extraRatioParts
            ratioParts.push(
                ...(extraParts.length > 0
                    ? extraParts
                    : ([
                          {
                              sourceType: 'panel',
                              source: 'Buff',
                              label: seg.ratioIncludesExtra ? '额外倍率（已含）' : '额外倍率',
                              value: seg.extraRatioPct,
                              unit: '%'
                          }
                      ] as TracePart[]))
            )
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

    interface TipAnchor {
        left: number
        top: number
        right: number
        bottom: number
    }
    let tip = $state<{ anchor: TipAnchor; chip: Chip } | null>(null)
    let pinned = $state(false)
    let closeTimer: ReturnType<typeof setTimeout> | null = null
    let rootEl = $state<HTMLElement | null>(null)
    let tipEl = $state<HTMLElement | null>(null)
    /** @desc 触发浮窗的 badge 元素：滚动时按它最新矩形重定位（fixed + 视口坐标，滚动后原锚点会失效） */
    let tipTrigger: HTMLElement | null = null
    /** @desc 浮窗实测尺寸：高度随来源条数变化，写死会导致翻上/翻下的位置算错 */
    let tipSize = $state({ w: 0, h: 0 })
    /** @desc 视口尺寸（resize 时更新），用于把浮窗 clamp 在窗口内 */
    let viewport = $state({
        w: typeof window !== 'undefined' ? window.innerWidth : 1400,
        h: typeof window !== 'undefined' ? window.innerHeight : 900
    })

    /** @desc 取触发 badge 的视口矩形作为锚点（真实左右/上下都记下来，定位时按浮窗实测尺寸算） */
    const rectOf = (el: HTMLElement): TipAnchor => {
        const r = el.getBoundingClientRect()
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    }

    function anchorAt(e: Event): TipAnchor {
        return rectOf(e.currentTarget as HTMLElement)
    }

    const TIP_MARGIN = 8
    const TIP_GAP = 8

    /**
     * @desc 浮窗 portal 到 document.body：祖先里只要有 backdrop-filter（data-sf 区域表面就是），
     *  position: fixed 就会「相对该祖先定位」并被其裁切，于是 left/top 用的是视口坐标却按祖先算 → 必然错位。
     *  挂到 body 后 fixed 才真正相对视口，下面的 clamp 才有意义。
     */
    const portal = (node: HTMLElement) => {
        document.body.appendChild(node)
        return { destroy: () => node.remove() }
    }

    /** @desc 浮窗定位：默认贴 badge 下方，下方放不下则弹到上方，最后整体 clamp 进视口（左右/上下都不越界） */
    const tipPos = $derived.by(() => {
        const t = tip
        if (!t) return { left: TIP_MARGIN, top: TIP_MARGIN }
        // 未测到尺寸前的兜底（首帧即会被实测值替换：浮窗宽 36rem，高度按常见内容估）
        const w = tipSize.w || 576
        const h = tipSize.h || 240
        const maxLeft = Math.max(TIP_MARGIN, viewport.w - w - TIP_MARGIN)
        const maxTop = Math.max(TIP_MARGIN, viewport.h - h - TIP_MARGIN)
        const left = Math.min(Math.max(TIP_MARGIN, t.anchor.left), maxLeft)
        const below = t.anchor.bottom + TIP_GAP
        const above = t.anchor.top - h - TIP_GAP
        const top =
            below <= maxTop ? below : above >= TIP_MARGIN ? above : Math.min(Math.max(TIP_MARGIN, below), maxTop)
        return { left, top }
    })

    /** @desc 浮窗尺寸测量：等 DOM 更新后量真实宽高（内容换了 chip 也会重测），位置由 tipPos 用实测值算 */
    $effect(() => {
        const chipId = tip?.chip.id
        const el = tipEl
        if (!el || !chipId) {
            tipSize = { w: 0, h: 0 }
            return
        }
        tipSize = { w: el.offsetWidth, h: el.offsetHeight }
    })

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
        tipTrigger = e.currentTarget as HTMLElement
        tip = { anchor: anchorAt(e), chip }
    }

    function scheduleClose() {
        if (pinned) return
        clearClose()
        closeTimer = setTimeout(() => {
            if (!pinned) {
                tip = null
                tipTrigger = null
            }
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
            tipTrigger = null
            return
        }
        pinned = true
        tipTrigger = e.currentTarget as HTMLElement
        tip = { anchor: anchorAt(e), chip }
    }

    function closeTip() {
        clearClose()
        pinned = false
        tip = null
        tipTrigger = null
    }

    /** @desc 滚动（含结果页/弹窗内部的滚动容器，故用捕获阶段）时：固定的浮窗不会跟着 badge 走，
     *  固定的就按最新矩形重定位、hover 预览的直接收起，避免浮窗「悬在原地」对不上来源 */
    onMount(() => {
        const onScroll = () => {
            if (!tip || !tipTrigger) return
            if (pinned) tip = { anchor: rectOf(tipTrigger), chip: tip.chip }
            else closeTip()
        }
        window.addEventListener('scroll', onScroll, true)
        return () => window.removeEventListener('scroll', onScroll, true)
    })
</script>

<svelte:window
    onresize={() => {
        viewport = { w: window.innerWidth, h: window.innerHeight }
    }}
    onmousedown={(e) => {
        // 浮窗已 portal 到 body，不再属于 rootEl，点它内部（滚动条、✕）不应视为「点外部」
        const t = e.target as Node
        if (tip && rootEl && !rootEl.contains(t) && !(tipEl && tipEl.contains(t))) closeTip()
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
                class="inline-flex cursor-help items-baseline gap-1 rounded-none border px-1.5 py-0.5 transition-all hover:opacity-75"
                style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-modal-bg) 30%, transparent);"
            >
                <span class="text-[10px] font-medium" style="color: var(--theme-modal-text); opacity: 0.4;"
                    >{c.label}</span
                >
                <span class="font-mono font-black tabular-nums" style="color: var(--theme-accent-text);">{c.value}</span
                >
            </button>
        {/each}
        <span class="select-none opacity-50">=</span>
        <span
            class="rounded-none px-1.5 py-0.5 font-mono text-[13px] font-black tabular-nums [text-shadow:0_0_3px_var(--theme-halo-color)]"
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
                <span style="color: var(--theme-accent-text); font-weight: 900;">0</span></span
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
            bind:this={tipEl}
            use:portal
            in:fade={{ duration: 100 }}
            role="tooltip"
            onpointerenter={clearClose}
            onpointerleave={scheduleClose}
            class="fixed z-100 w-[36rem] max-w-[85vw] overflow-hidden rounded-none border backdrop-blur-xl"
            style="left: {tipPos.left}px; top: {tipPos.top}px; background: color-mix(in srgb, var(--theme-modal-bg) 94%, transparent); border-color: var(--theme-divider-border);"
        >
            <div
                class="flex items-center justify-between gap-2 border-b px-3 py-1.5"
                style="border-color: var(--theme-divider-border);"
            >
                <span class="text-[11px] font-black" style="color: var(--theme-modal-text);">{tip.chip.label}</span>
                <span class="flex items-center gap-2">
                    <span class="font-mono text-[11px] font-black" style="color: var(--theme-accent-text);"
                        >{tip.chip.value}</span
                    >
                    <button
                        type="button"
                        onclick={(e) => {
                            e.stopPropagation()
                            closeTip()
                        }}
                        class="shrink-0 rounded-none text-[11px] leading-none transition-colors hover:opacity-70"
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
                        {#if p.note}
                            <span
                                class="ml-auto max-w-[9rem] truncate text-right text-[10px]"
                                style="color: var(--theme-accent-text); opacity: 0.85;"
                                title={p.note}
                            >
                                {p.note}
                            </span>
                        {:else}
                            <span class="ml-auto shrink-0 tabular-nums" style="color: var(--theme-accent-text);">
                                {partValue(p)}{#if p.contribution !== undefined && p.unit === 'mult'}
                                    <span style="opacity: 0.5;">（× {p.contribution.toFixed(3)}）</span>
                                {/if}
                            </span>
                        {/if}
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
