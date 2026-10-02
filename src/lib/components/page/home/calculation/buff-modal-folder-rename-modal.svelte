<script lang="ts">
    /**
     * @desc 文件夹批量重命名弹窗（自 `buff-modal.svelte` **原样抽出**，标记与行为未改）：
     * 按「新前缀 + 1..N + 新后缀」重新编号全部子 Buff，并在弹窗内实时预览新旧名对照。
     *
     * 职责边界：
     * - 组件**只在** `folderRenameTarget` 存在时被父组件挂载（父组件的 `{#if}` 条件从 `open={showFolderRename && target !== null}`
     *   收敛为「挂载即打开」），故 `open` 恒为 true；原 `{#if folderRenameTarget}` 内层判断随之消失，
     *   渲染结果不变（原实现里 target 为 null 时外壳内是空的，本组件此时根本不挂载）。
     * - 前缀/后缀是弹窗自己的输入草稿，由本组件持有；「确认」只把两个字符串交回父组件去改数据
     *   （父组件负责 store 写入与「前后缀不能同时为空」的提示）。
     */
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import type { GroupedBuffSetItem } from '$lib/calc/calculation.consts'
    import Modal from '$lib/components/layout/modal.svelte'
    import Button from '$lib/components/ui/button.svelte'
    import { folderMembersOf } from './buff-modal.utils'

    interface Props extends ComponentsProps {
        /** @desc 待重命名的目录（含全部子 Buff，用于预览与数量提示） */
        folder: GroupedBuffSetItem
        /** @desc 父组件关闭本弹窗（取消 / Esc / 右上角关闭） */
        onclose: () => void
        /** @desc 确认重命名：回传已 trim 的新前缀 / 新后缀 */
        onconfirm: (prefix: string, suffix: string) => void
    }

    let { folder, onclose, onconfirm, class: className, style: styleProp }: Props = $props()

    let prefix = $state(folder.prefixText ?? '')
    let suffix = $state(folder.suffixText ?? '')

    /** @desc 目录下的全部成员（含二级子目录） */
    const members = $derived(folderMembersOf(folder))
</script>

<Modal open={true} {onclose} layer="deep" class="w-96">
    {#snippet title()}
        <Icon icon="mdi:rename-box" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        <span>批量重命名文件夹</span>
    {/snippet}
    <p class="text-xs text-(--theme-modal-text)/60 mb-3">
        「{folder.name}」内的 <strong>{members.length}</strong> 条 BUFF 将按 「新前缀 + 序号 + 新后缀」重新编号
    </p>
    <div class="flex items-center gap-2 mb-1">
        <input
            type="text"
            bind:value={prefix}
            placeholder="新前缀"
            class="flex-1 min-w-0 rounded-none border px-2 py-1.5 text-xs outline-none text-(--theme-modal-text)"
            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
        />
        <span class="text-xs text-(--theme-modal-text)/40 shrink-0">{'{'}1..N{'}'}</span>
        <input
            type="text"
            bind:value={suffix}
            placeholder="新后缀"
            class="flex-1 min-w-0 rounded-none border px-2 py-1.5 text-xs outline-none text-(--theme-modal-text)"
            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
        />
    </div>
    <div
        class="theme-scrollbar max-h-28 overflow-y-auto mb-3 rounded-none border p-2 text-[11px] text-(--theme-modal-text)/50"
        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
    >
        {#each members as child, i (child.id)}
            <div class="flex items-center gap-1 py-0.5">
                <span class="line-through text-(--theme-modal-text)/30">{child.name}</span>
                <Icon icon="mdi:arrow-right" class="size-3 shrink-0" />
                <span class="text-(--theme-modal-text)/70">{prefix.trim()}{i + 1}{suffix.trim()}</span>
            </div>
        {/each}
    </div>
    {#snippet footer()}
        <div class="flex justify-end gap-2">
            <Button
                variant="text"
                compact
                bare
                onclick={onclose}
                backgroundImage="var(--theme-input-bg)"
                class="text-(--theme-modal-text)/60 transition-colors hover:bg-(--theme-modal-text)/10">取消</Button
            >
            <Button
                variant="text"
                compact
                bare
                onclick={() => onconfirm(prefix, suffix)}
                backgroundImage="var(--theme-accent-bg)"
                textColor="var(--theme-accent-text-on-bg, #ffffff)"
                class="transition-all hover:brightness-125">确认重命名</Button
            >
        </div>
    {/snippet}
</Modal>
