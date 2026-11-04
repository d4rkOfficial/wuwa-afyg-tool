<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import {
        getBuffEntities,
        loadBuffLibrary,
        ENTITY_TYPE_LABELS,
        BUFF_CATEGORY_ORDER,
        BUFF_CATEGORY_LABELS,
        categoryOfType,
        setPiecesOf
    } from '$lib/data/buff-library.svelte'
    import type { BuffLibraryEntity } from '$lib/data/buff-library.svelte'
    import {
        getAllBuffConfs,
        importBuffSetsWithDecisions,
        type ImportBuffInput
    } from '$lib/calc/calculation.store.svelte'
    import { ZONE_MAP } from '$lib/calc/calculation.consts'
    import { buildBuffImportItems, detectImportConflicts } from '$lib/calc/buff-import-utils'
    import { buffFolderPath, buffLeafName } from '$lib/calc/buff-name'
    import BuffImportConflictModal from './buff-import-conflict-modal.svelte'
    import { addToast } from '$lib/data/toast.svelte'
    import type { CharSlot } from '$lib/types/project'
    import { mergeComponentsStyle } from '$lib/utils/component-style'

    interface Props extends ComponentsProps {
        open: boolean
        team: [CharSlot, CharSlot, CharSlot]
        onclose?: () => void
    }

    let { open, onclose, team, backgroundImage, textColor, class: className, style: styleProp }: Props = $props()

    let mergedStyle = $derived(mergeComponentsStyle({ backgroundImage, textColor, style: styleProp }))

    let allEntities = $derived(getBuffEntities())

    let prevOpen = $state(open)
    $effect(() => {
        if (open && !prevOpen) {
            loadBuffLibrary()
        }
        prevOpen = open
    })

    function entityKey(entity: BuffLibraryEntity) {
        return `${entity.entityType}/${entity.entityName}`
    }

    let mergedKeys = $derived.by(() => {
        const keys = new Set<string>()
        for (const slot of team) {
            if (slot?.character) keys.add(`character/${slot.character}`)
            if (slot?.weapon) keys.add(`weapon/${slot.weapon}`)
            if (slot?.echoes?.[0]?.name) keys.add(`echo/${slot.echoes[0].name}`)
            for (const s of slot?.triggerSets ?? []) {
                if (s?.name) keys.add(`${s.pieces}set/${s.name}`)
            }
        }
        return keys
    })

    const recommendedEntities = $derived(allEntities.filter((e) => mergedKeys.has(entityKey(e)) && matchQuery(e)))
    const otherEntities = $derived(allEntities.filter((e) => !mergedKeys.has(entityKey(e)) && matchQuery(e)))

    let query = $state('')

    function matchQuery(e: BuffLibraryEntity): boolean {
        const q = query.trim()
        if (!q) return true
        return e.entityName.includes(q) || e.buffs.some((b) => b.buffName.includes(q))
    }

    /** @desc 三级勾选：实体 / 文件夹 / 单 Buff 都落到 buffKey（实体 + 全名） */
    let selectedBuffs = $state<Record<string, boolean>>({})
    let expandedEntities = $state<Record<string, boolean>>({})

    // 「已下载 · 其它」默认折叠，点击展开（搜索时自动展开）
    let showOthers = $state(false)

    const buffKeyOf = (entity: BuffLibraryEntity, buffName: string) => `${entityKey(entity)}\u0000${buffName}`

    const selectedBuffsOf = (entity: BuffLibraryEntity) =>
        entity.buffs.filter((buff) => selectedBuffs[buffKeyOf(entity, buff.buffName)])

    const isBuffChecked = (entity: BuffLibraryEntity, buffName: string) => !!selectedBuffs[buffKeyOf(entity, buffName)]

    function toggleBuff(entity: BuffLibraryEntity, buffName: string) {
        const key = buffKeyOf(entity, buffName)
        selectedBuffs = { ...selectedBuffs, [key]: !selectedBuffs[key] }
    }

    const isEntityChecked = (entity: BuffLibraryEntity) =>
        entity.buffs.length > 0 && entity.buffs.every((buff) => isBuffChecked(entity, buff.buffName))

    const isEntityPartial = (entity: BuffLibraryEntity) =>
        !isEntityChecked(entity) && selectedBuffsOf(entity).length > 0

    function toggleEntity(entity: BuffLibraryEntity) {
        const all = isEntityChecked(entity)
        const patch: Record<string, boolean> = {}
        for (const buff of entity.buffs) patch[buffKeyOf(entity, buff.buffName)] = !all
        selectedBuffs = { ...selectedBuffs, ...patch }
    }

    function folderOfBuff(entity: BuffLibraryEntity, buffName: string): string {
        void entity
        return buffFolderPath(buffName)[0] ?? ''
    }

    function buffsInFolder(entity: BuffLibraryEntity, folder: string) {
        return entity.buffs.filter((buff) => folderOfBuff(entity, buff.buffName) === folder)
    }

    function folderNamesOf(entity: BuffLibraryEntity): string[] {
        const names = entity.folders.map((folder) => folder.name)
        if (entity.buffs.some((buff) => !folderOfBuff(entity, buff.buffName))) names.push('')
        return names
    }

    function isFolderChecked(entity: BuffLibraryEntity, folder: string) {
        const list = buffsInFolder(entity, folder)
        return list.length > 0 && list.every((buff) => isBuffChecked(entity, buff.buffName))
    }

    function isFolderPartial(entity: BuffLibraryEntity, folder: string) {
        if (isFolderChecked(entity, folder)) return false
        return buffsInFolder(entity, folder).some((buff) => isBuffChecked(entity, buff.buffName))
    }

    function toggleFolder(entity: BuffLibraryEntity, folder: string) {
        const list = buffsInFolder(entity, folder)
        const all = isFolderChecked(entity, folder)
        const patch: Record<string, boolean> = {}
        for (const buff of list) patch[buffKeyOf(entity, buff.buffName)] = !all
        selectedBuffs = { ...selectedBuffs, ...patch }
    }

    const otherSelectedCount = $derived(otherEntities.reduce((sum, entity) => sum + selectedBuffsOf(entity).length, 0))

    const countSelectedBuffs = $derived(
        [...recommendedEntities, ...otherEntities].reduce((sum, entity) => sum + selectedBuffsOf(entity).length, 0)
    )

    function isChecked(entity: BuffLibraryEntity) {
        return isEntityChecked(entity)
    }

    function toggle(entity: BuffLibraryEntity) {
        toggleEntity(entity)
    }

    function toggleExpanded(entity: BuffLibraryEntity) {
        const key = entityKey(entity)
        expandedEntities = { ...expandedEntities, [key]: !expandedEntities[key] }
    }

    function isExpanded(entity: BuffLibraryEntity) {
        return !!expandedEntities[entityKey(entity)] || !!query.trim()
    }

    function zoneText(zoneId: string) {
        return ZONE_MAP.get(zoneId as never)?.label ?? zoneId
    }

    function buffDetail(entity: BuffLibraryEntity) {
        return entity.buffs
            .map((b) => {
                const zones = b.zones
                    .map((z) => `${zoneText(z.zoneId)} ${z.override ? '覆盖+' : '+'}${z.value}`)
                    .join(' · ')
                return `${buffLeafName(b.buffName)}${zones ? `（${zones}）` : ''}`
            })
            .join(' / ')
    }

    /** @desc 待冲突决策的导入批次（检测到同名冲突/内容一致时暂存，等弹窗决议） */
    let pending = $state<{
        items: ImportBuffInput[]
        total: number
        /** @desc 下标 → 命中的已有 buff id（重命名用） */
        identicalById: Record<number, string>
    } | null>(null)
    let conflictOpen = $state(false)
    let conflictList = $state<{ index: number; name: string; slot?: number }[]>([])
    let identicalList = $state<{ index: number; name: string; existingName: string; slot?: number }[]>([])

    /** @desc 统一的导入执行 + 结果提示 */
    function runImport(items: ImportBuffInput[], decisions: Parameters<typeof importBuffSetsWithDecisions>[1] = {}) {
        const report = importBuffSetsWithDecisions(items, decisions, -1, team.length)
        const parts = [`已导入 ${report.added} 条`]
        if (report.overwritten > 0) parts.push(`覆盖 ${report.overwritten} 条`)
        if (report.skipped > 0) parts.push(`跳过 ${report.skipped} 条重名`)
        if (report.renamed > 0) parts.push(`重命名已有 ${report.renamed} 条`)
        if (report.reowned > 0) parts.push(`修正归属 ${report.reowned} 条`)
        addToast(parts.join('，'), report.added > 0 || report.renamed > 0 ? 'success' : 'info')
    }

    function handleImport() {
        const picked = [...recommendedEntities, ...otherEntities].filter((e) => selectedBuffsOf(e).length > 0)
        if (!picked.length) {
            addToast('请先勾选要导入的 Buff', 'info')
            return
        }
        const items = picked.flatMap((e) => buildBuffImportItems(e, selectedBuffsOf(e), team))
        const { report, deduped } = detectImportConflicts(items, getAllBuffConfs())
        if (report.conflicts.length === 0 && report.identical.length === 0) {
            runImport(deduped)
            onclose?.()
            return
        }
        // 有需要用户决策的冲突：先弹窗，决议后再落库
        pending = {
            items: deduped,
            total: deduped.length,
            identicalById: Object.fromEntries(report.identical.map((it) => [it.index, it.existingId]))
        }
        conflictList = report.conflicts.map((c) => ({ index: c.index, name: c.name, slot: c.slot }))
        identicalList = report.identical.map((it) => ({
            index: it.index,
            name: it.name,
            existingName: it.existingName,
            slot: it.slot
        }))
        conflictOpen = true
    }

    /** @desc 冲突弹窗确认：逐条同名决议 + 重命名清单一并交给 store */
    function confirmConflict(decisions: {
        sameName: 'skip' | 'overwrite'
        perIndex: Record<number, 'skip' | 'overwrite'>
        renameIdentical: boolean
        renames: { index: number; name: string }[]
    }) {
        if (!pending) return
        const target = pending
        runImport(target.items, {
            sameName: decisions.sameName,
            sameNamePerIndex: decisions.perIndex,
            renameIdentical: decisions.renameIdentical,
            // 把「导入名 → 已有 buff id」补齐，store 据此重命名
            identicalRenames: decisions.renames
                .map((r) => ({ id: target.identicalById[r.index] ?? '', name: r.name }))
                .filter((r) => !!r.id)
        })
        pending = null
        conflictOpen = false
        onclose?.()
    }
