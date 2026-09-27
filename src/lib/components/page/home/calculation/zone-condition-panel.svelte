<script lang="ts">
    /**
     * @desc 乘区级生效条件（行内下拉展开）：直接挂在 BUFF 内部的**具体乘区**上。
     * 可配置：伤害类型、伤害属性。
     * 链条件与阶条件不在这里 —— 它们是整个 BUFF 的硬性条件，只在 BUFF 级「生效条件」里配置。
     */
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import type { BuffCondition } from '$lib/calc/calculation.types'
    import { ELEMENTS, DAMAGE_TYPES, DAMAGE_TYPE_SHORT } from '$lib/consts/game-terms'
    import { isConditionEmpty } from '$lib/calc/condition'

    interface Props extends ComponentsProps {
        condition: BuffCondition | undefined
        locked?: boolean
        onchange: (condition: BuffCondition | null) => void
    }
    let { condition, locked = false, onchange, class: className, style: styleProp }: Props = $props()

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

    const clauseCount = $derived((cond.damageTypes?.length ?? 0) + (cond.elements?.length ?? 0))
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
