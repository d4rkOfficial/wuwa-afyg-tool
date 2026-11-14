<script lang="ts">
    /**
     * @desc Buff 预设编辑器 → 中部「就地编辑器」栏目：作用域 / 链阶硬门槛 / 乘区贡献条目列表。
     *
     * 职责边界：
     * - 本组件是**受控区域**：Buff 草稿与两条视图状态（`expandedZoneIdx` / `condPanelOpen`）都归外壳所有，
     *   两条视图状态用 `$bindable` 双向绑定 —— 外壳的 `selectBuff` / `addBuff` / `removeBuff` / 打开重置
     *   共 4 条路径都要把 `expandedZoneIdx` / `condPanelOpen` 归零，状态留在外壳才能在一处完成这些重置
     *   （与 `result/analysis/segment-dps.svelte` 用 `$bindable` 同一做法）。
     * - `buff` 由外壳传入（外壳用同一个值决定渲染本区域还是空态），本组件**不回读**外壳状态。
     * - 三个乘区行内开关按钮（覆盖 / 引用 / 条件）的类串与条件**逐字相同**，收敛为 snippet `zoneToggleBtn`。
     * - 链/阶折叠动画走 `slideParams(MOTION_MS.base)`（180ms，且跟随「减弱动态效果」），
     *   与同一弹窗里引用配置卡的写法一致 —— `scripts/check-motion.mjs` ③ 禁止指令内联手写时长。
     */
    import Icon from '@iconify/svelte'
    import Button from '$lib/components/ui/button.svelte'
    import { slide } from 'svelte/transition'
    import type { ComponentsProps } from '$lib/types'
    import ZoneConditionPanel from './zone-condition-panel.svelte'
    import BuffModalRules from './buff-modal-rules.svelte'
    import { ZONE_MAP, ZONE_NO_OVERRIDE_IDS, ZONE_NO_REF_IDS, ZONE_REF_MAP } from '$lib/calc/calculation.consts'
    import type { BuffLibraryBuff, BuffLibraryScope } from '$lib/data/buff-library.svelte'
    import type { BuffRule } from '$lib/calc/calculation.types'
    import {
        LIBRARY_RULE_KINDS,
        LIBRARY_ZONE_COMPARE_OPTIONS,
        describeLibraryRules,
        isActiveRefOwner
    } from '$lib/calc/buff-library-condition'
    import BuffPathInput from './buff-path-input.svelte'
    import { describeCondition, describeZoneConditionBadge } from '$lib/calc/condition'
    import { joinStyle, mergeClass } from '$lib/utils/component-style'
    import { MOTION_MS, slideParams } from '$lib/utils/motion'
    import { simplifyPct, zoneLabel, zoneUnit } from './buff-entity-utils'

    interface Props extends ComponentsProps {
        /** @desc 当前编辑的 Buff（null = 无条目，渲染空态） */
        buff: BuffLibraryBuff | null
        /** @desc 当前 Buff 的下标（回传给外壳的改名 / 删除 / 作用域回调用） */
        buffIndex: number
        /** @desc 展开行内「乘区条件」面板的乘区下标（绑定自外壳，外壳切条目时要归零） */
        expandedZoneIdx: number | null
        /** @desc 门槛条件折叠面板是否展开（绑定自外壳，打开弹窗时要归零） */
        condPanelOpen: boolean
        onrename?: (idx: number, value: string) => void
        onremove?: (idx: number) => void
        onscope?: (idx: number, scope: BuffLibraryScope) => void
        /** @desc 写回当前 Buff 的 Buff 级规则（链阶 / 伤害名 / 面板数值 / 敌人类型） */
        onrules?: (rules: BuffRule[]) => void
        onPatchZone?: (zoneIndex: number, patch: Partial<BuffLibraryBuff['zones'][number]>) => void
        onoverride?: (zoneIndex: number, override: boolean) => void
        onRemoveZone?: (zoneIndex: number) => void
        onOpenRef?: (zoneIndex: number) => void
    }

    let {
        buff,
        buffIndex,
        expandedZoneIdx = $bindable(),
        condPanelOpen = $bindable(),
        onrename,
        onremove,
        onscope,
        onrules,
        onPatchZone,
        onoverride,
        onRemoveZone,
        onOpenRef,
        class: className,
        style: styleProp
    }: Props = $props()

    /**
     * @desc 受益目标（Buff 库作用域）：与工程的四种作用域一一对应 ——
     * 自己 / 队友（自己除外）→ 角色子集，**全队**=只有三名角色，**通用**=三名角色 + 效应，效应=仅效应。
     */
    const SCOPE_TABS: { value: BuffLibraryScope; label: string }[] = [
        { value: 'self', label: '自己' },
        { value: 'self_except', label: '队友' },
        { value: 'team_only', label: '全队' },
        { value: 'team', label: '通用' },
        { value: 'effect_only', label: '效应' }
    ]

    /** @desc 各实体类型可配置的条件：Buff 级规则对任何实体都成立（导入时按实体归属重指） */
    const zones = $derived(buff?.zones ?? [])

    /** @desc 门槛条件摘要（Buff 级规则的紧凑文案；空条件返回空串） */
    const rulesSummary = $derived(describeLibraryRules(buff?.rules))
