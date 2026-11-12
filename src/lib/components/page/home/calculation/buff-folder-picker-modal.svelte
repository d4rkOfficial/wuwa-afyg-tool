<script lang="ts">
    /**
     * @desc 文件夹选择器：`move` = 移入文件夹（点击即移动并关闭）；
     * `create` = 新建 Buff 时选择落点（先选中，底部确认后才创建；可在选中文件夹下新建子文件夹）。
     *
     * 新建文件夹最多两级：根目录下为一级，一级下为二级；选中二级时禁用新建。
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
        /** @desc 当前所在文件夹（move 模式标灰；create 模式不使用） */
        currentFolderId?: string | null
        /** @desc move = 点击即移动；create = 选中 + 确认新建 */
        mode?: 'move' | 'create'
        /** @desc 弹窗标题（默认按 mode 取「选择文件夹 / 移入文件夹」） */
        heading?: string
        /** @desc create 模式是否允许新建文件夹（全局树不可回滚，由调用方禁用） */
        allowCreateFolder?: boolean
        onclose: () => void
        onpick: (folderId: string | null) => void
        /** @desc create 模式：在 parentId（null = 根目录）下新建文件夹，返回新 id */
        oncreatefolder?: (parentId: string | null, name: string) => string | undefined
    }

    let {
        open,
        folders,
        currentFolderId = null,
        mode = 'move',
        heading,
        allowCreateFolder = true,
        onclose,
        onpick,
        oncreatefolder,
        backgroundImage,
        textColor,
        class: className,
        style: styleProp
    }: Props = $props()

    const mergedStyle = $derived(mergeComponentsStyle({ backgroundImage, textColor, style: styleProp }))
    const isCreate = $derived(mode === 'create')

    let query = $state('')
    let selectedId = $state<string | null>(null)
    let creating = $state(false)
    let newName = $state('')
    let createError = $state('')

    const filtered = $derived.by(() => {
        const q = query.trim()
        if (!q) return folders
        return folders.filter((folder) => folder.path.includes(q) || folder.name.includes(q))
    })

    const selectedFolder = $derived(folders.find((folder) => folder.id === selectedId) ?? null)
    const canCreateFolder = $derived(allowCreateFolder && (selectedId === null || (selectedFolder?.depth ?? 0) < 2))

    const pick = (id: string | null) => {
        if (!isCreate) {
            onpick(id)
            onclose()
            return
        }
        selectedId = id
        createError = ''
    }

    const confirmCreate = () => {
        if (isCreate) onpick(selectedId)
    }

    const startCreating = () => {
        if (!canCreateFolder) return
        creating = true
        newName = ''
        createError = ''
    }

    const cancelCreating = () => {
        creating = false
        newName = ''
        createError = ''
    }

    const submitCreate = () => {
        const name = newName.trim()
        if (!name) {
            createError = '请输入文件夹名'
            return
        }
        const id = oncreatefolder?.(selectedId, name)
        if (!id) {
            createError = '名称为空、与同级文件夹重名，或已达两级上限'
            return
        }
        selectedId = id
        creating = false
        newName = ''
        createError = ''
    }

    const onNewNameKeydown = (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
            event.preventDefault()
            submitCreate()
        } else if (event.key === 'Escape') {
            event.preventDefault()
            cancelCreating()
        }
    }
</script>

