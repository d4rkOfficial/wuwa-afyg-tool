<script lang="ts">
    /**
     * @desc 「乘区引用」配置弹窗（Phase 5.6：自 `buff-entity-edit-modal.svelte` **原样抽出**，标记与行为未改）：
     * 引用属性下拉 + 换算口径卡（超过 N 的部分 / 线性地·离散地 / 每 N 换 M）+ 下限上限。
     *
     * 职责边界：
     * - 本组件持有**引用草稿**（11 个 `$state`），只在「确认」时把结果交回父组件（`onconfirm`）、
     *   「清除」走 `onclear` —— 父组件持有的 Buff 草稿仍是唯一真相源，本组件不直接改数据。
     * - `open` 由父组件传入（父组件用同一个值决定是否打开本弹窗），本组件**不回读**父组件状态，
     *   避免出现两个真相源（参见 `settings/sections/ai.svelte` 的同类教训）。
     * - 打开时用 `untrack` 从 `zoneRef` / `zoneId` 重新初始化草稿：只跟随 `open` 的假→真跳变，
     *   与改前 `openRefModal()` 里「先写 11 个 `$state`、最后置 `showRefModal = true`」逐句等价。
     *
     * 「超过 / 下限 / 上限」三个开关按钮的类串与条件**逐字相同**，收敛为 snippet `refToggleBtn`。
     */
    import Icon from '@iconify/svelte'
    import Button from '$lib/components/ui/button.svelte'
    import { untrack } from 'svelte'
    import { slide } from 'svelte/transition'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import Tabs from '$lib/components/ui/tabs.svelte'
    import { ZONE_MAP, ZONE_REF_DEFS, ZONE_REF_MAP } from '$lib/calc/calculation.consts'
    import type { BuffEntityType, BuffLibraryZoneRef } from '$lib/data/buff-library.svelte'
    import { MOTION_MS, slideParams } from '$lib/utils/motion'
    import { mergeClass } from '$lib/utils/component-style'
    import { simplifyPct } from './buff-entity-utils'

    interface Props extends ComponentsProps {
        open: boolean
        entityType: BuffEntityType
        entityName: string
        /** @desc 正在配置引用的乘区 id（父组件由 `refZoneIndex` 推出后传入） */
        zoneId: string
        /** @desc 该乘区已存在的引用（无则 undefined）；打开时用它初始化草稿 */
        zoneRef?: BuffLibraryZoneRef
        /** @desc 父组件关闭本弹窗（取消 / Esc / 右上角关闭） */
        onclose?: () => void
        /** @desc 确认引用：父组件写回该乘区（设引用即清覆盖） */
        onconfirm?: (ref: BuffLibraryZoneRef) => void
        /** @desc 清除该乘区的引用 */
        onclear?: () => void
    }

    let {
        open,
        entityType,
        entityName,
        zoneId,
        zoneRef,
        onclose,
        onconfirm,
        onclear,
        class: className,
        style: styleProp
    }: Props = $props()

    let refTargetZoneId = $state('baseAtk')
    let refThreshold = $state(0)
    let refLower = $state<number | undefined>(undefined)
    let refUpper = $state<number | undefined>(undefined)
    let showRefZoneMenu = $state(false)
    let refHasThreshold = $state(true)
    let refDivisor = $state(10)
    let refMultiplier = $state(0)
    let refHasLower = $state(false)
    let refHasUpper = $state(false)
    let refIsDiscrete = $state(false)

    // ── 引用值转换口径（线性地 / 离散地）：2 选 1 分段页签，交给 ui/tabs（与 buff-modal 同一实现）──
    /** @desc 转换口径页签；顺序即分段顺序（false=线性地、true=离散地） */
    const REF_MODE_TABS = [
        { value: 'linear', label: '线性地' },
        { value: 'discrete', label: '离散地' }
    ]
    /** @desc 页签回调入参是分段 value（string），校验后写回受控状态 */
    const pickRefMode = (next: string) => {
        if (next === 'linear') refIsDiscrete = false
        else if (next === 'discrete') refIsDiscrete = true
    }

    /** @desc 打开（open 假→真）时按当前乘区的已有引用重置草稿；untrack 保证只跟随 open */
    $effect(() => {
        if (!open) return
        untrack(() => {
            showRefZoneMenu = false
            if (zoneRef) {
                refTargetZoneId = zoneRef.targetZoneId
                refThreshold = zoneRef.threshold ?? 0
                refLower = zoneRef.lower
                refUpper = zoneRef.upper
                const s = simplifyPct(zoneRef.pct)
                refDivisor = zoneRef.divisor ?? s.divisor
                refMultiplier = zoneRef.multiplier ?? s.multiplier
                refIsDiscrete = zoneRef.discrete ?? false
                refHasThreshold = true
                refHasLower = zoneRef.lower !== undefined
                refHasUpper = zoneRef.upper !== undefined
            } else {
                refTargetZoneId = 'baseAtk'
                refThreshold = 0
                refLower = undefined
                refUpper = undefined
                refDivisor = 10
                refMultiplier = 0
                refIsDiscrete = false
                refHasThreshold = true
                refHasLower = false
                refHasUpper = false
            }
            if (refTargetZoneId === zoneId) {
                const fallback = ZONE_REF_DEFS.find((d) => d.id !== zoneId)
                refTargetZoneId = fallback?.id ?? 'baseAtk'
            }
        })
    })

    let refTargetDef = $derived(ZONE_REF_MAP.get(refTargetZoneId) ?? ZONE_MAP.get(refTargetZoneId as never) ?? null)
    let refTargetDefUnit = $derived(refTargetDef?.unit === '%' ? '%' : '点')
    let currentZoneDef = $derived(ZONE_MAP.get(zoneId as never) ?? null)
    let currentZoneUnit = $derived(currentZoneDef?.unit === '%' ? '%' : '点')

    /** @desc 确认引用：由 除数/乘数 反算百分比并交给父组件（设引用即清覆盖） */
    const confirmRef = () => {
        const pct = refDivisor !== 0 ? (refMultiplier / refDivisor) * 100 : 0
        const ref: BuffLibraryZoneRef = {
            targetZoneId: refTargetZoneId,
            threshold: refHasThreshold ? refThreshold : 0,
            pct,
            lower: refHasLower && refLower !== undefined && !isNaN(refLower) ? refLower : undefined,
            upper: refHasUpper && refUpper !== undefined && !isNaN(refUpper) ? refUpper : undefined,
            discrete: refIsDiscrete,
            divisor: refDivisor,
            multiplier: refMultiplier,
            refOwner: entityType === 'character' ? 'self' : 'owner'
        }
        onconfirm?.(ref)
        onclose?.()
    }

    /** @desc 清除引用 */
    const clearRef = () => {
        onclear?.()
        onclose?.()
    }
