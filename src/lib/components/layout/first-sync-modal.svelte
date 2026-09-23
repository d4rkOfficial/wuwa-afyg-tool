<script lang="ts">
    import Icon from '@iconify/svelte'
    import Modal from '$lib/components/layout/modal.svelte'
    import type { ComponentsProps } from '$lib/types'
    import { fetchBuffSetsFromShare, loadBuffLibrary } from '$lib/data/buff-library.svelte'
    import { fetchSubstatPlansFromShare } from '$lib/data/substat-library.svelte'
    import { getShareBase } from '$lib/data/workshop.svelte'
    import { markFirstSyncAsked } from '$lib/data/first-sync.svelte'
    import { addToast } from '$lib/data/toast.svelte'

    interface Props extends ComponentsProps {
        open: boolean
        onclose?: () => void
    }

    let { open, onclose, backgroundImage, textColor, class: className, style: styleProp }: Props = $props()

    let syncing = $state(false)

    let mergedStyle = $derived(
        [
            backgroundImage ? `background: ${backgroundImage}` : '',
            textColor ? `color: ${textColor}` : '',
            styleProp || ''
        ]
            .filter(Boolean)
            .join(';')
    )

    async function handleSync() {
        if (syncing) return
        syncing = true
        await loadBuffLibrary()
        const [buffs, plans] = await Promise.all([fetchBuffSetsFromShare(), fetchSubstatPlansFromShare()])
        syncing = false
        markFirstSyncAsked()
        if (buffs.ok || plans.ok) {
            addToast(`同步完成：Buff 集 ${buffs.added} 个实体、标准词条集 ${plans.added} 个角色`, 'success', 5000)
        } else {
            addToast(`同步失败：${buffs.error ?? plans.error ?? '工坊不可达'}`, 'error')
        }
        onclose?.()
    }

    function handleSkip() {
        markFirstSyncAsked()
        addToast('已跳过：可随时在「Buff 集」或「词条方案」里手动同步', 'info')
        onclose?.()
    }
</script>

<Modal {open} {onclose} backdropClose class={className} style={mergedStyle}>
    {#snippet title()}
        <span class="flex items-center gap-2">
            <Icon icon="mdi:cloud-sync-outline" class="size-4" />
            <span>同步工坊数据</span>
        </span>
    {/snippet}

    <div class="flex w-[26rem] max-w-[86vw] flex-col gap-3 text-xs">
        <p style="opacity: 0.8;">
            这是你第一次进入工具箱。可以从工坊（{getShareBase()}）同步以下数据到本地，之后拉表与配装可以直接使用：
        </p>
        <ul class="space-y-1.5">
            <li class="flex gap-2">
                <Icon icon="mdi:format-list-bulleted" class="mt-0.5 size-3.5 shrink-0" style="opacity: 0.6;" />
                <span
                    ><b>Buff 集</b
                    >：各角色/武器/声骸/套装的增益条目（按实体整份覆盖本地工坊来源数据，本地自定义不受影响）。</span
                >
            </li>
            <li class="flex gap-2">
                <Icon icon="mdi:clipboard-text-outline" class="mt-0.5 size-3.5 shrink-0" style="opacity: 0.6;" />
                <span
                    ><b>标准词条集</b>：特殊角色的 14 词条声骸方案；其余角色由工具箱按角色数据自动生成（声骸主词条 43311
                    + 中位档副词条）。</span
                >
            </li>
        </ul>
        <p style="opacity: 0.55;">跳过也没关系：设置里的工坊、以及「Buff 集」「词条方案」面板都能随时手动同步。</p>
    </div>

    {#snippet footer()}
        <div class="mt-6 flex items-center gap-2">
            <button
                onclick={handleSkip}
                class="rounded-none border px-3 py-1.5 text-xs transition-colors"
                style="border-color: var(--theme-divider-border);">暂不同步</button
            >
            <button
                onclick={handleSync}
                disabled={syncing}
                class="flex items-center gap-1.5 rounded-none border px-3 py-1.5 text-xs transition-colors disabled:opacity-50"
                style="border-color: var(--theme-accent-bg); color: var(--theme-accent-text);"
            >
                <Icon icon={syncing ? 'mdi:loading' : 'mdi:cloud-download-outline'} class="size-3.5" />
                {syncing ? '同步中…' : '立即同步'}
            </button>
        </div>
    {/snippet}
</Modal>
