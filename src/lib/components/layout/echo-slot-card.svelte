<script lang="ts">
    /**
     * @desc 单个声骸词条卡片（工程-词条配置页与词条集的方案编辑器共用，UI 完全一致）：
     * cost 水印 + cost 选择 + 主词条按钮 + 副词条（档位滑块，可选拖动排序 / 逐个移除）。
     * 数据由父组件持有，本组件只渲染与回调，不直接读写 store。
     */
    import Icon from '@iconify/svelte'
    import { slide } from 'svelte/transition'
    import type { ComponentsProps } from '$lib/types'
    import type { EchoSlotConfig } from '$lib/calc/config.types'
    import { SECOND_MAIN_STAT, SUBSTAT_OPTIONS } from '$lib/consts/stat-data'

    interface Props extends ComponentsProps {
        slot: EchoSlotConfig
        /** @desc 副词条区域固定预留 5 行高度（词条集编辑器用，使各卡片内容行高一致） */
        reserveSubstatRows?: boolean
        /** @desc 其余槽位 cost 合计（用于判断能否切换本槽 cost） */
        otherCost: number
        /** @desc 主词条按钮的定位锚点（工程配置页用于弹出菜单） */
        mainStatTriggerKey?: string
        oncost: (cost: number) => void
        onmainstat: () => void
        onclearsubstats: () => void
        onaddsubstat: () => void
        onsubstatvalue: (index: number, value: number) => void
        /** @desc 逐个移除副词条（词条集编辑器用；不传则不显示移除按钮） */
        onremovesubstat?: (index: number) => void
        /** @desc 随机强化（不传则不显示该入口） */
        onenhance?: () => void
        /** @desc 拖动排序相关（不传则不启用拖动） */
        dragIndex?: number | null
        dropIndex?: number | null
        dragOutside?: boolean
        ondragstart?: (e: PointerEvent, index: number) => void
        ondragmove?: (e: PointerEvent) => void
        ondragend?: (e: PointerEvent, index: number) => void
    }

    let {
        slot,
        otherCost,
        mainStatTriggerKey,
        reserveSubstatRows = false,
        oncost,
        onmainstat,
        onclearsubstats,
        onaddsubstat,
        onsubstatvalue,
        onremovesubstat,
        onenhance,
        dragIndex = null,
        dropIndex = null,
        dragOutside = false,
        ondragstart,
        ondragmove,
        ondragend,
        class: className,
        style: styleProp
    }: Props = $props()

    const COST_OPTIONS = [4, 3, 1]

    const DAMAGE_SHORT: Record<string, string> = {
        普攻伤害加成: '普攻加成',
        重击伤害加成: '重击加成',
        共鸣技能伤害加成: '共技加成',
        共鸣解放伤害加成: '共解加成'
    }
    const shortLabel = (label: string) => DAMAGE_SHORT[label] ?? label

    const second = $derived(SECOND_MAIN_STAT[slot.cost as keyof typeof SECOND_MAIN_STAT])

    /** @desc 补足到 5 行的占位行序号（仅在预留模式下非空，占位行不参与交互、不可见但撑高） */
    const placeholderRows = $derived(
        reserveSubstatRows ? Array.from({ length: Math.max(0, 5 - slot.substats.length) }, (_, i) => i) : []
    )

    const costBtnCls = (cost: number): string => {
        if (cost === 4) return 'border-(--theme-accent-bg) bg-(--theme-accent-bg)/25 text-(--theme-accent-text)'
        if (cost === 3) return 'border-(--theme-accent-bg) bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
        return 'border-(--theme-accent-bg) bg-(--theme-accent-bg)/8 text-(--theme-accent-text)'
    }

    const getTierIndex = (tiers: number[], value: number): number => {
        if (value <= 0) return -1
        let closest = 0
        for (let i = 0; i < tiers.length; i++) {
            if (Math.abs(tiers[i] - value) < Math.abs(tiers[closest] - value)) closest = i
        }
        return closest
    }
</script>

<div
    data-sf="card"
    class="relative min-w-[13rem] rounded-none border p-4 {className ?? ''}"
    style="border-color: var(--theme-divider-border); {styleProp || ''}"
