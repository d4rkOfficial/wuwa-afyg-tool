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
        team: [CharSlot, CharSlot, CharSlot]
        charIconMap: Record<string, string>
        /** @desc 可被 `buffActive` 引用的 Buff 候选（当前树内的其它 Buff） */
        buffOptions: { id: string; label: string }[]
        /** @desc 保存整组规则；返回错误文案（null = 成功） */
        onsave: (rules: BuffRule[]) => string | null
    }

    let { rules, team, charIconMap, buffOptions, onsave, class: className, style: styleProp }: Props = $props()

    /** @desc 展开编辑的规则下标（-1 = 全部收起） */
    let editingIndex = $state(-1)
    /** @desc 「创建条件」类型菜单开关 */
    let kindMenuOpen = $state(false)

    const slotName = (i: number): string => team[i]?.character ?? `角色 ${i + 1}`
    const buffLabel = (id: string): string => buffOptions.find((o) => o.id === id)?.label ?? id

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
            case 'damageNameEquals':
                return { kind: 'damageNameEquals', value: '' }
            case 'zoneCompare':
                return { kind: 'zoneCompare', charIdx: -1, zone: 'atk', op: 'ge', value: 0 }
            case 'enemyType':
                return { kind: 'enemyType', type: 'BOSS' }
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
        damageNameEquals: 'mdi:format-text',
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

