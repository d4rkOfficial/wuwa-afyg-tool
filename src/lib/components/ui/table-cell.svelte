<script lang="ts">
    /**
     * @desc 表格单元格（`<td>` / `<th>`）：统一列内边距 + 水平对齐。
     * 抽自 `comparison-modal.svelte` 两张对比表里逐字重复的外层壳：
     *   - 表头右侧列 `px-2 py-1.5 text-right font-medium`（6 处，含 1 处带 `style`）
     *   - 表体数字列 `px-2 py-2 text-right tabular-nums`（3 处）
     *   - 表体统计列 `px-2 py-2 text-right text-[10px] tabular-nums`（1 处，带 `style`）
     *
     * 注（**为何只管外壳，不收字重/字号**）：各站点的字重字号从 `text-[10px]` 到 `text-sm font-black`
     * 跨度极大，收进外壳要么造成渲染漂移、要么得为每种组合加枚举 prop。故这些差异一律由调用方
     * 经 `class` 传入——`mergeClass` 把它追加在 base 之后，可覆盖 base。
     * 同理 `style`（如 `opacity: 0.45`）由调用方传入；**不传时不产生 `style` 属性**
     * （Svelte 的 `set_style`/`set_attribute` 在值为 `undefined` 时走 `removeAttribute`）。
     *
     * 注：`as` 只切换标签名；`<th>` 的 UA 默认样式（居中 + 加粗）被 base 的
     * `text-right` + 调用方传入的 `font-medium` 覆盖，故两类站点共用同一外壳。
     */
    import type { Snippet } from 'svelte'
    import type { ComponentsProps } from '$lib/types'
    import { mergeClass } from '$lib/utils/component-style'

    interface Props extends ComponentsProps {
        /** @desc 渲染成哪种单元格：`td`（表体，默认）/ `th`（表头） */
        as?: 'td' | 'th'
        /** @desc 行高档位（按所在行取，与标签无关）：`head`=`py-1.5`（表头行）/ `body`=`py-2`（表体行，默认） */
        size?: 'head' | 'body'
        /** @desc 水平对齐（实测站点只有右侧列，故默认 `right`） */
        align?: 'left' | 'right'
        children?: Snippet
    }

    let { as = 'td', size = 'body', align = 'right', class: className, style: styleProp, children }: Props = $props()

    // 写成「查表取字面量类名」而非模板拼接：Tailwind 静态扫描才能看到完整类名。
    const PAD = { head: 'py-1.5', body: 'py-2' } as const
    const ALIGN = { left: 'text-left', right: 'text-right' } as const
    const cellClass = $derived(mergeClass(['px-2', PAD[size], ALIGN[align], className]))
</script>

{#if as === 'th'}
    <th class={cellClass} style={styleProp}>{@render children?.()}</th>
{:else}
    <td class={cellClass} style={styleProp}>{@render children?.()}</td>
{/if}
