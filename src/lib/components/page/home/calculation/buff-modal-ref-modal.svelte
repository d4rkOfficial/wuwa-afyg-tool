<script lang="ts">
    /**
     * @desc 引用配置弹窗（自 `buff-modal.svelte` **原样抽出**，标记与行为未改）：
     * 选择引用角色/属性，再把换算规则与 clamp（「超过 N 的部分」/ 线性·离散 / 每 N 换 M / 上下限）
     * 交给 `buff-modal-ref-config.svelte`（纯受控视图，同 `ui` 对象双向绑定）。
     *
     * 职责边界：
     * - 「是否打开」由父组件通过 `open` 决定（父组件用 `ui.zoneIndex >= 0` 这一个值同时控制打开与「配置哪个乘区」，
     *   本组件**不回读**父组件状态，避免两个真相源）。
     * - 草稿态（12 个字段）由父组件的 `ui` 状态对象持有并 `$bindable` 双向绑定：父组件的 `openRefModal()`
     *   写草稿 → 置 `zoneIndex`，顺序与原实现逐句相同（原实现就是在父组件里先写 12 个 `$state`、最后置
     *   `showRefModal = true`）。
     * - 确认/清除由父组件落库（`onconfirm` / `onclear`），本组件不 import store。
     */
    import Icon from '@iconify/svelte'
    import Button from '$lib/components/ui/button.svelte'
    import type { ComponentsProps } from '$lib/types'
    import type { CharSlot } from '$lib/types/project'
    import Modal from '$lib/components/layout/modal.svelte'
    import BuffModalRefConfig from './buff-modal-ref-config.svelte'
    import { ZONE_REF_DEFS } from '$lib/calc/calculation.consts'
    import { fallbackIcon } from '$lib/utils/icons'
    import { refTargetDefOf, zoneUnitLabel, type RefModalState } from './buff-modal.utils'

    interface Props extends ComponentsProps {
        /** @desc 是否打开（父组件传 `ui.zoneIndex >= 0`） */
        open: boolean
        /** @desc 该乘区 id（引用属性不能是自身，下拉里要滤掉） */
        zoneId: string
        team: [CharSlot, CharSlot, CharSlot]
        /** @desc 角色头像表（store 能力，由父组件注入） */
        charIconMap: Record<string, string>
        /** @desc 引用草稿（父组件持有，双向绑定） */
        ui: RefModalState
        /** @desc 父组件关闭本弹窗（取消 / Esc / 右上角关闭） */
        onclose: () => void
        /** @desc 确认：把草稿交给父组件落库（父组件负责反算 pct 并写 store） */
        onconfirm: (ui: RefModalState) => void
        /** @desc 清除该乘区已有的引用 */
        onclear: () => void
        /** @desc 打开「速查」（只读引用速查弹窗，由父组件渲染） */
        onlookup: () => void
    }

    let {
        open,
        zoneId,
        team,
        charIconMap,
        ui = $bindable(),
        onclose,
        onconfirm,
        onclear,
        onlookup,
        class: className,
        style: styleProp
    }: Props = $props()

    /** @desc 引用属性定义 / 单位、当前乘区定义 / 单位（换算卡与上下限的单位文案经 props 传入下游） */
    const refTargetDef = $derived(refTargetDefOf(ui.targetZoneId))
    const refTargetDefUnit = $derived(zoneUnitLabel(refTargetDef?.unit))
    const currentZoneDef = $derived(refTargetDefOf(zoneId))
    const currentZoneUnit = $derived(zoneUnitLabel(currentZoneDef?.unit))
</script>