>
    <!-- COST overlay -->
    <div class="pointer-events-none absolute inset-0 flex select-none items-center justify-center overflow-hidden">
        <span class="text-[200px] font-black leading-none opacity-[0.06] text-(--theme-accent-text)">{slot.cost}</span>
    </div>

    <div class="relative z-1">
        <!-- Cost selector：按钮平分卡片宽度 -->
        <div class="mb-3 flex items-center gap-1">
            {#each COST_OPTIONS as c}
                <button
                    onclick={() => oncost(c)}
                    disabled={c !== slot.cost && otherCost + c > 12}
                    class={[
                        'h-6 min-w-0 flex-1 rounded-none border px-1 text-xs font-black transition-colors disabled:opacity-30 disabled:cursor-not-allowed',
                        slot.cost === c
                            ? costBtnCls(slot.cost)
                            : 'border-(--theme-divider-border) bg-(--theme-input-bg) text-(--theme-modal-text)/40 hover:border-(--theme-accent-bg) hover:text-(--theme-modal-text)'
                    ].join(' ')}>{c} COST</button
                >
            {/each}
        </div>

        <!-- Main stat + second stat combined -->
        <div class="relative z-20 mb-2">
            <button
                data-main-stat-trigger={mainStatTriggerKey}
                onclick={onmainstat}
                class="w-full rounded-none border px-3 py-2 transition-colors hover:border-(--theme-accent-bg) hover:bg-[color-mix(in_srgb,var(--theme-modal-text)_5%,var(--theme-input-bg))]"
                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
            >
                <div class="flex items-center justify-between">
                    <div class="flex flex-col text-left">
                        <span class="text-xs font-black text-(--theme-modal-text)">
                            {slot.mainStat
                                ? `${shortLabel(slot.mainStat.type)} ${slot.mainStat.value}${slot.mainStat.unit}`
                                : '未选择'}
                        </span>
                        {#if second}
                            <span class="text-[10px] text-(--theme-modal-text)/40">{second.label} +{second.value}</span>
                        {/if}
                    </div>
                    <Icon icon="mdi:chevron-down" class="size-3.5 text-(--theme-modal-text)/40 shrink-0" />
                </div>
            </button>
        </div>

        <!-- Substats -->
        <div>
            <span
                class="mb-1 flex items-center gap-1.5 border-t pt-2 text-[10px] font-black tracking-[0.18em] text-(--theme-modal-text)/40"
                style="border-color: var(--theme-divider-border);">副词条 ({slot.substats.length}/5)</span
            >
            <div class="space-y-1">
                {#each slot.substats as sub, idx (sub.type)}
                    {@const opt = SUBSTAT_OPTIONS.find((o) => o.label === sub.type)}
                    {#if opt}
                        {@const tierIdx = getTierIndex(opt.tiers, sub.value)}
                        {@const maxTier = opt.tiers.length - 1}
                        {@const pct = tierIdx > 0 ? (tierIdx / maxTier) * 100 : 0}
                        {@const isDragged = dragIndex === idx}
                        {#if dragIndex !== null && !dragOutside && dropIndex === idx}
                            <div class="h-0.5 rounded-full bg-(--theme-accent-bg)"></div>
                        {/if}
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <div
                            data-substat
                            role="listitem"
                            transition:slide={{ duration: 200 }}
                            class={[
                                'flex items-center gap-2 rounded-none border border-(--theme-divider-border) px-2 py-1.5 transition-all touch-none',
                                ondragstart ? 'cursor-grab active:cursor-grabbing' : '',
                                isDragged && !dragOutside && 'ring-2 ring-(--theme-accent-bg)',
                                isDragged && dragOutside && 'ring-2 ring-red-500 opacity-50'
                            ].join(' ')}
                            style="background: var(--theme-input-bg);"
                            onpointerdown={(e) => ondragstart?.(e, idx)}
                            onpointermove={ondragmove}
                            onpointerup={(e) => ondragend?.(e, idx)}
                        >
                            <span class="text-[11px] font-black text-(--theme-modal-text)/80 w-20 shrink-0 mr-2"
                                >{shortLabel(sub.type)}</span
                            >
                            <div class="relative flex-1 h-5">
                                <div
                                    class="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-(--theme-modal-text)/10"
                                >
                                    <div
                                        class="h-full rounded-full"
                                        style="width: {pct}%; background: var(--theme-accent-bg)"
                                    ></div>
                                </div>
                                <div
                                    class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-none text-[10px] font-black whitespace-nowrap pointer-events-none z-10"
                                    style="left: {pct}%; background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);"
                                >
                                    {sub.value}{opt.unit}
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max={maxTier}
                                    value={tierIdx > 0 ? tierIdx : 0}
                                    aria-label={`${sub.type} 档位`}
                                    oninput={(e) => onsubstatvalue(idx, opt.tiers[parseInt(e.currentTarget.value)])}
                                    class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-0"
                                />
                            </div>
                            {#if onremovesubstat}
                                <button
                                    onclick={() => onremovesubstat(idx)}
                                    class="shrink-0 rounded-none p-0.5 text-(--theme-modal-text)/40 transition-colors hover:text-red-500"
                                    title="移除该副词条"
                                >
                                    <Icon icon="mdi:close" class="size-3.5" />
                                </button>
                            {/if}
                        </div>
                    {/if}
                {/each}
                {#if dragIndex !== null && !dragOutside && dropIndex === slot.substats.length}
                    <div class="h-0.5 rounded-full bg-(--theme-accent-bg)"></div>
                {/if}
                <!-- 占位行：与真实副词条行同结构、不可见，用于把区域撑到 5 行高度 -->
                {#each placeholderRows as i (i)}
                    <div
                        aria-hidden="true"
                        transition:slide={{ duration: 200 }}
                        class="invisible flex items-center gap-2 rounded-none border px-2 py-1.5"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <span class="mr-2 w-20 shrink-0 text-[11px] font-black">占位</span>
                        <div class="relative h-5 flex-1"></div>
                        {#if onremovesubstat}
                            <span class="shrink-0 p-0.5"><Icon icon="mdi:close" class="size-3.5" /></span>
                        {/if}
                    </div>
                {/each}
            </div>
            {#if slot.substats.length > 0}
                <div class="mt-2 flex flex-wrap items-center gap-2">
                    {#if slot.substats.length < 5}
                        <button
                            onclick={onaddsubstat}
                            class="flex items-center gap-1 rounded-none border border-(--theme-divider-border) px-2 py-1 text-[10px] font-black text-(--theme-accent-text) transition-colors hover:border-(--theme-accent-bg) hover:bg-(--theme-input-bg)"
                        >
                            <Icon icon="mdi:plus" class="size-3" />
                            选择副词条
                        </button>
                    {/if}
                    <button
                        onclick={onclearsubstats}
                        class="flex items-center gap-1 rounded-none border border-(--theme-divider-border) px-2 py-1 text-[10px] font-black text-(--theme-modal-text)/40 transition-colors hover:border-red-500/50 hover:text-red-500"
                        title="清空该声骸的副词条"
                    >
                        <Icon icon="mdi:refresh" class="size-3" />
                        重置副词条
                    </button>
                </div>
            {:else}
                <div class="mt-2 flex flex-wrap items-center gap-2">
                    <button
                        onclick={onaddsubstat}
                        class="flex items-center gap-1 rounded-none border border-(--theme-divider-border) px-2 py-1 text-[10px] font-black text-(--theme-accent-text) transition-colors hover:border-(--theme-accent-bg) hover:bg-(--theme-input-bg)"
                    >
                        <Icon icon="mdi:plus" class="size-3" />
                        选择副词条
                    </button>
                    {#if onenhance}
                        <button
                            onclick={onenhance}
                            class="flex items-center gap-1 rounded-none border border-(--theme-divider-border) px-2 py-1 text-[10px] font-black text-(--theme-accent-text) transition-colors hover:border-(--theme-accent-bg) hover:bg-(--theme-input-bg)"
                        >
                            <Icon icon="mdi:dice-5" class="size-3" />
                            随机强化
                        </button>
                    {/if}
                </div>
            {/if}
        </div>
    </div>
</div>
