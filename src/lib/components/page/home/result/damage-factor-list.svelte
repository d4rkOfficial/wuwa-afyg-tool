<script lang="ts">
    /**
     * @desc 倍率因子表：把「复合倍率 / 额外倍率 Buff」拆成每一因子的伤害。
     *
     * 只在因子数 > 1 或条目段数 > 1 时由调用方渲染（单因子单段的倍率链里已经能直接看到那一个数）。
     * 列的含义：「单段倍率」是该因子自身的倍率（倍率串里的 `47.22%*2` 只显示 47.22%）；
     * 不暴击 / 暴击 / 期望是该因子**单段**的伤害（成分乘数与条目段数都归一到 1 段），
     * 与「单段倍率」同口径；条目的全部段数合计见上方溯源汇总。
     */
    import type { DamageFactorRow } from '$lib/calc/damage-trace'
    import type { ComponentsProps } from '$lib/types'
    import { mergeClass } from '$lib/utils/component-style'

    interface Props extends ComponentsProps {
        factors: DamageFactorRow[]
        /** 是否可暴击（决定是否展示 不暴击 / 暴击 两列） */
        canCrit: boolean
    }

    let { factors, canCrit, class: className, style: styleProp }: Props = $props()

    const fmt = (n: number, d = 0) => n.toLocaleString(undefined, { maximumFractionDigits: d })

    /** @desc 单段倍率文案：百分比条目带 %，固定值条目直接给数值 */
    const segmentText = (f: DamageFactorRow): string =>
        f.unit === 'flat'
            ? fmt(f.segmentRatio, 1)
            : `${f.segmentRatio.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`

    // 与 `damage-trace-view.svelte` 的来源色同一套语义（技能/效应/Buff），昼夜切换不改色
    const KIND_COLOR: Record<DamageFactorRow['kind'], string> = {
        skill: '#9aa3ad',
        effect: '#d18a8a',
        buff: 'var(--theme-accent-text)'
    }
</script>

<div class={mergeClass([className])} style={styleProp}>
    <table class="w-full text-[11px]">
        <thead>
            <tr style="color: var(--theme-modal-text); opacity: 0.45;">
                <th class="py-1 pr-2 text-left font-medium">倍率因子</th>
                <th class="px-2 py-1 text-right font-medium">单段倍率</th>
                {#if canCrit}
                    <th class="px-2 py-1 text-right font-medium">不暴击</th>
                    <th class="px-2 py-1 text-right font-medium">暴击</th>
                {/if}
                <th class="px-2 py-1 text-right font-medium">期望</th>
            </tr>
        </thead>
        <tbody style="color: var(--theme-modal-text);">
            {#each factors as f, fi (fi)}
                <tr class="border-t" style="border-color: var(--theme-divider-border);">
                    <td class="py-1 pr-2">
                        <span class="inline-flex items-center gap-1.5">
                            <span class="size-1.5 shrink-0 rounded-full" style="background: {KIND_COLOR[f.kind]};"
                            ></span>
                            <span class="truncate" title={f.label}>{f.label}</span>
                            {#if f.note}
                                <span
                                    class="shrink-0 rounded-none px-1 text-[9px] leading-tight"
                                    style="background: var(--theme-input-bg); color: var(--theme-modal-text); opacity: 0.6;"
                                    >{f.note}</span
                                >
                            {/if}
                        </span>
                    </td>
                    <td class="px-2 py-1 text-right tabular-nums" style="opacity: 0.75;">{segmentText(f)}</td>
                    {#if canCrit}
                        <td class="px-2 py-1 text-right tabular-nums" style="color: var(--theme-nocrit-from);">
                            {fmt(f.nonCrit)}
                        </td>
                        <td class="px-2 py-1 text-right tabular-nums" style="color: var(--theme-rigcrit-from);">
                            {fmt(f.crit)}
                        </td>
                    {/if}
                    <td class="px-2 py-1 text-right font-black tabular-nums" style="color: var(--theme-accent-text);">
                        {fmt(f.damage)}
                    </td>
                </tr>
            {/each}
        </tbody>
    </table>
</div>
