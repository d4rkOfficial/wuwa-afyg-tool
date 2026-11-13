<script lang="ts">
    /**
     * @desc 「以下修改还未保存」确认弹窗（Buff 配置 / 伤害类型编辑两个弹窗共用）。
     *
     * 关闭右上角 ❌ 时若本次会话有改动，宿主先弹本弹窗，再由用户二选一：
     * - **不保存**：把宿主的数据回滚到打开弹窗时的快照并退出；
     * - **保存并退出**：保留改动、落盘并退出。
     * 取消 / Esc / 背板只关闭本弹窗（回到编辑弹窗继续改），不丢弃任何数据。
     *
     * 视觉：变更内容按**列表 + 卡片**呈现（每条改动一张卡：对象名 + 种类 + 逐行明细），
     * 色调沿用语义色（新增=主题色、删除=红、修改=中性）。
     */
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import type { UnsavedChangeItem } from '$lib/types/unsaved-change'
    import Modal from '$lib/components/layout/modal.svelte'
    import Button from '$lib/components/ui/button.svelte'
    import { mergeClass } from '$lib/utils/component-style'

    interface Props extends ComponentsProps {
        open: boolean
        /** @desc 变更清单（列表 + 卡片呈现） */
        items: UnsavedChangeItem[]
        /** @desc 取消 / Esc / 右上角关闭：回到编辑弹窗继续改 */
        onclose: () => void
        /** @desc 不保存：丢弃本次改动并退出 */
        ondiscard: () => void
        /** @desc 保存并退出：保留改动并退出 */
        onsave: () => void
    }

    let { open, items, onclose, ondiscard, onsave, class: className, style: styleProp }: Props = $props()

    /** @desc 卡片色调（语义色描边 + 半透明底；与全局红/主题色口径一致） */
    const cardStyle = (tone: UnsavedChangeItem['tone']): string => {
        if (tone === 'remove')
            return 'border-color: color-mix(in srgb, #ef4444 55%, transparent); background: color-mix(in srgb, #ef4444 8%, transparent);'
        if (tone === 'create') {
            return 'border-color: color-mix(in srgb, var(--theme-accent-bg) 55%, transparent); background: color-mix(in srgb, var(--theme-accent-bg) 8%, transparent);'
        }
        return 'border-color: var(--theme-divider-border); background: var(--theme-input-bg);'
    }

    const toneIcon = (tone: UnsavedChangeItem['tone']): string =>
        tone === 'create'
            ? 'mdi:plus-circle-outline'
            : tone === 'remove'
              ? 'mdi:minus-circle-outline'
              : 'mdi:pencil-outline'

    const toneClass = (tone: UnsavedChangeItem['tone']): string =>
        tone === 'remove'
            ? 'text-red-400'
            : tone === 'create'
              ? 'text-(--theme-accent-text)'
              : 'text-(--theme-modal-text)/50'
</script>

<Modal {open} {onclose} layer="deep" class={mergeClass(['w-[34rem] max-w-[92vw]', className])} style={styleProp}>
    {#snippet title()}
        <Icon icon="mdi:content-save-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        <span>以下修改还未保存</span>
    {/snippet}

    <p class="mb-2 text-xs text-(--theme-modal-text)/55">
        共 <span class="font-black tabular-nums text-(--theme-modal-text)">{items.length}</span> 项改动： 选「不保存」会全部丢弃，并回到打开弹窗前的状态。
    </p>

    <!-- @desc 变更清单：列表 + 卡片（长清单内部滚动，弹窗高度不超过 60vh） -->
    <div class="theme-scrollbar max-h-[55vh] space-y-1.5 overflow-y-auto pr-1">
        {#each items as item (item.key)}
            <div class="rounded-none border px-2.5 py-2" style={cardStyle(item.tone)}>
                <div class="flex items-center gap-1.5">
                    <Icon icon={toneIcon(item.tone)} class={['size-3.5 shrink-0', toneClass(item.tone)].join(' ')} />
                    <span class="min-w-0 flex-1 truncate text-xs font-black tracking-tight text-(--theme-modal-text)">
                        {item.title}
                    </span>
                    {#if item.subtitle}
                        <span class={['shrink-0 text-[10px]', toneClass(item.tone)].join(' ')}>{item.subtitle}</span>
                    {/if}
                </div>
                {#if item.lines.length > 0}
                    <ul class="mt-1 space-y-0.5 pl-5 text-[10px] text-(--theme-modal-text)/55">
                        {#each item.lines as line, i (i)}
                            <li class="break-words">· {line}</li>
                        {/each}
                    </ul>
                {/if}
            </div>
        {/each}
    </div>

    {#snippet footer()}
        <div class="flex items-center justify-end gap-2 pt-3">
            <Button
                variant="text"
                compact
                bare
                onclick={ondiscard}
                backgroundImage=""
                class="bg-red-500 text-white transition-all hover:brightness-110">不保存</Button
            >
            <Button
                variant="text"
                compact
                bare
                onclick={onsave}
                backgroundImage="var(--theme-accent-bg)"
                textColor="var(--theme-accent-text-on-bg, #ffffff)"
                class="transition-all hover:brightness-125">保存并退出</Button
            >
        </div>
    {/snippet}
</Modal>
