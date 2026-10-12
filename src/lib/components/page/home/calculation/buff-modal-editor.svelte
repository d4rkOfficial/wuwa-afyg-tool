<script lang="ts">
    /**
     * @desc 右列「块编辑器」（自 `buff-modal.svelte` **原样抽出**，标记与行为未改）：
     * 选中块头部（收藏/重命名/复制/全局/删除）＋ 作用域区（角色勾选 + 效应专属）＋ 链/阶条件区
     * ＋ 乘区列表（数值输入 / 引用展示 / 追加覆盖切换 / 引用与条件入口）。
     *
     * 职责边界（受控区，无自有数据状态）：
     * - `buff` 由父组件传入（父组件用同一个值决定渲染本区域还是空态），本组件**不回读**父组件状态。
     * - 两条视图状态 `expandedZoneIndex` / `condPanelOpen` 归父组件所有：父组件在「切换选中块」时
     *   要把行内条件面板收起（原实现是一条 `$effect`），状态留在父组件才能保持该重置逐句不变，
     *   故用 `$bindable` 双向绑定（与 `buff-entity-editor.svelte` 同一做法）。
     * - 名称编辑输入框（`bind:this` 自动聚焦）是**本组件的 DOM 细节**，故重命名草稿与失焦/回车保存
     *   也一并在本组件内完成（不改 store 之外的任何东西）。父组件不再需要「重命名后聚焦输入框」。
     * - 所有数据写入一律经回调交回父组件（父组件是 store 的唯一调用方）。
     */
    import Icon from '@iconify/svelte'
    import Button from '$lib/components/ui/button.svelte'
    import { slide } from 'svelte/transition'
    import type { ComponentsProps } from '$lib/types'
    import type { CharSlot } from '$lib/types/project'
    import type { BuffCondition, BuffConf, BuffZoneValue } from '$lib/calc/calculation.types'
    import { ZONE_MAP, ZONE_NO_REF_IDS, ZONE_REF_MAP } from '$lib/calc/calculation.consts'
    import { describeCondition, describeZoneConditionBadge } from '$lib/calc/condition'
    import { fallbackIcon } from '$lib/utils/icons'
    import { MOTION_MS, slideParams } from '$lib/utils/motion'
    import { mergeClass } from '$lib/utils/component-style'
    import ZoneConditionPanel from './zone-condition-panel.svelte'
    import { gateOptionTitle, simplifyPct } from './buff-modal.utils'

    interface Props extends ComponentsProps {
        /** @desc 当前选中的 Buff 块（父组件已判定非 null 才挂载本组件） */
        buff: BuffConf
        team: [CharSlot, CharSlot, CharSlot]
        /** @desc 队伍槽位角色名（引用前缀用） */
        teamNames: string[]
        charIconMap: Record<string, string>
        /** @desc 当前块是否在全局目录里 */
        isGlobal: boolean
        /** @desc 内置默认全局块（global- 前缀）：链/阶不可配置，作用域不可改 */
        isDefaultGlobal: boolean
        /** @desc 三个槽位的作用域勾选态（'all' 时全 true） */
        scopeChars: boolean[]
        /** @desc 效应专属（作用域为空数组） */
        isNonCharBuff: boolean
        /** @desc 生效条件摘要文案（仅链/阶） */
        conditionSummary: string
        /** @desc 当前链门槛（兼容旧 chain 字段） */
        currentChain: number | undefined
        /** @desc 当前阶门槛（兼容旧 refinement 字段） */
        currentRefine: number | undefined
        /** @desc 当前参考角色槽位 */
        condRefIdx: number
        /** @desc 链/阶折叠面板是否展开（绑定自父组件） */
        condPanelOpen: boolean
        /** @desc 乘区条目列表 */
        zones: BuffZoneValue[]
        /** @desc 本 Buff 内存在生效覆盖的乘区 id 集合（其它条目置灰） */
        overrideZoneIds: Set<string>
        /** @desc 跨 Buff 的同乘区覆盖提示信息 */
        externalOverrides: Record<string, { name: string; later: boolean }[]>
        /** @desc 展开行内「乘区条件」面板的乘区下标（绑定自父组件） */
        expandedZoneIndex: number | null
        /** @desc 列表重命名输入框引用（父组件滚动定位用） */
        renameInputEl: HTMLInputElement | null
        /** @desc 点击收藏星标 */
        ontogglestar: () => void
        /** @desc 重命名（空名由父组件兜底成「未命名BUFF块」） */
        onrename: (value: string) => void
        /** @desc 复制当前块（叠层 / 数字递增命名由父组件决定） */
        oncopy: () => void
        /** @desc 并入 / 移出全局 */
        ontoggleglobal: () => void
        /** @desc 删除当前块 */
        ondelete: () => void
        /** @desc 切换某个槽位的作用域（父组件负责「全局块拒绝」提示） */
        ontogglechar: (idx: number) => void
        /** @desc 切换「效应专属」 */
        ontogglenonchar: () => void
        /** @desc 折叠 / 展开链阶面板 */
        ontogglecond: () => void
        /** @desc 设置参考角色槽位 */
        onsetref: (idx: number) => void
        /** @desc 设置链门槛（再次点击取消；设置链会清空全部阶） */
        onsetchain: (min: number) => void
        /** @desc 设置阶门槛（再次点击取消；设置阶会清空全部链） */
        onsetrefine: (min: number) => void
        /** @desc 改某个乘区条目的数值 */
        onsetzonevalue: (index: number, value: number) => void
        /** @desc 切换某个乘区条目的「追加 / 覆盖」 */
        onoverride: (index: number, override: boolean) => void
        /** @desc 打开某个乘区条目的引用配置 */
        onopenref: (index: number) => void
        /** @desc 移除某个乘区条目 */
        onremovezone: (index: number) => void
        /** @desc 行内展开 / 收起某个乘区条目的生效条件 */
        ontogglezonecond: (index: number) => void
        /** @desc 某乘区条目的生效条件变更 */
        onzonecondchange: (index: number, next: BuffCondition | null) => void
    }

    let {
        buff: selectedBuffSet,
        team,
        teamNames,
        charIconMap,
        isGlobal,
        isDefaultGlobal,
        scopeChars,
        isNonCharBuff,
        conditionSummary,
        currentChain,
        currentRefine,
        condRefIdx,
        condPanelOpen = $bindable(),
        zones: selectedZones,
        overrideZoneIds,
        externalOverrides,
        expandedZoneIndex = $bindable(),
        renameInputEl = $bindable(),
        ontogglestar,
        onrename,
        oncopy,
        ontoggleglobal,
        ondelete,
        ontogglechar,
        ontogglenonchar,
        ontogglecond,
        onsetref,
        onsetchain,
        onsetrefine,
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
    let renameValue = $state(selectedBuffSet.name)
    /** @desc 切换选中块时同步重命名输入框内容 */
    $effect(() => {
        selectedBuffSet.id
        renameValue = selectedBuffSet.name
    })
    /** @desc 名称编辑保存（Enter/失焦触发；空名兜底） */
    const handleRenameInline = () => onrename(renameValue.trim() || '未命名BUFF块')
</script>

<div class={mergeClass(['flex-1 flex flex-col', className])} style={styleProp}>
    <!-- @desc 选中块头部：收藏/重命名（双击编辑）/复制/并入全局/移出全局/删除（全局块锁定只读） -->
    <!-- Buff name header -->
    <div
        class="shrink-0 px-3 py-2.5 border-b flex items-center gap-2"
        style="border-bottom: 1px solid var(--theme-divider-border);"
    >
        {#if isGlobal}
            <button disabled class="shrink-0 rounded-none p-1 text-amber-400/40 cursor-not-allowed">
                <Icon icon={selectedBuffSet.starred ? 'mdi:star' : 'mdi:star-outline'} class="size-4" />
            </button>
            {#if isDefaultGlobal}
                <input
                    type="text"
                    value={selectedBuffSet.name}
                    readonly
                    class="flex-1 min-w-0 rounded-none border px-2 py-1.5 text-xs font-medium outline-none text-(--theme-modal-text) cursor-default"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                />
            {:else}
                <input
                    type="text"
                    bind:this={renameInputEl}
                    bind:value={renameValue}
                    onkeydown={(e) => e.key === 'Enter' && handleRenameInline()}
                    onblur={handleRenameInline}
                    class="flex-1 min-w-0 rounded-none border px-2 py-1.5 text-xs font-medium outline-none text-(--theme-modal-text)"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                />
            {/if}
            {#if !isDefaultGlobal}
                <Button
                    variant="text"
                    size="none"
                    bare
                    onclick={ontoggleglobal}
                    backgroundImage="transparent"
                    class="shrink-0 gap-1 border border-(--theme-divider-border) px-2 py-1.5 text-xs text-(--theme-modal-text) transition-colors hover:bg-(--theme-accent-bg)/10"
                >
                    <Icon icon="mdi:crown" class="size-3.5" />
                    移出全局
                </Button>
            {/if}
        {:else}
            <button
                onclick={ontogglestar}
                class="shrink-0 rounded-none p-1 transition-colors text-amber-400 hover:text-amber-300"
            >
                <Icon icon={selectedBuffSet.starred ? 'mdi:star' : 'mdi:star-outline'} class="size-4" />
            </button>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <input
                type="text"
                bind:this={renameInputEl}
                bind:value={renameValue}
                onkeydown={(e) => e.key === 'Enter' && handleRenameInline()}
                onblur={handleRenameInline}
                class="flex-1 min-w-0 rounded-none border px-2 py-1.5 text-xs font-medium outline-none text-(--theme-modal-text)"
                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
            />
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
            <Button
                variant="text"
                size="none"
                bare
                onclick={ontoggleglobal}
                backgroundImage="transparent"
                title="并入全局（全局 buff 的受益者将被锁定）"
                class="shrink-0 gap-1 border border-(--theme-divider-border) px-2 py-1.5 text-xs text-(--theme-modal-text) transition-colors hover:bg-(--theme-accent-bg)/10"
            >
                <Icon icon="mdi:crown" class="size-3.5" />
                并入全局
            </Button>
            <button
                onclick={ondelete}
                class="shrink-0 flex items-center gap-1 rounded-none border border-red-500 px-2 py-1.5 text-xs text-red-500 transition-colors hover:bg-red-500/20"
            >
                <Icon icon="mdi:delete-outline" class="size-3.5" />
                删除
            </button>
        {/if}
    </div>

    <!-- @desc 作用域区：角色头像勾选（可吃到的角色）+ 效应专属切换（全局块锁定） -->
    <!-- Character scope -->
    <div class="shrink-0 px-3 pt-3 pb-2.5 border-b" style="border-bottom: 1px solid var(--theme-divider-border);">
        <div class="flex items-center gap-1.5">
            <span class="text-xs text-(--theme-modal-text)/50 mr-0.5">这些角色可以吃到：</span>
            {#each team as slot, i (i)}
                {@const globalDisabled = selectedBuffSet && isGlobal}
                {@const disabled = globalDisabled || isNonCharBuff}
                <button
                    onclick={() => ontogglechar(i)}
                    class={[
                        'size-8 rounded-full overflow-hidden border-2 transition-all',
                        scopeChars[i]
                            ? 'border-(--theme-accent-bg)'
                            : 'border-(--theme-divider-border) grayscale opacity-30',
                        isGlobal ? 'cursor-not-allowed' : disabled ? 'pointer-events-none' : 'hover:opacity-60'
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
                            class="w-full h-full flex items-center justify-center text-[9px] font-medium text-(--theme-modal-text)/50"
                            >{slot.character?.charAt(0) ?? '?'}</span
                        >
                    {/if}
                </button>
            {/each}
            <div class="w-px h-5 mx-1" style="background: var(--theme-divider-border);"></div>
            <button
                onclick={ontogglenonchar}
                class={[
                    'flex items-center gap-1 rounded-none border px-2 py-1 text-[11px] font-medium transition-all whitespace-nowrap',
                    isGlobal ? 'cursor-not-allowed opacity-50' : '',
                    isNonCharBuff
                        ? 'border-(--theme-accent-bg) bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                        : 'border-transparent text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70 hover:bg-(--theme-modal-text)/5'
                ].join(' ')}
            >
                <svg viewBox="0 0 24 24" class="size-3.5 shrink-0">
                    {#if isNonCharBuff}
                        <path d="M7 2v11h3v9l7-12h-4l4-8H7z" fill="currentColor" />
                    {:else}
                        <path
                            d="M7 2v11h3v9l7-12h-4l4-8H7z"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.5"
                            stroke-linejoin="round"
                        />
                    {/if}
                </svg>
                效应专属
            </button>
        </div>
    </div>

    <!-- @desc 链/阶条件区：折叠面板内左侧参考角色（正方形头像框）、右侧链（0-6）/ 阶（0-5）两行（链阶互斥） -->
    <!-- 链/阶条件 -->
    <div class="shrink-0 border-b" style="border-bottom: 1px solid var(--theme-divider-border);">
        <button
            onclick={ontogglecond}
            class={[
                'flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] transition-colors hover:bg-(--theme-modal-text)/5',
                conditionSummary ? 'text-(--theme-accent-text)' : 'text-(--theme-modal-text)/60'
            ].join(' ')}
            title={isDefaultGlobal ? '链/阶条件（默认全局buff不可配置）' : '链/阶条件'}
        >
            <Icon
                icon={condPanelOpen ? 'mdi:chevron-down' : 'mdi:chevron-right'}
                class="size-4 shrink-0 text-(--theme-modal-text)/40"
            />
            <span class="shrink-0 text-xs font-black tracking-tight">链/阶条件</span>
            {#if conditionSummary}
                <span class="min-w-0 truncate text-[11px]">：{conditionSummary}</span>
            {/if}
        </button>
        {#if condPanelOpen}
            <div
                transition:slide|local={slideParams(MOTION_MS.base)}
                class="flex flex-wrap items-start gap-3 px-3 pb-2.5"
            >
                <!-- 参考角色：三个正方形头像框（未选降饱和/暗化，选中=主题色描边 + 光晕） -->
                <div class="flex flex-col gap-1">
                    <span class="text-[10px] text-(--theme-modal-text)/50">参考角色</span>
                    <div class="flex items-center gap-1.5">
                        {#each team as slot, i (i)}
                            <button
                                onclick={() => onsetref(i)}
                                class={[
                                    'size-8 shrink-0 overflow-hidden border-2 transition-all',
                                    condRefIdx === i
                                        ? 'border-(--theme-accent-bg)'
                                        : 'border-(--theme-divider-border) grayscale opacity-40 hover:opacity-70'
                                ].join(' ')}
                                style={condRefIdx === i
                                    ? 'box-shadow: 0 0 8px color-mix(in srgb, var(--theme-accent-bg) 55%, transparent);'
                                    : ''}
                                title={`看 ${slot.character ?? `角色 ${i + 1}`} 的链 / 阶`}
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
                                        class="w-full h-full flex items-center justify-center text-[9px] font-medium text-(--theme-modal-text)/50"
                                        >{slot.character?.charAt(0) ?? '?'}</span
                                    >
                                {/if}
                            </button>
                        {/each}
                    </div>
                </div>
                <!-- 链（上）/ 阶（下）：设置链会清空全部阶，设置阶会清空全部链 -->
                <div class="flex flex-col gap-1">
                    <div class="flex items-center gap-1.5">
                        <span class="flex h-6 w-4 shrink-0 items-center text-[10px] text-(--theme-modal-text)/60"
                            >链</span
                        >
                        <div
                            class="flex overflow-hidden rounded-none border"
                            style="border-color: var(--theme-divider-border);"
                        >
                            {#each Array.from({ length: 7 }, (_, k) => k) as n (n)}
                                <button
                                    onclick={() => onsetchain(n)}
                                    title={gateOptionTitle('chain', n, { chain: currentChain, refine: currentRefine })}
                                    class={[
                                        'flex h-6 min-w-6 items-center justify-center px-1 text-[11px] transition-colors',
                                        currentChain === n
                                            ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/15'
                                            : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'
                                    ].join(' ')}
                                >
                                    {n === 0 ? '本体' : n}
                                </button>
                            {/each}
                        </div>
                    </div>
                    <div class="flex items-center gap-1.5">
                        <span class="flex h-6 w-4 shrink-0 items-center text-[10px] text-(--theme-modal-text)/60"
                            >阶</span
                        >
                        <div
                            class="flex overflow-hidden rounded-none border"
                            style="border-color: var(--theme-divider-border);"
                        >
                            {#each Array.from({ length: 6 }, (_, k) => k) as n (n)}
                                <button
                                    onclick={() => onsetrefine(n)}
                                    title={gateOptionTitle('refinement', n, {
                                        chain: currentChain,
                                        refine: currentRefine
                                    })}
                                    class={[
                                        'flex h-6 min-w-6 items-center justify-center px-1 text-[11px] transition-colors',
                                        currentRefine === n
                                            ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/15'
                                            : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'
                                    ].join(' ')}
                                >
                                    {n}
                                </button>
                            {/each}
                        </div>
                    </div>
                </div>
                {#if isDefaultGlobal}
                    <span class="text-[10px] text-(--theme-modal-text)/35">默认全局buff无法设置链/阶条件</span>
                {/if}
            </div>
        {/if}
    </div>

    <!-- @desc 乘区列表：已配置乘区的数值输入/引用展示/追加覆盖切换/引用配置入口 -->
    <!-- Zone list -->
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
                    <!-- @desc 乘区条件徽标：紧跟在乘区名后，样式与同行「覆盖」按钮同款（同尺寸/圆角/内边距/字号），仅背景改为半透明 -->
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
                    <!-- @desc 移除该乘区条目（同名乘区可添加多个，逐个移除） -->
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
    </div>
</div>
