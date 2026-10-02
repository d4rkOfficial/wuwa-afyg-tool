<script lang="ts">
    /**
     * @desc 内联小徽标（chip）：可包图标 + 文本，底色/前景色由调用方决定。
     *
     * 抽因（实测，非「看起来像」）：两张拉表（`spread-table` / `dropdown-table`）里逐字重复的壳只有两档 ——
     * - `badge`：铺开表顶部「全局 BUFF」黄底 chip、下拉表差异模式的 全局/新增/移除 chip，共 **4 处**类串逐字相同
     *   （`inline-flex items-center gap-0.5 rounded-none px-1.5 py-0.5 text-[10px] font-medium`）；
     * - `plain`：下拉表差异模式「不变」与已绑定 Buff 名 chip，共 **2 处**逐字相同（同上但 `gap-1`）。
     *
     * 颜色两两不同（黄=全局 / 绿=新增 / 红=移除 / 强调色=不变·已绑定），故一律由调用方传入：
     * 有底色变量时走 `style`（`background` + `color`），移除态走语义类 `class="bg-red-500/15 text-red-500"`。
     */
    import type { Snippet } from 'svelte'
    import type { ComponentsProps } from '$lib/types'
    import { mergeClass } from '$lib/utils/component-style'

    interface Props extends ComponentsProps {
        /** @desc 壳档位：`badge`=图标+文本（gap-0.5，默认）/ `plain`=纯文本名（gap-1） */
        variant?: 'badge' | 'plain'
        children?: Snippet
    }

    let { variant = 'badge', class: className, style: styleProp, children }: Props = $props()

    // 写成「查表取字面量类名」而非模板拼接：Tailwind 静态扫描才能看到完整类名。
    const BASE = {
        badge: 'inline-flex items-center gap-0.5 rounded-none px-1.5 py-0.5 text-[10px] font-medium',
        plain: 'inline-flex items-center gap-1 rounded-none px-1.5 py-0.5 text-[10px] font-medium'
    } as const
    const chipClass = $derived(mergeClass([BASE[variant], className]))
</script>

<span class={chipClass} style={styleProp}>{@render children?.()}</span>
