<script lang="ts">
    /**
     * @desc 数据分析 → Buff 贡献（单角色视图）。
     *
     * 算法：把该 Buff 从「这个角色伤害条目」的绑定里拿掉，重算该角色总伤，损失量即贡献。
     * 口径统一为**当前配置**（凹暴 / 不暴 / 未命中已在结果页生效），不分别展示期望/凹暴/不暴三列。
     * 逐条损失**不可相加**（多条 Buff 乘算叠加，1+1 ≠ 2），因此表头另给「移除全部 Buff」的总贡献，
     * 这一点在帮助弹窗与副标题里都写清楚，避免用户拿两种数互相校验。
     *
     * 版面：高度跟随左栏（副词条贡献）并由调用方传入，列表在内部滚动。
     * 列表按 Buff 全名的文件夹层级折叠（文件夹行 = 该文件夹内全部 Buff 一起移除的损失）。
     */
    import Icon from '@iconify/svelte'
    import { openHelp } from '$lib/data/help.svelte'
    import { BUFF_ALGORITHM_HELP } from '$lib/calc/result.consts'
    import { BUFF_PATH_SEP } from '$lib/calc/buff-name'
    import { CARD_SURFACE_STYLE, SECTION_LABEL, STAT_VALUE_SM } from '$lib/calc/result.styles'
    import type { CharBuffAnalysis } from '$lib/calc/result.types'
    import { joinStyle, mergeClass } from '$lib/utils/component-style'
    import type { ComponentsProps } from '$lib/types'
    import {
        buildBuffContributionTree,
        collectBuffFolderKeys,
        flattenBuffTreeRows,
        type BuffTreeRow
    } from './buff-contribution-tree'

    interface Props extends ComponentsProps {
        /** @desc 该角色的 Buff 贡献分析结果（undefined = 尚未算出） */
        analysis: CharBuffAnalysis | undefined
        computing: boolean
        /** @desc 与左栏（副词条贡献）等高的目标高度（px）；0 = 尚未测量，按内容自然高度 */
        height?: number
    }

    let { analysis, computing, height = 0, class: className, style: styleProp }: Props = $props()

    const helpItems = [{ ...BUFF_ALGORITHM_HELP }]

    let buffs = $derived(analysis?.buffs ?? [])
    let tree = $derived(buildBuffContributionTree(analysis))
    let allFolderKeys = $derived(collectBuffFolderKeys(tree))
    /** @desc 收起的文件夹 key（空 = 全部展开，新出现的文件夹默认展开） */
    let collapsed = $state<ReadonlySet<string>>(new Set())
    let rows = $derived(flattenBuffTreeRows(tree, collapsed))

    /** @desc 条形长度基准：贡献最大的节点（文件夹与 Buff 一起比较，便于横向对照） */
    let maxContribution = $derived(
        Math.max(
            0,
            ...buffs.map((buff) => buff.contribution),
            ...(analysis?.folders ?? []).map((folder) => folder.contribution)
        )
    )

    const barWidth = (contribution: number): number =>
        maxContribution > 0 ? Math.max(2, (contribution / maxContribution) * 100) : 0

    const fmt = (n: number) => Math.round(n).toLocaleString()

    const toggleFolder = (key: string) => {
        const next = new Set(collapsed)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        collapsed = next
    }

    const expandAll = () => {
        collapsed = new Set()
    }

    const collapseAll = () => {
        collapsed = new Set(allFolderKeys)
    }

    const folderTitle = (row: BuffTreeRow): string =>
        `${row.path.join(BUFF_PATH_SEP)}（整组移除 +${fmt(row.contribution)}）`

    /** @desc Buff 行 hover：完整全名 + 乘区明细（乘区名不以 badge 形式占位） */
    const buffTitle = (row: BuffTreeRow): string => {
        const zones = row.buff?.zones ?? []
        const fullName = [...row.path, row.name].join(BUFF_PATH_SEP)
        if (zones.length === 0) return fullName
        return `${fullName}\n乘区：${zones.map((zone) => `${zone.label} +${fmt(zone.contribution)}`).join(' · ')}`
    }
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
        <span class="ml-auto flex items-center gap-1">
            {#if computing}
                <span class="mr-1 text-[10px]" style="color: var(--theme-accent-text); opacity: 0.6;">计算中…</span>
            {/if}
            <button
                type="button"
                onclick={expandAll}
                class="flex h-5 w-5 items-center justify-center rounded-none transition-colors hover:bg-(--theme-modal-text)/10"
                style="color: var(--theme-accent-text);"
                title="展开全部"
                aria-label="展开全部"
            >
                <Icon icon="mdi:expand-all-outline" class="size-4" />
            </button>
            <button
                type="button"
                onclick={collapseAll}
                class="flex h-5 w-5 items-center justify-center rounded-none transition-colors hover:bg-(--theme-modal-text)/10"
                style="color: var(--theme-accent-text); opacity: 0.7;"
                title="收起全部"
                aria-label="收起全部"
            >
                <Icon icon="mdi:collapse-all-outline" class="size-4" />
            </button>
        </span>
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
                        {fmt(analysis.totalDamage)}
                    </div>
                    <div class="text-[10px]" style="color: var(--theme-modal-text); opacity: 0.55;">当前配置</div>
                </div>
                <div class="rounded-none border px-3 py-2" style="border-color: var(--theme-divider-border);">
                    <div class="{SECTION_LABEL} text-(--theme-modal-text)/45">Buff 总贡献</div>
                    <div class="mt-1 {STAT_VALUE_SM} text-(--theme-accent-text)">
                        +{fmt(analysis.buffTotal)}
                    </div>
                    <div class="text-[10px] tabular-nums" style="color: var(--theme-modal-text); opacity: 0.55;">
                        {analysis.buffTotalPct.toFixed(1)}%
                    </div>
                </div>
                <div class="rounded-none border px-3 py-2" style="border-color: var(--theme-divider-border);">
                    <div class="{SECTION_LABEL} text-(--theme-modal-text)/45">移除全部后</div>
                    <div class="mt-1 {STAT_VALUE_SM} text-(--theme-modal-text)">{fmt(analysis.noBuffDamage)}</div>
                    <div class="text-[10px]" style="color: var(--theme-modal-text); opacity: 0.55;">
                        仅保留装备与面板
                    </div>
                </div>
            </div>

            {#if buffs.length === 0}
                <div class="py-8 text-center text-xs" style="color: var(--theme-modal-text); opacity: 0.4;">
                    该角色没有生效的 Buff
                </div>
            {:else}
                <div
                    class="theme-scrollbar mt-3 min-h-0 flex-1 divide-y overflow-y-auto"
                    style="border-color: var(--theme-divider-border);"
                >
                    {#each rows as row (row.key)}
                        {#if row.kind === 'folder'}
                            <div class="relative overflow-hidden" style="border-color: var(--theme-divider-border);">
                                <div
                                    class="pointer-events-none absolute inset-y-0 left-0"
                                    style="width: {barWidth(
                                        row.contribution
                                    )}%; background: color-mix(in srgb, var(--theme-accent-bg) 22%, transparent);"
                                ></div>
                                {@render treeGuides(row)}
                                <button
                                    type="button"
                                    class="relative flex w-full items-center gap-1.5 py-1.5 pr-2 text-left text-[11px] transition-colors hover:bg-(--theme-modal-text)/5"
                                    style="padding-left: {(row.depth + 1) * 16 + 8}px;"
                                    onclick={() => toggleFolder(row.key)}
                                    aria-expanded={!collapsed.has(row.key)}
                                    title={folderTitle(row)}
                                >
                                    <Icon
                                        icon={collapsed.has(row.key) ? 'mdi:circle-outline' : 'mdi:circle'}
                                        class="size-2.5 shrink-0"
                                        style="color: var(--theme-accent-text);"
                                    />
                                    <span class="min-w-0 max-w-[46%] truncate font-bold">{row.name}</span>
                                    <span
                                        class="ml-auto shrink-0 tabular-nums"
                                        style="color: var(--theme-accent-text);"
                                    >
                                        +{fmt(row.contribution)}
                                        <span style="opacity: 0.6;">({row.contribPct.toFixed(1)}%)</span>
                                    </span>
                                </button>
                            </div>
                        {:else}
                            <div class="relative overflow-hidden" style="border-color: var(--theme-divider-border);">
                                <div
                                    class="pointer-events-none absolute inset-y-0 left-0"
                                    style="width: {barWidth(
                                        row.contribution
                                    )}%; background: color-mix(in srgb, var(--theme-accent-bg) 14%, transparent);"
                                ></div>
                                {@render treeGuides(row)}
                                <div
                                    class="relative flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 pr-2 text-[11px]"
                                    style="padding-left: {(row.depth + 1) * 16 + 8}px;"
                                    title={buffTitle(row)}
                                >
                                    <span class="min-w-0 max-w-[52%] truncate font-medium">{row.name}</span>
                                    <span
                                        class="ml-auto shrink-0 tabular-nums"
                                        style="color: var(--theme-accent-text);"
                                    >
                                        +{fmt(row.contribution)}
                                        <span style="opacity: 0.6;">({row.contribPct.toFixed(1)}%)</span>
                                    </span>
                                </div>
                            </div>
                        {/if}
                    {/each}
                </div>
            {/if}
        {/if}
    </div>
</section>

{#snippet treeGuides(row: BuffTreeRow)}
    <div class="pointer-events-none absolute inset-y-0 left-0" style="width: {(row.depth + 1) * 16 + 8}px;">
        {#each row.ancestorHasNext as hasNext, i (i)}
            {#if hasNext}
                <span
                    class="absolute inset-y-0 border-l"
                    style="left: {i * 16 +
                        8}px; border-color: color-mix(in srgb, var(--theme-modal-text) 32%, transparent);"
                ></span>
            {/if}
        {/each}
        <span
            class="absolute border-l"
            style="left: {row.depth * 16 + 8}px; top: 0; bottom: {row.lastSibling
                ? '50%'
                : '0'}; border-color: color-mix(in srgb, var(--theme-modal-text) 32%, transparent);"
        ></span>
        <span
            class="absolute border-t"
            style="left: {row.depth * 16 +
                8}px; top: 50%; width: 8px; border-color: color-mix(in srgb, var(--theme-modal-text) 32%, transparent);"
        ></span>
    </div>
{/snippet}
