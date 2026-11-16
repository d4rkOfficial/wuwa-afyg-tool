<script lang="ts">
    /**
     * @desc 右列「门槛条件」tab：Buff 级规则（`BuffInstance.rules`）的创建 / 编辑 / 删除。
     *
     * 结构口径（已对齐）：默认**没有条件**，只显示一个「创建条件」按钮；每个条件一张卡，
     * 卡内就地编辑，全部条件之间是 **AND**（没有 or 组合、也没有「链阶互斥」）。
     *
     * 职责边界：本组件自持「展开的规则下标 / 类型菜单开关」这类**视图态**（切 tab 即销毁重建，
     * 天然复位）；规则本身由父组件经 `rules` 传入，写入一律走 `onsave`（父组件是 store 唯一调用方）。
     *
     * `buffActive` 的循环依赖由父组件校验（`onsave` 返回错误文案），本组件只负责展示 toast。
     */
    import Icon from '@iconify/svelte'
    import Button from '$lib/components/ui/button.svelte'
    import Select from '$lib/components/ui/select.svelte'
    import type { ComponentsProps } from '$lib/types'
    import type { CharSlot } from '$lib/types/project'
    import type { BuffRule, ZoneCompareId, ZoneCompareOp } from '$lib/calc/calculation.types'
    import {
        CHAIN_MAX,
        ENEMY_TYPE_OPTIONS,
        REFINE_MAX,
        RULE_KIND_OPTIONS,
        ZONE_COMPARE_OPS,
        ZONE_COMPARE_OPTIONS,
        describeRule,
        isRuleDraft,
        isValidRegex,
        ruleKindLabel
    } from '$lib/calc/rules'
    import { addToast } from '$lib/data/toast.svelte'
    import { fallbackIcon } from '$lib/utils/icons'
    import { mergeClass } from '$lib/utils/component-style'

    interface Props extends ComponentsProps {
        rules: BuffRule[]
        /** @desc 配队（工程侧用）；Buff 集侧不传，槽位说法退化为「本角色」 */
        team?: [CharSlot, CharSlot, CharSlot]
        charIconMap?: Record<string, string>
        /** @desc 可被 `buffActive` 引用的 Buff 候选（当前树内的其它 Buff） */
        buffOptions?: { id: string; label: string }[]
        /** @desc 「创建条件」菜单里可选的规则种类（Buff 集侧不含 `buffActive`） */
        kinds?: BuffRule['kind'][]
        /** @desc 「角色面板数值」可选的属性（Buff 集侧按模板口径裁剪） */
        zoneCompareOptions?: { value: ZoneCompareId; label: string; unit: '%' | 'flat' }[]
        /**
         * @desc 角色槽位轴：`slots` = 工程侧（三名角色 + 当前角色）；
         * `owner` = Buff 集侧（本角色 / 出伤者，`charIdx` 只有 0 与 -1 两档）
         */
        charMode?: 'slots' | 'owner'
        /** @desc 区块标题 */
        title?: string
        /** @desc 保存整组规则；返回错误文案（null = 成功） */
        onsave: (rules: BuffRule[]) => string | null
    }

    let {
        rules,
        team,
        charIconMap,
        buffOptions = [],
        kinds,
        zoneCompareOptions,
        charMode = 'slots',
        title = '门槛条件',
        onsave,
        class: className,
        style: styleProp
    }: Props = $props()

    /** @desc 展开编辑的规则下标（-1 = 全部收起） */
    let editingIndex = $state(-1)
    /** @desc 「创建条件」类型菜单开关 */
    let kindMenuOpen = $state(false)

    /** @desc 槽位说法：工程侧读配队角色名，Buff 集侧一律「本角色」 */
    const slotName = (i: number): string =>
        charMode === 'owner' ? '本角色' : (team?.[i]?.character ?? `角色 ${i + 1}`)
    /** @desc `charIdx = -1` 的称呼：工程侧是「当前角色」，Buff 集侧是「出伤者」 */
    const activeName = $derived(charMode === 'owner' ? '出伤者' : '当前角色')
    const buffLabel = (id: string): string => buffOptions.find((o) => o.id === id)?.label ?? id
    const kindOptions = $derived(
        (kinds ? RULE_KIND_OPTIONS.filter((option) => kinds.includes(option.value)) : RULE_KIND_OPTIONS).filter(
            // 同类条件只能有一条：已有的 kind 不再出现在「创建条件」菜单里
            (option) => !rules.some((rule) => rule.kind === option.value)
        )
    )
    const zoneOptions = $derived(zoneCompareOptions ?? ZONE_COMPARE_OPTIONS)

    /** @desc 提交整组规则（失败时 toast 错误并保持现状） */
    const commit = (next: BuffRule[]) => {
        const error = onsave(next)
        if (error) {
            addToast(error, 'error')
            return false
        }
        return true
    }

    const replaceAt = (index: number, rule: BuffRule) => {
        const next = rules.map((item, i) => (i === index ? rule : item))
        if (commit(next)) return
    }

    const removeAt = (index: number) => {
        if (!commit(rules.filter((_, i) => i !== index))) return
        editingIndex = -1
    }

    /** @desc 新规则的默认值（每种类型各给一个「可立即生效」的合理初值） */
    const defaultRuleOf = (kind: BuffRule['kind']): BuffRule | null => {
        switch (kind) {
            case 'chain':
                return { kind: 'chain', charIdx: 0, min: 0 }
            case 'refinement':
                return { kind: 'refinement', charIdx: 0, min: 1 }
            case 'damageNameRegex':
                return { kind: 'damageNameRegex', pattern: '' }
            case 'zoneCompare':
                return { kind: 'zoneCompare', charIdx: -1, zone: 'atk', op: 'ge', value: 0 }
            case 'enemyType':
                return { kind: 'enemyType', types: ['BOSS'] }
            case 'buffActive':
                return { kind: 'buffActive', mode: 'all', buffIds: [] }
            default:
                return null
        }
    }

    /** @desc 创建一条新条件：空正则/空字符串/空引用集合先落草稿（保存时再校验） */
    const createRule = (kind: BuffRule['kind']) => {
        kindMenuOpen = false
        const rule = defaultRuleOf(kind)
        if (!rule) return
        const next = [...rules, rule]
        if (!commit(next)) return
        editingIndex = next.length - 1
    }

    /** @desc 卡片标题用的短标签 */
    const ruleTitle = (rule: BuffRule): string => ruleKindLabel(rule.kind)

    const RULE_ICON: Record<BuffRule['kind'], string> = {
        chain: 'mdi:account-star-outline',
        refinement: 'mdi:sword',
        damageNameRegex: 'mdi:regex',
        zoneCompare: 'mdi:chart-bar',
        enemyType: 'mdi:skull-outline',
        buffActive: 'mdi:link-variant'
    }

    const patchNumber = (value: string, fallback: number): number => {
        const n = parseFloat(value)
        return Number.isFinite(n) ? n : fallback
    }

    const toggleBuffId = (rule: Extract<BuffRule, { kind: 'buffActive' }>, id: string): string[] =>
        rule.buffIds.includes(id) ? rule.buffIds.filter((x) => x !== id) : [...rule.buffIds, id]