<div class={mergeClass(['flex flex-1 flex-col gap-2 overflow-y-auto p-3', className])} style={styleProp}>
    <div class="flex items-center gap-1.5">
        <Icon icon="mdi:filter-cog-outline" class="size-3.5 shrink-0" style="color: var(--theme-accent-text);" />
        <span class="text-xs font-black tracking-tight text-(--theme-modal-text)">门槛条件</span>
        <span class="text-[10px] text-(--theme-modal-text)/45"
            >{rules.length === 0 ? '无条件（本次伤害恒生效）' : `${rules.length} 条条件，全部同时满足`}</span
        >
    </div>

    {#each rules as rule, index (index)}
        {@const draft = isRuleDraft(rule)}
        <div class="border" style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);">
            <div class="flex items-center gap-1.5 px-2 py-1.5">
                <Icon icon={RULE_ICON[rule.kind]} class="size-3.5 shrink-0" style="color: var(--theme-accent-text);" />
                <span class="shrink-0 text-[10px] font-black tracking-tight text-(--theme-modal-text)/70"
                    >{ruleTitle(rule)}</span
                >
                <span class="min-w-0 flex-1 truncate text-[11px] text-(--theme-modal-text)">
                    {describeRule(rule, { slotName, buffName: buffLabel })}
                </span>
                {#if draft}
                    <span class="shrink-0 text-[10px] text-amber-400">未填写</span>
                {/if}
                <button
                    type="button"
                    onclick={() => (editingIndex = editingIndex === index ? -1 : index)}
                    class="shrink-0 rounded-none border px-1.5 py-0.5 text-[10px] text-(--theme-modal-text)/50 transition-colors hover:text-(--theme-accent-text)"
                    style="border-color: var(--theme-divider-border);"
                >
                    <Icon icon={editingIndex === index ? 'mdi:chevron-up' : 'mdi:pencil'} class="size-3" />
                </button>
                <button
                    type="button"
                    onclick={() => removeAt(index)}
                    class="shrink-0 rounded-none border border-transparent px-1 py-0.5 text-(--theme-modal-text)/30 transition-colors hover:border-red-500/40 hover:text-red-500"
                    title="删除该条件"
                >
                    <Icon icon="mdi:close" class="size-3" />
                </button>
            </div>

            {#if editingIndex === index}
                <div class="space-y-2 border-t px-2 py-2" style="border-color: var(--theme-divider-border);">
                    {#if rule.kind === 'chain' || rule.kind === 'refinement'}
                        {@const max = rule.kind === 'chain' ? CHAIN_MAX : REFINE_MAX}
                        {@const minFloor = rule.kind === 'chain' ? 0 : 1}
                        <div class="flex items-center gap-1.5">
                            <span class="w-14 shrink-0 text-[10px] text-(--theme-modal-text)/45">角色</span>
                            {#each team as slot, i (i)}
                                <button
                                    type="button"
                                    onclick={() => replaceAt(index, { ...rule, charIdx: i })}
                                    class={[
                                        'size-7 shrink-0 overflow-hidden border-2 transition-all',
                                        rule.charIdx === i
                                            ? 'border-(--theme-accent-bg)'
                                            : 'border-(--theme-divider-border) grayscale opacity-40 hover:opacity-70'
                                    ].join(' ')}
                                    title={slotName(i)}
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
                                        <span class="text-[9px] text-(--theme-modal-text)/50"
                                            >{slot.character?.charAt(0) ?? '?'}</span
                                        >
                                    {/if}
                                </button>
                            {/each}
                        </div>
                        <div class="flex flex-wrap items-center gap-1">
                            <span class="w-14 shrink-0 text-[10px] text-(--theme-modal-text)/45"
                                >{rule.kind === 'chain' ? '链 ≥' : '阶 ≥'}</span
                            >
                            {#each Array.from({ length: max - minFloor + 1 }, (_, k) => k + minFloor) as n (n)}
                                <button
                                    type="button"
                                    onclick={() => replaceAt(index, { ...rule, min: n })}
                                    class={[
                                        'h-6 min-w-6 rounded-none border px-1 text-[11px] transition-colors',
                                        rule.min === n
                                            ? 'border-(--theme-accent-bg) text-(--theme-accent-text)'
                                            : 'border-(--theme-divider-border) text-(--theme-modal-text)/50 hover:text-(--theme-modal-text)'
                                    ].join(' ')}
                                >
                                    {rule.kind === 'chain' && n === 0 ? '本体' : n}
                                </button>
                            {/each}
                        </div>
                    {:else if rule.kind === 'damageNameRegex' || rule.kind === 'damageNameEquals'}
                        <div class="flex flex-col gap-1">
                            <span class="text-[10px] text-(--theme-modal-text)/45"
                                >伤害名{rule.kind === 'damageNameRegex' ? '（正则，包含匹配）' : '（全等匹配）'}</span
                            >
                            <input
                                type="text"
                                value={rule.kind === 'damageNameRegex' ? rule.pattern : rule.value}
                                oninput={(e) => {
                                    const value = (e.target as HTMLInputElement).value
                                    replaceAt(
                                        index,
                                        rule.kind === 'damageNameRegex'
                                            ? { kind: 'damageNameRegex', pattern: value }
                                            : { kind: 'damageNameEquals', value }
                                    )
                                }}
                                placeholder={rule.kind === 'damageNameRegex' ? '如 共鸣解放|处决' : '如 共鸣解放·终曲'}
                                class="rounded-none border px-2 py-1 text-[11px] outline-none text-(--theme-modal-text)"
                                style="border-color: var(--theme-divider-border); background: var(--theme-modal-bg);"
                            />
                            {#if rule.kind === 'damageNameRegex' && rule.pattern.trim() && !isValidRegex(rule.pattern)}
                                <span class="text-[10px] text-red-400">正则表达式无效</span>
                            {/if}
                        </div>
                    {:else if rule.kind === 'zoneCompare'}
                        <div class="flex flex-wrap items-center gap-1">
                            <span class="w-14 shrink-0 text-[10px] text-(--theme-modal-text)/45">角色</span>
                            <button
                                type="button"
                                onclick={() => replaceAt(index, { ...rule, charIdx: -1 })}
                                class={[
                                    'rounded-none border px-1.5 py-0.5 text-[10px] transition-colors',
                                    rule.charIdx < 0
                                        ? 'border-(--theme-accent-bg) text-(--theme-accent-text)'
                                        : 'border-(--theme-divider-border) text-(--theme-modal-text)/50'
                                ].join(' ')}
                                title="按伤害条目的归属角色判定">当前角色</button
                            >
                            {#each team as slot, i (i)}
                                <button
                                    type="button"
                                    onclick={() => replaceAt(index, { ...rule, charIdx: i })}
                                    class={[
                                        'rounded-none border px-1.5 py-0.5 text-[10px] transition-colors',
                                        rule.charIdx === i
                                            ? 'border-(--theme-accent-bg) text-(--theme-accent-text)'
                                            : 'border-(--theme-divider-border) text-(--theme-modal-text)/50'
                                    ].join(' ')}>{slot.character ?? `角色${i + 1}`}</button
                                >
                            {/each}
                        </div>
                        <div class="flex flex-wrap items-center gap-1">
                            <span class="w-14 shrink-0 text-[10px] text-(--theme-modal-text)/45">属性</span>
                            <select
                                value={rule.zone}
                                onchange={(e) =>
                                    replaceAt(index, {
                                        ...rule,
                                        zone: (e.target as HTMLSelectElement).value as ZoneCompareId
                                    })}
                                class="rounded-none border px-1.5 py-0.5 text-[10px] outline-none text-(--theme-modal-text)"
                                style="border-color: var(--theme-divider-border); background: var(--theme-modal-bg);"
                            >
                                {#each ZONE_COMPARE_OPTIONS as option (option.value)}
                                    <option value={option.value}>{option.label}</option>
                                {/each}
                            </select>
                            <select
                                value={rule.op}
                                onchange={(e) =>
                                    replaceAt(index, {
                                        ...rule,
                                        op: (e.target as HTMLSelectElement).value as ZoneCompareOp
                                    })}
                                class="rounded-none border px-1.5 py-0.5 text-[10px] outline-none text-(--theme-modal-text)"
                                style="border-color: var(--theme-divider-border); background: var(--theme-modal-bg);"
                            >
                                {#each ZONE_COMPARE_OPS as option (option.value)}
                                    <option value={option.value}>{option.label}</option>
                                {/each}
                            </select>
                            <input
                                type="number"
                                value={rule.value}
                                oninput={(e) =>
                                    replaceAt(index, {
                                        ...rule,
                                        value: patchNumber((e.target as HTMLInputElement).value, 0)
                                    })}
                                class="w-20 rounded-none border px-1.5 py-0.5 text-right text-[10px] tabular-nums outline-none text-(--theme-modal-text)"
                                style="border-color: var(--theme-divider-border); background: var(--theme-modal-bg);"
                            />
                            <span class="text-[10px] text-(--theme-modal-text)/40"
                                >{ZONE_COMPARE_OPTIONS.find((o) => o.value === rule.zone)?.unit === '%'
                                    ? '%'
                                    : ''}</span
                            >
                        </div>
                        <p class="text-[10px] text-(--theme-modal-text)/40">
                            读「无条件部分」面板：装备 + 其它 BUFF 的固定乘区（不含带属性/类型条件的乘区、不含本 BUFF
                            自身、不含依赖「某 BUFF 生效」的 BUFF）。
                        </p>
                    {:else if rule.kind === 'enemyType'}
                        <div class="flex flex-wrap items-center gap-1">
                            <span class="w-14 shrink-0 text-[10px] text-(--theme-modal-text)/45">类型</span>
                            {#each ENEMY_TYPE_OPTIONS as option (option.value)}
                                <button
                                    type="button"
                                    onclick={() => replaceAt(index, { kind: 'enemyType', type: option.value })}
                                    class={[
                                        'rounded-none border px-1.5 py-0.5 text-[10px] transition-colors',
                                        rule.type === option.value
                                            ? 'border-(--theme-accent-bg) text-(--theme-accent-text)'
                                            : 'border-(--theme-divider-border) text-(--theme-modal-text)/50'
                                    ].join(' ')}>{option.label}</button
                                >
                            {/each}
                        </div>
                    {:else if rule.kind === 'buffActive'}
                        <div class="flex items-center gap-1">
                            <span class="w-14 shrink-0 text-[10px] text-(--theme-modal-text)/45">匹配</span>
                            {#each [{ value: 'all' as const, label: '全部生效' }, { value: 'any' as const, label: '至少一个生效' }] as mode (mode.value)}
                                <button
                                    type="button"
                                    onclick={() => replaceAt(index, { ...rule, mode: mode.value })}
                                    class={[
                                        'rounded-none border px-1.5 py-0.5 text-[10px] transition-colors',
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
                                        'flex w-full items-center gap-1.5 px-2 py-1 text-left text-[10px] transition-colors',
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
                                <div class="px-2 py-3 text-center text-[10px] text-(--theme-modal-text)/30">
                                    没有可引用的 BUFF
                                </div>
                            {/if}
                        </div>
                        <p class="text-[10px] text-(--theme-modal-text)/40">
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
            class="flex w-full items-center justify-center gap-1.5 border px-2 py-1.5 text-xs font-medium transition-colors hover:bg-(--theme-accent-bg)/10"
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
                {#each RULE_KIND_OPTIONS as option (option.value)}
                    <button
                        type="button"
                        onclick={() => createRule(option.value)}
                        class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] text-(--theme-modal-text)/70 transition-colors hover:bg-(--theme-accent-bg)/10 hover:text-(--theme-accent-text)"
                    >
                        <Icon icon={option.icon} class="size-3.5 shrink-0" />
                        <span class="min-w-0 flex-1 truncate">{option.label}</span>
                    </button>
                {/each}
            </div>
        {/if}
    </div>
</div>