</script>

<div
    class={mergeClass(['flex min-w-0 flex-1 flex-col rounded-none border', className])}
    style={joinStyle(['border-color: var(--theme-divider-border);', styleProp || ''])}
>
    {#snippet zoneToggleBtn(
        active: boolean,
        onclick: () => void,
        title: string | undefined,
        icon: string,
        label: string
    )}
        <button
            {onclick}
            {title}
            class={[
                'shrink-0 rounded-none border px-1.5 py-0.5 text-[10px] transition-colors flex items-center gap-0.5',
                active
                    ? 'border-(--theme-accent-bg) text-(--theme-accent-text)'
                    : 'border-transparent text-(--theme-modal-text)/30 hover:border-(--theme-divider-border) hover:text-(--theme-modal-text)/60'
            ].join(' ')}
        >
            <Icon {icon} class="size-3" />
            {label}
        </button>
    {/snippet}

    {#if buff}
        <div class="flex shrink-0 flex-col gap-2 border-b px-3 py-2" style="border-color: var(--theme-divider-border);">
            <div class="flex items-center gap-2">
                <BuffPathInput
                    value={buff.buffName}
                    oncommit={(value) => onrename?.(buffIndex, value)}
                    class="flex-1"
                />
                <Button
                    variant="text"
                    bare
                    pad="p-1"
                    onclick={() => onremove?.(buffIndex)}
                    class="shrink-0 text-(--theme-modal-text)/40 transition-colors hover:text-red-500"
                    title="删除该 Buff"
                >
                    <Icon icon="mdi:delete-outline" class="size-3.5" />
                </Button>
            </div>
            <div
                class="flex shrink-0 overflow-hidden rounded-none border"
                style="border-color: var(--theme-divider-border);"
                title="受益目标：自己=仅自身；队友=自己除外；全队=仅三名角色（不含效应）；通用=三名角色+效应；效应=效应专属（互斥）"
            >
                {#each SCOPE_TABS as t (t.value)}
                    <button
                        onclick={() => onscope?.(buffIndex, t.value)}
                        class={[
                            'flex-1 px-2.5 py-1 text-xs transition-colors',
                            (buff.scope ?? 'team') === t.value
                                ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12'
                                : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'
                        ].join(' ')}
                    >
                        {t.label}
                    </button>
                {/each}
            </div>
        </div>

        <!-- 门槛条件（Buff 级规则：链/阶、伤害名正则、角色面板数值、敌人类型；全部 AND） -->
        <div class="shrink-0 border-b" style="border-color: var(--theme-divider-border);">
            <button
                onclick={() => (condPanelOpen = !condPanelOpen)}
                class={[
                    'flex w-full items-center gap-1.5 px-3 py-2 text-left text-[10px] transition-colors hover:bg-(--theme-modal-text)/5',
                    rulesSummary ? 'text-(--theme-accent-text)' : 'text-(--theme-modal-text)/60'
                ].join(' ')}
                title="Buff 级门槛条件：列出的条件全部满足才生效"
            >
                <Icon
                    icon={condPanelOpen ? 'mdi:chevron-down' : 'mdi:chevron-right'}
                    class="size-3.5 shrink-0 text-(--theme-modal-text)/40"
                />
                <span class="shrink-0">条件</span>
                {#if rulesSummary}
                    <span class="min-w-0 truncate">：{rulesSummary}</span>
                {:else}
                    <span class="min-w-0 truncate text-(--theme-modal-text)/30">（无条件，导入后恒生效）</span>
                {/if}
            </button>
            {#if condPanelOpen}
                <div transition:slide|local={slideParams(MOTION_MS.base)} class="flex h-72 px-0 pb-1">
                    <BuffModalRules
                        rules={buff.rules ?? []}
                        charMode="owner"
                        kinds={LIBRARY_RULE_KINDS}
                        zoneCompareOptions={LIBRARY_ZONE_COMPARE_OPTIONS}
                        onsave={(next) => {
                            onrules?.(next)
                            return null
                        }}
                    />
                </div>
            {/if}
        </div>

        <!-- 乘区贡献条目列表（同一乘区可多条，各自带数值 / 引用 / 覆盖 / 乘区级条件） -->
        <div class="theme-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {#if zones.length === 0}
                <div class="py-6 text-center text-xs text-(--theme-modal-text)/30">
                    暂无乘区，请点击右侧乘区清单添加
                </div>
            {:else}
                {#each zones as z, zoneIndex (zoneIndex)}
                    {@const badge = describeZoneConditionBadge(z.condition)}
                    <div class="space-y-1">
                        <div
                            class="flex items-center gap-1.5 rounded-none px-3 py-2"
                            style="background: var(--theme-input-bg);"
                        >
                            <span class="shrink-0 truncate text-xs text-(--theme-modal-text)"
                                >{zoneLabel(z.zoneId)}</span
                            >
                            {#if badge}
                                <span
                                    class="shrink-0 max-w-32 truncate rounded-none border px-1.5 py-0.5 text-[10px]"
                                    style="border-color: transparent; background: color-mix(in srgb, var(--theme-accent-bg) 18%, transparent); color: var(--theme-accent-text);"
                                    title={`该乘区条件：${describeCondition(z.condition)}`}>{badge}</span
                                >
                            {/if}
                            {#if z.override}
                                <span
                                    class="shrink-0 px-1 py-0.5 text-[10px] font-black tracking-tight"
                                    style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                                    title="覆盖优先于一切：该乘区的其它条目都不参与计算">覆盖生效</span
                                >
                            {/if}
                            {#if z.ref && !ZONE_NO_REF_IDS.has(z.zoneId)}
                                {@const refDef =
                                    ZONE_REF_MAP.get(z.ref.targetZoneId) ?? ZONE_MAP.get(z.ref.targetZoneId as never)}
                                {@const refOp = (z.ref.threshold ?? 0) < 0 ? '+' : '-'}
                                {@const refTh = Math.abs(z.ref.threshold ?? 0)}
                                {@const refS = simplifyPct(z.ref.pct)}
                                {@const hasThreshold = (z.ref.threshold ?? 0) !== 0}
                                {@const hasLower = z.ref.lower !== undefined}
                                {@const hasUpper = z.ref.upper !== undefined}
                                <span
                                    class="min-w-0 flex-1 truncate text-right text-[10px] text-(--theme-modal-text)/40"
                                    title="引用: ({refDef?.label ?? '?'}{hasThreshold
                                        ? ' ' + refOp + ' ' + refTh + (refDef?.unit === '%' ? '%' : '')
                                        : ''}) ÷{refS.divisor}×{refS.multiplier}{hasLower || hasUpper
                                        ? ' clamp(' +
                                          (hasLower ? String(z.ref.lower) : '') +
                                          ' ~ ' +
                                          (hasUpper ? String(z.ref.upper) : '') +
                                          ')'
                                        : ''}"
                                >
                                    引用: ({refDef?.label ?? '?'}{hasThreshold
                                        ? refOp + refTh + (refDef?.unit === '%' ? '%' : '')
                                        : ''}) ÷{refS.divisor}×{refS.multiplier}
                                    {#if hasLower || hasUpper}
                                        <span class="text-(--theme-modal-text)/30">
                                            ({hasLower ? z.ref.lower : ''}~{hasUpper ? z.ref.upper : ''})
                                        </span>
                                    {/if}
                                </span>
                            {:else}
                                <div class="flex flex-1 items-center justify-end gap-1">
                                    <input
                                        type="number"
                                        value={z.value}
                                        oninput={(e) =>
                                            onPatchZone?.(zoneIndex, {
                                                value: Number((e.currentTarget as HTMLInputElement).value)
                                            })}
                                        class="w-14 h-6 rounded-none border bg-transparent px-1.5 text-xs text-right tabular-nums text-(--theme-modal-text) outline-none"
                                        style="border-color: var(--theme-divider-border);"
                                    />
                                    <span class="w-3 text-[10px] text-(--theme-modal-text)/40">
                                        {zoneUnit(z.zoneId)}
                                    </span>
                                </div>
                            {/if}
                            {#if !ZONE_NO_OVERRIDE_IDS.has(z.zoneId)}
                                {@render zoneToggleBtn(
                                    !!z.override,
                                    () => onoverride?.(zoneIndex, !z.override),
                                    undefined,
                                    'mdi:swap-horizontal-bold',
                                    z.override ? '覆盖' : '追加'
                                )}
                            {/if}
                            {#if !ZONE_NO_REF_IDS.has(z.zoneId)}
                                {@render zoneToggleBtn(
                                    !!z.ref,
                                    () => onOpenRef?.(zoneIndex),
                                    z.ref
                                        ? `引${isActiveRefOwner(z.ref.refOwner) ? '出伤者' : '本角色'} ${ZONE_REF_MAP.get(z.ref.targetZoneId)?.label ?? z.ref.targetZoneId} × ${z.ref.pct}%`
                                        : '引用某属性（如 本角色攻击×N%）',
                                    'mdi:link-variant',
                                    z.ref ? '已引用' : '引用'
                                )}
                            {/if}
                            <!-- 乘区级生效条件（行内下拉展开）：伤害类型 / 伤害属性 -->
                            {@render zoneToggleBtn(
                                !!z.condition,
                                () => (expandedZoneIdx = expandedZoneIdx === zoneIndex ? null : zoneIndex),
                                z.condition
                                    ? `该乘区条件：${describeCondition(z.condition)}`
                                    : '为该乘区设置生效条件（伤害类型/属性）',
                                expandedZoneIdx === zoneIndex ? 'mdi:chevron-up' : 'mdi:filter-outline',
                                '条件'
                            )}
                            <!-- 移除该乘区条目（同名乘区可添加多个，逐个移除） -->
                            <button
                                onclick={() => onRemoveZone?.(zoneIndex)}
                                class="shrink-0 rounded-none border border-transparent px-1 py-0.5 text-[10px] text-(--theme-modal-text)/30 transition-colors hover:border-red-500/40 hover:text-red-500"
                                title="移除该乘区条目"
                            >
                                <Icon icon="mdi:close" class="size-3" />
                            </button>
                        </div>
                        {#if expandedZoneIdx === zoneIndex}
                            <ZoneConditionPanel
                                condition={z.condition}
                                onchange={(next) => onPatchZone?.(zoneIndex, { condition: next ?? undefined })}
                            />
                        {/if}
                    </div>
                {/each}
            {/if}
        </div>
    {:else}
        <div class="flex flex-1 items-center justify-center text-xs text-(--theme-modal-text)/40">
            点击左侧 Buff 条目进行编辑
        </div>
    {/if}
</div>