</script>

<div class={mergeClass(['flex flex-1 flex-col gap-2.5 overflow-y-auto p-3.5', className])} style={styleProp}>
    <div class="flex items-center gap-1.5">
        <Icon icon="mdi:filter-cog-outline" class="size-3.5 shrink-0" style="color: var(--theme-accent-text);" />
        <span class="text-xs font-black tracking-tight text-(--theme-modal-text)">{title}</span>
        <span class="text-xs text-(--theme-modal-text)/45"
            >{rules.length === 0 ? '无条件（本次伤害恒生效）' : `${rules.length} 条条件，全部同时满足`}</span
        >
    </div>

    {#each rules as rule, index (index)}
        {@const draft = isRuleDraft(rule)}
        <div class="border" style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);">
            <div class="flex items-center gap-1.5 px-2.5 py-2">
                <Icon icon={RULE_ICON[rule.kind]} class="size-3.5 shrink-0" style="color: var(--theme-accent-text);" />
                <span class="shrink-0 text-xs font-black tracking-tight text-(--theme-modal-text)/70"
                    >{ruleTitle(rule)}</span
                >
                <span class="min-w-0 flex-1 truncate text-xs text-(--theme-modal-text)">
                    {describeRule(rule, { slotName, buffName: buffLabel, activeName })}
                </span>
                {#if draft}
                    <span class="shrink-0 text-xs text-amber-400">未填写</span>
                {/if}
                <button
                    type="button"
                    onclick={() => (editingIndex = editingIndex === index ? -1 : index)}
                    class="shrink-0 rounded-none border px-2 py-1 text-xs text-(--theme-modal-text)/50 transition-colors hover:text-(--theme-accent-text)"
                    style="border-color: var(--theme-divider-border);"
                >
                    <Icon icon={editingIndex === index ? 'mdi:chevron-up' : 'mdi:pencil'} class="size-3.5" />
                </button>
                <button
                    type="button"
                    onclick={() => removeAt(index)}
                    class="shrink-0 rounded-none border border-transparent px-1.5 py-1 text-(--theme-modal-text)/30 transition-colors hover:border-red-500/40 hover:text-red-500"
                    title="删除该条件"
                >
                    <Icon icon="mdi:close" class="size-3.5" />
                </button>
            </div>

            {#if editingIndex === index}
                <div class="space-y-2.5 border-t px-2.5 py-2.5" style="border-color: var(--theme-divider-border);">
                    {#if rule.kind === 'chain' || rule.kind === 'refinement'}
                        {@const max = rule.kind === 'chain' ? CHAIN_MAX : REFINE_MAX}
                        {@const minFloor = rule.kind === 'chain' ? 0 : 1}
                        {#if charMode === 'slots'}
                            <div class="flex items-center gap-1.5">
                                <span class="w-14 shrink-0 text-xs text-(--theme-modal-text)/45">角色</span>
                                {#each team ?? [] as slot, i (i)}
                                    <button
                                        type="button"
                                        onclick={() => replaceAt(index, { ...rule, charIdx: i })}
                                        class={[
                                            'size-8 shrink-0 overflow-hidden border-2 transition-all',
                                            rule.charIdx === i
                                                ? 'border-(--theme-accent-bg)'
                                                : 'border-(--theme-divider-border) grayscale opacity-40 hover:opacity-70'
                                        ].join(' ')}
                                        title={slotName(i)}
                                    >
                                        {#if slot.character && charIconMap?.[slot.character]}
                                            <img
                                                src={charIconMap[slot.character]}
                                                alt={slot.character}
                                                draggable="false"
                                                use:fallbackIcon={'/icons/placeholder-character.svg'}
                                                class="h-full w-full object-cover"
                                            />
                                        {:else}
                                            <span class="text-[10px] text-(--theme-modal-text)/50"
                                                >{slot.character?.charAt(0) ?? '?'}</span
                                            >
                                        {/if}
                                    </button>
                                {/each}
                            </div>
                        {:else}
                            <p class="text-xs text-(--theme-modal-text)/40">
                                门槛按「本角色」计：导入工程时自动指向该增益所属的角色。
                            </p>
                        {/if}
                        <div class="flex flex-wrap items-center gap-1.5">
                            <span class="w-14 shrink-0 text-xs text-(--theme-modal-text)/45"
                                >{rule.kind === 'chain' ? '链 ≥' : '阶 ≥'}</span
                            >
                            {#each Array.from({ length: max - minFloor + 1 }, (_, k) => k + minFloor) as n (n)}
                                <button
                                    type="button"
                                    onclick={() => replaceAt(index, { ...rule, min: n })}
                                    class={[
                                        'h-7 min-w-7 rounded-none border px-1 text-xs transition-colors',
                                        rule.min === n
                                            ? 'border-(--theme-accent-bg) text-(--theme-accent-text)'
                                            : 'border-(--theme-divider-border) text-(--theme-modal-text)/50 hover:text-(--theme-modal-text)'
                                    ].join(' ')}
                                >
                                    {rule.kind === 'chain' && n === 0 ? '本体' : n}
                                </button>
                            {/each}
                        </div>
                    {:else if rule.kind === 'damageNameRegex'}
                        <div class="flex flex-col gap-1">
                            <span class="text-xs text-(--theme-modal-text)/45"
                                >伤害名（正则，包含匹配；全等请用 ^…$）</span
                            >
                            <input
                                type="text"
                                value={rule.pattern}
                                oninput={(e) =>
                                    replaceAt(index, {
                                        kind: 'damageNameRegex',
                                        pattern: (e.target as HTMLInputElement).value
                                    })}
                                placeholder="如 共鸣解放|处决"
                                class="rounded-none border px-2 py-1 text-xs outline-none text-(--theme-modal-text)"
                                style="border-color: var(--theme-divider-border); background: var(--theme-modal-bg);"
                            />
                            {#if rule.pattern.trim() && !isValidRegex(rule.pattern)}
                                <span class="text-xs text-red-400">正则表达式无效</span>
                            {/if}
                        </div>
                    {:else if rule.kind === 'zoneCompare'}
                        <div class="flex flex-wrap items-center gap-1.5">
                            <span class="w-14 shrink-0 text-xs text-(--theme-modal-text)/45">角色</span>
                            <button
                                type="button"
                                onclick={() => replaceAt(index, { ...rule, charIdx: -1 })}
                                class={[
                                    'rounded-none border px-2 py-1 text-xs transition-colors',
                                    rule.charIdx < 0
                                        ? 'border-(--theme-accent-bg) text-(--theme-accent-text)'
                                        : 'border-(--theme-divider-border) text-(--theme-modal-text)/50'
                                ].join(' ')}
                                title={charMode === 'owner' ? '按本次伤害所属角色判定' : '按伤害条目的归属角色判定'}
                                >{activeName}</button
                            >
                            {#if charMode === 'slots'}
                                {#each team ?? [] as slot, i (i)}
                                    <button
                                        type="button"
                                        onclick={() => replaceAt(index, { ...rule, charIdx: i })}
                                        class={[
                                            'rounded-none border px-2 py-1 text-xs transition-colors',
                                            rule.charIdx === i
                                                ? 'border-(--theme-accent-bg) text-(--theme-accent-text)'
                                                : 'border-(--theme-divider-border) text-(--theme-modal-text)/50'
                                        ].join(' ')}>{slot.character ?? `角色${i + 1}`}</button
                                    >
                                {/each}
                            {:else}
                                <button
                                    type="button"
                                    onclick={() => replaceAt(index, { ...rule, charIdx: 0 })}
                                    class={[
                                        'rounded-none border px-2 py-1 text-xs transition-colors',
                                        rule.charIdx >= 0
                                            ? 'border-(--theme-accent-bg) text-(--theme-accent-text)'
                                            : 'border-(--theme-divider-border) text-(--theme-modal-text)/50'
                                    ].join(' ')}
                                    title="该增益所属角色（导入时按实体归属重指）">本角色</button
                                >
                            {/if}
                        </div>
                        <div class="flex flex-wrap items-center gap-1.5">
                            <span class="w-14 shrink-0 text-xs text-(--theme-modal-text)/45">属性</span>
                            <div class="w-40">
                                <Select
                                    size="sm"
                                    options={zoneOptions}
                                    value={rule.zone}
                                    onchange={(zone) => replaceAt(index, { ...rule, zone: zone as ZoneCompareId })}
                                />
                            </div>
                            <div class="w-20">
                                <Select
                                    size="sm"
                                    options={ZONE_COMPARE_OPS}
                                    value={rule.op}
                                    onchange={(op) => replaceAt(index, { ...rule, op: op as ZoneCompareOp })}
                                />
                            </div>
                            <input
                                type="number"
                                value={rule.value}
                                oninput={(e) =>
                                    replaceAt(index, {
                                        ...rule,
                                        value: patchNumber((e.target as HTMLInputElement).value, 0)
                                    })}
                                class="w-20 rounded-none border px-2 py-1 text-right text-xs tabular-nums outline-none text-(--theme-modal-text)"
                                style="border-color: var(--theme-divider-border); background: var(--theme-modal-bg);"
                            />
                            <span class="text-xs text-(--theme-modal-text)/40"
                                >{zoneOptions.find((o) => o.value === rule.zone)?.unit === '%' ? '%' : ''}</span
                            >
                        </div>
                        <p class="text-xs text-(--theme-modal-text)/40">
                            读「无条件部分」面板：装备 + 其它 BUFF 的固定乘区（不含带属性/类型条件的乘区、不含本 BUFF
                            自身、不含依赖「某 BUFF 生效」的 BUFF）。
                        </p>
                    {:else if rule.kind === 'enemyType'}
                        <div class="flex flex-wrap items-center gap-1.5">
                            <span class="w-14 shrink-0 text-xs text-(--theme-modal-text)/45">类型</span>
                            {#each ENEMY_TYPE_OPTIONS as option (option.value)}
                                {@const on = rule.types.includes(option.value)}
                                <button
                                    type="button"
                                    onclick={() =>
                                        replaceAt(index, {
                                            kind: 'enemyType',
                                            // 多选：至少保留一项（取消最后一项视为无操作）
                                            types: (on
                                                ? rule.types.filter((item) => item !== option.value)
                                                : [...rule.types, option.value]) as typeof rule.types
                                        })}
                                    class={[
                                        'rounded-none border px-2 py-1 text-xs transition-colors',
                                        on
                                            ? 'border-(--theme-accent-bg) text-(--theme-accent-text)'
                                            : 'border-(--theme-divider-border) text-(--theme-modal-text)/50'
                                    ].join(' ')}
                                    disabled={on && rule.types.length <= 1}>{option.label}</button
                                >
                            {/each}
                            <span class="text-xs text-(--theme-modal-text)/35">可多选，命中任意一项即满足</span>
                        </div>
                    {:else if rule.kind === 'buffActive'}
                        <div class="flex items-center gap-1.5">
                            <span class="w-14 shrink-0 text-xs text-(--theme-modal-text)/45">匹配</span>
                            {#each [{ value: 'all' as const, label: '全部生效' }, { value: 'any' as const, label: '至少一个生效' }] as mode (mode.value)}
                                <button
                                    type="button"
                                    onclick={() => replaceAt(index, { ...rule, mode: mode.value })}
                                    class={[
                                        'rounded-none border px-2 py-1 text-xs transition-colors',
                                        rule.mode === mode.value
                                            ? 'border-(--theme-accent-bg) text-(--theme-accent-text)'
                                            : 'border-(--theme-divider-border) text-(--theme-modal-text)/50'
                                    ].join(' ')}>{mode.label}</button
                                >
                            {/each}
                        </div>
                        <div
                            class="theme-scrollbar max-h-44 overflow-y-auto border"
                            style="border-color: var(--theme-divider-border); background: var(--theme-modal-bg);"
                        >
                            {#each buffOptions as option (option.id)}
                                {@const on = rule.buffIds.includes(option.id)}
                                <button
                                    type="button"
                                    onclick={() =>
                                        replaceAt(index, { ...rule, buffIds: toggleBuffId(rule, option.id) })}
                                    class={[
                                        'flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs transition-colors',
                                        on
                                            ? 'text-(--theme-accent-text)'
                                            : 'text-(--theme-modal-text)/55 hover:bg-(--theme-modal-text)/5'
                                    ].join(' ')}
                                >
                                    <Icon
                                        icon={on ? 'mdi:checkbox-marked' : 'mdi:checkbox-blank-outline'}
                                        class="size-3.5 shrink-0"
                                    />
                                    <span class="min-w-0 flex-1 truncate">{option.label}</span>
                                </button>
                            {/each}
                            {#if buffOptions.length === 0}
                                <div class="px-2 py-3 text-center text-xs text-(--theme-modal-text)/30">
                                    没有可引用的 BUFF
                                </div>
                            {/if}
                        </div>
                        <p class="text-xs text-(--theme-modal-text)/40">
                            引用成环（含直接自引用）会被拒绝；删除被引用的 BUFF 时会提示级联删除。
                        </p>
                    {/if}
                </div>
            {/if}
        </div>
    {/each}

    <!-- @desc 创建条件：一个按钮 + 类型菜单（没有条件时它就是整页唯一入口） -->
    <div class="relative">
        <Button
            type="button"
            variant="text"
            bare
            onclick={() => (kindMenuOpen = !kindMenuOpen)}
            backgroundImage="transparent"
            class="flex w-full items-center justify-center gap-1.5 border px-2 py-2 text-xs font-medium transition-colors hover:bg-(--theme-accent-bg)/10"
            style="border-color: var(--theme-divider-border); color: var(--theme-accent-text);"
        >
            <Icon icon="mdi:plus" class="size-3.5" />
            创建条件
        </Button>
        {#if kindMenuOpen}
            <button
                type="button"
                class="fixed inset-0 cursor-default"
                aria-label="关闭菜单"
                onclick={() => (kindMenuOpen = false)}
            ></button>
            <div
                class="absolute left-0 top-full z-10 mt-1 w-full border shadow-xl"
                style="background: var(--theme-modal-bg); border-color: var(--theme-divider-border);"
            >
                {#each kindOptions as option (option.value)}
                    <button
                        type="button"
                        onclick={() => createRule(option.value)}
                        class="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs text-(--theme-modal-text)/70 transition-colors hover:bg-(--theme-accent-bg)/10 hover:text-(--theme-accent-text)"
                    >
                        <Icon icon={option.icon} class="size-3.5 shrink-0" />
                        <span class="min-w-0 flex-1 truncate">{option.label}</span>
                    </button>
                {/each}
            </div>
        {/if}
    </div>
</div>
