<script lang="ts">
    /**
     * @desc 单个声骸词条卡片（工程-词条配置页与词条集的方案编辑器共用）：
     * cost 水印 + cost 选择 + 主词条按钮 + 副词条（档位滑块，可选拖动排序 / 逐个移除）。
     * 数据由父组件持有，本组件只渲染与回调，不直接读写 store。
     * costTabsAside=true 时改为左右结构（cost 页签竖排在卡片左侧、文本 4C/3C/1C，左侧底部是无边框图标式重置），工程-词条配置页使用；
     * 不传（默认）则维持上下结构 + 「4 COST」文案，词条集方案编辑器样式不变。
     * 区域质感：卡片本体、cost 页签、主词条按钮、逐条副词条行与其小按钮统一接入「小部件」区域
     * （`data-sf="widget" data-sf-flat` + `--sf-base: var(--theme-input-bg)`），底色由「设置-外观主题-背景质感-小部件」管理。
     */
    import Icon from '@iconify/svelte'
    import Button from '$lib/components/ui/button.svelte'
    import { slide } from 'svelte/transition'
    import { MOTION_MS, slideParams } from '$lib/utils/motion'
    import type { ComponentsProps } from '$lib/types'
    import type { EchoSlotConfig } from '$lib/calc/config.types'
    import { SECOND_MAIN_STAT, SUBSTAT_OPTIONS } from '$lib/consts/stat-data'

    interface Props extends ComponentsProps {
        slot: EchoSlotConfig
        /** @desc 副词条区域固定预留 5 行高度（词条集编辑器用，使各卡片内容行高一致） */
        reserveSubstatRows?: boolean
        /** @desc cost 页签放卡片左侧、卡片改左右结构，页签文案用 4c/3c/1c（工程-词条配置页用） */
        costTabsAside?: boolean
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
        costTabsAside = false,
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

    /** @desc 选中态 cost 页签的强调强度（4c / 3c / 1c 依次 25% / 15% / 8%） */
    const COST_ACTIVE_ALPHA: Record<number, number> = { 4: 25, 3: 15, 1: 8 }

    const costBtnCls = (): string => 'border-(--theme-accent-bg) text-(--theme-accent-text)'

    /**
     * @desc cost 页签内联底色：未选中交给「小部件」区域底色（`--sf-base` 保持 input 底色）；
     * 选中态的强调底色内联下发，确保始终优先于区域底色（不依赖工具类与区域底色的层叠先后）
     */
    const costBtnStyle = (cost: number, active: boolean): string =>
        active
            ? `--sf-base: var(--theme-input-bg); background: color-mix(in srgb, var(--theme-accent-bg) ${COST_ACTIVE_ALPHA[cost] ?? 8}%, transparent)`
            : '--sf-base: var(--theme-input-bg)'

    const getTierIndex = (tiers: number[], value: number): number => {
        if (value <= 0) return -1
        let closest = 0
        for (let i = 0; i < tiers.length; i++) {
            if (Math.abs(tiers[i] - value) < Math.abs(tiers[closest] - value)) closest = i
        }
        return closest
    }
</script>

{#snippet costWatermark()}
    <!-- COST overlay -->
    <div class="pointer-events-none absolute inset-0 flex select-none items-center justify-center overflow-hidden">
        <span class="text-[200px] font-black leading-none opacity-[0.06] text-(--theme-accent-text)">{slot.cost}</span>
    </div>
{/snippet}

{#snippet costTabs()}
    <!-- 词条 4C/3C/1C 页签本体：底色交给「小部件」区域（未选中取 --sf-base = input 底色，
         选中态由 costBtnStyle 内联主题色强调），透明度/毛玻璃/深度改由「设置-背景质感-小部件」管理 -->
    {#each COST_OPTIONS as c (c)}
        <button
            onclick={() => oncost(c)}
            disabled={c !== slot.cost && otherCost + c > 12}
            data-sf="widget"
            data-sf-flat
            class={[
                'rounded-none border text-xs font-black transition-colors disabled:cursor-not-allowed disabled:opacity-30',
                costTabsAside ? 'flex size-8 shrink-0 items-center justify-center' : 'h-6 min-w-0 flex-1 px-1',
                slot.cost === c
                    ? costBtnCls()
                    : 'border-(--theme-divider-border) text-(--theme-modal-text)/40 hover:border-(--theme-accent-bg) hover:text-(--theme-modal-text)'
            ].join(' ')}
            style={costBtnStyle(c, slot.cost === c)}>{costTabsAside ? `${c}C` : `${c} COST`}</button
        >
    {/each}
{/snippet}

{#snippet statAndSubstats()}
    <!-- Main stat + second stat combined -->
    <div class="relative z-20 mb-2">
        <button
            data-main-stat-trigger={mainStatTriggerKey}
            onclick={onmainstat}
            data-sf="widget"
            data-sf-flat
            class="w-full rounded-none border px-3 py-2 transition-colors hover:border-(--theme-accent-bg) hover:bg-[color-mix(in_srgb,var(--theme-modal-text)_5%,var(--sf-mix,var(--theme-input-bg)))]"
            style="border-color: var(--theme-divider-border); --sf-base: var(--theme-input-bg);"
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
    <div
        class={costTabsAside ? 'border-t pt-2' : ''}
        style={costTabsAside ? 'border-color: var(--theme-divider-border);' : ''}
    >
        {#if !costTabsAside}
            <span
                class="mb-1 flex items-center gap-1.5 border-t pt-2 text-[10px] font-black tracking-[0.18em] text-(--theme-modal-text)/40"
                style="border-color: var(--theme-divider-border);">副词条 ({slot.substats.length}/5)</span
            >
        {/if}
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
                        data-sf="widget"
                        data-sf-flat
                        role="listitem"
                        transition:slide={slideParams(MOTION_MS.base)}
                        class={[
                            'flex items-center gap-2 rounded-none border border-(--theme-divider-border) px-2 py-1.5 transition-all touch-none',
                            ondragstart ? 'cursor-grab active:cursor-grabbing' : '',
                            isDragged && !dragOutside && 'ring-2 ring-(--theme-accent-bg)',
                            isDragged && dragOutside && 'ring-2 ring-red-500 opacity-50'
                        ].join(' ')}
                        style="--sf-base: var(--theme-input-bg);"
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
                                data-sf="widget"
                                data-sf-flat
                                class="shrink-0 rounded-none p-0.5 text-(--theme-modal-text)/40 transition-colors hover:text-red-500"
                                style="--sf-base: var(--theme-input-bg)"
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
                    transition:slide={slideParams(MOTION_MS.base)}
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
                    <Button
                        variant="text"
                        size="none"
                        bare
                        surface="none"
                        onclick={onaddsubstat}
                        data-sf="widget"
                        data-sf-flat
                        backgroundImage="transparent"
                        class="gap-1 border border-(--theme-divider-border) px-2 py-1 text-[10px] font-black text-(--theme-accent-text) transition-colors hover:border-(--theme-accent-bg) hover:bg-(--theme-input-bg)"
                        style="--sf-base: var(--theme-input-bg)"
                    >
                        <Icon icon="mdi:plus" class="size-3" />
                        选择副词条
                    </Button>
                {/if}
                {#if !costTabsAside}
                    <Button
                        variant="text"
                        size="none"
                        bare
                        surface="none"
                        onclick={onclearsubstats}
                        data-sf="widget"
                        data-sf-flat
                        backgroundImage="transparent"
                        class="gap-1 border border-(--theme-divider-border) px-2 py-1 text-[10px] font-black text-(--theme-modal-text)/40 transition-colors hover:border-red-500/50 hover:text-red-500"
                        style="--sf-base: var(--theme-input-bg)"
                        title="清空该声骸的副词条"
                    >
                        <Icon icon="mdi:refresh" class="size-3" />
                        重置副词条
                    </Button>
                {/if}
            </div>
        {:else}
            <div class="mt-2 flex flex-wrap items-center gap-2">
                <Button
                    variant="text"
                    size="none"
                    bare
                    surface="none"
                    onclick={onaddsubstat}
                    data-sf="widget"
                    data-sf-flat
                    backgroundImage="transparent"
                    class="gap-1 border border-(--theme-divider-border) px-2 py-1 text-[10px] font-black text-(--theme-accent-text) transition-colors hover:border-(--theme-accent-bg) hover:bg-(--theme-input-bg)"
                    style="--sf-base: var(--theme-input-bg)"
                >
                    <Icon icon="mdi:plus" class="size-3" />
                    选择副词条
                </Button>
                {#if onenhance}
                    <Button
                        variant="text"
                        size="none"
                        bare
                        surface="none"
                        onclick={onenhance}
                        data-sf="widget"
                        data-sf-flat
                        backgroundImage="transparent"
                        class="gap-1 border border-(--theme-divider-border) px-2 py-1 text-[10px] font-black text-(--theme-accent-text) transition-colors hover:border-(--theme-accent-bg) hover:bg-(--theme-input-bg)"
                        style="--sf-base: var(--theme-input-bg)"
                    >
                        <Icon icon="mdi:dice-5" class="size-3" />
                        随机强化
                    </Button>
                {/if}
            </div>
        {/if}
    </div>
{/snippet}

<div
    data-sf="widget"
    data-sf-flat
    class="relative min-w-[13rem] rounded-none border p-4 {className ?? ''}"
    style="border-color: var(--theme-divider-border); {styleProp || ''}"
>
    {#if costTabsAside}
        <!-- 左右结构：左侧竖排正方形 cost 页签（4C/3C/1C）+ 左下角无边框重置图标（上方一条分界线）；右侧为主词条 + 副词条；左右之间有分割线 -->
        <div class="relative z-1 flex items-stretch">
            <div class="flex shrink-0 flex-col items-center gap-1.5 border-r border-(--theme-divider-border) pr-2.5">
                {@render costTabs()}
                {#if slot.substats.length > 0}
                    <div class="mt-auto flex flex-col items-center border-t border-(--theme-divider-border) pt-1.5">
                        <button
                            onclick={onclearsubstats}
                            data-sf="widget"
                            data-sf-flat
                            class="flex size-8 cursor-pointer items-center justify-center rounded-none text-(--theme-modal-text)/40 transition-colors hover:text-red-500"
                            style="--sf-base: var(--theme-input-bg)"
                            title="清空该声骸的副词条"
                        >
                            <Icon icon="mdi:refresh" class="size-4" />
                        </button>
                    </div>
                {/if}
            </div>
            <div class="relative min-w-0 flex-1 pl-3">
                {@render costWatermark()}
                <div class="relative z-1">{@render statAndSubstats()}</div>
            </div>
        </div>
    {:else}
        {@render costWatermark()}
        <div class="relative z-1">
            <!-- Cost selector：按钮平分卡片宽度 -->
            <div class="mb-3 flex items-center gap-1">{@render costTabs()}</div>
            {@render statAndSubstats()}
        </div>
    {/if}
</div>
