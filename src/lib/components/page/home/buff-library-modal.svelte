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
        setEntitySource,
        BUFF_CATEGORY_ORDER,
        BUFF_CATEGORY_LABELS,
        categoryOfType,
        setPiecesOf,
        type BuffEntityType,
        type BuffLibraryEntity,
        type BuffCategory
    } from '$lib/data/buff-library.svelte'
    import { addToast } from '$lib/data/toast.svelte'
    import {
        getCharacterList,
        getWeaponList,
        getEchoList,
        getEchoSetList,
        getCharacterIcons,
        getWeaponIcons,
        getEchoIcons,
        getEchoSetIcons
    } from '$lib/data/api'
    import type { Character, Weapon, Echo, EchoSetItem } from '$lib/api/types'
    import { fallbackIcon } from '$lib/utils/icons'
    import { fade } from 'svelte/transition'
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

    let tab = $state<BuffCategory>('character')
    let query = $state('')
    let filter = $state<'with' | 'without'>('with')
    const FILTERS = [
        { key: 'with', label: '有条目' },
        { key: 'without', label: '无条目' }
    ] as const

    // ── game data ──
    let characters: Character[] = $state([])
    let weapons: Weapon[] = $state([])
    let echoes: Echo[] = $state([])
    let echoSets: EchoSetItem[] = $state([])
    let characterIcons: Record<string, string> = $state({})
    let weaponIcons: Record<string, string> = $state({})
    let echoIcons: Record<string, string> = $state({})
    let echoSetIcons: Record<string, string> = $state({})

    let dataLoaded = false
    $effect(() => {
        if (dataLoaded) return
        dataLoaded = true
        Promise.allSettled([
            getCharacterList(),
            getWeaponList(),
            getEchoList(),
            getEchoSetList(),
            getCharacterIcons(),
            getWeaponIcons(),
            getEchoIcons(),
            getEchoSetIcons()
        ]).then((results) => {
            const [cl, wl, el, esl, ci, wi, ei, esi] = results
            if (cl.status === 'fulfilled') characters = cl.value
            if (wl.status === 'fulfilled') weapons = wl.value
            if (el.status === 'fulfilled') echoes = el.value
            if (esl.status === 'fulfilled') echoSets = esl.value
            if (ci.status === 'fulfilled') characterIcons = ci.value
            if (wi.status === 'fulfilled') weaponIcons = wi.value
            if (ei.status === 'fulfilled') echoIcons = ei.value
            if (esi.status === 'fulfilled') echoSetIcons = esi.value
        })
    })

    interface EntityRow {
        entityType: BuffEntityType
        entityName: string
        icon?: string
        pieces?: number
        count: number
        source: 'share' | 'custom' | null
    }

    let entityKeyMap = $derived(new Map(entities.map((e) => [`${e.entityType}/${e.entityName}`, e])))

    function rowOf(
        entityType: BuffEntityType,
        entityName: string,
        icon: string | undefined,
        pieces: number | undefined
    ): EntityRow {
        const e = entityKeyMap.get(`${entityType}/${entityName}`)
        return { entityType, entityName, icon, pieces, count: e?.buffs.length ?? 0, source: e?.source ?? null }
    }

    let rows = $derived.by(() => {
        let list: EntityRow[] = []
        if (tab === 'character') {
            list = characters.map((c) => rowOf('character', c.name, characterIcons[c.name], undefined))
        } else if (tab === 'weapon') {
            list = weapons.map((w) => rowOf('weapon', w.name, weaponIcons[w.name], undefined))
        } else if (tab === 'echo') {
            list = echoes.map((e) => rowOf('echo', e.name, echoIcons[e.name], undefined))
        } else {
            for (const set of echoSets) {
                for (const piece of set.pieces) {
                    list.push(rowOf(`${piece}set` as BuffEntityType, set.name, echoSetIcons[set.name], piece))
                }
            }
        }

        const covered = new Set(list.map((r) => `${r.entityType}/${r.entityName}`))
        for (const e of entities) {
            if (categoryOfType(e.entityType) !== tab) continue
            const key = `${e.entityType}/${e.entityName}`
            if (covered.has(key)) continue
            list.push(rowOf(e.entityType, e.entityName, undefined, setPiecesOf(e.entityType) || undefined))
        }

        const seenRows = new Set<string>()
        list = list.filter((r) => {
            const k = `${r.entityType}/${r.entityName}`
            if (seenRows.has(k)) return false
            seenRows.add(k)
            return true
        })

        if (tab === 'weapon') {
            list = list.filter((r) => !r.entityName.startsWith('投影·'))
        }

        const q = query.trim()
        if (q) list = list.filter((r) => r.entityName.includes(q))

        if (filter === 'with') {
            list = list.filter((r) => r.count > 0)
        } else if (filter === 'without') {
            list = list.filter((r) => r.count === 0)
        }

        list.sort((a, b) => a.entityName.localeCompare(b.entityName, 'zh') || (a.pieces ?? 0) - (b.pieces ?? 0))
        return list
    })

    async function handleDownload() {
        const res = await fetchBuffSetsFromShare()
        if (res.ok) {
            addToast(res.added > 0 ? `已同步 ${res.added} 个实体` : '工坊 buff 集已是最新', 'success')
        } else {
            addToast(res.error ?? '下载失败', 'error')
        }
    }

    function openEdit(row: EntityRow) {
        const existing = entityKeyMap.get(`${row.entityType}/${row.entityName}`)
        editTarget = {
            entityType: row.entityType,
            entityName: row.entityName,
            source: existing?.source ?? 'custom',
            buffs: existing?.buffs ?? []
        }
    }

    async function handleExcludeSync(entity: BuffLibraryEntity) {
        if (entity.source === 'custom') {
            await setEntitySource(entity.entityType, entity.entityName, 'share')
            addToast('已恢复跟随工坊，下次同步时更新该实体', 'success')
        } else {
            await setEntitySource(entity.entityType, entity.entityName, 'custom')
            addToast('已设为不同步工坊，工坊同步时保留该实体', 'success')
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

    function iconFallback(entityType: BuffEntityType): string {
        if (entityType === 'character') return '/icons/placeholder-character.svg'
        if (entityType === 'weapon') return '/icons/placeholder-weapon.svg'
        if (entityType === 'echo') return '/icons/placeholder-echo.svg'
        return '/icons/placeholder-echo-set.svg'
    }
</script>

<Modal {open} {onclose} class={className} style="width: min(92vw, 820px); height: min(85vh, 760px); {mergedStyle}">
    {#snippet title()}
        Buff 集
    {/snippet}
    {#snippet footer()}{/snippet}

    <div class="flex h-full flex-col">
        <div class="mb-3 flex shrink-0 items-center justify-between gap-2">
            <p class="text-xs text-(--theme-muted-text)">按角色/武器/声骸/套装管理 Buff 预设，点击条目即可编辑</p>
            <div class="flex items-center gap-2">
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

        <!-- Tab bar -->
        <div class="mb-3 flex shrink-0 rounded-lg border border-(--theme-card-border) bg-(--theme-card-bg) p-0.5">
            {#each BUFF_CATEGORY_ORDER as cat}
                <button
                    onclick={() => (tab = cat)}
                    class={[
                        'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                        tab === cat
                            ? 'bg-(--theme-accent-bg) text-(--theme-accent-text-on-bg)'
                            : 'text-(--theme-muted-text) hover:text-(--theme-modal-text)'
                    ].join(' ')}
                >
                    <Icon
                        icon={cat === 'character'
                            ? 'mdi:account-outline'
                            : cat === 'weapon'
                              ? 'mdi:sword'
                              : cat === 'echo'
                                ? 'mdi:ghost-outline'
                                : 'mdi:layers-outline'}
                        class="size-3.5"
                    />
                    {BUFF_CATEGORY_LABELS[cat]}
                </button>
            {/each}
        </div>

        <!-- Search -->
        <div
            class="mb-3 flex shrink-0 items-center gap-2 rounded-lg border border-(--theme-card-border) bg-(--theme-input-bg) px-3 py-2"
        >
            <Icon icon="mdi:magnify" class="size-4 shrink-0 text-(--theme-muted-text)" />
            <input
                bind:value={query}
                placeholder="搜索{BUFF_CATEGORY_LABELS[tab]}…"
                class="min-w-0 flex-1 bg-transparent text-sm outline-none text-(--theme-modal-text) placeholder:text-(--theme-modal-text)/30"
            />
            {#if query}
                <button
                    onclick={() => (query = '')}
                    class="rounded p-0.5 text-(--theme-muted-text) hover:text-(--theme-modal-text)"
                >
                    <Icon icon="mdi:close" class="size-4" />
                </button>
            {/if}
            <div
                class="ml-1 flex shrink-0 items-center gap-0.5 rounded-md border border-(--theme-card-border) bg-(--theme-card-bg) p-0.5"
            >
                {#each FILTERS as f (f.key)}
                    <button
                        onclick={() => (filter = f.key)}
                        class={[
                            'whitespace-nowrap rounded px-2 py-1 text-[11px] font-medium transition-colors',
                            filter === f.key
                                ? 'bg-(--theme-accent-bg) text-(--theme-accent-text-on-bg)'
                                : 'text-(--theme-muted-text) hover:text-(--theme-modal-text)'
                        ].join(' ')}
                    >
                        {f.label}
                    </button>
                {/each}
            </div>
        </div>

        <!-- Entity list -->
        <div class="min-h-0 flex-1 overflow-y-auto pr-0.5">
            {#if rows.length === 0}
                <div class="flex h-full flex-col items-center justify-center gap-2 text-sm text-(--theme-muted-text)">
                    <Icon icon="mdi:magnify-close" class="size-9" />
                    没有匹配的条目
                </div>
            {:else}
                <div class="space-y-1">
                    {#each rows as row (row.entityType + '/' + row.entityName)}
                        <!-- svelte-ignore a11y_click_events_have_key_events -->
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <div
                            in:fade={{ duration: 120 }}
                            onclick={() => openEdit(row)}
                            role="button"
                            tabindex="0"
                            class="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-(--theme-card-border) bg-(--theme-card-bg) px-3 py-2 text-left transition-colors hover:bg-(--theme-card-bg-focused)"
                        >
                            <div
                                class={[
                                    'flex size-10 shrink-0 items-center justify-center overflow-hidden',
                                    row.entityType === 'character'
                                        ? 'rounded-full'
                                        : 'rounded-lg bg-(--theme-card-bg-focused)'
                                ].join(' ')}
                            >
                                {#if row.icon}
                                    <img
                                        src={row.icon}
                                        alt={row.entityName}
                                        use:fallbackIcon={iconFallback(row.entityType)}
                                        class={row.entityType === 'character'
                                            ? 'size-full object-cover'
                                            : 'size-full object-contain p-1'}
                                    />
                                {:else}
                                    <span class="text-xs text-(--theme-muted-text)">{row.entityName.charAt(0)}</span>
                                {/if}
                            </div>

                            <div class="min-w-0 flex-1">
                                <div class="flex items-center gap-2">
                                    <span class="truncate text-sm font-medium text-(--theme-layout-text)">
                                        {row.entityName}
                                    </span>
                                    {#if row.pieces}
                                        <span
                                            class="shrink-0 rounded bg-(--theme-accent-bg)/10 px-1.5 py-0.5 text-[10px] text-(--theme-accent-text)"
                                        >
                                            {row.pieces}件
                                        </span>
                                    {/if}
                                    {#if row.source}
                                        <button
                                            onclick={(e) => {
                                                e.stopPropagation()
                                                const existing = entityKeyMap.get(`${row.entityType}/${row.entityName}`)
                                                if (existing) handleExcludeSync(existing)
                                            }}
                                            class={[
                                                'inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                                                row.source === 'custom'
                                                    ? 'text-(--theme-accent-text)'
                                                    : 'text-(--theme-muted-text) hover:text-(--theme-modal-text)'
                                            ].join(' ')}
                                            style={row.source === 'custom'
                                                ? 'background: color-mix(in srgb, var(--theme-accent-bg) 10%, transparent);'
                                                : ''}
                                            title={row.source === 'custom'
                                                ? '不同步工坊：点击恢复跟随工坊'
                                                : '跟随工坊：点击设为不同步工坊'}
                                        >
                                            <Icon
                                                icon={row.source === 'custom'
                                                    ? 'mdi:check-circle'
                                                    : 'mdi:circle-outline'}
                                                class="size-3"
                                            />
                                            不同步工坊
                                        </button>
                                    {/if}
                                </div>
                            </div>

                            <span
                                class={[
                                    'shrink-0 rounded px-1.5 py-0.5',
                                    row.count > 0
                                        ? 'bg-(--theme-accent-bg)/10 text-sm font-semibold text-(--theme-accent-text)'
                                        : 'text-[10px] text-(--theme-muted-text)/60'
                                ].join(' ')}
                            >
                                {row.count} 条
                            </span>

                            {#if row.count > 0}
                                <button
                                    onclick={(e) => {
                                        e.stopPropagation()
                                        const existing = entityKeyMap.get(`${row.entityType}/${row.entityName}`)
                                        if (existing) confirmDelete = existing
                                    }}
                                    class="shrink-0 rounded p-1 text-(--theme-muted-text) transition-colors hover:bg-(--theme-card-bg-focused) hover:text-red-500"
                                    title="删除"
                                >
                                    <Icon icon="mdi:trash-can-outline" class="size-4" />
                                </button>
                            {/if}
                        </div>
                    {/each}
                </div>
            {/if}
        </div>
    </div>

    {#if editTarget}
        <BuffEntityEditModal
            open
            entityType={editTarget.entityType}
            entityName={editTarget.entityName}
            initialBuffs={editTarget.buffs}
            onclose={() => (editTarget = null)}
        />
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