<Modal {open} {onclose} layer="nested" noScroll class={className} style="width: min(92vw, 460px); {mergedStyle}">
    {#snippet title()}
        <span class="flex items-center gap-2">
            <Icon
                icon={isCreate ? 'mdi:folder-plus-outline' : 'mdi:folder-open'}
                class="size-4 shrink-0"
                style="color: var(--theme-accent-text);"
            />
            <span class="font-black tracking-tight">{heading ?? (isCreate ? '选择文件夹' : '移入文件夹')}</span>
        </span>
    {/snippet}

    <div
        class="mb-2 flex shrink-0 items-center gap-2 border px-2 py-1.5"
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

    <div class="theme-scrollbar min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        <button
            type="button"
            onclick={() => pick(null)}
            disabled={!isCreate && currentFolderId === null}
            aria-pressed={isCreate ? selectedId === null : undefined}
            class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-(--theme-accent-bg)/10 disabled:opacity-35"
            style={isCreate && selectedId === null
                ? 'background: color-mix(in srgb, var(--theme-accent-bg) 16%, transparent);'
                : ''}
        >
            <Icon icon="mdi:folder-open" class="size-4 shrink-0 text-(--theme-accent-text)" />
            <span class="min-w-0 flex-1 truncate">根目录</span>
            {#if !isCreate && currentFolderId === null}
                <span class="text-[10px] text-(--theme-modal-text)/35">当前</span>
            {:else if isCreate && selectedId === null}
                <Icon icon="mdi:check" class="size-3.5 shrink-0 text-(--theme-accent-text)" />
            {/if}
        </button>
        {#each filtered as folder (folder.id)}
            <button
                type="button"
                onclick={() => pick(folder.id)}
                disabled={!isCreate && currentFolderId === folder.id}
                aria-pressed={isCreate ? selectedId === folder.id : undefined}
                class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-(--theme-accent-bg)/10 disabled:opacity-35"
                style="padding-left: {8 + Math.max(0, folder.depth - 1) * 14}px; {isCreate && selectedId === folder.id
                    ? 'background: color-mix(in srgb, var(--theme-accent-bg) 16%, transparent);'
                    : ''}"
                title={folder.path}
            >
                <Icon icon="mdi:folder-outline" class="size-4 shrink-0 text-(--theme-accent-text)" />
                <span class="min-w-0 flex-1 truncate">{folder.name}</span>
                {#if !isCreate && currentFolderId === folder.id}
                    <span class="text-[10px] text-(--theme-modal-text)/35">当前</span>
                {:else if isCreate && selectedId === folder.id}
                    <Icon icon="mdi:check" class="size-3.5 shrink-0 text-(--theme-accent-text)" />
                {/if}
            </button>
        {/each}
        {#if filtered.length === 0}
            <div class="py-6 text-center text-xs text-(--theme-modal-text)/30">没有匹配的文件夹</div>
        {/if}
    </div>

    {#if isCreate && allowCreateFolder && oncreatefolder}
        <div class="mt-2 shrink-0 border-t pt-2" style="border-color: var(--theme-divider-border);">
            {#if creating}
                <div class="flex items-center gap-1.5">
                    <input
                        bind:value={newName}
                        onkeydown={onNewNameKeydown}
                        placeholder="在「{selectedFolder?.name ?? '根目录'}」下新建文件夹…"
                        class="min-w-0 flex-1 rounded-none border px-2 py-1 text-xs outline-none"
                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg); color: var(--theme-modal-text);"
                    />
                    <button
                        type="button"
                        onclick={submitCreate}
                        class="rounded-none border px-2 py-1 text-xs font-medium transition-colors hover:brightness-110"
                        style="border-color: var(--theme-accent-bg); background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                    >
                        创建
                    </button>
                    <button
                        type="button"
                        onclick={cancelCreating}
                        class="rounded-none border px-2 py-1 text-xs transition-colors hover:opacity-70"
                        style="border-color: var(--theme-divider-border); color: var(--theme-modal-text);"
                    >
                        取消
                    </button>
                </div>
                {#if createError}
                    <p class="mt-1 text-[10px]" style="color: var(--theme-modal-text); opacity: 0.55;">{createError}</p>
                {/if}
            {:else}
                <button
                    type="button"
                    onclick={startCreating}
                    disabled={!canCreateFolder}
                    class="flex items-center gap-1.5 rounded-none px-1.5 py-1 text-xs transition-colors hover:bg-(--theme-accent-bg)/10 disabled:cursor-not-allowed disabled:opacity-35"
                    style="color: var(--theme-accent-text);"
                    title={canCreateFolder ? '在当前选中文件夹下新建' : '文件夹最多两级，不能在二级文件夹下继续新建'}
                >
                    <Icon icon="mdi:folder-plus-outline" class="size-3.5" />
                    <span>新建文件夹</span>
                </button>
                {#if !canCreateFolder}
                    <p class="mt-1 text-[10px]" style="color: var(--theme-modal-text); opacity: 0.45;">
                        文件夹最多两级，不能在二级文件夹下继续新建
                    </p>
                {/if}
            {/if}
        </div>
    {/if}

    {#if isCreate}
        <div class="mt-3 flex shrink-0 items-center justify-end gap-2">
            <button
                type="button"
                onclick={onclose}
                class="rounded-none border px-3 py-1.5 text-xs transition-colors hover:opacity-70"
                style="border-color: var(--theme-divider-border); color: var(--theme-modal-text);"
            >
                取消
            </button>
            <button
                type="button"
                onclick={confirmCreate}
                class="rounded-none border px-3 py-1.5 text-xs font-medium transition-all hover:brightness-110"
                style="border-color: var(--theme-accent-bg); background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
            >
                新建 BUFF
            </button>
        </div>
    {/if}
</Modal>
