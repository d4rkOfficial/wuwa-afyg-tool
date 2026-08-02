<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import {
        getBuffEntities,
        getBuffLibraryLoading,
        getBuffLibraryError,
        fetchBuffSetsFromShare,
        deleteBuffEntity,
        clearBuffLibrary,
        loadBuffLibrary,
        createCustomEntity,
        setEntitySource,
        ENTITY_TYPES,
        ENTITY_TYPE_LABELS,
        SCOPE_LABELS,
        type BuffEntityType,
        type BuffLibraryEntity
    } from '$lib/data/buff-library.svelte'
    import { ZONE_MAP } from '$lib/components/page/home/calculation/calculation.consts'
    import { addToast } from '$lib/data/toast.svelte'
    import BuffEntityEditModal from './buff-entity-edit-modal.svelte'

    interface Props extends ComponentsProps {
        open: boolean
        onclose?: () => void
    }

    let { open, onclose, backgroundImage, textColor, class: className, style: styleProp }: Props = $props()

    let mergedStyle = $derived(
        [
            backgroundImage ? `background: ${backgroundImage}` : '',
            textColor ? `color: ${textColor}` : '',
            styleProp || ''
        ]
            .filter(Boolean)
            .join(';')
    )

    let entities = $derived(getBuffEntities())
    let loading = $derived(getBuffLibraryLoading())
    let error = $derived(getBuffLibraryError())

    let prevOpen = $state(open)

    $effect(() => {
        if (open && !prevOpen) {
            loadBuffLibrary()
        }
        prevOpen = open
    })

    let editTarget = $state<BuffLibraryEntity | null>(null)
    let confirmDelete = $state<BuffLibraryEntity | null>(null)

    function zoneLabel(zoneId: string) {
        const def = ZONE_MAP.get(zoneId as never)
        return def?.label ?? zoneId
    }

    async function handleDownload() {
        const res = await fetchBuffSetsFromShare()
        if (res.ok) {
            addToast(res.added > 0 ? `已同步 ${res.added} 个实体` : '工坊 buff 集已是最新', 'success')
        } else {
            addToast(res.error ?? '下载失败', 'error')
        }
    }

    function handleEdit(entity: BuffLibraryEntity) {
        editTarget = entity
    }

    async function toggleSource(entity: BuffLibraryEntity) {
        if (entity.source === 'custom') {
            await setEntitySource(entity.entityType, entity.entityName, 'share')
            addToast('已设为跟随工坊，下次下载时同步', 'success')
        } else {
            await setEntitySource(entity.entityType, entity.entityName, 'custom')
            addToast('已设为自定义，不再跟随工坊', 'success')
        }
    }

    async function handleDelete() {
        if (!confirmDelete) return
        await deleteBuffEntity(confirmDelete.entityType, confirmDelete.entityName)
        addToast('已删除', 'success')
        confirmDelete = null
    }

    function handleClear() {
        clearBuffLibrary()
        addToast('已清空本地 buff 预设', 'success')
    }

    // 新增预设弹窗状态
    let showCreate = $state(false)
    let createType = $state<BuffEntityType>('character')
    let createName = $state('')

    async function handleCreate() {
        const name = createName.trim()
        if (!name) {
            addToast('请输入实体名', 'error')
            return
        }
        const ok = await createCustomEntity(createType, name)
        if (!ok) {
            addToast('该实体已存在', 'error')
            return
        }
        addToast('已创建自定义预设', 'success')
        showCreate = false
        createName = ''
        const created = entities.find((e) => e.entityType === createType && e.entityName === name)
        if (created) editTarget = created
    }
</script>

