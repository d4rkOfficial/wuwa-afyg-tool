<script lang="ts">
    /**
     * @desc tab 面板的共享动效外壳（Phase 8.4）：把面板内容包在 `{#key active}` 里，
     * 切换 tab 时整块重挂载并播放 `animate-rise-in` 入场动画，让全项目的 tab 系统
     * （设置弹窗 15 分支 / Buff 集 / AI 助手气泡 / 其它）动效一致，而不是各自发明一套。
     *
     * 取舍说明：
     * - 用 `{#key}` 重挂载而不是 `svelte/transition`：`{#if}` 分支的**内容**变化时
     *   只有 `{#key}` 能让 Svelte 销毁旧块、新建新块，从而触发进场；
     *   复用 `layout.css` 已注册的 `--animate-rise-in`（0.32s / `--ease-out` / `backwards`），
     *   本组件不新增任何 keyframes。
     * - 动画期间 `transform` 会建立包含块，面板内容里**不要**放 `position: fixed` 浮层
     *   （本项目弹窗类浮层一律 portal 到 `Modal` / 根级，不在此面板内）。
     * - 时长由 token 决定，故不额外暴露 `duration` prop；`prefers-reduced-motion` 下
     *   由 layout.css 的媒体查询统一置为 `animation: none`。
     */
    import type { Snippet } from 'svelte'
    import type { ComponentsProps } from '$lib/types'
    import { mergeClass } from '$lib/utils/component-style'

    interface Props extends ComponentsProps {
        /** @desc 当前激活的 tab 标识：值变化即触发面板重挂载 + 入场动画 */
        active: string | number
        children?: Snippet
    }

    let { active, class: className, style: styleProp, children }: Props = $props()
</script>

{#key active}
    <div class={mergeClass(['animate-rise-in', className])} style={styleProp}>
        {@render children?.()}
    </div>
{/key}
