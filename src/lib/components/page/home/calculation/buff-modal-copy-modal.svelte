<script lang="ts">
    /**
     * @desc 复制命名选项弹窗（自 `buff-modal.svelte` **原样抽出**，标记与行为未改）：
     * buff 名带数字时，列出「原名 （复制）」与逐个数字 +1（保持原位数）的候选名。
     *
     * 职责边界：候选名清单由父组件用纯函数 `copyNameOptions()` 算好后经 `names` 传入（本组件不重算，
     * 避免「父组件用来选子组件的值」被搬到子组件里重算）；点选只回传被选中的名字（`onpick`），
     * 由父组件做 store 复制并选中新块。
     */
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import Button from '$lib/components/ui/button.svelte'

    interface Props extends ComponentsProps {
        /** @desc 候选名列表（父组件由 `copyNameOptions()` 产出，已保证无重复） */
        names: string[]
        /** @desc 父组件关闭本弹窗（取消 / Esc / 右上角关闭） */
        onclose: () => void
        /** @desc 选中某个候选名 → 父组件据此复制并选中新块 */
        onpick: (name: string) => void
    }

    let { names, onclose, onpick, class: className, style: styleProp }: Props = $props()
</script>

<Modal open {onclose} layer="deep" class="w-96">
    {#snippet title()}
        <Icon icon="mdi:content-copy" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        <span>复制 BUFF</span>
    {/snippet}
    <p class="text-xs text-(--theme-modal-text)/60 mb-4">检测到您的 buff 名带数字，请问要复制为？</p>
    <div class="flex flex-col gap-1.5">
        {#each names as name (name)}
            <button
                onclick={() => onpick(name)}
                class="h-8 rounded-none px-3 text-xs text-left text-(--theme-modal-text) transition-colors hover:bg-(--theme-modal-text)/10"
                style="background: var(--theme-input-bg);"
            >
                {name}
            </button>
        {/each}
    </div>
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
        </div>
    {/snippet}
</Modal>
