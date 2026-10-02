<script lang="ts">
    /**
     * @desc 右栏乘区清单（自 `buff-modal.svelte` 原样抽出）：点击即**添加**一个乘区条目
     * （同一乘区可添加多次，各自独立配置）；宽度固定。
     *
     * 职责边界：本组件是**纯展示 + 单一回传**——`zones` 只用于显示每个乘区已有几条，
     * 点击只把被点的乘区 id 交回父组件（`onadd`），不直接改数据。
     * 尺寸（`ZONE_BAR_WIDTH` / 左边框色）是**内容驱动的定尺**，与原实现同为字面量，未开 `class` 口子。
     */
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import type { BuffZoneValue } from '$lib/calc/calculation.types'
    import { ZONE_SECTION_VIEWS } from '$lib/calc/calculation.consts'
    import { mergeClass } from '$lib/utils/component-style'
    import { ZONE_BAR_WIDTH } from './buff-modal.utils'

    interface Props extends ComponentsProps {
        /** @desc 当前 Buff 的乘区条目列表（只读，用于显示每个乘区已有几个） */
        zones: BuffZoneValue[]
        /** @desc 点击一条乘区定义 → 父组件往当前 Buff 追加该乘区 */
        onadd: (zoneId: string) => void
    }

    let { zones, onadd, class: className, style: styleProp }: Props = $props()

    /** @desc 某乘区定义在当前 Buff 里已有多少条（同一乘区可添加多次） */
    const countOf = (zoneId: string): number => zones.filter((z) => z.zoneId === zoneId).length

    /** @desc 面板根类名 / 内联样式（`class` / `style` 落在根上，供外部定制） */
    const barClass = $derived(mergeClass(['shrink-0 flex flex-col', className]))
    const barStyle = $derived(
        `width: ${ZONE_BAR_WIDTH}px; border-left: 1px solid var(--theme-divider-border);${styleProp || ''}`
    )
</script>

<div class={barClass} style={barStyle}>
    <div class="shrink-0 px-3 pt-3 pb-1.5">
        <div class="flex items-center gap-1.5">
            <Icon icon="mdi:playlist-plus" class="size-3.5 shrink-0" style="color: var(--theme-accent-text);" />
            <span class="text-xs font-black tracking-tight">添加乘区</span>
        </div>
    </div>
    <div class="theme-scrollbar flex-1 overflow-y-auto px-2 pb-3">
        {#each ZONE_SECTION_VIEWS as section (section.title)}
            <div class="mt-2 first:mt-0">
                <div class="px-1 pb-1 text-[10px] font-black tracking-[0.1em] text-(--theme-modal-text)/35">
                    {section.title}
                </div>
                <div class="flex flex-col gap-0.5">
                    {#each section.defs as def (def.id)}
                        {@const count = countOf(def.id)}
                        <button
                            onclick={() => onadd(def.id)}
                            data-press="none"
                            class={[
                                'w-full text-left rounded-none px-2 py-1.5 text-xs font-medium transition-colors inline-flex items-center gap-1.5 hover:bg-(--theme-modal-text)/5 active:bg-(--theme-accent-bg)/15',
                                count > 0
                                    ? 'text-(--theme-accent-text)'
                                    : 'text-(--theme-modal-text)/50 hover:text-(--theme-accent-text)'
                            ].join(' ')}
                            title={`添加「${def.label}」${count > 0 ? `（已有 ${count} 个）` : ''}`}
                        >
                            <!-- @desc 图标取 currentColor：生效乘区随按钮文字一起走主题色 -->
                            <Icon icon="mdi:plus" class="size-3.5 shrink-0" />
                            <span class="min-w-0 flex-1 truncate">{def.label}</span>
                            {#if count > 0}
                                <span
                                    class="shrink-0 px-1 text-[10px] tabular-nums"
                                    style="background: color-mix(in srgb, var(--theme-accent-bg) 18%, transparent); color: var(--theme-accent-text);"
                                    >{count}</span
                                >
                            {/if}
                        </button>
                    {/each}
                </div>
            </div>
        {/each}
    </div>
</div>
