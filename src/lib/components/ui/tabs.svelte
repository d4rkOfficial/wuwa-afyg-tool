<script lang="ts">
    /**
     * @desc 分段式 text tabs：**等宽分段 + 单一滑动指示块**。
     *
     * 指示块是一个绝对定位元素，切换时从旧分段滑到新分段 —— 也就是用户要的「底色从起点走到终点、
     * 边界一路推过去」，而不是两个按钮各自淡入淡出各自的底色。实现走
     * `transform: translateX(index × 100%)` + `width: calc((100% - 0.25rem) / N)`，**不做任何 DOM 测量**。
     *
     * 取舍（重要，勿默默改掉）：不量宽度的前提是**分段等宽**（每个分段 `flex-1`）。
     * 指示块宽恒为「轨道宽 / N」，而分段宽在收缩到内容（shrink-to-fit）的容器里是**各自的内容宽**，
     * 因此同一组里标签字数/内边距不一致时会与指示块错位。现有调用点的每组标签字数一致、
     * 内边距一致（累计/窗口、看总伤/看占比、线性地/离散地），等宽天然成立。
     * 若将来要接不等宽标签，只有三条路：① 给分段定死等宽（`basis-*` / 等宽字面量）；
     * ② 把**轨道**定宽（调用方传 `w-44` 之类）—— 定宽轨道下 `flex-1` 的分段必然等分，
     *    与各标签内容无关，这是不比测量差的确定解，设置弹窗的「左文案 + 右控件」行即此用法；
     * ③ 改为测量（绑定每个分段的 `offsetLeft` / `offsetWidth`）—— 本组件刻意不引入该状态。
     *
     * **折行坑（对每个调用点都潜在成立，T19 在链/阶实测）**：分段是 `flex: 1 1 0%` 且**刻意不写**
     * `whitespace-nowrap`，`min-width` 仍是默认 `auto`；而 CJK 可逐字断行 → `min-width:auto` 的
     * min-content **只有一个字**，于是**宽标签既不撑宽轨道也不溢出，而是被折成两行**
     * （实测 `无专` 在默认 `px-3 text-sm` 下 max-content 28px > 每段内容盒 24.87px → 段高 28 → **48px**）。
     * 三种错法都实测过：只 `w-fit` → 折行；`w-fit` + `nowrap` → 不折但宽段 `min-width:auto` 变
     * max-content(52px) → **各段不再等宽**（52 vs 47）、指示块左差 4.14px；任意定宽但**不加 nowrap**
     * → 标签照折（`w-[340px]` 下 7 段全折两行）。故接**长标签**组时只能
     * **`min-w-[<推导值>]` + `whitespace-nowrap` 一起给**，且
     * `min-w` 必须 ≥ `N × (最宽标签 + 左右内边距) + 轨道内边距`
     * （链/阶那处的推导：阶 `6×(28+24)+4 = 316`、链 `7×(23.05+24)+4 ≈ 333.4` → 取 336）。
     *
     * **同权重 `w-*` 覆盖不了基底的 `w-fit`（机制坑）**：根节点基底类**已有 `w-fit`**，而 `class` 走
     * `mergeClass`（只拼空格、**不去重**）→ 同权重工具类谁生效**只看生成 CSS 的顺序**；实测
     * `class="w-fit w-[340px]"` 时轨道宽**恒等于 `w-fit` 的结果**，`w-[…]` **完全不生效**。
     * 故覆盖宽度只能用**不同属性**的 `min-w-[…]`，不能用 `w-[…]`。
     *
     * **但不要给分段加 `whitespace-nowrap`**：T15 曾**刻意**去掉 7 段满宽组的 `nowrap`，
     * 让它在窄屏**折行而不是溢出**；全局加上会把这个选择反过来（`min-width:auto` 变 max-content
     * → 窄屏溢出 + 各段不等宽 → 指示块错位）。
     *
     * 尺寸：默认 `px-3 py-1 text-sm`；`compact` 换 `px-2 py-1 text-[11px] leading-4`（设置行等窄栏位）。
     * 两者是**同位置二选一**（不是叠加），故不需要 `[&>button]:` 变体或 tailwind-merge 去重。
     *
     * 内边距几何：轨道 `p-0.5`（0.125rem），指示块 `left-0.5 top-0.5 bottom-0.5`，
     * 故宽度减掉左右内边距 `- 0.25rem`，`translateX(index × 100%)` 每一步恰好一个指示块宽，
     * 落点与分段一一对应。
     *
     * 配色：`backgroundImage` 覆盖指示块默认底色（`--theme-tabs-bg`），`textColor` 覆盖选中项前景色
     * ——即改造前「选中项三件套」的语义，只是底色从选中按钮搬到了指示块上，才能形成滑动。
     *
     * 关于用户说的「起点到终点着色，然后边界推过去」（T15/T16 评估结论，勿重复返工）：
     *   - 「起点到终点」与「边界推过去」由**同一个 transform 过渡**实现：指示块在起点着色、整块
     *     平移到终点，两个边界一起推过去（这是本组件的核心，也是它取代「两个按钮各自淡入淡出」的原因）。
     *   - 底色变化**也走同一条过渡**（`transition-[transform,background-color]` + `--motion-base`），
     *     于是「着色」是随行程发生的，而不是切换瞬间硬切（设置-主色调从一个预设切到另一个预设时可见）。
     *   - **做不到**的是「把渐变色的色标（stop）也当成可过渡量」：CSS 的 `linear-gradient` 色标不可插值，
     *     要动画它必须用 `@property` 注册一个 `<color>`/`<percentage>` 自定义属性并让它参与过渡，
     *     而 `@property` 只能注册在全局样式表（本仓库即 `src/routes/layout.css`）——它不属本组件的文件，
     *     且给指示块铺静态渐变会让**静止态**变成双色块（现有 11 个调用点的选中态观感都会变差）。
     *     故此处只做「颜色随行程过渡」，不做渐变 stop 动画。
     *
     * 减弱动态效果：指示块是 `<span>`，不吃 layout.css 里 `:where(button)` 的全局归零规则，
     * 故自己带 `motion-reduce:transition-none`；按钮的文字色过渡由该全局规则负责。
     */
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import { joinStyle, mergeClass } from '$lib/utils/component-style'

    interface TabItem {
        /** @desc 选中值（回调入参；须唯一，同时用作 {#each} 的 key） */
        value: string
        /** @desc 分段文案 */
        label: string
        /** @desc 可选 mdi 图标名（与文案同排） */
        icon?: string
        /** @desc 文案后的次要标记（如「当前」），以 60% 不透明度跟在同一分段内 */
        suffix?: string
        /** @desc 原生 title 提示（逐项说明较长时用，如「屏幕左上角向下堆叠」） */
        title?: string
    }

    interface Props extends ComponentsProps {
        /**
         * @desc 分段清单；`value` 即选中值与回调入参（须唯一，同时用作 `{#each}` 的 key）
         * @desc 每段另可选 `icon`（mdi 名）/ `suffix`（文案后的次要标记）/ `title`（原生提示）
         */
        items: TabItem[]
        /** @desc 当前选中值（受控）；不在 `items` 中时指示块回落第 0 段 */
        value: string
        /** @desc 选中变化回调，入参为被点选分段的 `value`（单词型事件 prop 全小写，AGENTS §3） */
        onchange?: (value: string) => void
        /** @desc 紧凑尺寸档（`px-2 py-1 text-[11px] leading-4`）：设置行等窄栏位用；默认 `px-3 py-1 text-sm` */
        compact?: boolean
    }

    let {
        items,
        value,
        onchange,
        compact = false,
        backgroundImage,
        textColor,
        class: className,
        style: styleProp
    }: Props = $props()

    /** @desc 当前下标（找不到 / 空列表时回落 0，避免 translateX(NaN)） */
    let activeIndex = $derived(
        Math.max(
            0,
            items.findIndex((item) => item.value === value)
        )
    )
    /** @desc 指示块几何：宽度 = 轨道宽 / N，位移 = 下标 × 自身宽（无测量） */
    let indicatorStyle = $derived(
        joinStyle([
            `width: calc((100% - 0.25rem) / ${items.length});`,
            `transform: translateX(${activeIndex * 100}%);`,
            backgroundImage ? `background: ${backgroundImage};` : ''
        ])
    )