<Modal {open} {onclose} layer="nested" class="w-md">
    {#snippet title()}
        <Icon icon="mdi:link-variant" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        <span>引用配置</span>
        <button
            onclick={onlookup}
            class="ml-auto mr-4 flex items-center gap-1 rounded-none px-2 py-1 text-xs text-(--theme-accent-text) transition-colors hover:bg-(--theme-modal-text)/5"
        >
            <Icon icon="mdi:magnify" class="size-3.5" />
            速查
        </button>
    {/snippet}

    <div class="space-y-4">
        <!-- Character selector (top) -->
        <div role="group" aria-label="引用角色">
            <span class="text-[10px] text-(--theme-modal-text)/50 block mb-1.5">引用角色</span>
            <div class="flex gap-2">
                {#each team as slot, i (i)}
                    <button
                        onclick={() => (ui.characterIdx = i)}
                        class={[
                            'size-9 rounded-full overflow-hidden border-2 transition-all',
                            ui.characterIdx === i
                                ? 'border-(--theme-accent-bg) ring-2 ring-(--theme-accent-bg)/30'
                                : 'border-transparent grayscale opacity-30 hover:opacity-60'
                        ].join(' ')}
                    >
                        {#if slot.character && charIconMap[slot.character]}
                            <img
                                src={charIconMap[slot.character]}
                                alt={slot.character}
                                draggable="false"
                                use:fallbackIcon={'/icons/placeholder-character.svg'}
                                class="h-full w-full object-cover"
                            />
                        {:else}
                            <span
                                class="w-full h-full flex items-center justify-center text-xs font-medium text-(--theme-modal-text)/50"
                                >{slot.character?.charAt(0) ?? '?'}</span
                            >
                        {/if}
                    </button>
                {/each}
            </div>
        </div>

        <!-- Zone selector (below) -->
        <div role="group" aria-label="引用属性">
            <span class="text-[10px] text-(--theme-modal-text)/50 block mb-1.5">引用属性</span>
            <div class="relative">
                <button
                    onclick={() => (ui.zoneMenuOpen = !ui.zoneMenuOpen)}
                    class="w-full flex items-center justify-between rounded-none border px-3 py-2 text-xs text-(--theme-modal-text) transition-colors hover:bg-(--theme-modal-text)/5"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                >
                    <span class="truncate">{refTargetDef?.label ?? ui.targetZoneId}</span>
                    <Icon icon="mdi:chevron-down" class="size-3.5 shrink-0 text-(--theme-modal-text)/40" />
                </button>
                {#if ui.zoneMenuOpen}
                    <div
                        class="theme-scrollbar absolute left-0 top-full z-10 mt-1.5 w-full max-h-60 overflow-y-auto rounded-none border bg-(--theme-modal-bg) py-1 backdrop-blur-lg"
                        style="border-color: var(--theme-divider-border);"
                        onclick={(e) => e.stopPropagation()}
                    >
                        {#each ZONE_REF_DEFS.filter((d) => d.id !== zoneId) as def (def.id)}
                            <button
                                onclick={() => {
                                    ui.targetZoneId = def.id
                                    ui.zoneMenuOpen = false
                                }}
                                class={[
                                    'flex w-full items-center gap-2 px-3 py-2 text-xs text-left transition-colors',
                                    ui.targetZoneId === def.id
                                        ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/15'
                                        : 'text-(--theme-modal-text) hover:bg-(--theme-modal-text)/5'
                                ].join(' ')}
                            >
                                <span class="flex-1">{def.label}</span>
                                <span class="text-[10px] text-(--theme-modal-text)/40"
                                    >{def.unit === '%' ? '%' : ''}</span
                                >
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>

        <!-- Conversion rule card + Lower & Upper（再抽一层：纯受控视图） -->
        {#if refTargetDef && currentZoneDef}
            <BuffModalRefConfig
                bind:ui
                targetLabel={refTargetDef.label}
                targetUnit={refTargetDefUnit}
                currentLabel={currentZoneDef.label}
                currentUnit={currentZoneUnit}
            />
        {/if}
    </div>

    {#snippet footer()}
        <div
            class="mt-5 flex items-center justify-between border-t pt-4"
            style="border-color: var(--theme-divider-border);"
        >
            <Button
                variant="text"
                size="none"
                bare
                onclick={onclear}
                backgroundImage="transparent"
                class="px-3 py-1.5 text-xs text-red-500 transition-colors hover:bg-red-500/15">清除引用</Button
            >
            <div class="flex items-center gap-2">
                <Button
                    variant="text"
                    size="none"
                    bare
                    onclick={onclose}
                    backgroundImage="transparent"
                    class="px-3 py-1.5 text-xs text-(--theme-modal-text)/50 transition-colors hover:bg-(--theme-modal-text)/10"
                    >取消</Button
                >
                <button
                    onclick={() => onconfirm(ui)}
                    class="rounded-none px-4 py-1.5 text-xs transition-all hover:brightness-125"
                    style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);"
                    >确认</button
                >
            </div>
        </div>
    {/snippet}
</Modal>