</script>

{#snippet refToggleBtn(active: boolean, onclick: () => void, label: string)}
    <button
        {onclick}
        class={[
            'px-3 py-1.5 text-xs font-medium transition-all',
            active
                ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12'
                : 'text-(--theme-modal-text)/25 bg-transparent hover:text-(--theme-modal-text)/50'
        ].join(' ')}
    >
        {label}
    </button>
{/snippet}

<Modal {open} {onclose} layer="nested" class={mergeClass(['w-120', className])} style={styleProp}>
    {#snippet title()}
        <Icon icon="mdi:link-variant" class="size-4 shrink-0 self-center" style="color: var(--theme-accent-text);" />
        引用
        <span
            class="text-lg scale-110 inline-block leading-none text-(--theme-accent-text)"
            style="color: var(--theme-accent-text);"
        >
            {entityName}
        </span>
        {entityType === 'character' ? '自身的' : '装备者的'}
    {/snippet}

    <div class="space-y-4">
        <!-- Zone selector -->
        <div role="group" aria-label="引用属性">
            <span class="text-[10px] text-(--theme-modal-text)/50 block mb-1.5">引用属性</span>
            <div class="relative">
                <button
                    onclick={() => (showRefZoneMenu = !showRefZoneMenu)}
                    class="w-full flex items-center justify-between rounded-none border px-3 py-2 text-xs text-(--theme-modal-text) transition-colors hover:bg-(--theme-modal-text)/5"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                >
                    <span class="truncate">{refTargetDef?.label ?? refTargetZoneId}</span>
                    <Icon icon="mdi:chevron-down" class="size-3.5 shrink-0 text-(--theme-modal-text)/40" />
                </button>
                {#if showRefZoneMenu}
                    <div
                        class="theme-scrollbar absolute left-0 top-full z-10 mt-1.5 w-full max-h-60 overflow-y-auto rounded-none border bg-(--theme-modal-bg) py-1 backdrop-blur-lg"
                        style="border-color: var(--theme-divider-border);"
                        onclick={(e) => e.stopPropagation()}
                    >
                        {#each ZONE_REF_DEFS.filter((d) => d.id !== zoneId) as def (def.id)}
                            <button
                                onclick={() => {
                                    refTargetZoneId = def.id
                                    showRefZoneMenu = false
                                }}
                                class={[
                                    'flex w-full items-center gap-2 px-3 py-2 text-xs text-left transition-colors',
                                    refTargetZoneId === def.id
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

        <!-- Conversion rule card -->
        {#if refTargetDef && currentZoneDef}
            <div
                transition:slide|local={slideParams(MOTION_MS.base)}
                class="rounded-none border px-4 py-3.5 space-y-3"
                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
            >
                <div class="text-xs text-(--theme-modal-text)/60">
                    <span class="font-medium text-(--theme-modal-text)/80">{refTargetDef.label}</span>
                </div>

                <!-- Line 1: 超过 [threshold] unit1 的部分 -->
                <div
                    class="flex items-center rounded-none border overflow-hidden"
                    style="border-color: var(--theme-divider-border);"
                >
                    {@render refToggleBtn(refHasThreshold, () => (refHasThreshold = !refHasThreshold), '超过')}
                    <div
                        class="flex items-center flex-1 px-3 py-1.5 border-x"
                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                    >
                        <input
                            type="number"
                            bind:value={refThreshold}
                            disabled={!refHasThreshold}
                            class="w-full min-w-0 text-xs outline-none tabular-nums text-center bg-transparent disabled:text-(--theme-modal-text)/20"
                            class:text-(--theme-modal-text)={refHasThreshold}
                        />
                        <span class="text-xs text-(--theme-modal-text)/40">{refTargetDefUnit}</span>
                    </div>
                    <span class="text-xs text-(--theme-modal-text)/40 px-3 py-1.5">的部分</span>
                </div>

                <!-- Conversion mode tab：线性地 / 离散地（等宽分段 + 滑动指示块） -->
                <Tabs
                    items={REF_MODE_TABS}
                    value={refIsDiscrete ? 'discrete' : 'linear'}
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
                            bind:value={refDivisor}
                            class="w-full min-w-0 text-xs text-(--theme-modal-text) outline-none tabular-nums text-center bg-transparent"
                        />
                        <span class="text-xs text-(--theme-modal-text)/40">{refTargetDefUnit}</span>
                    </div>
                    <span
                        class="text-xs text-(--theme-modal-text)/40 px-3 py-1.5 border-r"
                        style="border-color: var(--theme-divider-border);">转换为</span
                    >
                    <div class="flex items-center flex-1 px-3 py-1.5" style="background: var(--theme-input-bg);">
                        <input
                            type="number"
                            bind:value={refMultiplier}
                            class="w-full min-w-0 text-xs text-(--theme-modal-text) outline-none tabular-nums text-center bg-transparent"
                        />
                        <span class="text-xs text-(--theme-modal-text)/40">{currentZoneUnit}</span>
                    </div>
                </div>

                <!-- Footer: 的 targetName -->
                <div class="flex justify-end text-sm text-(--theme-modal-text)/60">
                    <span class="text-(--theme-modal-text)/30">的</span>
                    <span class="font-medium text-(--theme-accent-text) ml-1">{currentZoneDef.label}</span>
                </div>
            </div>
        {/if}

        <!-- Lower & Upper -->
        <div class="flex gap-2">
            <div
                class="flex items-center flex-1 rounded-none border overflow-hidden"
                style="border-color: var(--theme-divider-border);"
            >
                {@render refToggleBtn(refHasLower, () => (refHasLower = !refHasLower), '下限')}
                <div
                    class="flex items-center flex-1 px-3 py-1.5 border-x"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                >
                    <input
                        type="number"
                        bind:value={refLower}
                        disabled={!refHasLower}
                        class="w-full min-w-0 text-xs outline-none tabular-nums text-center bg-transparent disabled:text-(--theme-modal-text)/20"
                        class:text-(--theme-modal-text)={refHasLower}
                    />
                </div>
                <span class="text-xs text-(--theme-modal-text)/40 px-3 py-1.5">{currentZoneUnit}</span>
            </div>
            <div
                class="flex items-center flex-1 rounded-none border overflow-hidden"
                style="border-color: var(--theme-divider-border);"
            >
                {@render refToggleBtn(refHasUpper, () => (refHasUpper = !refHasUpper), '上限')}
                <div
                    class="flex items-center flex-1 px-3 py-1.5 border-x"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                >
                    <input
                        type="number"
                        bind:value={refUpper}
                        disabled={!refHasUpper}
                        class="w-full min-w-0 text-xs outline-none tabular-nums text-center bg-transparent disabled:text-(--theme-modal-text)/20"
                        class:text-(--theme-modal-text)={refHasUpper}
                    />
                </div>
                <span class="text-xs text-(--theme-modal-text)/40 px-3 py-1.5">{currentZoneUnit}</span>
            </div>
        </div>
    </div>

    {#snippet footer()}
        <div
            class="flex items-center justify-between mt-5 pt-4 border-t"
            style="border-color: var(--theme-divider-border);"
        >
            <Button
                variant="text"
                size="none"
                bare
                onclick={clearRef}
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
                <Button
                    variant="text"
                    size="none"
                    bare
                    onclick={confirmRef}
                    backgroundImage="var(--theme-accent-bg)"
                    textColor="var(--theme-accent-text-on-bg, #ffffff)"
                    class="px-4 py-1.5 text-xs transition-all hover:brightness-125">确认</Button
                >
            </div>
        </div>
    {/snippet}
</Modal>