</script>

<div
    data-sf="widget"
    data-sf-flat
    class={mergeClass(['relative flex rounded-none border border-(--theme-divider-border) p-0.5', className])}
    style="--sf-base: var(--theme-input-bg); {styleProp || ''}"
    role="tablist"
>
    <!-- 指示块：绝对定位 + transform 位移（无测量）。刻意排在按钮**之前**，
         靠分段的 `relative` 把文字压在它上层，从而不需要任何 z-index。 -->
    {#if items.length > 0}
        <span
            aria-hidden="true"
            class="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 rounded-none bg-(--theme-tabs-bg) transition-[transform,background-color] duration-[var(--motion-base)] ease-out motion-reduce:transition-none"
            style={indicatorStyle}
        ></span>
    {/if}
    {#each items as item, i (item.value)}
        <button
            type="button"
            role="tab"
            aria-selected={i === activeIndex}
            title={item.title}
            onclick={() => onchange?.(item.value)}
            class={mergeClass([
                'relative inline-flex flex-1 items-center justify-center gap-1.5 rounded-none font-medium transition-colors duration-[var(--motion-fast)] ease-out motion-reduce:transition-none',
                compact ? 'px-2 py-1 text-[11px] leading-4' : 'px-3 py-1 text-sm',
                i === activeIndex
                    ? 'text-(--theme-tabs-text)'
                    : 'text-(--theme-modal-text)/50 hover:text-(--theme-modal-text)/80 active:text-(--theme-modal-text)'
            ])}
            style={i === activeIndex && textColor ? `color: ${textColor};` : ''}
        >
            {#if item.icon}
                <Icon icon={item.icon} class="size-4 shrink-0" />
            {/if}
            {item.label}{#if item.suffix}<span class="ml-1 opacity-60">{item.suffix}</span>{/if}
        </button>
    {/each}
</div>
