<script lang="ts">
    /**
     * @desc 乘区级生效条件（行内下拉展开）：直接挂在 BUFF 内部的**具体乘区**上。
     * 可配置：伤害类型、伤害属性、自定义变量判定（布尔值等于真/假、数值 大于/等于/小于/不等于）。
     * 链条件与阶条件不在这里 —— 它们是整个 BUFF 的硬性条件，只在 BUFF 级「生效条件」里配置。
     */
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import type { BuffCondition, BoolClause, NumClause, BuffOperand } from '$lib/calc/calculation.types'
    import { getUserVars } from '$lib/calc/calculation.store.svelte'
    import { ELEMENTS, DAMAGE_TYPES, DAMAGE_TYPE_SHORT } from '$lib/consts/game-terms'
    import { isConditionEmpty } from '$lib/calc/condition'

    interface Props extends ComponentsProps {
        condition: BuffCondition | undefined
        locked?: boolean
        onchange: (condition: BuffCondition | null) => void
    }
    let { condition, locked = false, onchange, class: className, style: styleProp }: Props = $props()

    let vars = $derived(getUserVars())
    const numVars = $derived(vars.filter((v) => v.type === 'number'))
    const boolVars = $derived(vars.filter((v) => v.type === 'boolean'))

    const cond = $derived<BuffCondition>(condition ?? {})
    const logic = $derived(cond.logic === 'or' ? 'or' : 'and')

    /** @desc 提交：清空所有子句时回传 null，保持工程数据干净 */
    const emit = (next: BuffCondition) => onchange(isConditionEmpty(next) ? null : next)
    const patch = (part: Partial<BuffCondition>) => emit({ ...cond, ...part })

    // ── 伤害类型 / 属性（多选，任一命中即满足）──
    const toggleDamageType = (dt: string) => {
        const list = cond.damageTypes ?? []
        const next = list.includes(dt) ? list.filter((d) => d !== dt) : [...list, dt]
        patch({ damageTypes: next.length ? next : undefined })
    }
    const toggleElement = (el: string) => {
        const list = cond.elements ?? []
        const next = list.includes(el) ? list.filter((e) => e !== el) : [...list, el]
        patch({ elements: next.length ? next : undefined })
    }

    // ── 自定义变量判定 ──
    const addBool = () => {
        if (boolVars.length === 0) return
        patch({ bools: [...(cond.bools ?? []), { var: boolVars[0].name, op: 'is_true' }] })
    }
    const updateBool = (i: number, part: Partial<BoolClause>) =>
        patch({ bools: (cond.bools ?? []).map((c, j) => (j === i ? { ...c, ...part } : c)) })
    const removeBool = (i: number) => patch({ bools: (cond.bools ?? []).filter((_, j) => j !== i) })

    const addNum = () => {
        if (numVars.length === 0) return
        patch({ numbers: [...(cond.numbers ?? []), { var: numVars[0].name, cmp: 'gte', value: { const: 0 } }] })
    }
    const updateNum = (i: number, part: Partial<NumClause>) =>
        patch({ numbers: (cond.numbers ?? []).map((c, j) => (j === i ? { ...c, ...part } : c)) })
    const removeNum = (i: number) => patch({ numbers: (cond.numbers ?? []).filter((_, j) => j !== i) })

    /** @desc 数值条件右值：常量 或 另一个计数变量 */
    const operandIsVar = (operand: BuffOperand | undefined) => !!operand && 'var' in operand
    const operandConst = (operand: BuffOperand | undefined): number =>
        operand && 'const' in operand ? (typeof operand.const === 'number' ? operand.const : 0) : 0
    const operandVar = (operand: BuffOperand | undefined): string =>
        operand && 'var' in operand ? operand.var : (numVars[0]?.name ?? '')

    const clauseCount = $derived(
        (cond.damageTypes?.length ?? 0) +
            (cond.elements?.length ?? 0) +
            (cond.bools?.length ?? 0) +
            (cond.numbers?.length ?? 0)
    )
</script>

<div
    class={['space-y-2 border-t px-2 py-2', className].join(' ')}
    style="border-color: var(--theme-divider-border); background: var(--theme-modal-bg); {styleProp || ''}"
