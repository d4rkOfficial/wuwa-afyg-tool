<script lang="ts">
    /**
     * @desc 通用按钮元件：把全项目手写的 `<button>` 收进一个壳，让尺寸 / 配色 / 按压反馈统一。
     *
     * **T34 扩充了什么、为什么**（原 75 行版本的 API 承接不了现状，无法接线 —— 详据见
     * `.tmp/remaining-refactor-handoff.md` §2.1；实测全项目 381 处原生 `<button>`）：
     * - `children`：原来只认 `variant` + `icon` + `label` 的固定组合，而绝大多数调用点是**任意内容**
     *   （图标+文字+条件片段）。`children` 优先于 icon/label，两者可共存（留作兼容既有用法）。
     * - `type`：原来写死 `type="button"`，无法透传。**默认仍是 `'button'`**（与旧行为逐字一致）；
     *   需要 `submit` 的调用点显式传。经实测本项目**全库没有任何 `<form>`**（`rg '<form'` 为 0 处），
     *   故默认值不会改变任何表单行为。
     * - `$restProps`：原来只透传 `disabled` / `onclick` / `class` / `style`，`aria-label` / `title` /
     *   `data-press` / 其它 `data-*` 全部丢失 —— 接线时把 T21/T25 加的 51 处 `data-press="none"`
     *   静默吃掉是不可接受的，故必须支持。
     * - `compact`：原尺寸写死 `px-3 py-1.5 text-sm`，覆盖不到实测最高频的弹窗 footer 族
     *   `h-7 rounded-none px-3 text-xs`（**10 处**）。
     *
     * **尺寸是「同位置二选一」而不是覆盖（重要，勿改成靠调用方 class 压）**：
     * `class` 走 `mergeClass`（只拼空格、**不去重**），同权重工具类谁生效只看产物 CSS 的顺序。
     * 实测（`.tmp/t34-utility-order.mjs`，读真实构建产物 `_app/immutable/assets/*.css`）：
     * Tailwind 按刻度升序发射，`.text-sm` 在 46250、`.text-xs` 在 46434 → 调用方传 `text-xs` 确实能压过
     * 基类 `text-sm`。但那是**巧合性**依赖（同 `ui/tabs` 记过的 `w-fit` vs `w-[340px]` 反例就是压不过），
     * 所以本组件的尺寸一律走**参数化基类**：`compact` 时根本**不发射** `px-3 py-1.5 text-sm`，
     * 只发射 `h-7 px-3 text-xs`。这样不存在同权重冲突，与调用方是否传 class 无关。
     *
     * **不要在这里写 `data-press`**：按压反馈由 `layout.css` 的
     * `:where(button:not(:disabled))` 全局规则提供（transform + 过渡并集，含 `!important` 的过渡），
     * 本组件只叠加全局规则没覆盖的**非 transform** 反馈（按下提亮）。
     */
    import Icon from '@iconify/svelte'
    import type { Snippet } from 'svelte'
    import type { ComponentsProps } from '$lib/types'
    import { resolveButtonSurface, type ButtonSurface } from '$lib/utils/button-surface'
    import { joinStyle, mergeClass } from '$lib/utils/component-style'

    interface Props extends ComponentsProps {
        variant: 'icon' | 'text' | 'icon-text'
        /** @desc 紧凑档：弹窗 footer 的 `h-7 px-3 text-xs`（与默认档**同位置二选一**） */
        compact?: boolean
        /**
         * @desc 显式尺寸档；`'compact'`/`'none'` 优先于 `compact` 布尔量。
         * `'none'` = 基类**不发射**高度/内边距/字号，全部交给调用方 class
         * （用于 padding 小于基类、靠 class 压不过的历史按钮，见 `SIZE_CLASS.none` 注释）。
         */
        size?: 'default' | 'compact' | 'none'
        /**
         * @desc 关掉本组件自带的**外观层**（`focus-visible:*` / `disabled:*` / `active:brightness-110`
         * 三个状态层 + `--theme-btn-text` 前景色兜底 + `--theme-btn-bg` 底色兜底），
         * 只保留布局与排版基类，外观全由调用方给。用于承接「原本完全没有自定义样式」的历史按钮：
         * 直接换过去会凭空多出键盘焦点轮廓、禁用态变暗、按下提亮，以及**昼夜与主题相反的按钮底色** ——
         * 属可见行为变化。实测用例：弹窗 footer 族（`h-7 px-3 text-xs`）全项目 10 处，原本只有
         * `transition-colors hover:*`；以及各处的暗淡图标钮（自带 `text-(--theme-modal-text)/40`）。
         * 注：按压的位移/缩放来自 `layout.css` 的全局 `:where(button:not(:disabled))`，
         * **不受本参数影响**（那是全项目按钮共有的基础反馈，不是本组件的状态层）。
         */
        bare?: boolean
        /**
         * @desc 内边距档。`'auto'`（默认）= 按变体判定（`icon` → `p-1.5`，其余不补），与旧行为一致；
         * 其余取值直接替换该基类，用于承接实际用 `p-1`/`p-0.5`/`p-2` 的历史图标钮
         * （**不能靠调用方 class 压**：`.p-1` 在产物里排在 `.p-1.5` 之前，压不过，见下方 `PAD_CLASS` 注释）。
         */
        pad?: 'auto' | 'none' | 'p-0.5' | 'p-1' | 'p-1.5' | 'p-2'
        /**
         * @desc 与 `bare` 搭配：**只保留禁用态外观**，仍关掉 `focus-visible:*` 与按下提亮。
         *
         * 为什么需要单独一档：有些历史按钮**刻意带禁用态**（如 `disabled={!canSave}` 配
         * `disabled:opacity-40 disabled:pointer-events-none`），若用纯 `bare` 会连禁用态一起关掉 ——
         * 按钮变得看不出不可用，属可见行为退化。实测用例：
         * `buff-entity-edit-modal` 的「保存」、`buff-import-conflict-modal` 更早一版的确认钮。
         */
        keepDisabled?: boolean
        icon?: string
        label?: string
        /** @desc 按钮内容；给了它就以它为准（`icon` / `label` 仅作旧用法保留） */
        children?: Snippet
        /**
         * @desc 区域质感归属：`'widget'` = 底色交给「设置-外观主题-背景质感-小部件」管理（不再写死按钮自身底色），
         * `'none'` = 保持按钮自身底色。不传时按变体判定：图标型 → `'widget'`，文字型 / 图标+文字型 → `'none'`。
         * 注：`--theme-btn-bg` 在预设主题里是渐变（不能当 `color-mix` 的基色），故 widget 模式下不覆盖 `--sf-base`，
         * 需要指定基色的调用方可在 `style` 里自行传 `--sf-base`（如 `--sf-base: var(--theme-btn-bg-focused)`）。
         */
        surface?: ButtonSurface
        /** @desc 原生按钮类型；默认 `'button'`（不提交表单） */
        type?: 'button' | 'submit' | 'reset'
        disabled?: boolean
        onclick?: (e: MouseEvent) => void
        /** @desc 右键菜单（文件夹⋯按钮等用它开菜单）。必须**显式声明**，否则内部 `{...restProps}` 落成隐式 any 参数 */
        oncontextmenu?: (e: MouseEvent) => void
        /** @desc 其余属性（`aria-label` / `title` / `data-*`…）原样透传到 `<button>` */
        [key: string]: unknown
    }

    let {
        variant,
        compact = false,
        size,
        bare = false,
        keepDisabled = false,
        pad = 'auto',
        icon,
        label,
        children,
        surface,
        type = 'button',
        disabled,
        onclick,
        backgroundImage,
        textColor,
        class: className,
        style: styleProp,
        ...restProps
    }: Props = $props()

    const isWidget = $derived(resolveButtonSurface(variant, surface) === 'widget')

    /**
     * 尺寸档：**整组二选一**，不与调用方 class 竞争同权重工具类。
     * 默认档的 `px-3 py-1.5 text-sm` 与旧实现逐字一致（旧行为零漂移）。
     */
    const SIZE_CLASS = {
        default: 'px-3 py-1.5 text-sm',
        compact: 'h-7 px-3 text-xs',
        /**
         * 裸尺寸档：**不发射任何尺寸/内边距**（高度/内边距/字号全交给调用方 class）。
         *
         * 为什么必须有它（实测踩到）：Tailwind 同权重工具类按**字面量升序**发射
         * （`.py-1` 在 `.py-1.5` **之前**、`.px-2.5` 在 `.px-3` **之前**、`.gap-1` 在 `.gap-1.5` 之前），
         * 所以调用方传**更小**的刻度会被基类**压过** —— 只有 `px-4` / `py-2` / `text-xs` / `text-[10px]`
         * 这类「字面量更大」的才能覆盖。于是「基类 px-3 py-1.5 + 调用方 px-2.5 py-1」是**静默失效**的。
         * `size="none"` 从根上避免这场博弈：基类不发，调用方说多少就是多少。
         */
        none: ''
    } as const

    /**
     * @desc 内边距档：**参数化基类**，不与调用方 class 竞争同权重工具类（同尺寸档的思路）。
     *
     * 为什么需要它（实测）：原 `variant === 'icon'` 一律补 `p-1.5`，而项目里的图标钮实际用的是
     * `p-1`（7 处）/ `p-0.5`（3 处）/ `p-2`（1 处），且**靠调用方 class 压不过** ——
     * Tailwind 按刻度升序发射，`.p-1`(@) 在 `.p-1.5`(@) 之前，故 `p-1.5` 反而胜出（已实测）。
     * 于是 `icon` 变体的按钮无法用调用方 class 收窄内边距，必须在这里参数化。
     *
     * `'auto'` = 按变体判定（`icon` → `p-1.5`，其余不补），保持旧行为零漂移。
     */
    const PAD_CLASS = {
        auto: 'p-1.5',
        'p-0.5': 'p-0.5',
        'p-1': 'p-1',
        'p-1.5': 'p-1.5',
        'p-2': 'p-2',
        none: ''
    } as const

    let mergedStyle = $derived(
        joinStyle([
            // 底色**优先取调用方传的 `backgroundImage`**，没传才回落到主题的 `--theme-btn-bg`。
            // （旧实现无条件先写 `--theme-btn-bg` 再由 backgroundImage 覆盖，会在 style 里留下
            //  两条 `background:` 声明；虽然后者生效、视觉无差，但属噪音且与 props 注释矛盾 —— T34 修。）
            // widget 模式刻意不写：底色交给「背景质感-小部件」管理。
            // `bare` 档也刻意不写（同前景色兜底的理由）：`--theme-btn-bg` 在预设里是**与主题昼夜相反**的
            // 按钮渐变（dark 浅色 / light 深色），而 `bare` 语义是「长得像原生按钮」——原生 `<button>` 的底色
            // 被 Tailwind preflight 置为透明。不关掉它，那些自带暗淡前景色的图标钮（`text-(--theme-modal-text)/40`
            // 这类）就会变成与主题相反的实心块，且它们 class 里的 `hover:bg-*` 会被不透明渐变盖住、永远看不见
            // （实测症状：AI 助手悬浮窗头部两个按钮昼夜反色）。AST 实测全项目 70 个 `ui/Button` 调用点
            // 全是 `bare`，其中只剩 7 处完全不给 `backgroundImage` —— 正是这条兜底色的受害者
            // （AI 助手头部 2 个 + 各弹窗里的暗淡图标钮 5 个）；另有 1 处按条件传
            // （`confirm-dialog` 的危险分支传空串，修前同样被这条不透明兜底盖住了 class 里的 `bg-red-500`）。
            backgroundImage
                ? `background: ${backgroundImage}`
                : isWidget || bare
                  ? ''
                  : `background: var(--theme-btn-bg)`,
            textColor ? `color: ${textColor}` : '',
            styleProp || ''
        ])
    )
