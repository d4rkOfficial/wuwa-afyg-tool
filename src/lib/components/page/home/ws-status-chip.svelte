<script lang="ts">
    /**
     * @desc WS 连接状态胶囊（圆点 + 文案）：顶栏「WS 远程接管」状态弹窗与
     * 「设置-连接配置」共用同一实现，避免两处各写一份「状态 → 配色/文案」映射。
     */
    import { WS_LABEL, getWsStatus } from '$lib/ws-remote/ws-remote.svelte'
    import type { ComponentsProps } from '$lib/types'
    import { joinStyle, mergeClass } from '$lib/utils/component-style'

    interface Props extends ComponentsProps {}
    let { class: className, style: styleProp }: Props = $props()

    let status = $derived(getWsStatus())
    /**
     * @desc 状态 → 配色。**必须用 `color-mix` 而不是 `var(--x)/60`**：
     * Tailwind 的 `/60` 透明度后缀只在**类名**里被编译，写进内联 `style` 只是普通文本，
     * `color: var(--theme-modal-text)/60` 是非法值 —— 整条声明在计算值阶段失效（颜色回落继承、
     * 状态圆点直接变透明）。此处按 60%/40% 混 transparent 复刻同一观感。
     */
    let tone = $derived(
        status === 'connected'
            ? 'var(--theme-accent-text)'
            : status === 'error'
              ? '#ef4444'
              : 'color-mix(in srgb, var(--theme-modal-text) 60%, transparent)'
    )
    let dot = $derived(
        status === 'connected'
            ? 'var(--theme-accent-bg)'
            : status === 'error'
              ? '#ef4444'
              : 'color-mix(in srgb, var(--theme-modal-text) 40%, transparent)'
    )
</script>

<span
    class={mergeClass([
        'inline-flex items-center gap-1.5 rounded-none border px-2.5 py-1 text-[10px] font-black',
        className
    ])}
    style={joinStyle([
        `border-color: var(--theme-divider-border); background: color-mix(in srgb, var(--theme-accent-bg) 15%, transparent); color: ${tone}`,
        styleProp
    ])}
>
    <span class="size-1.5 rounded-full" style="background: {dot};"></span>
    {WS_LABEL[status]}
</span>
