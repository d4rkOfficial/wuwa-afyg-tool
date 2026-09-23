<script lang="ts">
    /**
     * @desc 词条集里的一张方案卡片：头部点击展开/收起 5 个声骸的主副词条明细，
     * 底部操作按钮由父组件通过 actions snippet 注入（套用/覆盖/重置/同步/重命名/删除随入口不同）。
     */
    import Icon from '@iconify/svelte'
    import type { Snippet } from 'svelte'
    import type { ComponentsProps } from '$lib/types'
    import type { EchoSlotConfig } from '$lib/calc/config.types'
    import { planSubstatTotal } from '$lib/calc/standard-substats'
    import { abbrevMainStat, abbrevSubstat } from '$lib/utils/substat-abbrev'

    interface Props extends ComponentsProps {
        name: string
        slots: EchoSlotConfig[]
        /** @desc 标准14词条卡片（显示来源角标、图标不同） */
        standard?: boolean
        /** @desc 标准方案的来源角标：工坊 / 本地自定义 / 自动生成 */
        origin?: string
        expanded?: boolean
        onexpand?: () => void
        actions?: Snippet
    }

    let {
        name,
        slots,
        standard = false,
        origin,
        expanded = false,
        onexpand,
        actions,
        class: className,
        style: styleProp
    }: Props = $props()

    const costString = () =>
        slots
            .map((s) => s.cost)
            .sort((a, b) => b - a)
            .join('')

    /** @desc 完整主词条（悬浮提示用） */
    const mainSummary = (slot: EchoSlotConfig) =>
        slot.mainStat ? `${slot.mainStat.type}${slot.mainStat.value}${slot.mainStat.unit}` : '未选主词条'

    /** @desc 完整副词条（悬浮提示用） */
    const slotSummary = (slot: EchoSlotConfig) =>
        slot.substats.map((s) => `${s.type}${s.value}${s.unit}`).join(' / ') || '无副词条'

    /** @desc 主词条简写：`<cost>C<主缩>`，如 4C暴击 */
    const mainAbbrev = (slot: EchoSlotConfig) =>
        slot.mainStat ? `${slot.cost}C${abbrevMainStat(slot.mainStat.type)}` : `${slot.cost}C未选`

    /** @desc 副词条简写：`<数值><副缩>` 以 / 连接，如 6.3暴 / 12.6爆 / 50小攻 / 11大攻 */
    const subsAbbrev = (slot: EchoSlotConfig) =>
        slot.substats.map((s) => `${s.value}${abbrevSubstat(s.type) || s.type}`).join(' / ') || '无副词条'
</script>

<div
    class="rounded-none border {className ?? ''}"
    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg); {styleProp || ''}"
>
    <button
        onclick={onexpand}
        class="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-(--theme-modal-text)/5"
        title={expanded ? '收起明细' : '展开 5 个声骸的明细'}
    >
        <Icon
            icon={standard ? 'mdi:star-four-points-outline' : 'mdi:clipboard-text-outline'}
            class="size-4 shrink-0 {standard ? 'text-(--theme-accent-text)' : 'text-(--theme-modal-text)/40'}"
        />
        <span class="min-w-0 flex-1 truncate text-xs font-black tracking-tight text-(--theme-modal-text)">{name}</span>
        {#if origin}
            <span
                class="shrink-0 rounded-none px-1.5 py-0.5 text-[10px] text-(--theme-modal-text)/40"
                style="background: color-mix(in srgb, var(--theme-modal-text) 8%, transparent);">{origin}</span
            >
        {/if}
        <span class="shrink-0 text-[10px] font-black tabular-nums tracking-[0.22em] text-(--theme-modal-text)/40">
            {costString()} · {planSubstatTotal(slots)} 条
        </span>
        <Icon
            icon={expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'}
            class="size-4 shrink-0 text-(--theme-modal-text)/40"
        />
    </button>

    {#if expanded}
        <div class="space-y-1.5 border-t px-3 py-2.5 text-[10px]" style="border-color: var(--theme-divider-border);">
            {#each slots as slot}
                <div class="flex items-baseline gap-3">
                    <span class="w-16 shrink-0 truncate font-black text-(--theme-accent-text)" title={mainSummary(slot)}
                        >{mainAbbrev(slot)}</span
                    >
                    <span class="min-w-0 flex-1 truncate text-(--theme-modal-text)/40" title={slotSummary(slot)}
                        >{subsAbbrev(slot)}</span
                    >
                </div>
            {/each}
        </div>
    {/if}

    {#if actions}
        <div
            class="flex flex-wrap items-center gap-1.5 border-t px-2.5 py-2"
            style="border-color: var(--theme-divider-border);"
        >
            {@render actions()}
        </div>
    {/if}
</div>
