<script lang="ts">
    /**
     * @desc 引用换算规则与 clamp 卡（自 `buff-modal-ref-modal.svelte` 再抽一层，标记与行为未改）：
     * 「超过 N 的部分」＋ 线性/离散口径页签 ＋「每 N 换 M」＋「的 X」＋ 下限/上限。
     *
     * 职责边界：纯受控视图 —— 草稿 `ui` 由父组件（`buff-modal-ref-modal`）持有并 `$bindable` 双向绑定，
     * 本组件只读写字段（`ui.hasThreshold = !ui.hasThreshold` 之类），不改任何 store、不注册 effect。
     * 单位文案（`refTargetDefUnit` / `currentZoneUnit`）由父组件算好传入，避免此处重复查表。
     */
    import type { ComponentsProps } from '$lib/types'
    import Tabs from '$lib/components/ui/tabs.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import { REF_MODE_TABS } from './buff-modal.consts'
    import type { RefModalState } from './buff-modal.utils'

    interface Props extends ComponentsProps {
        /** @desc 引用草稿（父组件持有，双向绑定） */
        ui: RefModalState
        /** @desc 引用属性显示名（未选中时兜底用 id） */
        targetLabel: string
        /** @desc 引用属性单位文案（`%` 或 `点`） */
        targetUnit: string
        /** @desc 当前乘区显示名 */
        currentLabel: string
        /** @desc 当前乘区单位文案（`%` 或 `点`） */
        currentUnit: string
    }

    let {
        ui = $bindable(),
        targetLabel,
        targetUnit,
        currentLabel,
        currentUnit,
        class: className,
        style: styleProp
    }: Props = $props()

    /** @desc 根容器类名（`class` 落在换算卡上，供外部定制） */
    const cardClass = $derived(mergeClass(['rounded-none border px-4 py-3.5 space-y-3', className]))

    /** @desc 页签回调入参是分段 value（string），校验后写回受控状态 */
    const pickRefMode = (next: string) => {
        if (next === 'linear') ui.isDiscrete = false
        else if (next === 'discrete') ui.isDiscrete = true
    }
</script>

<div
    class={cardClass}
    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);{styleProp || ''}"
>
    <!-- Header: refAttr -->
    <div class="text-xs text-(--theme-modal-text)/60">
        <span class="font-medium text-(--theme-modal-text)/80">{targetLabel}</span>
    </div>

    <!-- Line 1: 超过 [threshold] unit1 的部分 -->
    <div
        class="flex items-center rounded-none border overflow-hidden"
        style="border-color: var(--theme-divider-border);"
    >
        <button
            onclick={() => {
                ui.hasThreshold = !ui.hasThreshold
            }}
            class={[
                'px-3 py-1.5 text-xs font-medium transition-all',
                ui.hasThreshold
                    ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12'
                    : 'text-(--theme-modal-text)/25 bg-transparent hover:text-(--theme-modal-text)/50'
            ].join(' ')}
        >
            超过
        </button>
        <div
            class="flex items-center flex-1 px-3 py-1.5 border-x"
            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
        >
            <input
                type="number"
                bind:value={ui.threshold}
                disabled={!ui.hasThreshold}
                class="w-full min-w-0 text-xs outline-none tabular-nums text-center bg-transparent disabled:text-(--theme-modal-text)/20"
                class:text-(--theme-modal-text)={ui.hasThreshold}
            />
            <span class="text-xs text-(--theme-modal-text)/40">{targetUnit}</span>
        </div>
        <span class="text-xs text-(--theme-modal-text)/40 px-3 py-1.5">的部分</span>
    </div>

    <!-- Conversion mode tab：线性地 / 离散地（等宽分段 + 滑动指示块） -->
    <Tabs
        items={REF_MODE_TABS}
        value={ui.isDiscrete ? 'discrete' : 'linear'}
        onchange={pickRefMode}
        backgroundImage="color-mix(in srgb, var(--theme-accent-bg) 12%, transparent)"
        textColor="var(--theme-accent-text)"
        class="[&>button]:py-1.5 [&>button]:text-xs"
    />

    <!-- Line 2: 每 [divisor] unit1 转换为 [multiplier] unit2 -->
    <div
        class="flex items-center rounded-none border overflow-hidden"
        style="border-color: var(--theme-divider-border);"
    >
        <span
            class="text-xs text-(--theme-modal-text)/40 px-3 py-1.5 border-r"
            style="border-color: var(--theme-divider-border);">每</span
        >
        <div
            class="flex items-center flex-1 px-3 py-1.5 border-r"
            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
        >
            <input
                type="number"
                bind:value={ui.divisor}
                class="w-full min-w-0 text-xs text-(--theme-modal-text) outline-none tabular-nums text-center bg-transparent"
            />
            <span class="text-xs text-(--theme-modal-text)/40">{targetUnit}</span>
        </div>
        <span
            class="text-xs text-(--theme-modal-text)/40 px-3 py-1.5 border-r"
            style="border-color: var(--theme-divider-border);">转换为</span
        >
        <div class="flex items-center flex-1 px-3 py-1.5" style="background: var(--theme-input-bg);">
            <input
                type="number"
                bind:value={ui.multiplier}
                class="w-full min-w-0 text-xs text-(--theme-modal-text) outline-none tabular-nums text-center bg-transparent"
            />
            <span class="text-xs text-(--theme-modal-text)/40">{currentUnit}</span>
        </div>
    </div>

    <!-- Footer: 的 targetName -->
    <div class="flex justify-end text-sm text-(--theme-modal-text)/60">
        <span class="text-(--theme-modal-text)/30">的</span>
        <span class="font-medium text-(--theme-accent-text) ml-1">{currentLabel}</span>
    </div>
