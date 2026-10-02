<script lang="ts">
    import Icon from '@iconify/svelte'
    import { slide } from 'svelte/transition'
    import { MOTION_MS, slideParams } from '$lib/utils/motion'
    import type { ComponentsProps } from '$lib/types'
    import {
        describeTurnPhase,
        getContextSegments,
        getLastTurnSummary,
        getSessionUsage,
        getTurnRuntime,
        getTurnUsage,
        resetDisabledSegments,
        toggleSegmentDisabled
    } from '$lib/ai/turn-state.svelte'
    import { clearChanges, getChangeCount } from '$lib/ai/change-queue.svelte'
    import { addToast } from '$lib/data/toast.svelte'
    import {
        cacheHitRate,
        formatDuration,
        formatPercent,
        formatTokens,
        summarizeTurn,
        type UsageTotals
    } from '$lib/ai/token-usage'

    interface Props extends ComponentsProps {
        // 面板是否展开（入口按钮由助手头部控制；默认收起）
        open?: boolean
        onclose?: () => void
        // 清空对话历史（由助手宿主执行，面板不持有消息）
        onClearHistory?: () => void
    }

    let { open = false, onclose, onClearHistory, class: className, style: styleProp }: Props = $props()

    const segments = $derived(getContextSegments())
    const runtime = $derived(getTurnRuntime())
    const turnUsage = $derived(getTurnUsage())
    const sessionUsage = $derived(getSessionUsage())
    const summary = $derived(getLastTurnSummary())
    const changeCount = $derived(getChangeCount())

    // 分段合计：仅统计「启用且非空」的段（它们才会进本轮请求）
    const totalTokens = $derived(segments.filter((s) => s.enabled && !s.empty).reduce((sum, s) => sum + s.tokens, 0))
    const activeSegments = $derived(segments.filter((s) => s.enabled && !s.empty).length)
    const disabledSegments = $derived(segments.filter((s) => !s.enabled).length)

    interface UsageRow {
        label: string
        value: string
    }

    /** @desc usage 行（字段缺失显示「—」，不臆造；有估算回退时在标题处标注） */
    const usageRows = (usage: UsageTotals, requests: number): UsageRow[] => {
        if (requests === 0) return [{ label: 'usage', value: '—（尚未返回 usage）' }]
        const hit = usage.cacheHitTokens
        const miss = usage.cacheMissTokens
        const cacheDetail =
            hit === undefined
                ? '（服务商未提供）'
                : `（hit ${formatTokens(hit)}${miss === undefined ? '' : ` · miss ${formatTokens(miss)}`}）`
        return [
            { label: 'prompt', value: formatTokens(usage.promptTokens) },
            { label: 'completion', value: formatTokens(usage.completionTokens) },
            { label: '合计', value: formatTokens(usage.totalTokens) },
            { label: '缓存命中', value: `${formatPercent(cacheHitRate(usage))}${cacheDetail}` }
        ]
    }

    const phaseText = $derived(describeTurnPhase(runtime))

    const usageSource = (usage: UsageTotals, requests: number): string => {
        if (requests === 0) return '—'
        if (usage.estimatedRequests === 0) return '服务商 usage'
        if (usage.estimatedRequests >= requests) return '本地估算（服务商未提供）'
        return `服务商 usage + ${usage.estimatedRequests} 次本地估算`
    }

    const onClearChanges = () => {
        const count = changeCount
        clearChanges()
        addToast(count > 0 ? `已清空 ${count} 条待上报变化` : '变化队列本就是空的', 'info')
    }

    /**
     * @desc 面板展开 / 收起的高度过渡（`svelte/transition` 的 slide）。
     *  时长与减弱动态效果一律交给 `$lib/utils/motion.ts` 的 `slideParams`：
     *  `layout.css` 的 `prefers-reduced-motion` 只管 CSS 动画，管不到 JS 过渡，
     *  `slideParams` 内部已把 reduce 下的时长压到 1ms（保留过渡钩子，避免结构分支变化），
     *  故本组件不再自行订阅 `matchMedia`（原第 19 处实质硬编码时长已消除）。
     *  档位取 `MOTION_MS.base`（180ms）：`layout.css` 对该 token 的用途注释即「展开 / 收起」。
     */
</script>

