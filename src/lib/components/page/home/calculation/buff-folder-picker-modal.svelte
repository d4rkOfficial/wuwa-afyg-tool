<script lang="ts">
    /**
     * @desc 「移入文件夹」二级弹窗：列出当前 tab 的全部文件夹（含空文件夹）与根目录，
     * 点击即移动；用于替代右键菜单里一长串「移入「…」」项。
     */
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import { mergeComponentsStyle } from '$lib/utils/component-style'

    export interface MoveFolderOption {
        id: string
        name: string
        path: string
        depth: number
    }

    interface Props extends ComponentsProps {
        open: boolean
        folders: MoveFolderOption[]
        /** @desc 当前所在文件夹（会标灰，避免重复移入） */
        currentFolderId?: string | null
        onclose: () => void
        onpick: (folderId: string | null) => void
    }

    let {
        open,
        folders,
        currentFolderId = null,
        onclose,
        onpick,
        backgroundImage,
        textColor,
        class: className,
        style: styleProp
    }: Props = $props()

    const mergedStyle = $derived(mergeComponentsStyle({ backgroundImage, textColor, style: styleProp }))
    let query = $state('')
    const filtered = $derived.by(() => {
        const q = query.trim()
        if (!q) return folders
        return folders.filter((folder) => folder.path.includes(q) || folder.name.includes(q))
    })

    const pick = (id: string | null) => {
        onpick(id)
        onclose()
    }
</script>

<Modal {open} {onclose} layer="nested" class={className} style="width: min(92vw, 440px); {mergedStyle}">
    {#snippet title()}
        <span class="flex items-center gap-2">
            <Icon icon="mdi:folder-open" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            <span class="font-black tracking-tight">移入文件夹</span>
        </span>
    {/snippet}

    <div
        class="mb-2 flex items-center gap-2 border px-2 py-1.5"
        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
    >
        <Icon icon="mdi:magnify" class="size-3.5 shrink-0 text-(--theme-modal-text)/35" />
        <input
            bind:value={query}
            placeholder="搜索文件夹…"
            class="min-w-0 flex-1 bg-transparent text-xs outline-none text-(--theme-modal-text) placeholder:text-(--theme-modal-text)/30"
        />
        {#if query}
            <button
                onclick={() => (query = '')}
                class="p-0.5 text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)"
            >
                <Icon icon="mdi:close" class="size-3.5" />
            </button>
        {/if}
    </div>

    <div class="theme-scrollbar max-h-[min(60vh,420px)] space-y-0.5 overflow-y-auto">
        <button
            type="button"
            onclick={() => pick(null)}
            disabled={currentFolderId === null}
            class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-(--theme-accent-bg)/10 disabled:opacity-35"
        >
            <Icon icon="mdi:folder-open" class="size-4 shrink-0 text-(--theme-accent-text)" />
            <span class="min-w-0 flex-1 truncate">根目录</span>
            {#if currentFolderId === null}<span class="text-[10px] text-(--theme-modal-text)/35">当前</span>{/if}
        </button>
        {#each filtered as folder (folder.id)}
            <button
                type="button"
                onclick={() => pick(folder.id)}
                disabled={currentFolderId === folder.id}
                class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-(--theme-accent-bg)/10 disabled:opacity-35"
                style="padding-left: {8 + Math.max(0, folder.depth - 1) * 14}px;"
                title={folder.path}
            >
                <Icon icon="mdi:folder-outline" class="size-4 shrink-0 text-(--theme-accent-text)" />
                <span class="min-w-0 flex-1 truncate">{folder.name}</span>
                {#if currentFolderId === folder.id}
                    <span class="text-[10px] text-(--theme-modal-text)/35">当前</span>
                {/if}
            </button>
        {/each}
        {#if filtered.length === 0}
            <div class="py-6 text-center text-xs text-(--theme-modal-text)/30">没有匹配的文件夹</div>
        {/if}
    </div>
</Modal>
