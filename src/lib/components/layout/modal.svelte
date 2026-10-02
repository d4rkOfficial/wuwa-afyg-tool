<script lang="ts">
    /**
     * @desc 共享弹窗外壳：所有对话框的唯一实现（backdrop / 关闭 / 层级 / 焦点 / 滚动锁定）。
     *
     * 约定：
     * - `class` / `style` 落在**面板**（panel）上，不是 backdrop。
     * - 层级用 `layer`，不要在外层再包一层写裸 z-index。
     * - 视觉上不锁背景滚动、不接管焦点是刻意的：背景滚动锁定与焦点陷阱都由本组件负责，
     *   调用方不要再自己 `document.body.style.overflow` 或 `use:focusTrap`。
     */
    import type { Snippet } from 'svelte'
    import { fade } from 'svelte/transition'
    import { motionDuration, popOut } from '$lib/utils/motion'
    import type { ComponentsProps } from '$lib/types'
    import Icon from '@iconify/svelte'
    import { getModalClosePosition } from '$lib/data/interaction-prefs.svelte'
    import { mergeClass, mergeComponentsStyle } from '$lib/utils/component-style'
    import { focusTrap } from '$lib/utils/focus-trap'
    import { lockBodyScroll } from '$lib/utils/scroll-lock'

    /** @desc 层级：对应 layout.css 的 --z-* token，避免调用方猜 z 值 */
    type Layer = 'modal' | 'nested' | 'deep'

    interface Props extends ComponentsProps {
        open: boolean
        onclose?: () => void
        backdropClose?: boolean
        /** @desc 弹窗整体不滚动，由内容自行管理内部滚动（内部列表滚动） */
        noScroll?: boolean
        /**
         * @desc 去掉面板自带内边距（`p-6`），由内容自管。
         * 给「自绘版面」的弹窗用（如工坊 iframe 要满铺、设置双栏各自已有内边距）。
         *
         * 为什么必须是 prop 而不是让调用方写 `class="p-0"`：外壳是
         * `mergeClass([...基础类, className])`，而 Tailwind 同属性工具类的胜者由**样式表顺序**
         * 决定、不是 class 属性里的先后，故 `p-0` 不保证覆盖 `p-6`（实测确实被压掉）。
         * 这里用二选一彻底回避级联竞争。
         */
        flush?: boolean
        /** @desc 不渲染右上/左上角关闭按钮（由内容自己提供关闭入口，如底栏按钮） */
        hideClose?: boolean
        /** @desc 层级档位（默认 modal；弹窗内再开弹窗用 nested / deep） */
        layer?: Layer
        /** @desc 是否响应 Esc 关闭。设为 false 表示由宿主自行处理 Esc（如"Esc=保存并关闭"） */
        escapable?: boolean
        /**
         * @desc 拦截页面级快捷键：开启后非 Esc/Enter 的按键不再冒泡到 `window`。
         * 用于「弹窗打开期间不应触发宿主页面快捷键」的场景（实测时间轴的两个 picker 原本
         * 各自在面板上拦截，否则 Delete 会删掉时间轴选中项、Ctrl+Z 会撤销时间轴）。
         * Enter 仍放行：时间轴靠 `window` 监听把 Enter 当「保存并关闭」。
         */
        blockPageShortcuts?: boolean
        children?: Snippet
        title?: Snippet
        footer?: Snippet
    }

    let {
        open,
        onclose,
        backdropClose = false,
        noScroll = false,
        flush = false,
        hideClose = false,
        layer = 'modal',
        escapable = true,
        blockPageShortcuts = false,
        backgroundImage,
        textColor,
        class: className,
        style: styleProp,
        children,
        title,
        footer
    }: Props = $props()

    let mergedStyle = $derived(mergeComponentsStyle({ backgroundImage, textColor, style: styleProp }))

    /** @desc 关闭按钮是否放在左上（跟随用户偏好）。抽成 $derived 供标题行与角按钮共用。 */
    const closeAtTopLeft = $derived(getModalClosePosition() === 'top-left')

    const LAYER_CLASS: Record<Layer, string> = {
        modal: 'z-(--z-modal)',
        nested: 'z-(--z-modal-nested)',
        deep: 'z-(--z-modal-deep)'
    }

    /**
     * @desc 背景滚动锁定。用模块级计数（见 `$lib/utils/scroll-lock`），保证嵌套弹窗
     * 逐个关闭时不会因为内层先解锁而提前恢复滚动。
     */
    $effect(() => {
        if (!open) return
        return lockBodyScroll()
    })

    function handleBackdropClick(e: MouseEvent) {
        if (backdropClose && e.target === e.currentTarget) onclose?.()
    }

    /**
     * @desc 背板上的键盘处理。
     * - Esc 且由外壳处理时：**必须截断冒泡**。否则同一次 Esc 会继续冒到页面级 `window`
     *   监听上，把「关闭本层」变成「顺带确认/保存背后的那一层」——实测 `quick-lookup`
     *   叠在 `skill-picker` 之上时就会这样（原实现各自在自己的背板上 `stopPropagation`，
     *   迁移到外壳后该行为丢失）。
     * - Esc 但 `escapable === false`：**放行冒泡**，因为此时宿主自己要处理 Esc
     *   （如时间轴上的「Esc = 保存并关闭」，它靠 `window` 监听拿到这个事件）。
     * - 非 Esc：默认放行；`blockPageShortcuts` 开启时拦住页面级快捷键（Enter 例外）。
     */
    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            if (!escapable) return
            e.stopPropagation()
            onclose?.()
            return
        }
        if (!blockPageShortcuts) return
        if (e.key === 'Enter') return
        e.stopPropagation()
    }