</div>

<!-- Lower & Upper -->
<div class="flex gap-2">
    <div
        class="flex items-center flex-1 rounded-none border overflow-hidden"
        style="border-color: var(--theme-divider-border);"
    >
        <button
            onclick={() => {
                ui.hasLower = !ui.hasLower
            }}
            class={[
                'px-3 py-1.5 text-xs font-medium transition-all',
                ui.hasLower
                    ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12'
                    : 'text-(--theme-modal-text)/25 bg-transparent hover:text-(--theme-modal-text)/50'
            ].join(' ')}
        >
            下限
        </button>
        <div
            class="flex items-center flex-1 px-3 py-1.5 border-x"
            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
        >
            <input
                type="number"
                bind:value={ui.lower}
                disabled={!ui.hasLower}
                class="w-full min-w-0 text-xs outline-none tabular-nums text-center bg-transparent disabled:text-(--theme-modal-text)/20"
                class:text-(--theme-modal-text)={ui.hasLower}
            />
        </div>
        <span class="text-xs text-(--theme-modal-text)/40 px-3 py-1.5">{currentUnit}</span>
    </div>
    <div
        class="flex items-center flex-1 rounded-none border overflow-hidden"
        style="border-color: var(--theme-divider-border);"
    >
        <button
            onclick={() => {
                ui.hasUpper = !ui.hasUpper
            }}
            class={[
                'px-3 py-1.5 text-xs font-medium transition-all',
                ui.hasUpper
                    ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12'
                    : 'text-(--theme-modal-text)/25 bg-transparent hover:text-(--theme-modal-text)/50'
            ].join(' ')}
        >
            上限
        </button>
        <div
            class="flex items-center flex-1 px-3 py-1.5 border-x"
            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
        >
            <input
                type="number"
                bind:value={ui.upper}
                disabled={!ui.hasUpper}
                class="w-full min-w-0 text-xs outline-none tabular-nums text-center bg-transparent disabled:text-(--theme-modal-text)/20"
                class:text-(--theme-modal-text)={ui.hasUpper}
            />
        </div>
        <span class="text-xs text-(--theme-modal-text)/40 px-3 py-1.5">{currentUnit}</span>
    </div>
</div>