{#if open}
    <div
        transition:slide|local={slideParams(MOTION_MS.base)}
        class="theme-scrollbar flex max-h-[52%] shrink-0 flex-col gap-2 overflow-y-auto border-b px-3 py-2.5 {className ||
            ''}"
        style="border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-input-bg) 55%, transparent); {styleProp ||
            ''}"
    >
        <!-- 用量（本轮 / 本会话累计） -->
        <div class="flex flex-col gap-1.5">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span class="flex items-center gap-1 text-[11px] font-black tracking-tight">
                    <Icon icon="mdi:chart-timeline-variant" class="size-3.5" style="color: var(--theme-accent-text);" />
                    用量
                </span>
                <span class="text-[10px] text-(--theme-modal-text)/40">本轮</span>
                <span class="min-w-0 flex-1 truncate text-[10px] text-(--theme-modal-text)/35">
                    {usageSource(turnUsage, turnUsage.requests)}
                </span>
            </div>
            <div class="flex flex-wrap gap-x-3 gap-y-1 tabular-nums">
                {#each usageRows(turnUsage, turnUsage.requests) as row (row.label)}
                    <span class="flex items-baseline gap-1 text-[10px]">
                        <span class="text-(--theme-modal-text)/40">{row.label}</span>
                        <span class="font-black break-all">{row.value}</span>
                    </span>
                {/each}
            </div>
            <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 tabular-nums">
                <span class="text-[10px] text-(--theme-modal-text)/40">
                    累计（本会话 {sessionUsage.turns} 轮 / {sessionUsage.requests} 请求）
                </span>
                {#each usageRows(sessionUsage, sessionUsage.requests) as row (row.label)}
                    <span class="flex items-baseline gap-1 text-[10px]">
                        <span class="text-(--theme-modal-text)/40">{row.label}</span>
                        <span class="break-all">{row.value}</span>
                    </span>
                {/each}
            </div>
        </div>

        <!-- 上下文分段 -->
        <div class="flex flex-col gap-1.5 border-t pt-2" style="border-color: var(--theme-divider-border);">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span class="flex items-center gap-1 text-[11px] font-black tracking-tight">
                    <Icon icon="mdi:layers-triple-outline" class="size-3.5" style="color: var(--theme-accent-text);" />
                    上下文分段
                </span>
                <span class="text-[10px] text-(--theme-modal-text)/40 tabular-nums">
                    合计 {formatTokens(totalTokens)} token（估算） · 启用 {activeSegments}/{segments.length}
                    {#if disabledSegments > 0}
                        · <span class="text-red-500/70">已禁用 {disabledSegments}（下一轮生效）</span>
                    {/if}
                </span>
                {#if disabledSegments > 0}
                    <button
                        onclick={resetDisabledSegments}
                        class="rounded-none border px-1.5 py-0.5 text-[10px] text-(--theme-modal-text)/50 transition-colors hover:text-(--theme-modal-text)"
                        style="border-color: var(--theme-divider-border);"
                    >
                        全部恢复
                    </button>
                {/if}
            </div>

            {#if segments.length === 0}
                <div class="py-2 text-[10px] text-(--theme-modal-text)/35">
                    还没有发过请求：分段快照在发送时生成（面板展示的是最近一轮「实际注入」的内容与估算； 禁用 /
                    恢复在下一轮请求生效）。
                </div>
            {:else}
                <div class="flex flex-col gap-1">
                    {#each segments as seg (seg.id)}
                        <div
                            class="flex items-center gap-1.5 rounded-none border-l-2 py-0.5 pl-1.5 {seg.enabled
                                ? ''
                                : 'opacity-45'}"
                            style="border-color: {seg.enabled ? 'transparent' : 'rgb(239 68 68 / 0.6)'};"
                            title={seg.text ? seg.text.slice(0, 400) : '该段本轮无内容'}
                        >
                            <input
                                type="checkbox"
                                checked={seg.enabled}
                                onchange={() => toggleSegmentDisabled(seg.id)}
                                class="size-3 shrink-0 cursor-pointer accent-(--theme-accent-bg)"
                                title={seg.enabled ? '临时禁用该段（仅本会话影响，不写入设置）' : '恢复该段'}
                            />
                            <span class="shrink-0 text-[10px] {seg.enabled ? 'font-black' : 'font-black line-through'}">
                                {seg.label}
                            </span>
                            {#if seg.empty}
                                <span class="shrink-0 text-[10px] text-(--theme-modal-text)/30">无内容</span>
                            {:else if !seg.enabled}
                                <span class="shrink-0 text-[10px] text-red-500/70">已禁用</span>
                            {/if}
                            <span class="min-w-0 flex-1"></span>
                            <span class="shrink-0 text-[10px] text-(--theme-modal-text)/40 tabular-nums">
                                {seg.charCount} 字符 · ≈{formatTokens(seg.tokens)} · {Math.round(seg.ratio * 100)}%
                            </span>
                            <span
                                class="h-[3px] w-10 shrink-0 overflow-hidden rounded-none"
                                style="background: color-mix(in srgb, var(--theme-modal-text) 12%, transparent);"
                            >
                                <span
                                    class="block h-full"
                                    style="width: {Math.round(seg.ratio * 100)}%; background: {seg.enabled
                                        ? 'var(--theme-accent-bg)'
                                        : 'var(--theme-modal-text)'};"
                                ></span>
                            </span>
                        </div>
                    {/each}
                </div>
            {/if}
        </div>

        <!-- 实时运行情况 -->
        <div class="flex flex-col gap-1.5 border-t pt-2" style="border-color: var(--theme-divider-border);">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span class="flex items-center gap-1 text-[11px] font-black tracking-tight">
                    <Icon icon="mdi:speedometer" class="size-3.5" style="color: var(--theme-accent-text);" />
                    运行情况
                </span>
                <span class="flex items-center gap-1 text-[10px] tabular-nums">
                    <span
                        class="inline-block size-1.5 shrink-0 rounded-full"
                        style="background: {runtime.running
                            ? 'var(--theme-accent-bg)'
                            : 'currentColor'}; opacity: {runtime.running ? 1 : 0.3};"
                    ></span>
                    {phaseText}
                </span>
                <span class="text-[10px] text-(--theme-modal-text)/40 tabular-nums">
                    {runtime.running ? `已耗时 ${formatDuration(runtime.elapsedMs)}` : ''}
                </span>
            </div>

            {#if summary && !runtime.running}
                <div class="text-[10px] break-words text-(--theme-modal-text)/50 tabular-nums">
                    {summarizeTurn(summary)}
                </div>
            {/if}

            {#if runtime.toolCalls.length > 0}
                <div class="flex flex-col gap-0.5">
                    {#each runtime.toolCalls as call, i (i)}
                        <div class="flex items-center gap-1.5 text-[10px]">
                            <Icon
                                icon={call.ok === false
                                    ? 'mdi:close-circle-outline'
                                    : call.ok === undefined
                                      ? 'mdi:loading'
                                      : 'mdi:check-circle'}
                                class="size-3 shrink-0"
                                style="color: {call.ok === false ? 'rgb(239 68 68)' : 'var(--theme-accent-text)'};"
                            />
                            <span class="shrink-0 font-black">{call.name}</span>
                            <span class="shrink-0 text-(--theme-modal-text)/40 tabular-nums">
                                {call.durationMs === undefined ? '执行中…' : formatDuration(call.durationMs)}
                            </span>
                            {#if call.summary}
                                <span class="min-w-0 flex-1 truncate text-(--theme-modal-text)/40">{call.summary}</span>
                            {/if}
                        </div>
                    {/each}
                </div>
            {/if}
        </div>

        <!-- 操作 -->
        <div class="flex flex-wrap gap-1.5 border-t pt-2" style="border-color: var(--theme-divider-border);">
            <button
                onclick={() => onClearHistory?.()}
                class="flex items-center gap-1 rounded-none border px-2 py-1 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                style="border-color: var(--theme-divider-border);"
                title="清空对话历史与本会话用量累计"
            >
                <Icon icon="mdi:broom" class="size-3" />
                清空对话历史
            </button>
            <button
                onclick={onClearChanges}
                class="flex items-center gap-1 rounded-none border px-2 py-1 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                style="border-color: var(--theme-divider-border);"
                title="丢弃队列里待上报的工程变化（已注入的历史消息不回退）"
            >
                <Icon icon="mdi:delete-sweep-outline" class="size-3" />
                清空变化队列（待上报 {changeCount}）
            </button>
            {#if onclose}
                <span class="min-w-0 flex-1"></span>
                <button
                    onclick={() => onclose?.()}
                    class="flex items-center gap-1 rounded-none border px-2 py-1 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                    style="border-color: var(--theme-divider-border);"
                    title="收起面板"
                >
                    <Icon icon="mdi:chevron-up" class="size-3" />
                    收起
                </button>
            {/if}
        </div>
    </div>
{/if}
