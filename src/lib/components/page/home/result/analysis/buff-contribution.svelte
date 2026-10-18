<script lang="ts">
    /**
     * @desc 数据分析 → Buff 贡献（单角色视图）。
     *
     * 算法：把该 Buff 从「这个角色伤害条目」的绑定里拿掉，重算该角色总伤，损失量即贡献。
     * 逐条损失**不可相加**（多条 Buff 乘算叠加，1+1 ≠ 2），因此表头另给「移除全部 Buff」的总贡献，
     * 这一点在帮助弹窗与副标题里都写清楚，避免用户拿两种数互相校验。
     *
     * 版面：高度跟随左栏（副词条贡献）并由调用方传入，列表在内部滚动 —— 不做展开/收起。
     */
    import Icon from '@iconify/svelte'
    import { openHelp } from '$lib/data/help.svelte'
    import { BUFF_ALGORITHM_HELP } from '$lib/calc/result.consts'
    import { CARD_SURFACE_STYLE, SECTION_LABEL, STAT_VALUE_SM } from '$lib/calc/result.styles'
    import type { BuffContribution, CharBuffAnalysis } from '$lib/calc/result.types'
    import Chip from '$lib/components/ui/chip.svelte'
    import { joinStyle, mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {
        /** @desc 该角色的 Buff 贡献分析结果（undefined = 尚未算出） */
        analysis: CharBuffAnalysis | undefined
        computing: boolean
        /** @desc 与左栏（副词条贡献）等高的目标高度（px）；0 = 尚未测量，按内容自然高度 */
        height?: number
    }

    let { analysis, computing, height = 0, class: className, style: styleProp }: Props = $props()

    const RIG_GRAD_TEXT =
        'background: var(--theme-rigcrit-grad); -webkit-background-clip: text; background-clip: text; color: transparent;'
    const NOCRIT_GRAD_TEXT =
        'background: var(--theme-nocrit-grad); -webkit-background-clip: text; background-clip: text; color: transparent;'

    const helpItems = [{ ...BUFF_ALGORITHM_HELP }]

    let buffs = $derived(analysis?.buffs ?? [])
    /** @desc 条形长度基准：最长的那条 Buff（相对长度比「占角色总伤」更易分辨） */
    let maxContribution = $derived(buffs.reduce((m, b) => Math.max(m, b.contributionNorm), 0))

    const barWidth = (b: BuffContribution): number =>
        maxContribution > 0 ? Math.max(2, (b.contributionNorm / maxContribution) * 100) : 0

    const fmt = (n: number) => Math.round(n).toLocaleString()
</script>

<section
    class={mergeClass(['flex min-w-0 flex-col rounded-none border', className])}
    style={joinStyle([CARD_SURFACE_STYLE, styleProp, height > 0 ? `height: ${height}px` : ''])}
>
    <div
        class="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-3"
        style="border-color: var(--theme-divider-border);"
    >
        <div class="flex items-center gap-2">
            <Icon icon="mdi:flash-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            <h3 class="text-sm font-black tracking-tight" style="color: var(--theme-modal-text);">Buff 贡献</h3>
            <button
                onclick={() => openHelp('Buff 贡献怎么算', helpItems)}
                class="flex h-5 w-5 items-center justify-center rounded-none text-xs font-black transition-colors hover:bg-(--theme-modal-text)/10"
                style="color: var(--theme-accent-text);"
                title="Buff 贡献怎么算"
            >
                ?
            </button>
        </div>
        <span class="text-[10px]" style="color: var(--theme-modal-text); opacity: 0.45;">按移除损失计算</span>
        {#if computing}
            <span class="ml-auto text-[10px]" style="color: var(--theme-accent-text); opacity: 0.6;">计算中…</span>
        {:else if buffs.length > 0}
            <span class="ml-auto text-[10px] tabular-nums" style="color: var(--theme-modal-text); opacity: 0.45;">
                生效 {buffs.length} 条
            </span>
        {/if}
    </div>

    <div class="flex min-h-0 flex-1 flex-col p-4">
        {#if !analysis}
            <div class="py-8 text-center text-xs" style="color: var(--theme-modal-text); opacity: 0.4;">
                {computing ? '计算中…' : '暂无数据'}
            </div>
        {:else}
            <div class="grid shrink-0 grid-cols-3 gap-2">
                <div class="rounded-none border px-3 py-2" style="border-color: var(--theme-divider-border);">
                    <div class="{SECTION_LABEL} text-(--theme-modal-text)/45">角色总伤</div>
                    <div class="mt-1 {STAT_VALUE_SM} text-(--theme-modal-text)">
                        {fmt(analysis.totalDamageNorm)}
                    </div>
                    <div class="text-[10px]" style="color: var(--theme-modal-text); opacity: 0.55;">当前配置</div>
                </div>
                <div class="rounded-none border px-3 py-2" style="border-color: var(--theme-divider-border);">
                    <div class="{SECTION_LABEL} text-(--theme-modal-text)/45">Buff 总贡献</div>
                    <div class="mt-1 {STAT_VALUE_SM} text-(--theme-accent-text)">
                        +{fmt(analysis.buffTotalNorm)}
                    </div>
                    <div class="text-[10px] tabular-nums" style="color: var(--theme-modal-text); opacity: 0.55;">
                        {analysis.buffTotalPctNorm.toFixed(1)}%
                        {#if analysis.buffTotalRig !== analysis.buffTotalNorm}
                            <span style={RIG_GRAD_TEXT}
                                >· 凹暴 +{fmt(analysis.buffTotalRig)} ({analysis.buffTotalPctRig.toFixed(1)}%)</span
                            >
                        {/if}
                        {#if analysis.buffTotalNoCrit !== analysis.buffTotalNorm}
                            <span style={NOCRIT_GRAD_TEXT}
                                >· 不暴 +{fmt(analysis.buffTotalNoCrit)} ({analysis.buffTotalPctNoCrit.toFixed(
                                    1
                                )}%)</span
                            >
                        {/if}
                    </div>
                </div>
                <div class="rounded-none border px-3 py-2" style="border-color: var(--theme-divider-border);">
                    <div class="{SECTION_LABEL} text-(--theme-modal-text)/45">移除全部后</div>
                    <div class="mt-1 {STAT_VALUE_SM} text-(--theme-modal-text)">{fmt(analysis.noBuffDamageNorm)}</div>
                    <div class="text-[10px]" style="color: var(--theme-modal-text); opacity: 0.55;">
                        仅保留装备与面板
                    </div>
                </div>
            </div>

            <p class="mt-2 shrink-0 text-[10px] leading-relaxed" style="color: var(--theme-modal-text); opacity: 0.5;">
                表头「Buff 总贡献」= 移除全部生效 Buff 的损失；列表每行 = <b>只</b>移除该条 Buff 的损失。 多条 Buff
                乘算叠加，逐条损失之和不等于总贡献，两者算法不同，数值本就不会相等。
            </p>

            {#if buffs.length === 0}
                <div class="py-8 text-center text-xs" style="color: var(--theme-modal-text); opacity: 0.4;">
                    该角色没有生效的 Buff
                </div>
            {:else}
                <div
                    class="theme-scrollbar mt-3 min-h-0 flex-1 divide-y overflow-y-auto"
                    style="border-color: var(--theme-divider-border);"
                >
                    {#each buffs as buff (buff.id)}
                        <div style="border-color: var(--theme-divider-border);">
                            <div class="relative overflow-hidden">
                                <!-- 贡献条：以最强 Buff 为满格，便于横向比较 -->
                                <div
                                    class="pointer-events-none absolute inset-y-0 left-0"
                                    style="width: {barWidth(
                                        buff
                                    )}%; background: color-mix(in srgb, var(--theme-accent-bg) 14%, transparent);"
                                ></div>
                                <div
                                    class="relative flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2 py-1.5 text-[11px]"
                                >
                                    <span class="min-w-0 max-w-[45%] truncate font-medium" title={buff.name}>
                                        {buff.name}
                                    </span>
                                    {#each buff.zones as zone, zi (zi)}
                                        <span class="shrink-0" title="{zone.label}：+{fmt(zone.contributionNorm)}">
                                            <Chip
                                                variant="plain"
                                                class="text-(--theme-modal-text)/55"
                                                style="background: var(--theme-input-bg);"
                                            >
                                                {zone.label}
                                            </Chip>
                                        </span>
                                    {/each}
                                    <span
                                        class="ml-auto shrink-0 tabular-nums"
                                        style="color: var(--theme-accent-text);"
                                    >
                                        +{fmt(buff.contributionNorm)}
                                        <span style="opacity: 0.6;">({buff.contribPctNorm.toFixed(1)}%)</span>
                                    </span>
                                    {#if buff.contributionRig !== buff.contributionNorm}
                                        <span class="shrink-0 text-[10px] tabular-nums" style={RIG_GRAD_TEXT}>
                                            凹暴 +{fmt(buff.contributionRig)}
                                        </span>
                                    {/if}
                                    {#if buff.contributionNoCrit !== buff.contributionNorm}
                                        <span class="shrink-0 text-[10px] tabular-nums" style={NOCRIT_GRAD_TEXT}>
                                            不暴 +{fmt(buff.contributionNoCrit)}
                                        </span>
                                    {/if}
                                </div>
                            </div>
                        </div>
                    {/each}
                </div>
            {/if}
        {/if}
    </div>
</section>