</script>

<Modal {open} {onclose} class={className} style="width: min(92vw, 720px); {mergedStyle}">
    {#snippet title()}
        <span class="flex items-center gap-2">
            <Icon icon="mdi:import" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            <span class="font-black tracking-tight">导入 Buff 集</span>
        </span>
    {/snippet}

    <p class="mb-3 text-[10px] leading-relaxed text-(--theme-modal-text)/40">
        勾选实体 = 全选；展开后可按文件夹整组勾选，也可单独挑某条 Buff。上方为根据当前配装推荐的实体，下方为其它已下载的
    </p>

    <div
        class="mb-3 flex items-center gap-2 rounded-none border px-3 py-2"
        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
    >
        <Icon icon="mdi:magnify" class="size-4 shrink-0 text-(--theme-modal-text)/35" />
        <input
            bind:value={query}
            placeholder="搜索实体 / Buff 名…"
            class="min-w-0 flex-1 bg-transparent text-sm outline-none text-(--theme-modal-text) placeholder:text-(--theme-modal-text)/30"
        />
        {#if query}
            <button
                onclick={() => (query = '')}
                class="rounded-none p-0.5 text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)"
            >
                <Icon icon="mdi:close" class="size-4" />
            </button>
        {/if}
    </div>

    <div class="flex flex-col gap-4">
        <div>
            <h3 class="mb-2 flex items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text)">
                <Icon icon="mdi:star" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
                推荐（匹配当前配装）
            </h3>
            {#if recommendedEntities.length === 0}
                <div
                    class="flex items-center gap-2 rounded-none border px-3 py-3 text-[10px] text-(--theme-modal-text)/40"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                >
                    <Icon icon="mdi:emoticon-happy-outline" class="size-4 shrink-0" />
                    没有匹配到推荐 Buff 集，可先到主页「Buff 集」从工坊下载
                </div>
            {:else}
                {@render CategoryGroup(recommendedEntities)}
            {/if}
        </div>

        <div>
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <button
                onclick={() => (showOthers = !showOthers)}
                class="mb-2 flex w-full items-center gap-2 text-sm font-black tracking-tight text-(--theme-modal-text) transition-colors hover:text-(--theme-accent-text)"
                title="展开 / 收起非推荐实体"
            >
                <Icon icon={showOthers || query ? 'mdi:chevron-down' : 'mdi:chevron-right'} class="size-4 shrink-0" />
                <Icon icon="mdi:download" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
                已下载 · 其它（{otherEntities.length}）
                {#if otherSelectedCount > 0}
                    <span
                        class="rounded-none bg-(--theme-accent-bg)/10 px-1.5 py-0.5 text-[10px] font-medium text-(--theme-accent-text)"
                        >已选 {otherSelectedCount}</span
                    >
                {/if}
            </button>
            {#if showOthers || query}
                {#if otherEntities.length === 0}
                    <div
                        class="rounded-none border px-3 py-3 text-[10px] text-(--theme-modal-text)/40"
                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                    >
                        暂无其它 Buff 集
                    </div>
                {:else}
                    {@render CategoryGroup(otherEntities)}
                {/if}
            {/if}
        </div>
    </div>

    {#snippet footer()}
        <div
            class="flex items-center justify-end gap-2 border-t pt-3"
            style="border-color: var(--theme-divider-border);"
        >
            <button
                onclick={onclose}
                class="rounded-none px-4 py-1.5 text-sm text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
            >
                取消
            </button>
            <button
                onclick={handleImport}
                disabled={countSelectedBuffs === 0}
                class="inline-flex items-center gap-1.5 rounded-none px-4 py-1.5 text-sm font-medium transition-all hover:brightness-125 disabled:opacity-40"
                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
            >
                <Icon icon="mdi:import" class="size-4" />
                导入{#if countSelectedBuffs > 0}（{countSelectedBuffs} 条）{/if}
            </button>
        </div>
    {/snippet}
</Modal>

{#snippet CategoryGroup(list: BuffLibraryEntity[])}
    {#each BUFF_CATEGORY_ORDER as cat (cat)}
        {@const group = list
            .filter((e) => categoryOfType(e.entityType) === cat)
            .sort((a, b) => setPiecesOf(a.entityType) - setPiecesOf(b.entityType))}
        {#if group.length > 0}
            <div class="mb-2">
                <h4 class="mb-1 px-0.5 text-[10px] font-black tracking-[0.12em] text-(--theme-modal-text)/40">
                    {BUFF_CATEGORY_LABELS[cat]}（{group.length}）
                </h4>
                <div class="grid grid-cols-1 gap-1.5 xl:grid-cols-2 xl:gap-x-3">
                    {#each group as entity (entityKey(entity))}
                        {@render EntityRow(entity, isChecked(entity))}
                    {/each}
                </div>
            </div>
        {/if}
    {/each}
{/snippet}

{#snippet EntityRow(entity: BuffLibraryEntity, checked: boolean)}
    <div class="rounded-none border" style="border-color: var(--theme-divider-border);">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class={[
                'flex cursor-pointer items-start gap-3 px-3 py-2 transition-colors',
                checked ? 'bg-(--theme-accent-bg)/10' : 'bg-(--theme-input-bg) hover:bg-(--theme-accent-bg)/5'
            ].join(' ')}
            onclick={() => toggle(entity)}
            title="点击全选 / 取消该实体"
        >
            <span
                class="mt-0.5 flex size-5 shrink-0 items-center justify-center {checked
                    ? 'text-(--theme-accent-text)'
                    : 'text-(--theme-modal-text)/40'}"
            >
                <Icon
                    icon={checked
                        ? 'mdi:checkbox-marked'
                        : isEntityPartial(entity)
                          ? 'mdi:minus-box-outline'
                          : 'mdi:checkbox-blank-outline'}
                    class="size-5"
                />
            </span>
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                    <span class="truncate text-sm font-medium text-(--theme-modal-text)">{entity.entityName}</span>
                    <span
                        class="shrink-0 rounded-none bg-(--theme-accent-bg)/10 px-1.5 py-0.5 text-[10px] font-medium text-(--theme-accent-text)"
                    >
                        {categoryOfType(entity.entityType) === 'set'
                            ? `${setPiecesOf(entity.entityType)}件`
                            : ENTITY_TYPE_LABELS[entity.entityType]}
                    </span>
                    <span class="shrink-0 text-[10px] text-(--theme-modal-text)/40">
                        {selectedBuffsOf(entity).length}/{entity.buffs.length} 条
                    </span>
                </div>
                <div class="mt-0.5 truncate text-[10px] text-(--theme-modal-text)/40" title={buffDetail(entity)}>
                    {buffDetail(entity)}
                </div>
            </div>
            <button
                onclick={(e) => {
                    e.stopPropagation()
                    toggleExpanded(entity)
                }}
                class="mt-0.5 shrink-0 p-1 text-(--theme-modal-text)/40 hover:text-(--theme-accent-text)"
                title={isExpanded(entity) ? '收起 Buff 明细' : '展开 Buff 明细'}
            >
                <Icon icon={isExpanded(entity) ? 'mdi:chevron-up' : 'mdi:chevron-down'} class="size-4" />
            </button>
        </div>
        {#if isExpanded(entity)}
            <div class="space-y-1 border-t px-2 py-2" style="border-color: var(--theme-divider-border);">
                {#each folderNamesOf(entity) as folder (folder)}
                    <div>
                        <button
                            onclick={() => toggleFolder(entity, folder)}
                            class="flex w-full items-center gap-1.5 rounded-none px-1 py-0.5 text-left text-[11px] font-medium text-(--theme-modal-text)/60 hover:text-(--theme-accent-text)"
                        >
                            <Icon
                                icon={isFolderChecked(entity, folder)
                                    ? 'mdi:checkbox-marked'
                                    : isFolderPartial(entity, folder)
                                      ? 'mdi:minus-box-outline'
                                      : 'mdi:checkbox-blank-outline'}
                                class="size-4 shrink-0"
                            />
                            <Icon icon="mdi:folder-outline" class="size-3.5 shrink-0" />
                            <span class="min-w-0 flex-1 truncate">{folder || '未归组'}</span>
                            <span class="shrink-0 text-[10px] opacity-60">{buffsInFolder(entity, folder).length}</span>
                        </button>
                        <div class="ml-6 space-y-0.5">
                            {#each buffsInFolder(entity, folder) as buff (buff.buffName)}
                                <button
                                    onclick={() => toggleBuff(entity, buff.buffName)}
                                    class="flex w-full items-center gap-1.5 rounded-none px-1 py-0.5 text-left text-[11px] text-(--theme-modal-text)/70 hover:bg-(--theme-modal-text)/5"
                                    title={buff.buffName}
                                >
                                    <Icon
                                        icon={isBuffChecked(entity, buff.buffName)
                                            ? 'mdi:checkbox-marked'
                                            : 'mdi:checkbox-blank-outline'}
                                        class="size-3.5 shrink-0 {isBuffChecked(entity, buff.buffName)
                                            ? 'text-(--theme-accent-text)'
                                            : 'text-(--theme-modal-text)/30'}"
                                    />
                                    <span class="min-w-0 flex-1 truncate">{buffLeafName(buff.buffName)}</span>
                                    <span class="shrink-0 text-[10px] text-(--theme-modal-text)/35"
                                        >{buff.zones.length} 乘区</span
                                    >
                                </button>
                            {/each}
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
{/snippet}

<!-- 冲突解决弹窗：同级挂载、DOM 在本弹窗之后，因此叠在上层 -->
<BuffImportConflictModal
    open={conflictOpen}
    conflicts={conflictList}
    identical={identicalList}
    total={pending?.total ?? 0}
    onclose={() => {
        conflictOpen = false
        pending = null
    }}
    onconfirm={confirmConflict}
/>
