<script lang="ts">
    /**
     * @desc 数据分析 → KPI 总览（Phase 5.3：自 `data-analysis-modal.svelte` 原样抽出，标记与行为未改）。
     * 口径随「分段 DPS」里选中的时段切换（默认总计）。4 张卡按两种形状各用一个 snippet 收敛：
     * ①②「总值卡」（仅文案/底色/跨列不同）、③④「伤害卡」（仅头像叠底/标题/数值配色不同）。
     */
    import Icon from '@iconify/svelte'
    import {
        CARD_BG_STYLE,
        SECTION_LABEL,
        SECTION_NOTE,
        STAT_CARD_GRADIENT_STYLE,
        STAT_CARD_GRADIENT_SUBTLE_STYLE
    } from '$lib/calc/result.styles'
    import { mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'
    import { cssVar } from './chart-utils'
    import type { CharCard, EffectCard, RangeStats } from './types'

    interface Props extends ComponentsProps {
        /** @desc 选中范围标签：'总计' 或 '1.0s — 12.0s' */
        rangeLabel: string
        /** @desc 选中范围统计口径（总计 = 整段，时段 = 该段） */
        rangeStats: RangeStats
        /** @desc 角色伤害卡数据（已按当前口径降序） */
        charCards: CharCard[]
        /** @desc 效应伤害卡数据（已按当前口径降序） */
        effectCards: EffectCard[]
    }

    let { rangeLabel, rangeStats, charCards, effectCards, class: className, style: styleProp }: Props = $props()

    /** @desc 卡片底色口径（与结果页卡片刻意保持同一份定义） */
    const cardBg = CARD_BG_STYLE
</script>

<section class={mergeClass(['space-y-2', className])} style={styleProp}>
    {#snippet statCard(label: string, value: string, note: string, cardClass: string, cardStyle: string)}
        <div class={cardClass} style={cardStyle}>
            <div class={`${SECTION_LABEL} text-(--theme-modal-text)/45`}>{label}</div>
            <div
                class="mt-1.5 text-2xl font-black leading-none tabular-nums [text-shadow:0_0_3px_var(--theme-halo-color)]"
                style="color: var(--theme-accent-text);"
            >
                {value}
            </div>
            <div class={`${SECTION_NOTE} text-(--theme-modal-text)/45`}>{note}</div>
        </div>
    {/snippet}

    {#snippet damageCard(
        card: { damage: number; count: number; element: string; icon?: string; label?: string },
        name: string,
        useElementColor: boolean
    )}
        {@const color = card.element ? cssVar(`--theme-element-${card.element}`, '#888') : '#888'}
        <div
            class="relative overflow-hidden rounded-none border p-4"
            style="border-color: var(--theme-divider-border); background: {cardBg};"
        >
            {#if card.icon}
                <div
                    class="pointer-events-none absolute -bottom-2 -right-2 z-0 size-24 opacity-40"
                    style="-webkit-mask-image: linear-gradient(to left, transparent, #000 40%), linear-gradient(to bottom, transparent, #000 40%); -webkit-mask-composite: source-in; mask-image: linear-gradient(to left, transparent, #000 40%), linear-gradient(to bottom, transparent, #000 40%); mask-composite: intersect;"
                >
                    <img src={card.icon} alt="" class="size-full object-cover" />
                </div>
            {/if}
            <div class="relative z-10">
                <div class="flex items-center gap-1.5">
                    <span class="size-2 rounded-full shrink-0" style="background: {color};"></span>
                    <span class="truncate text-[10px] font-black" style="color: {color};" title={card.label}
                        >{name}</span
                    >
                </div>
                <div
                    class="mt-1.5 text-lg font-black leading-none tabular-nums [text-shadow:0_0_3px_var(--theme-halo-color)]"
                    style="color: {useElementColor ? color : 'var(--theme-modal-text)'};"
                >
                    {Math.round(card.damage).toLocaleString()}
                </div>
                <div class={`${SECTION_NOTE} text-(--theme-modal-text)/45`}>
                    占比 {rangeStats.damage > 0 ? ((card.damage / rangeStats.damage) * 100).toFixed(1) : '0.0'}% · {card.count}
                    条
                </div>
            </div>
        </div>
    {/snippet}

    <div class="flex flex-wrap items-center gap-2 text-[11px] text-(--theme-modal-text)/45">
        <Icon icon="mdi:cursor-default-click-outline" class="size-3.5" />
        <span>当前口径：{rangeLabel}</span>
        <span class="tabular-nums">（时长 {rangeStats.span.toFixed(1)}s）</span>
        <span>· 在「分段 DPS」点时段行可切换</span>
    </div>
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <!-- ① 总伤害 -->
        {@render statCard(
            '总伤害',
            Math.round(rangeStats.damage).toLocaleString(),
            `${rangeStats.entryCount} 条伤害记录`,
            'relative col-span-2 overflow-hidden rounded-none border p-4 lg:col-span-1',
            STAT_CARD_GRADIENT_STYLE
        )}
        <!-- ② 总 DPS -->
        {@render statCard(
            '总 DPS',
            rangeStats.dps > 0 ? Math.round(rangeStats.dps).toLocaleString() : '—',
            `${rangeLabel} · ${rangeStats.span.toFixed(1)}s`,
            'relative overflow-hidden rounded-none border p-4',
            STAT_CARD_GRADIENT_SUBTLE_STYLE
        )}
        <!-- ③ 角色伤害（按当前口径伤害降序，头像叠底） -->
        {#each charCards as card (card.character)}
            {@render damageCard(card, card.character, false)}
        {/each}
        <!-- ④ 效应伤害（非配队条目按来源效应分流，永远排在最后，按当前口径伤害降序） -->
        {#each effectCards as card (card.label)}
            {@render damageCard(card, card.label, true)}
        {/each}
    </div>
</section>
