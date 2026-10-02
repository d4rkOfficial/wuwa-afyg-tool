<script lang="ts">
    /**
     * @desc 开关（Switch）：主题化的胶囊开关。
     * 原先在设置弹窗里手写了 11 份同样的 `<button>` + 滑块 `<span>`，此组件是其唯一实现。
     */
    import type { ComponentsProps } from '$lib/types'
    import { mergeClass } from '$lib/utils/component-style'

    interface Props extends ComponentsProps {
        checked: boolean
        /** @desc 切换回调，入参为**新的**值（不是旧值） */
        onchange?: (next: boolean) => void
        disabled?: boolean
        /** @desc 原生 title 提示 */
        title?: string
    }

    let {
        checked,
        onchange,
        disabled = false,
        title = '点击切换',
        class: className,
        style: styleProp
    }: Props = $props()
</script>

<!-- 动效（Phase 8.x）：
     ① 底色切换（关=灰 / 开=强调色）走 `--motion-fast`——按压/切换属即时反馈档；
     ② 滑块位移**用 transform 而非 left**：`left` 是布局属性，过渡会每帧触发重排，
        `translate-x` 走合成层、且 `--motion-fast` 只驱动 transform，不影响其它属性；
     ③ 按压反馈（位移/缩放）由 layout.css 的全局 `:where(button:not(:disabled))` 提供，
        这里只叠加全局没覆盖的非 transform 部分（按下轻微提亮）。该全局规则在
        `prefers-reduced-motion: reduce` 下已把按钮的 transform/transition 归零，故本组件的
        底色过渡不再重复写 `motion-reduce:transition-none`；滑块的 transform 由下方 `motion-reduce` 关掉
        （非 button 元素不受全局规则覆盖；本仓库其余非按钮过渡同样尚未逐个覆盖，见报告）。
     水平几何与原 `left: {checked ? '18px' : '2px'}` 完全等价（2px + 16px = 18px，滑块 size-4 = 16px），
     因此这是纯动效层，不改视觉。 -->
<button
    type="button"
    role="switch"
    aria-checked={checked}
    {disabled}
    {title}
    onclick={() => onchange?.(!checked)}
    class={mergeClass([
        'relative h-5 w-9 shrink-0 rounded-full transition-colors duration-[var(--motion-fast)] ease-out motion-reduce:transition-none',
        'active:brightness-110 disabled:active:brightness-100',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
    ])}
    style="background: {checked
        ? 'var(--theme-accent-bg)'
        : 'color-mix(in srgb, var(--theme-modal-text) 25%, transparent)'}; {styleProp || ''}"
>
    <span
        class={mergeClass([
            'absolute top-0.5 left-0.5 size-4 rounded-full transition-transform duration-[var(--motion-fast)] ease-out motion-reduce:transition-none',
            checked ? 'translate-x-4' : 'translate-x-0'
        ])}
        style="background: var(--theme-modal-bg);"
    ></span>
</button>