</script>

{#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class={mergeClass([
            'animate-fade-in fixed inset-0 flex items-center justify-center backdrop-blur-sm',
            LAYER_CLASS[layer]
        ])}
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5))"
        onclick={handleBackdropClick}
        onkeydown={handleKeydown}
        out:fade={{ duration: motionDuration(130) }}
    >
        <div
            data-sf="modal"
            use:focusTrap
            tabindex="-1"
            class={mergeClass([
                'animate-pop-in theme-glass-surface theme-scrollbar relative max-h-[85vh] min-w-80 rounded-none shadow-2xl',
                flush ? 'p-0' : 'p-6',
                footer || noScroll ? 'flex flex-col overflow-hidden' : 'overflow-y-auto',
                'text-(--theme-modal-text)',
                className || ''
            ])}
            style="max-width: calc(100vw - 40px); {mergedStyle}"
            role="dialog"
            aria-modal="true"
            out:popOut
        >
            {#if title}
                <div
                    class="mb-4 flex items-center gap-2 border-b pb-2.5 text-base font-black tracking-tight {flush
                        ? 'pl-6 pt-6'
                        : ''} {hideClose ? '' : 'pr-6'} {footer ? 'shrink-0' : ''}"
                    style="border-color: var(--theme-divider-border);"
                >
                    {#if !hideClose && closeAtTopLeft}
                        <!-- 左上角模式：关闭按钮进入标题行，形成「关闭 | 图标 标题」 -->
                        <button
                            onclick={onclose}
                            class="shrink-0 rounded-none p-1 text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)/70"
                            aria-label="Close"
                        >
                            <Icon icon="mdi:close" class="size-4.5" />
                        </button>
                        <span class="h-4 w-px shrink-0" style="background: var(--theme-divider-border);"></span>
                    {/if}
                    {@render title()}
                </div>
            {/if}
            {#if !hideClose && !(title && closeAtTopLeft)}
                <!-- @desc 角上的关闭按钮：`top-6` 对齐面板内边距（`p-6`），使按钮与标题行首行齐平。
                     原先用 `top-3`，比标题行高约 11px，看起来「标题栏和关闭按钮没对齐」。
                     注意 `hideClose` 必须在**这条路径**上也生效：原实现只在「有标题」那支里判断它，
                     于是无标题的弹窗（如工坊 iframe）永远会渲染出这个按钮。 -->
                <button
                    onclick={onclose}
                    class="absolute top-6 rounded-none p-1 text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-modal-text)/70 {closeAtTopLeft
                        ? 'left-3'
                        : 'right-3'}"
                    aria-label="Close"
                >
                    <Icon icon="mdi:close" class="size-4.5" />
                </button>
            {/if}
            {#if footer}
                <div class="theme-scrollbar min-h-0 flex-1 overflow-y-auto">
                    {@render children?.()}
                </div>
                <div class="shrink-0">
                    {@render footer()}
                </div>
            {:else if noScroll}
                <div class="flex min-h-0 flex-1 flex-col">
                    {@render children?.()}
                </div>
            {:else}
                <div>
                    {@render children?.()}
                </div>
            {/if}
        </div>
    </div>
{/if}
