<script lang="ts">
    /**
     * @desc picker 弹窗的**确认 footer**（右对齐 + 强调色确认按钮 + 勾图标）。
     *
     * 抽因（T14 实测）：**四个** picker 的 footer 逐字同构，实测差异只有两处 ——
     * ① 外层容器是否 `items-center`（`set-picker` 有、其余三个没有）；
     * ② 按钮文案（三个是固定的「确认」，`set-picker` 是动态的「确认 (… = N/5)」）。
     * 见 `.tmp/t14-shell-measure.mjs` 的比对输出。
     *
     * 语义边界：**本组件只管外观与布局，不碰选择逻辑**。确认动作由 `onconfirm` 传入
     * （四个调用点各自的 `handleConfirm` 负责「回传选中值 + 关闭弹窗」）。
     */
    import Icon from '@iconify/svelte'
    import type { Snippet } from 'svelte'
    import type { ComponentsProps } from '$lib/types'
    import { mergeClass } from '$lib/utils/component-style'

    interface Props extends ComponentsProps {
        /** @desc 点击确认的回调（调用方的 handleConfirm） */
        onconfirm: () => void
        /** @desc 文案；不传则渲染默认的「确认」。需要动态文案时传 snippet（如 set-picker 的件数汇总） */
        label?: Snippet
        /** @desc 外层容器是否垂直居中（`set-picker` 的动态文案更高，需要 `items-center`） */
        center?: boolean
    }

    let { onconfirm, label, center = false, class: className, style: styleProp }: Props = $props()

    /** @desc 外层容器类名：`items-center` 必须与 `justify-end` 拼在**同一个字面量**里，
     * 否则 class 串顺序会与替换前的内联写法不同（实测：拆开拼会得到
     * `mt-4 flex justify-end items-center`，而原内联是 `mt-4 flex items-center justify-end`） */
    const wrapClass = $derived(
        mergeClass([center ? 'mt-4 flex items-center justify-end' : 'mt-4 flex justify-end', className || ''])
    )
</script>

<div class={wrapClass} style={styleProp}>
    <button
        onclick={onconfirm}
        class="inline-flex items-center gap-1.5 rounded-none px-4 py-1.5 text-xs font-black tracking-tight transition-all hover:brightness-125"
        style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);"
    >
        <Icon icon="mdi:check" class="size-4" />
        {#if label}
            {@render label()}
        {:else}
            确认
        {/if}
    </button>
</div>