</script>

<button
    {...restProps}
    {type}
    {disabled}
    {onclick}
    data-sf={isWidget ? 'widget' : undefined}
    data-sf-flat={isWidget ? '' : undefined}
    class={mergeClass([
        'inline-flex items-center justify-center gap-1.5 rounded-none font-medium tracking-tight',
        // `bare` 时用 `font-normal` 抵消基类的 `font-medium`：Tailwind preflight 对 button 设了
        // `font: inherit`（字重 400），而原生按钮没有 `font-medium`，故不抵消会出现
        // 「字重 500 vs 400」的**真实视觉差**。两者同为 font-weight 工具类、同权重，
        // 靠产物串序定胜负（实测 `.font-medium` 在 `.font-normal` 之前 → 后者胜出，见 .tmp/t5-font-order.mjs）。
        bare ? 'font-normal' : '',
        SIZE_CLASS[size ?? (compact ? 'compact' : 'default')],
        // 前景色兜底：**`bare` 档刻意不发射**。`--theme-btn-text` 是主题里**为按钮底色配的对比色**
        // （预设 dark #18181b / light #ffffff），与 `modal.textColor`（dark #e4e4e7 / light #1e293b）
        // 昼夜恰好对调；而 `bare` 语义是「本按钮长得像原生按钮、样式全由调用方给」，
        // 它作为同权重工具类会**压掉调用方 class 里的前景色**（Tailwind 按字面串序发射，斗不过），
        // 结果是弹窗里的 `bare` 图标钮昼夜观感反过来（实测：AI 助手头部两个 `ui/Button` 与左侧原生按钮不同色）。
        // 实测依据：全项目 70 个 `bare` 调用点（AST 实测）里 56 个未显式传 `textColor`，但**没有一个**
        // 缺少自己的前景色 class（唯一 3 处的 class 走 `{FOOT_BTN}` 变量，其常量里就是 `text-(--theme-modal-text)/60`），
        // 即该兜底色在 `bare` 档上从无实际消费者，去掉零回归。
        bare ? '' : 'text-(--theme-btn-text)',
        // 状态层（`bare` 时整组不发射，用于承接历史上没有任何自定义状态样式的按钮）
        bare ? '' : 'focus-visible:bg-(--theme-btn-bg-focused) focus-visible:text-(--theme-btn-text-focused)',
        bare ? '' : 'focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-(--theme-btn-text)',
        // 禁用态：`bare` 关掉，但 `keepDisabled` 可单独保留（有些历史按钮刻意有禁用外观）
        bare && !keepDisabled ? '' : 'disabled:opacity-40 disabled:pointer-events-none',
        /* 动效（Phase 8.x）：按压的位移/缩放 + 颜色过渡已由 layout.css 的全局
           `:where(button:not(:disabled))` 提供（transform/color/background/border/box-shadow @ --motion-fast），
           本组件**不再重复 transform**（全局的 scale 会与组件级 scale 相乘，按下去会过深），
           只叠加全局规则没覆盖的**非 transform**反馈：按下轻微提亮。
           `disabled:active:brightness-100` 用于关掉禁用态的按压提亮。
           注：按下提亮也属「状态层」，`bare` 时一并关掉（原按钮没有这个反馈）。 */
        bare ? '' : 'active:brightness-110 disabled:active:brightness-100',
        pad === 'auto' ? (variant === 'icon' ? PAD_CLASS.auto : '') : PAD_CLASS[pad],
        className || ''
    ])}
    style={mergedStyle}
>
    {#if children}
        {@render children()}
    {:else}
        {#if icon && variant !== 'text'}
            <Icon {icon} class="shrink-0" />
        {/if}
        {#if label && variant !== 'icon'}
            <span>{label}</span>
        {/if}
    {/if}
</button>
