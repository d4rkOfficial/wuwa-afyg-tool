<script lang="ts">
    /**
     * @desc 乘区级生效条件（行内展开）：直接挂在某个乘区**条目**上。
     * 可配置：伤害类型、伤害属性 —— 组合口径固定为「类内或、类间与」：
     * 多选的伤害类型内部「或」、多选的伤害属性内部「或」，而类型条件与属性条件之间必须同时满足。
     * 链条件与阶条件不在这里 —— 它们是整条 BUFF 的硬性条件（工程内由链/阶面板管理，工坊预设由实例级 condition 承载）。
     */
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import type { BuffCondition } from '$lib/calc/calculation.types'
    import { ELEMENTS, DAMAGE_TYPES, DAMAGE_TYPE_SHORT } from '$lib/consts/game-terms'
    import { isConditionEmpty } from '$lib/calc/condition'
    import { slide } from 'svelte/transition'
    import { MOTION_MS, slideParams } from '$lib/utils/motion'

    interface Props extends ComponentsProps {
        condition: BuffCondition | undefined
        onchange: (condition: BuffCondition | null) => void
    }
    let { condition, onchange, class: className, style: styleProp }: Props = $props()

    const cond = $derived<BuffCondition>(condition ?? {})

    /** @desc 提交：清空所有子句时回传 null，保持数据干净 */
    const emit = (next: BuffCondition) => onchange(isConditionEmpty(next) ? null : next)
    const patch = (part: Partial<BuffCondition>) => emit({ ...cond, ...part })

    // ── 伤害类型 / 属性（多选，类内任一命中即满足；两个类别之间为与）──
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

<!-- @desc 本面板整体就是「行内条件展开区」的内容体：两处调用方都把它包在 `{#if 展开条件}` 里，
     所以进出场过渡挂在自己的根节点上（Svelte 的 `transition:` 不能写在组件调用上）。
     两处宿主都在可滚动容器（.theme-scrollbar overflow-y-auto）内，故用 `|local`；本节点恒存在，无需条件过渡。 -->
<div
    transition:slide|local={slideParams(MOTION_MS.base)}
    class={['space-y-2 border-t px-2 py-2', className].join(' ')}
    style="border-color: var(--theme-divider-border); background: var(--theme-modal-bg); {styleProp || ''}"
>
    <div class="flex items-center gap-1.5">
        <Icon icon="mdi:filter-outline" class="size-3.5 shrink-0" style="color: var(--theme-accent-text);" />
        <span class="text-[11px] font-black tracking-tight">该乘区的生效条件</span>
    </div>

    <!-- 伤害类型 -->
    <div class="flex flex-wrap items-center gap-1">
        <span class="w-16 shrink-0 text-[10px] text-(--theme-modal-text)/45">伤害类型</span>
        {#each DAMAGE_TYPES as dt (dt)}
            {@const on = (cond.damageTypes ?? []).includes(dt)}
            <button
                onclick={() => toggleDamageType(dt)}
                title={dt}
                class="border px-1.5 py-0.5 text-[10px] transition-colors"
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
                class="border px-1.5 py-0.5 text-[10px] transition-colors"
                style={on
                    ? 'background: color-mix(in srgb, var(--theme-accent-bg) 22%, transparent); color: var(--theme-accent-text); border-color: color-mix(in srgb, var(--theme-accent-bg) 45%, transparent);'
                    : 'background: var(--theme-card-bg); color: color-mix(in srgb, var(--theme-modal-text) 45%, transparent); border-color: var(--theme-divider-border);'}
            >
                {el}
            </button>
        {/each}
    </div>

    {#if clauseCount > 0}
        <div class="flex items-center">
            <button
                onclick={() => onchange(null)}
                class="ml-auto text-[10px] text-(--theme-modal-text)/40 transition-colors hover:text-red-400"
            >
                清空该乘区条件
            </button>
        </div>
    {/if}
</div>
