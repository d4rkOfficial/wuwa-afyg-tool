<script lang="ts">
    /**
     * @desc 右列「块编辑器」：选中块头部（重命名 / 复制 / 删除）＋ 三个 tab
     * **具体效果 / 生效成员 / 门槛条件**（默认「具体效果」）。
     *
     * 职责边界（受控区，无自有数据状态）：
     * - `buff` 由父组件传入（父组件用同一个值决定渲染本区域还是空态），本组件**不回读**父组件状态。
     * - 当前 tab（`tab`）与行内乘区条件展开项（`expandedZoneIndex`）用 `$bindable` 双向绑定：
     *   父组件要靠 tab 决定右侧「添加乘区」栏是否展开（只有具体效果 tab 展开）。
     * - 名称编辑输入框（`bind:this` 自动聚焦）是**本组件的 DOM 细节**，故重命名草稿与失焦/回车保存
     *   也一并在本组件内完成。父组件不再需要「重命名后聚焦输入框」。
     * - 所有数据写入一律经回调交回父组件（父组件是 store 的唯一调用方）。
     */
    import Icon from '@iconify/svelte'
    import Button from '$lib/components/ui/button.svelte'
    import type { ComponentsProps } from '$lib/types'
    import type { CharSlot } from '$lib/types/project'
    import type { BuffCondition, BuffConf, BuffRule, BuffZoneValue } from '$lib/calc/calculation.types'
    import { buffLeafName } from '$lib/calc/buff-name'
    import { ZONE_MAP, ZONE_NO_REF_IDS, ZONE_REF_MAP } from '$lib/calc/calculation.consts'
    import { describeCondition, describeZoneConditionBadge } from '$lib/calc/condition'
    import { describeRules } from '$lib/calc/rules'
    import { fallbackIcon } from '$lib/utils/icons'
    import { mergeClass } from '$lib/utils/component-style'
    import ZoneConditionPanel from './zone-condition-panel.svelte'
    import BuffModalMembers from './buff-modal-members.svelte'
    import BuffModalRules from './buff-modal-rules.svelte'
    import { simplifyPct } from './buff-modal.utils'

    /** @desc 右列三个 tab（文案已定稿） */
    export type BuffEditorTab = 'effect' | 'members' | 'rules'

    interface Props extends ComponentsProps {
        buff: BuffConf
        team: [CharSlot, CharSlot, CharSlot]
        teamNames: string[]
        charIconMap: Record<string, string>
        /** @desc 当前块是否在全局目录里（全局块不可删，作用域锁定） */
        isGlobal: boolean
        /** @desc 内置默认全局块（global- 前缀）：不可改名 / 不可改作用域 */
        isDefaultGlobal: boolean
        /** @desc 当前 tab（绑定自父组件：只有「具体效果」展开右侧乘区栏） */
        tab: BuffEditorTab
        zones: BuffZoneValue[]
        overrideZoneIds: Set<string>
        externalOverrides: Record<string, { name: string; later: boolean }[]>
        /** @desc 展开行内「乘区条件」面板的乘区下标（绑定自父组件） */
        expandedZoneIndex: number | null
        /** @desc 列表重命名输入框引用（父组件滚动定位用） */
        renameInputEl: HTMLInputElement | null
        /** @desc `buffActive` 条件可引用的 Buff 候选 */
        buffOptions: { id: string; label: string }[]
        /**
         * @desc 头部「并入全局 / 移出全局」按钮（**非多选时**的唯一入口，放在复制/删除旁边）。
         * 多选态的批量入口在左栏底部工具栏，那时父组件传 null。
         */
        globalAction: { label: string; icon: string; disabled: boolean; title: string } | null
        onrename: (value: string) => void
        oncopy: () => void
        ondelete: () => void
        /** @desc 头部「并入/移出全局」点击 */
        onContextGlobal: () => void
        /** @desc 生效成员（作用域）变更 */
        onscope: (scope: 'all' | number[]) => void
        /** @desc 保存 Buff 级规则；返回错误文案（null = 成功） */
        onsaverules: (rules: BuffRule[]) => string | null
        onsetzonevalue: (index: number, value: number) => void
        onoverride: (index: number, override: boolean) => void
        onopenref: (index: number) => void
        onremovezone: (index: number) => void
        ontogglezonecond: (index: number) => void
        onzonecondchange: (index: number, next: BuffCondition | null) => void
    }

    let {
        buff: selectedBuffSet,
        team,
        teamNames,
        charIconMap,
        isGlobal,
        isDefaultGlobal,
        tab = $bindable(),
        zones: selectedZones,
        overrideZoneIds,
        externalOverrides,
        expandedZoneIndex = $bindable(),
        renameInputEl = $bindable(),
        buffOptions,
        globalAction,
        onrename,
        oncopy,
        ondelete,
        onContextGlobal,
        onscope,
        onsaverules,
        onsetzonevalue,
        onoverride,
        onopenref,
        onremovezone,
        ontogglezonecond,
        onzonecondchange,
        class: className,
        style: styleProp
    }: Props = $props()

    /** @desc 名称编辑草稿 */
    let renameValue = $state(buffLeafName(selectedBuffSet.name))
    /** @desc 切换选中块时同步重命名输入框内容 */
    $effect(() => {
        selectedBuffSet.id
        renameValue = buffLeafName(selectedBuffSet.name)
    })
    /** @desc 名称编辑保存（Enter/失焦触发；空名兜底） */
    const handleRenameInline = () => onrename(renameValue.trim() || '未命名BUFF块')

    const slotName = (i: number): string => team[i]?.character ?? `角色 ${i + 1}`
    const ruleSummary = $derived(
        describeRules(selectedBuffSet.rules, {
            slotName,
            buffName: (id) => buffOptions.find((o) => o.id === id)?.label ?? id
        })
    )
    const rulesCount = $derived(selectedBuffSet.rules?.length ?? 0)

    const TABS: { value: BuffEditorTab; label: string; icon: string }[] = [
        { value: 'effect', label: '具体效果', icon: 'mdi:tune-variant' },
        { value: 'members', label: '生效成员', icon: 'mdi:account-group-outline' },
        { value: 'rules', label: '门槛条件', icon: 'mdi:filter-cog-outline' }
    ]
