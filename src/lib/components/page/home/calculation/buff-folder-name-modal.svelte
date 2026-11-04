<script lang="ts">
    /**
     * @desc 手动文件夹的「新建 / 重命名」弹窗：只负责收集名称，实际写入由父组件完成。
     * 手动整理模式专用；自动规则模式不会挂载它。
     */
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import Button from '$lib/components/ui/button.svelte'

    interface Props extends ComponentsProps {
        /** @desc 弹窗标题（新建文件夹 / 重命名文件夹） */
        title: string
        /** @desc 初始名称（重命名时带入；新建时为空串） */
        initialName?: string
        onclose: () => void
        onconfirm: (name: string) => void
    }

    let { title, initialName = '', onclose, onconfirm, class: className, style: styleProp }: Props = $props()

    let name = $state('')
    $effect(() => {
        name = initialName
    })
    const trimmed = $derived(name.trim())
    const confirm = () => {
        if (trimmed) onconfirm(trimmed)
    }
</script>

<Modal open={true} {onclose} layer="deep" class={className} style={styleProp}>
    {#snippet title()}
        <Icon icon="mdi:folder" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        <span>{title}</span>
    {/snippet}
    <input
        type="text"
        bind:value={name}
        placeholder="文件夹名称"
        maxlength="40"
        onkeydown={(e) => {
            if (e.key === 'Enter') {
                e.preventDefault()
                confirm()
            }
        }}
        class="w-full rounded-none border px-2.5 py-1.5 text-xs text-(--theme-modal-text) outline-none transition-colors placeholder:text-(--theme-modal-text)/30 focus:border-(--theme-accent-bg)/50"
        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
    />
    {#snippet footer()}
        <div class="mt-4 flex justify-end gap-2">
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
                disabled={!trimmed}
                onclick={confirm}
                backgroundImage="var(--theme-accent-bg)"
                textColor="var(--theme-accent-text-on-bg, #ffffff)"
                class="transition-all hover:brightness-125">确认</Button
            >
        </div>
    {/snippet}
</Modal>