>
    <div class="flex items-center gap-1.5">
        <Icon icon="mdi:filter-outline" class="size-3.5 shrink-0" style="color: var(--theme-accent-text);" />
        <span class="text-[11px] font-black tracking-tight">该乘区的生效条件</span>
        <span class="text-[10px] text-(--theme-modal-text)/40">
            不满足时只有这个乘区不计入；链/阶是整个 BUFF 的硬性条件
        </span>
    </div>

    <!-- 伤害类型 -->
    <div class="flex flex-wrap items-center gap-1">
        <span class="w-16 shrink-0 text-[10px] text-(--theme-modal-text)/45">伤害类型</span>
        {#each DAMAGE_TYPES as dt (dt)}
            {@const on = (cond.damageTypes ?? []).includes(dt)}
            <button
                onclick={() => toggleDamageType(dt)}
                disabled={locked}
                title={dt}
                class="border px-1.5 py-0.5 text-[10px] transition-colors disabled:opacity-40"
                style={on
                    ? 'background: color-mix(in srgb, var(--theme-accent-bg) 22%, transparent); color: var(--theme-accent-text); border-color: color-mix(in srgb, var(--theme-accent-bg) 45%, transparent);'
                    : 'background: var(--theme-card-bg); color: color-mix(in srgb, var(--theme-modal-text) 45%, transparent); border-color: var(--theme-divider-border);'}
            >
                {DAMAGE_TYPE_SHORT[dt] ?? dt}
            </button>
        {/each}
    </div>

    <!-- 伤害属性 -->
    <div class="flex flex-wrap items-center gap-1">
        <span class="w-16 shrink-0 text-[10px] text-(--theme-modal-text)/45">伤害属性</span>
        {#each ELEMENTS as el (el)}
            {@const on = (cond.elements ?? []).includes(el)}
            <button
                onclick={() => toggleElement(el)}
                disabled={locked}
                class="border px-1.5 py-0.5 text-[10px] transition-colors disabled:opacity-40"
                style={on
                    ? 'background: color-mix(in srgb, var(--theme-accent-bg) 22%, transparent); color: var(--theme-accent-text); border-color: color-mix(in srgb, var(--theme-accent-bg) 45%, transparent);'
                    : 'background: var(--theme-card-bg); color: color-mix(in srgb, var(--theme-modal-text) 45%, transparent); border-color: var(--theme-divider-border);'}
            >
                {el}
            </button>
        {/each}
    </div>

    <!-- 布尔值变量判定 -->
    <div class="space-y-1">
        <div class="flex items-center gap-1">
            <span class="w-16 shrink-0 text-[10px] text-(--theme-modal-text)/45">布尔变量</span>
            <button
                onclick={addBool}
                disabled={locked || boolVars.length === 0}
                class="p-0.5 text-(--theme-accent-text) transition-colors disabled:opacity-30"
                title={boolVars.length === 0 ? '尚未创建布尔变量' : '新增一条布尔变量判定'}
            >
                <Icon icon="mdi:plus" class="size-3.5" />
            </button>
            {#if boolVars.length === 0}
                <span class="text-[10px] text-(--theme-modal-text)/30">先在「变量」中创建布尔变量</span>
            {/if}
        </div>
        {#each cond.bools ?? [] as clause, i}
            <div class="flex items-center gap-1 pl-16">
                <select
                    value={clause.var}
                    onchange={(e) => updateBool(i, { var: e.currentTarget.value })}
                    disabled={locked}
                    class="min-w-0 flex-1 border px-1 py-0.5 text-[10px] outline-none disabled:opacity-60"
                    style="background: var(--theme-card-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                >
                    {#each boolVars as bv (bv.id)}
                        <option value={bv.name}>{bv.name}</option>
                    {/each}
                </select>
                <select
                    value={clause.op}
                    onchange={(e) => updateBool(i, { op: e.currentTarget.value as BoolClause['op'] })}
                    disabled={locked}
                    class="shrink-0 border px-1 py-0.5 text-[10px] outline-none disabled:opacity-60"
                    style="background: var(--theme-card-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                >
                    <option value="is_true">等于 真</option>
                    <option value="is_false">等于 假</option>
                </select>
                <button
                    onclick={() => removeBool(i)}
                    disabled={locked}
                    class="shrink-0 p-0.5 text-(--theme-modal-text)/35 transition-colors hover:text-red-400 disabled:opacity-40"
                >
                    <Icon icon="mdi:close" class="size-3.5" />
                </button>
            </div>
        {/each}
    </div>

    <!-- 计数值变量判定 -->
    <div class="space-y-1">
        <div class="flex items-center gap-1">
            <span class="w-16 shrink-0 text-[10px] text-(--theme-modal-text)/45">数值变量</span>
            <button
                onclick={addNum}
                disabled={locked || numVars.length === 0}
                class="p-0.5 text-(--theme-accent-text) transition-colors disabled:opacity-30"
                title={numVars.length === 0 ? '尚未创建计数变量' : '新增一条数值变量判定'}
            >
                <Icon icon="mdi:plus" class="size-3.5" />
            </button>
            {#if numVars.length === 0}
                <span class="text-[10px] text-(--theme-modal-text)/30">先在「变量」中创建计数变量</span>
            {/if}
        </div>
        {#each cond.numbers ?? [] as clause, i}
            <div class="flex flex-wrap items-center gap-1 pl-16">
                <select
                    value={clause.var}
                    onchange={(e) => updateNum(i, { var: e.currentTarget.value })}
                    disabled={locked}
                    class="min-w-0 flex-1 border px-1 py-0.5 text-[10px] outline-none disabled:opacity-60"
                    style="background: var(--theme-card-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                >
                    {#each numVars as nv (nv.id)}
                        <option value={nv.name}>{nv.name}</option>
                    {/each}
                </select>
                <select
                    value={clause.cmp}
                    onchange={(e) => updateNum(i, { cmp: e.currentTarget.value as NumClause['cmp'] })}
                    disabled={locked}
                    class="shrink-0 border px-1 py-0.5 text-[10px] outline-none disabled:opacity-60"
                    style="background: var(--theme-card-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                >
                    <option value="gt">大于</option>
                    <option value="eq">等于</option>
                    <option value="lt">小于</option>
                    <option value="ne">不等于</option>
                </select>
                {#if operandIsVar(clause.value)}
                    <select
                        value={operandVar(clause.value)}
                        onchange={(e) => updateNum(i, { value: { var: e.currentTarget.value } })}
                        disabled={locked}
                        class="shrink-0 border px-1 py-0.5 text-[10px] outline-none disabled:opacity-60"
                        style="background: var(--theme-card-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                    >
                        {#each numVars as nv (nv.id)}
                            <option value={nv.name}>{nv.name}</option>
                        {/each}
                    </select>
                    <button
                        onclick={() => updateNum(i, { value: { const: 0 } })}
                        disabled={locked}
                        class="shrink-0 px-1 py-0.5 text-[10px] text-(--theme-modal-text)/45 transition-colors hover:text-(--theme-accent-text) disabled:opacity-40"
                        title="改为常量"
                    >
                        常量
                    </button>
                {:else}
                    <input
                        type="number"
                        value={operandConst(clause.value)}
                        onchange={(e) => updateNum(i, { value: { const: Number(e.currentTarget.value) || 0 } })}
                        disabled={locked}
                        class="w-16 shrink-0 border px-1 py-0.5 text-right text-[10px] tabular-nums outline-none disabled:opacity-60"
                        style="background: var(--theme-card-bg); color: var(--theme-modal-text); border-color: var(--theme-divider-border);"
                    />
                    {#if numVars.length > 0}
                        <button
                            onclick={() => updateNum(i, { value: { var: numVars[0].name } })}
                            disabled={locked}
                            class="shrink-0 px-1 py-0.5 text-[10px] text-(--theme-modal-text)/45 transition-colors hover:text-(--theme-accent-text) disabled:opacity-40"
                            title="改为引用另一个计数变量"
                        >
                            变量
                        </button>
                    {/if}
                {/if}
                <button
                    onclick={() => removeNum(i)}
                    disabled={locked}
                    class="shrink-0 p-0.5 text-(--theme-modal-text)/35 transition-colors hover:text-red-400 disabled:opacity-40"
                >
                    <Icon icon="mdi:close" class="size-3.5" />
                </button>
            </div>
        {/each}
    </div>

    <!-- 逻辑关系 + 清空 -->
    <div class="flex items-center gap-2">
        {#if clauseCount > 1}
            <span class="text-[10px] text-(--theme-modal-text)/45">这些条件</span>
            <div class="flex border" style="border-color: var(--theme-divider-border);">
                {#each [['and', '全部满足'], ['or', '满足任一']] as [key, label]}
                    <button
                        onclick={() => patch({ logic: key as 'and' | 'or' })}
                        disabled={locked}
                        class="px-2 py-0.5 text-[10px] transition-colors disabled:opacity-60"
                        style={logic === key
                            ? 'background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);'
                            : 'background: var(--theme-card-bg); color: color-mix(in srgb, var(--theme-modal-text) 55%, transparent);'}
                    >
                        {label}
                    </button>
                {/each}
            </div>
        {/if}
        {#if clauseCount > 0}
            <button
                onclick={() => onchange(null)}
                disabled={locked}
                class="ml-auto text-[10px] text-(--theme-modal-text)/40 transition-colors hover:text-red-400 disabled:opacity-60"
            >
                清空该乘区条件
            </button>
        {/if}
    </div>
</div>
