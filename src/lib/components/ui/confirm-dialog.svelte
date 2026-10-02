<script lang="ts">
    /**
     * @desc 确认对话框：小尺寸、标题 + 正文 + 「取消 / 确认」两键。
     *
     * 由 `buff-modal.svelte` 里 4 份近乎逐字重复的确认框收敛而来（本组件先覆盖其中
     * 「删除文件夹」「批量删除」两份完全同构的；`danger` 分支同时覆盖批量重命名的强调色按钮）。
     *
     * 面板观感与行为（Escape / 焦点陷阱 / 背景滚动锁定 / 层级 / 关闭按钮）一律交给
     * `layout/modal.svelte`，本组件只负责标题、正文与两个按钮。
     * **行为说明**：只有 Esc 与「取消」会关闭，点背板不关闭（与原实现一致；原注释曾称
     * 「点背板」也走 `onclose`，但代码里并无背板点击处理，此处按代码原行为保留）。
     */
    import type { Snippet } from 'svelte'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import Button from '$lib/components/ui/button.svelte'
    import Icon from '@iconify/svelte'
    import { mergeClass } from '$lib/utils/component-style'

    interface Props extends ComponentsProps {
        open: boolean
        /** @desc 标题文案（与图标同行） */
        title: string
        /** @desc 标题左侧图标（mdi 名） */
        icon?: string
        /** @desc 取消 / Esc —— 统一走这一个回调 */
        onclose: () => void
        /** @desc 确认按钮文案；不传则不渲染确认按钮（纯提示框） */
        confirmLabel?: string
        onconfirm?: () => void
        /** @desc 破坏性操作：确认按钮用红底（否则用主题强调色） */
        danger?: boolean
        /** @desc 正文（文案 / 表单 / 列表任选） */
        children?: Snippet
    }

    let {
        open,
        title,
        icon,
        onclose,
        confirmLabel,
        onconfirm,
        danger = false,
        class: className,
        style: styleProp,
        children
    }: Props = $props()
</script>

<Modal {open} {onclose} layer="deep" class={mergeClass(['w-80', className])} style={styleProp}>
    {#snippet title()}
        {#if icon}
            <Icon {icon} class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        {/if}
        <span>{title}</span>
    {/snippet}
    <div class="mb-4 text-xs text-(--theme-modal-text)/60">
        {@render children?.()}
    </div>
    {#snippet footer()}
        <div class="flex justify-end gap-2 pt-3">
            <Button
                variant="text"
                compact
                bare
                onclick={onclose}
                backgroundImage="var(--theme-input-bg)"
                class="text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)">取消</Button
            >
            {#if confirmLabel}
                <Button
                    variant="text"
                    compact
                    bare
                    onclick={onconfirm}
                    backgroundImage={danger ? '' : 'var(--theme-accent-bg)'}
                    textColor={danger ? '' : 'var(--theme-accent-text-on-bg, #ffffff)'}
                    class={danger
                        ? 'bg-red-500 text-white transition-all hover:brightness-110'
                        : 'transition-all hover:brightness-125'}>{confirmLabel}</Button
                >
            {/if}
        </div>
    {/snippet}
</Modal>