<Modal {open} {onclose} class={className} style="width: min(92vw, 820px); {mergedStyle}">
    {#snippet title()}
        Buff 集
    {/snippet}

    <div class="mb-3 flex items-center justify-between gap-2">
        <p class="text-xs text-(--theme-muted-text)">管理角色/武器/首位声骸/套装的 Buff 预设，可跟工坊同步或自定义</p>
        <div class="flex items-center gap-2">
            <button
                onclick={() => (showCreate = true)}
                class="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all hover:brightness-125"
                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
            >
                <Icon icon="mdi:plus" class="size-3.5" />
                新增预设
            </button>
            <button
                onclick={handleDownload}
                disabled={loading}
                class="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all hover:brightness-125 disabled:opacity-40"
                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
            >
                <Icon
                    icon={loading ? 'mdi:loading' : 'mdi:download'}
                    class={loading ? 'size-3.5 animate-spin' : 'size-3.5'}
                />
                从工坊同步
            </button>
            {#if entities.length > 0}
                <button
                    onclick={handleClear}
                    class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-(--theme-muted-text) transition-colors hover:bg-(--theme-card-bg-focused) hover:text-red-500"
                >
                    <Icon icon="mdi:delete-sweep-outline" class="size-3.5" />
                    清空
                </button>
            {/if}
        </div>
    </div>

    {#if error}
        <div
            class="mb-3 flex items-center gap-2 rounded-lg border border-(--theme-card-border) bg-(--theme-card-bg) px-3 py-2 text-xs text-red-500"
        >
            <Icon icon="mdi:alert-circle-outline" class="size-4 shrink-0" />
            <span class="flex-1">从工坊下载失败：{error}</span>
        </div>
    {/if}

    {#if entities.length === 0}
        <div class="flex flex-col items-center gap-2 py-12 text-sm text-(--theme-muted-text)">
            <Icon icon="mdi:view-dashboard-outline" class="size-9" />
            本地还没有 Buff 预设，点击右上角新增或从工坊同步
        </div>
    {:else}
        <div class="space-y-4">
            {#each ENTITY_TYPES as type}
                {@const group = entities.filter((e) => e.entityType === type)}
                {#if group.length > 0}
                    <div>
                        <h3 class="mb-1.5 text-xs font-medium text-(--theme-muted-text)">
                            {ENTITY_TYPE_LABELS[type]}（{group.length}）
                        </h3>
                        <div class="space-y-1.5">
                            {#each group as entity (entity.entityType + '/' + entity.entityName)}
                                <div
                                    class="flex items-center gap-3 rounded-lg border border-(--theme-card-border) bg-(--theme-card-bg) px-3 py-2"
                                >
                                    <div class="min-w-0 flex-1">
                                        <div class="flex flex-wrap items-center gap-2">
                                            <span class="truncate text-sm font-medium text-(--theme-layout-text)">
                                                {entity.entityName}
                                            </span>
                                            <button
                                                onclick={() => toggleSource(entity)}
                                                class="shrink-0 rounded px-1.5 py-0.5 text-[10px] transition-colors"
                                                class:text-(--theme-accent-text)={entity.source === 'share'}
                                                class:text-(--theme-muted-text)={entity.source === 'custom'}
                                                style={`background: ${
                                                    entity.source === 'share'
                                                        ? 'color-mix(in srgb, var(--theme-accent-bg) 10%, transparent)'
                                                        : 'var(--theme-card-bg-focused)'
                                                };`}
                                                title="点击切换来源"
                                            >
                                                {entity.source === 'share' ? '跟工坊' : '自定义'}
                                            </button>
                                            <span class="shrink-0 text-[10px] text-(--theme-muted-text)">
                                                {entity.buffs.length} 条
                                            </span>
                                        </div>
                                        <div
                                            class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-(--theme-muted-text)"
                                        >
                                            {#each entity.buffs as b, i}
                                                <span>
                                                    {b.buffName}
                                                    {#if b.scope}
                                                        <span
                                                            class="rounded bg-(--theme-accent-bg)/10 px-1 py-0.5 text-[9px] text-(--theme-accent-text)"
                                                        >
                                                            {SCOPE_LABELS[b.scope]}
                                                        </span>
                                                    {/if}
                                                    {#if b.exclusive}
                                                        <span
                                                            class="rounded bg-amber-500/10 px-1 py-0.5 text-[9px] text-amber-500"
                                                        >
                                                            专属
                                                        </span>
                                                    {/if}
                                                    {#if b.zones.length}
                                                        <span class="opacity-70">
                                                            （{b.zones
                                                                .map(
                                                                    (z) =>
                                                                        `${zoneLabel(z.zoneId)}${z.override ? '覆盖+' : '+'}${z.ref ? `引用${z.ref.targetZoneId}×${z.ref.pct}%` : z.value}`
                                                                )
                                                                .join(' · ')}）
                                                        </span>
                                                    {/if}
                                                </span>
                                                {#if i < entity.buffs.length - 1}<span>·</span>{/if}
                                            {/each}
                                        </div>
                                    </div>
                                    <button
                                        onclick={() => handleEdit(entity)}
                                        class="shrink-0 rounded p-1 text-(--theme-muted-text) transition-colors hover:bg-(--theme-card-bg-focused) hover:text-(--theme-accent-text)"
                                        title="编辑"
                                    >
                                        <Icon icon="mdi:pencil-outline" class="size-4" />
                                    </button>
                                    <button
                                        onclick={() => (confirmDelete = entity)}
                                        class="shrink-0 rounded p-1 text-(--theme-muted-text) transition-colors hover:bg-(--theme-card-bg-focused) hover:text-red-500"
                                        title="删除"
                                    >
                                        <Icon icon="mdi:trash-can-outline" class="size-4" />
                                    </button>
                                </div>
                            {/each}
                        </div>
                    </div>
                {/if}
            {/each}
        </div>
    {/if}

    {#if editTarget}
        <BuffEntityEditModal
            open
            entityType={editTarget.entityType}
            entityName={editTarget.entityName}
            initialBuffs={editTarget.buffs}
            onclose={() => (editTarget = null)}
        />
    {/if}

    {#if showCreate}
        <Modal
            open
            onclose={() => (showCreate = false)}
            backdropClose={false}
            style="width: min(92vw, 420px); {mergedStyle}"
        >
            {#snippet title()}
                新增 Buff 预设
            {/snippet}
            <div class="space-y-3">
                <label class="flex flex-col gap-1 text-xs text-(--theme-muted-text)">
                    实体类型
                    <select
                        bind:value={createType}
                        class="rounded-lg border border-(--theme-card-border) bg-(--theme-input-bg) px-2 py-1.5 text-sm outline-none focus:border-(--theme-accent-bg)"
                    >
                        {#each ENTITY_TYPES as t}
                            <option value={t}>{ENTITY_TYPE_LABELS[t]}</option>
                        {/each}
                    </select>
                </label>
                <label class="flex flex-col gap-1 text-xs text-(--theme-muted-text)">
                    实体名（角色/武器/声骸/套装名）
                    <input
                        bind:value={createName}
                        maxlength="60"
                        placeholder="输入实体名"
                        class="w-full rounded-lg border border-(--theme-card-border) bg-(--theme-input-bg) px-2 py-1.5 text-sm outline-none focus:border-(--theme-accent-bg)"
                    />
                </label>
            </div>
            <div class="mt-4 flex items-center justify-end gap-2 border-t border-(--theme-card-border) pt-3">
                <button
                    onclick={() => (showCreate = false)}
                    class="rounded-lg px-4 py-1.5 text-sm text-(--theme-muted-text) transition-colors hover:bg-(--theme-card-bg-focused)"
                >
                    取消
                </button>
                <button
                    onclick={handleCreate}
                    class="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-all hover:brightness-125"
                    style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
                >
                    <Icon icon="mdi:check" class="size-4" />
                    创建并编辑
                </button>
            </div>
        </Modal>
    {/if}

    {#if confirmDelete}
        <Modal
            open
            onclose={() => (confirmDelete = null)}
            backdropClose={false}
            style="width: min(92vw, 420px); {mergedStyle}"
        >
            {#snippet title()}
                确认删除
            {/snippet}
            <p class="text-sm text-(--theme-muted-text)">
                确定删除「{confirmDelete.entityName}」的全部 Buff 预设？（无法撤销）
            </p>
            <div class="mt-4 flex items-center justify-end gap-2 border-t border-(--theme-card-border) pt-3">
                <button
                    onclick={() => (confirmDelete = null)}
                    class="rounded-lg px-4 py-1.5 text-sm text-(--theme-muted-text) transition-colors hover:bg-(--theme-card-bg-focused)"
                >
                    取消
                </button>
                <button
                    onclick={handleDelete}
                    class="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium text-white transition-all hover:brightness-110"
                    style="background: var(--theme-danger-bg, tomato);"
                >
                    <Icon icon="mdi:trash-can-outline" class="size-4" />
                    确认删除
                </button>
            </div>
        </Modal>
    {/if}
</Modal>
