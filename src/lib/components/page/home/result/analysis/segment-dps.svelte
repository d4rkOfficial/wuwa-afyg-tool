<script lang="ts">
    /**
     * @desc 数据分析 → 时间记点 + 分段 DPS（Phase 5.3：自 `data-analysis-modal.svelte` 原样抽出，标记与行为未改）。
     *
     * 时间记点状态 `timings` 由外壳持有（标题栏/对比弹窗都要写回），本组件只渲染 + 回调；
     * `selectedRange` / `timingOpen` 是纯视图状态，用 `$bindable` 双向绑定以保持标记逐字不变。
     * 表头与表体的「角色列 × 效应列」两组 `{#each}` 各收敛为一个 snippet（`<th>` 与 `<td>` 内容不同，无法共用一个）。
     */
    import Icon from '@iconify/svelte'
    import { slide } from 'svelte/transition'
    import { MOTION_MS, slideParams } from '$lib/utils/motion'
    import { getModalClosePosition } from '$lib/data/interaction-prefs.svelte'
    import { openHelp } from '$lib/data/help.svelte'
    import { CARD_SURFACE_STYLE } from '$lib/calc/result.styles'
    import type { CharSlot } from '$lib/types/project'
    import type { RefLine } from '$lib/calc/timeline.types'
    import { joinStyle, mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'
    import type { DpsSegment, SegTotals, Timing } from './types'

    interface Props extends ComponentsProps {
        /** @desc 配队（含空位），表格角色列按此顺序 */
        team: [CharSlot, CharSlot, CharSlot]
        /** @desc 分段表的效应列：整段与分段口径的并集，按整段伤害降序 */
        effectColumns: string[]
        segments: DpsSegment[]
        segTotals: SegTotals
        segTotalDps: number
        /** @desc 总时长（秒） */
        totalDur: number
        /** @desc 全部时间记点（含「未填写」） */
        timings: Timing[]
        /** @desc 按参考线时间轴位置排序后的时间记点 */
        sortedTimings: Timing[]
        /** @desc 时间轴参考线（已排除 'left'） */
        refLines: RefLine[]
        /** @desc 生效的时段选择（'total' 或时段下标） */
        activeRange: 'total' | number
        /** @desc 原始时段选择（用户点击的行） */
        selectedRange: 'total' | number
        /** @desc 时间记点配置区是否展开 */
        timingOpen: boolean
        overallDps: number | null
        onToggleRefLine: (id: string) => void
        onUpdateSeconds: (id: string, raw: string) => void
        onPrevValidSeconds: (selIdx: number) => number
        onAutoConfigure: () => void
    }

    let {
        team,
        effectColumns,
        segments,
        segTotals,
        segTotalDps,
        totalDur,
        timings,
        sortedTimings,
        refLines,
        activeRange,
        selectedRange = $bindable(),
        timingOpen = $bindable(),
        overallDps,
        onToggleRefLine,
        onUpdateSeconds,
        onPrevValidSeconds,
        onAutoConfigure,
        class: className,
        style: styleProp
    }: Props = $props()

    // ── 时间记点规则帮助 ──
    const refLineHelpItems: { name: string; description: string; content: string }[] = [
        {
            name: '命名解析',
            description: '从名称中提取最像时间的片段',
            content:
                '数字紧邻单位（分/秒/帧、min/sec/m/s/f）即为时间片段，可在名称任意位置；多个片段取最后一个；裸数字仅独立片段（不与中文/字母紧贴，如「启动 60」=60s，「循环2」不算）才解析。混合单位如「1m30s50f」= 90.5 秒（1 秒 = 100 帧）。'
        },
        {
            name: '相对加算',
            description: '时间片段前紧邻 + 号 → 相对上一记点追加',
            content: '若时间片段前紧邻 + 号（如 +25s、启动+30s、启动 +30s），时间 = 上一记点 + 片段值。'
        },
        {
            name: '单调追加',
            description: '绝对时间早于上一记点 → 自动改为追加',
            content: '绝对时间若早于上一记点，自动按追加处理：时间 = 上一记点 + 片段值，保证各记点时间单调递增。'
        },
        {
            name: '结束线',
            description: '结束线默认 120s，不足则每次 +30s',
            content: '排轴末尾的「结束」线启用后默认 120s；若 ≤ 上一记点则每次 +30s，直至大于上一记点。'
        },
        {
            name: '未填写',
            description: '名称无时间片段 → 不参与分段，可手动填',
            content: '名称不含时间片段时，记点显示「未填写」、不计入 DPS 分段；可在输入框手动填秒数后参与。'
        },
        {
            name: '自动配置规则',
            description: '一键按参考线命名启用记点；解析不出的跳过',
            content:
                '点「自动配置」会从左到右启用参考线：名称能解析出时间的直接启用，解析不出的跳过（不打断后续参考线）。末尾的「结束」线按最后一条可解析参考线定：该线之后还有伤害 → 默认 120s，不足则每次 +30s；该线之后已无伤害 → 与它同一时刻（+0 帧），不额外拉长时间。所有参考线都解析不出时，「结束」回退 25s。'
        }
    ]
</script>

<!-- ── 时间记点 + 分段 DPS ── -->
<section class={mergeClass(['rounded-none border', className])} style={joinStyle([CARD_SURFACE_STYLE, styleProp])}>
    {#snippet dpsHeadCells()}
        {#each team as slot, i (i)}
            {#if slot.character}
                <th class="py-1.5 pl-2 text-right font-medium">{slot.character}</th>
            {/if}
        {/each}
        {#each effectColumns as label (label)}
            <th class="py-1.5 pl-2 text-right font-medium">{label}</th>
        {/each}
    {/snippet}

    {#snippet dpsCells(
        charDamages: Record<string, number>,
        effectDamages: Record<string, number>,
        divisor: number,
        cellClass: string
    )}
        {#each team as slot, i (i)}
            {#if slot.character}
                {@const cd = charDamages[slot.character] ?? 0}
                <td class={cellClass}>{cd > 0 ? Math.round(cd / divisor).toLocaleString() : '—'}</td>
            {/if}
        {/each}
        {#each effectColumns as label (label)}
            {@const ed = effectDamages[label] ?? 0}
            <td class={cellClass}>{ed > 0 ? Math.round(ed / divisor).toLocaleString() : '—'}</td>
        {/each}
    {/snippet}

    <div
        class="flex flex-wrap items-center gap-2 border-b px-4 py-3"
        style="border-color: var(--theme-divider-border);"
    >
        <div class="flex items-center gap-2">
            <Icon icon="mdi:chart-timeline-variant" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            <h3 class="text-base font-black tracking-tight" style="color: var(--theme-modal-text);">分段 DPS</h3>
            <button
                onclick={() => openHelp('时间记点规则', refLineHelpItems)}
                class="flex h-5 w-5 items-center justify-center rounded-none text-xs font-black transition-colors hover:bg-(--theme-modal-text)/10"
                style="color: var(--theme-accent-text);"
                title="时间参考线命名解析与限制规则"
            >
                ?
            </button>
            {#if overallDps}
                <span
                    class="rounded-none border px-2 py-0.5 text-[10px] font-black tabular-nums"
                    style="background: color-mix(in srgb, var(--theme-accent-bg) 16%, transparent); color: var(--theme-accent-text); border-color: var(--theme-divider-border);"
                >
                    总 DPS {Math.round(overallDps).toLocaleString()}
                </span>
            {/if}
        </div>
        <div class="{getModalClosePosition() === 'top-left' ? '' : 'ml-auto '}flex items-center gap-2">
            <button
                onclick={onAutoConfigure}
                class="flex cursor-pointer items-center gap-1.5 rounded-none border px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:opacity-80"
                style="border-color: var(--theme-divider-border); color: var(--theme-modal-text);"
                title="按参考线命名自动启用时间记点：能解析出时间的全部启用；遇到解析不出的收尾到「结束」（25s）"
            >
                <Icon icon="mdi:auto-fix" class="size-3.5" />
                <span>自动配置</span>
            </button>
            <button
                onclick={() => (timingOpen = !timingOpen)}
                class="flex cursor-pointer items-center gap-1.5 rounded-none border px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:opacity-80"
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
            <div transition:slide|local={slideParams(MOTION_MS.base)}>
                {#if refLines.length === 0}
                    <div class="text-[11px]" style="color: var(--theme-modal-text); opacity: 0.4;">
                        暂无时间参考线，请先在时间轴添加参考线
                    </div>
                {:else}
                    <div class="flex flex-wrap gap-2">
                        {#each refLines as rl (rl.id)}
                            {@const isSelected = timings.some((t) => t.refLineId === rl.id)}
                            {@const selIdx = sortedTimings.findIndex((t) => t.refLineId === rl.id)}
                            {@const timing = timings.find((t) => t.refLineId === rl.id)}
                            {@const prevV = onPrevValidSeconds(selIdx)}
                            <div
                                data-press=""
                                class="flex items-center gap-1.5 rounded-none border px-2.5 py-1.5 text-xs select-none transition-colors"
                                style="border-color: {isSelected
                                    ? 'var(--theme-accent-bg)'
                                    : 'var(--theme-divider-border)'}; background: {isSelected
                                    ? 'color-mix(in srgb, var(--theme-accent-bg) 8%, transparent)'
                                    : 'transparent'}; color: var(--theme-modal-text);"
                                onclick={() => onToggleRefLine(rl.id)}
                                role="button"
                                tabindex="0"
                            >
                                <span class="truncate opacity-60">{rl.time || '—'}</span>
                                {#if isSelected}
                                    <input
                                        type="number"
                                        value={timing?.seconds ?? ''}
                                        placeholder="未填"
                                        oninput={(e) => onUpdateSeconds(rl.id, (e.target as HTMLInputElement).value)}
                                        min={prevV}
                                        step="0.1"
                                        class="w-16 rounded-none border px-1.5 py-0.5 text-right text-[11px] tabular-nums outline-none"
                                        style="background: var(--theme-input-bg); border-color: var(--theme-divider-border); color: var(--theme-modal-text);"
                                        onclick={(e) => e.stopPropagation()}
                                    />
                                    <span class="text-[10px] opacity-40">秒</span>
                                    {#if timing?.seconds === null}
                                        <span class="text-[10px] whitespace-nowrap text-red-500">未填写</span>
                                    {/if}
                                    {#if selIdx > 0 && prevV > 0}
                                        <span class="text-[10px]" style="color: var(--theme-accent-text); opacity: 0.6;"
                                            >(≥ {prevV.toFixed(1)}s)</span
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
                        {@render dpsHeadCells()}
                    </tr>
                </thead>
                <tbody>
                    {#each segments as seg, si (si)}
                        {@const span = seg.endSeconds - seg.startSeconds}
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <tr
                            class="cursor-pointer border-t transition-colors"
                            data-press="row"
                            style="border-color: var(--theme-divider-border); color: var(--theme-modal-text); background: {activeRange ===
                            si
                                ? 'color-mix(in srgb, var(--theme-accent-bg) 8%, transparent)'
                                : 'transparent'};"
                            onclick={() => (selectedRange = si)}
                            role="button"
                            tabindex="0"
                            title="点击后上方 KPI 按该时段呈现"
                        >
                            <td class="py-2 pr-2 text-[10px] tabular-nums" style="opacity: 0.45;">
                                {seg.startSeconds.toFixed(1)}s — {seg.endSeconds.toFixed(1)}s
                            </td>
                            <td class="px-2 py-2 text-right text-[10px] tabular-nums" style="opacity: 0.45;">
                                {span.toFixed(1)}s
                            </td>
                            <td class="px-2 py-2 text-right tabular-nums"
                                >{Math.round(seg.totalDamage).toLocaleString()}</td
                            >
                            <td
                                class="px-2 py-2 text-right text-sm font-black tabular-nums"
                                style="color: var(--theme-accent-text);"
                            >
                                {Math.round(seg.totalDamage / span).toLocaleString()}
                            </td>
                            {@render dpsCells(
                                seg.charDamages,
                                seg.effectDamages,
                                span,
                                'py-2 pl-2 text-right tabular-nums'
                            )}
                        </tr>
                    {/each}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <tr
                        class="cursor-pointer border-t transition-colors"
                        data-press="row"
                        style="border-color: var(--theme-divider-border); background: {activeRange === 'total'
                            ? 'color-mix(in srgb, var(--theme-accent-bg) 8%, transparent)'
                            : 'transparent'};"
                        onclick={() => (selectedRange = 'total')}
                        role="button"
                        tabindex="0"
                        title="点击后上方 KPI 按总计呈现"
                    >
                        <td
                            class="py-2 pr-2 text-[10px] font-black tracking-[0.22em]"
                            style="color: var(--theme-modal-text); opacity: 0.6;"
                            colspan="2">总计</td
                        >
                        <td class="px-2 py-2 text-right font-black tabular-nums" style="color: var(--theme-modal-text);"
                            >{Math.round(segTotals.total).toLocaleString()}</td
                        >
                        <td
                            class="px-2 py-2 text-right text-sm font-black tabular-nums"
                            style="color: var(--theme-accent-text);"
                        >
                            {Math.round(segTotalDps).toLocaleString()}
                        </td>
                        {@render dpsCells(
                            segTotals.perChar,
                            segTotals.effectDamages,
                            totalDur,
                            'py-2 pl-2 text-right font-medium tabular-nums'
                        )}
                    </tr>
                </tbody>
            </table>
        {/if}
    </div>
</section>