</script>

<div class={mergeClass(['flex min-w-0 flex-1 flex-col', className])} style={styleProp}>
    <!-- @desc 选中块头部：重命名（回车/失焦保存）/复制/删除/并入或移出全局（全局块锁定只读，改名与删除禁用） -->
    <div
        class="shrink-0 border-b px-3 py-2.5 flex items-center gap-2"
        style="border-bottom: 1px solid var(--theme-divider-border);"
    >
        {#if isDefaultGlobal}
            <input
                type="text"
                value={buffLeafName(selectedBuffSet.name)}
                readonly
                class="min-w-0 flex-1 rounded-none border px-2 py-1.5 text-xs font-medium outline-none text-(--theme-modal-text) cursor-default"
                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
            />
        {:else}
            <input
                type="text"
                bind:this={renameInputEl}
                bind:value={renameValue}
                onkeydown={(e) => e.key === 'Enter' && handleRenameInline()}
                onblur={handleRenameInline}
                class="min-w-0 flex-1 rounded-none border px-2 py-1.5 text-xs font-medium outline-none text-(--theme-modal-text)"
                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
            />
        {/if}
        {#if !isGlobal}
            <Button
                variant="text"
                size="none"
                bare
                onclick={oncopy}
                backgroundImage="transparent"
                class="shrink-0 gap-1 border border-(--theme-divider-border) px-2 py-1.5 text-xs text-(--theme-modal-text) transition-colors hover:bg-(--theme-accent-bg)/10"
            >
                <Icon icon="mdi:content-copy" class="size-3.5" />
                复制
            </Button>
            <button
                onclick={ondelete}
                class="shrink-0 flex items-center gap-1 rounded-none border border-red-500 px-2 py-1.5 text-xs text-red-500 transition-colors hover:bg-red-500/20"
            >
                <Icon icon="mdi:delete-outline" class="size-3.5" />
                删除
            </button>
        {:else}
            <span
                class="shrink-0 flex items-center gap-1 border px-2 py-1.5 text-[11px] text-amber-400/80"
                style="border-color: var(--theme-divider-border);"
                title="全局 BUFF 不能删除，需先移出全局"
            >
                <Icon icon="mdi:crown" class="size-3.5" />
                全局
            </span>
        {/if}
        <!-- @desc 并入 / 移出全局（非多选时的唯一入口：就在复制、删除旁边；多选态用左栏底部批量按钮） -->
        {#if globalAction}
            <button
                type="button"
                disabled={globalAction.disabled}
                onclick={onContextGlobal}
                class={[
                    'shrink-0 flex items-center gap-1 rounded-none border px-2 py-1.5 text-xs transition-colors',
                    globalAction.disabled
                        ? 'cursor-not-allowed border-transparent text-(--theme-modal-text)/25'
                        : 'border-(--theme-divider-border) text-(--theme-accent-text) hover:bg-(--theme-accent-bg)/10'
                ].join(' ')}
                title={globalAction.title}
            >
                <Icon icon={globalAction.icon} class="size-3.5" />
                {globalAction.label}
            </button>
        {/if}
    </div>

    <!-- @desc 三个 tab：具体效果（默认）/ 生效成员 / 门槛条件 -->
    <div class="shrink-0 flex items-stretch border-b" style="border-color: var(--theme-divider-border);">
        {#each TABS as item (item.value)}
            {@const on = tab === item.value}
            <button
                type="button"
                onclick={() => (tab = item.value)}
                class={[
                    'flex flex-1 items-center justify-center gap-1.5 border-r px-2 py-2 text-xs font-medium transition-colors last:border-r-0',
                    on
                        ? 'text-(--theme-accent-text)'
                        : 'text-(--theme-modal-text)/50 hover:bg-(--theme-modal-text)/5 hover:text-(--theme-modal-text)'
                ].join(' ')}
                style="border-color: var(--theme-divider-border); {on
                    ? 'background: color-mix(in srgb, var(--theme-accent-bg) 12%, transparent);'
                    : ''}"
            >
                <Icon icon={item.icon} class="size-3.5 shrink-0" />
                <span class="truncate">{item.label}</span>
                {#if item.value === 'rules' && rulesCount > 0}
                    <span
                        class="shrink-0 px-1 text-[10px] tabular-nums"
                        style="background: color-mix(in srgb, var(--theme-accent-bg) 18%, transparent); color: var(--theme-accent-text);"
                        >{rulesCount}</span
                    >
                {:else if item.value === 'members'}
                    <span class="shrink-0 text-[10px] text-(--theme-modal-text)/35">
                        {selectedBuffSet.scope === 'all'
                            ? '通用'
                            : selectedBuffSet.scope.length === 0
                              ? '效应'
                              : selectedBuffSet.scope.length >= team.length
                                ? '全队'
                                : `${selectedBuffSet.scope.length}人`}
                    </span>
                {/if}
            </button>
        {/each}
    </div>

    {#if tab === 'members'}
        <BuffModalMembers buff={selectedBuffSet} {team} {charIconMap} locked={isGlobal} {onscope} />
    {:else if tab === 'rules'}
        <BuffModalRules rules={selectedBuffSet.rules ?? []} {team} {charIconMap} {buffOptions} onsave={onsaverules} />
    {:else}
        <!-- @desc 乘区列表：已配置乘区的数值输入/引用展示/追加覆盖切换/引用配置入口 -->
        <div class="theme-scrollbar flex-1 overflow-y-auto p-3 space-y-1">
            {#each selectedZones as zone, zoneIndex (zoneIndex)}
                {@const def = ZONE_MAP.get(zone.zoneId)}
                {@const zoneKey = zone.zoneId as string}
                {@const overridden = !zone.override && overrideZoneIds.has(zoneKey)}
                {@const external = externalOverrides[zoneKey] ?? []}
                {@const condBadge = describeZoneConditionBadge(zone.condition)}
                {@const zoneLabel = def?.label ?? zoneKey}
                {#if def}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                        class="flex items-center gap-1.5 rounded-none border px-3 py-2 transition-colors {overridden
                            ? 'opacity-40'
                            : 'hover:border-(--theme-accent-bg)'}"
                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                        title={overridden ? `同乘区已有覆盖条目：覆盖优先于一切，本条目不参与计算` : ''}
                    >
                        <span class="shrink-0 text-xs text-(--theme-modal-text) truncate">{zoneLabel}</span>
                        <!-- @desc 乘区条件徽标：紧跟在乘区名后，样式与同行「覆盖」按钮同款，仅背景改为半透明 -->
                        {#if condBadge}
                            <span
                                class="shrink-0 max-w-32 truncate rounded-none border px-1.5 py-0.5 text-[10px]"
                                style="border-color: transparent; background: color-mix(in srgb, var(--theme-accent-bg) 18%, transparent); color: var(--theme-accent-text);"
                                title={`该乘区条件：${describeCondition(zone.condition)}`}>{condBadge}</span
                            >
                        {/if}
                        {#if zone.override}
                            <span
                                class="shrink-0 px-1 py-0.5 text-[10px] font-black tracking-tight"
                                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                                title="覆盖优先于一切：该乘区的其它条目都不参与计算">覆盖生效</span
                            >
                        {:else if overridden}
                            <span
                                class="shrink-0 px-1 py-0.5 text-[10px] text-(--theme-modal-text)/50"
                                title="同乘区已有覆盖条目，本条目被覆盖">已被覆盖</span
                            >
                        {:else if external.length > 0}
                            <span
                                class="shrink-0 px-1 py-0.5 text-[10px] text-(--theme-modal-text)/50"
                                title={`同乘区在其它 BUFF 上也有覆盖：${external
                                    .map(
                                        (e) =>
                                            `「${e.name}」${e.later ? '在本 Buff 之后 → 最终生效' : '在本 Buff 之前 → 会被本 Buff 覆盖'}`
                                    )
                                    .join('；')}`}>跨 Buff 覆盖 ×{external.length}</span
                            >
                        {/if}
                        {#if zone.ref && !ZONE_NO_REF_IDS.has(zone.zoneId)}
                            {@const refDef = ZONE_REF_MAP.get(zone.ref.zoneId) ?? ZONE_MAP.get(zone.ref.zoneId)}
                            {@const refName = teamNames[zone.ref.characterIdx] ?? '?'}
                            {@const refOp = zone.ref.threshold < 0 ? '+' : '-'}
                            {@const refTh = zone.ref.threshold < 0 ? -zone.ref.threshold : zone.ref.threshold}
                            {@const refS = simplifyPct(zone.ref.pct)}
                            {@const hasThreshold = zone.ref.threshold !== 0}
                            {@const hasLower = zone.ref.lower !== undefined}
                            {@const hasUpper = zone.ref.upper !== undefined}
                            <span
                                class="flex-1 text-[10px] text-(--theme-modal-text)/40 truncate min-w-0 text-right"
                                title="({refName}.{refDef?.label ?? '?'}{hasThreshold
                                    ? ' ' + refOp + ' ' + refTh + (refDef?.unit === '%' ? '%' : '')
                                    : ''}) ÷{refS.divisor}×{refS.multiplier}{hasLower || hasUpper
                                    ? ' clamp(' +
                                      (hasLower ? String(zone.ref.lower) : '') +
                                      ' ~ ' +
                                      (hasUpper ? String(zone.ref.upper) : '') +
                                      ')'
                                    : ''}"
                            >
                                引用: ({refName}.{refDef?.label ?? '?'}{hasThreshold
                                    ? refOp + refTh + (refDef?.unit === '%' ? '%' : '')
                                    : ''}) ÷{refS.divisor}×{refS.multiplier}
                                {#if hasLower || hasUpper}
                                    <span class="text-(--theme-modal-text)/30">
                                        ({hasLower ? zone.ref.lower : ''}~{hasUpper ? zone.ref.upper : ''})
                                    </span>
                                {/if}
                            </span>
                        {:else}
                            <div class="flex-1 flex justify-end items-center gap-1">
                                <input
                                    type="number"
                                    value={zone.value}
                                    oninput={(e) => {
                                        const v = parseFloat((e.target as HTMLInputElement).value)
                                        onsetzonevalue(zoneIndex, isNaN(v) ? 0 : v)
                                    }}
                                    class="w-14 h-6 rounded-none border bg-transparent px-1.5 text-xs text-right tabular-nums text-(--theme-modal-text) outline-none"
                                    style="border-color: var(--theme-divider-border);"
                                />
                                <span class="text-[10px] text-(--theme-modal-text)/40 w-3"
                                    >{def?.unit === '%' ? '%' : ''}</span
                                >
                            </div>
                        {/if}
                        {#if zone.zoneId !== 'atkPct' && zone.zoneId !== 'hpPct' && zone.zoneId !== 'defPct' && zone.zoneId !== 'extraRatio'}
                            <button
                                onclick={() => onoverride(zoneIndex, !zone.override)}
                                class={[
                                    'shrink-0 rounded-none border px-1.5 py-0.5 text-[10px] transition-colors flex items-center gap-0.5',
                                    zone.override
                                        ? 'border-(--theme-accent-bg) text-(--theme-accent-text)'
                                        : 'border-transparent text-(--theme-modal-text)/30 hover:border-(--theme-divider-border) hover:text-(--theme-modal-text)/60'
                                ].join(' ')}
                            >
                                <Icon icon="mdi:swap-horizontal-bold" class="size-3" />
                                {zone.override ? '覆盖' : '追加'}
                            </button>
                        {/if}
                        {#if !ZONE_NO_REF_IDS.has(zone.zoneId)}
                            <button
                                onclick={() => onopenref(zoneIndex)}
                                class="shrink-0 rounded-none border px-1.5 py-0.5 text-[10px] transition-colors flex items-center gap-0.5"
                                style="border-color: var(--theme-divider-border);"
                            >
                                <Icon icon="mdi:link-variant" class="size-3" />
                                引用
                            </button>
                        {/if}
                        <!-- @desc 乘区级生效条件（行内下拉展开）：伤害类型 / 伤害属性 -->
                        <button
                            onclick={() => ontogglezonecond(zoneIndex)}
                            class={[
                                'shrink-0 rounded-none border px-1.5 py-0.5 text-[10px] transition-colors flex items-center gap-0.5',
                                zone.condition
                                    ? 'border-(--theme-accent-bg) text-(--theme-accent-text)'
                                    : 'border-transparent text-(--theme-modal-text)/30 hover:border-(--theme-divider-border) hover:text-(--theme-modal-text)/60'
                            ].join(' ')}
                            title={zone.condition
                                ? `该乘区条件：${describeCondition(zone.condition)}`
                                : '为该乘区设置生效条件（伤害类型/属性）'}
                        >
                            <Icon
                                icon={expandedZoneIndex === zoneIndex ? 'mdi:chevron-up' : 'mdi:filter-outline'}
                                class="size-3"
                            />
                            条件
                        </button>
                        <button
                            onclick={() => onremovezone(zoneIndex)}
                            class="shrink-0 rounded-none border border-transparent px-1 py-0.5 text-[10px] text-(--theme-modal-text)/30 transition-colors hover:border-red-500/40 hover:text-red-500"
                            title="移除该乘区"
                        >
                            <Icon icon="mdi:close" class="size-3" />
                        </button>
                    </div>
                    {#if expandedZoneIndex === zoneIndex}
                        <ZoneConditionPanel
                            condition={zone.condition}
                            onchange={(next) => onzonecondchange(zoneIndex, next)}
                        />
                    {/if}
                {/if}
            {/each}
            {#if selectedZones.length === 0}
                <div class="text-xs text-(--theme-modal-text)/30 py-4 text-center">暂无乘区</div>
            {/if}
            {#if ruleSummary}
                <div class="pt-1 text-[10px] text-(--theme-modal-text)/35">门槛条件：{ruleSummary}</div>
            {/if}
        </div>
    {/if}
</div>
