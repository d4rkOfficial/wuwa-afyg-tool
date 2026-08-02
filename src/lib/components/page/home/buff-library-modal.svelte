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
    const CREATE_TABS = ['角色', '武器', '首位声骸', '套装'] as const
    let createTab = $state<0 | 1 | 2 | 3>(0)
    let createQuery = $state('')

    let characters: Character[] = $state([])
    let weapons: Weapon[] = $state([])
    let echoes: Echo[] = $state([])
    let echoSets: EchoSetItem[] = $state([])
    let characterIcons: Record<string, string> = $state({})
    let weaponIcons: Record<string, string> = $state({})
    let echoIcons: Record<string, string> = $state({})
    let echoSetIcons: Record<string, string> = $state({})

    let createCharacter = $state<Character | null>(null)
    let createWeapon = $state<Weapon | null>(null)
    let createEcho = $state<Echo | null>(null)
    let createSet = $state<EchoSetItem | null>(null)
    let createSetPieces = $state(0)

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

    let filteredCharacters = $derived(createQuery ? characters.filter((c) => c.name.includes(createQuery)) : characters)
    let filteredWeapons = $derived(createQuery ? weapons.filter((w) => w.name.includes(createQuery)) : weapons)
    let filteredEchoes = $derived(createQuery ? echoes.filter((e) => e.name.includes(createQuery)) : echoes)

    let createEntityType = $derived.by(() => {
        if (createTab === 3) return createSetPieces > 0 ? (`${createSetPieces}set` as BuffEntityType) : null
        return (['character', 'weapon', 'echo'] as BuffEntityType[])[createTab]
    })
    let createEntityName = $derived.by(() => {
        if (createTab === 3) return createSet?.name ?? ''
        return [createCharacter, createWeapon, createEcho][createTab]?.name ?? ''
    })
    let createCanSubmit = $derived(!!createEntityType && !!createEntityName)

    function switchCreateTab(i: number) {
        createTab = i as 0 | 1 | 2 | 3
        createQuery = ''
    }

    function pickItemCls(selected: boolean): string {
        return [
            'flex w-[100px] shrink-0 flex-col items-center gap-1.5 rounded-lg p-3 transition-colors cursor-pointer',
            selected ? 'ring-2 ring-(--theme-accent-bg) bg-(--theme-accent-bg)/10' : 'hover:bg-(--theme-modal-text)/5'
        ].join(' ')
    }

    function closeCreate() {
        showCreate = false
        createQuery = ''
        createCharacter = null
        createWeapon = null
        createEcho = null
        createSet = null
        createSetPieces = 0
    }

    async function handleCreate() {
        if (!createEntityType || !createEntityName) {
            addToast('请先选择实体', 'error')
            return
        }
        const ok = await createCustomEntity(createEntityType, createEntityName)
        if (!ok) {
            addToast('该实体已存在', 'error')
            return
        }
        addToast('已创建自定义预设', 'success')
        const created = entities.find((e) => e.entityType === createEntityType && e.entityName === createEntityName)
        if (created) editTarget = created
        closeCreate()
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
        <Modal open onclose={closeCreate} backdropClose={false} style="width: min(92vw, 560px); {mergedStyle}">
            {#snippet title()}
                新增 Buff 预设
            {/snippet}
            <div class="space-y-3">
                <!-- 类型 -->
                <div class="flex rounded-lg border border-(--theme-card-border) bg-(--theme-card-bg) p-0.5">
                    {#each CREATE_TABS as tab, i}
                        <button
                            onclick={() => switchCreateTab(i)}
                            class={[
                                'flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                                createTab === i
                                    ? 'bg-(--theme-accent-bg) text-(--theme-accent-text-on-bg)'
                                    : 'text-(--theme-muted-text) hover:text-(--theme-modal-text)'
                            ].join(' ')}
                        >
                            {tab}
                        </button>
                    {/each}
                </div>

                <!-- 搜索 -->
                {#if createTab !== 3}
                    <div
                        class="flex items-center gap-2 rounded-lg border border-(--theme-card-border) bg-(--theme-input-bg) px-3 py-2"
                    >
                        <Icon icon="mdi:magnify" class="size-4 shrink-0 text-(--theme-muted-text)" />
                        <input
                            bind:value={createQuery}
                            placeholder="搜索…"
                            class="min-w-0 flex-1 bg-transparent text-sm outline-none text-(--theme-modal-text) placeholder:text-(--theme-modal-text)/30"
                        />
                        {#if createQuery}
                            <button
                                onclick={() => (createQuery = '')}
                                class="rounded p-0.5 text-(--theme-muted-text) hover:text-(--theme-modal-text)"
                            >
                                <Icon icon="mdi:close" class="size-4" />
                            </button>
                        {/if}
                    </div>
                {/if}

                <!-- 实体选择 -->
                <div class="max-h-64 overflow-y-auto p-1">
                    {#if createTab === 0}
                        <div class="flex flex-wrap gap-2">
                            {#each filteredCharacters as c}
                                <button
                                    onclick={() => (createCharacter = c)}
                                    class={pickItemCls(createCharacter?.name === c.name)}
                                >
                                    <div class="size-14 overflow-hidden rounded-full bg-(--theme-modal-text)/10">
                                        {#if characterIcons[c.name]}
                                            <img
                                                src={characterIcons[c.name]}
                                                alt={c.name}
                                                use:fallbackIcon={'/icons/placeholder-character.svg'}
                                                class="size-full object-cover"
                                            />
                                        {:else}
                                            <div
                                                class="flex size-full items-center justify-center text-xs text-(--theme-muted-text)"
                                            >
                                                {c.name.charAt(0)}
                                            </div>
                                        {/if}
                                    </div>
                                    <span class="truncate text-[11px] leading-tight text-(--theme-modal-text)"
                                        >{c.name}</span
                                    >
                                </button>
                            {/each}
                            {#if filteredCharacters.length === 0}
                                <div class="w-full py-8 text-center text-xs text-(--theme-muted-text)">无匹配角色</div>
                            {/if}
                        </div>
                    {:else if createTab === 1}
                        <div class="flex flex-wrap gap-2">
                            {#each filteredWeapons as w}
                                <button
                                    onclick={() => (createWeapon = w)}
                                    class={pickItemCls(createWeapon?.name === w.name)}
                                >
                                    <div class="size-14 overflow-hidden rounded-full bg-(--theme-modal-text)/10">
                                        {#if weaponIcons[w.name]}
                                            <img
                                                src={weaponIcons[w.name]}
                                                alt={w.name}
                                                use:fallbackIcon={'/icons/placeholder-weapon.svg'}
                                                class="size-full object-cover"
                                            />
                                        {:else}
                                            <div
                                                class="flex size-full items-center justify-center text-xs text-(--theme-muted-text)"
                                            >
                                                {w.name.charAt(0)}
                                            </div>
                                        {/if}
                                    </div>
                                    <span class="truncate text-[11px] leading-tight text-(--theme-modal-text)"
                                        >{w.name}</span
                                    >
                                </button>
                            {/each}
                            {#if filteredWeapons.length === 0}
                                <div class="w-full py-8 text-center text-xs text-(--theme-muted-text)">无匹配武器</div>
                            {/if}
                        </div>
                    {:else if createTab === 2}
                        <div class="flex flex-wrap gap-2">
                            {#each filteredEchoes as e}
                                <button
                                    onclick={() => (createEcho = e)}
                                    class={pickItemCls(createEcho?.name === e.name)}
                                >
                                    <div class="size-14 overflow-hidden rounded-full bg-(--theme-modal-text)/10">
                                        {#if echoIcons[e.name]}
                                            <img
                                                src={echoIcons[e.name]}
                                                alt={e.name}
                                                use:fallbackIcon={'/icons/placeholder-echo.svg'}
                                                class="size-full object-cover"
                                            />
                                        {:else}
                                            <div
                                                class="flex size-full items-center justify-center text-xs text-(--theme-muted-text)"
                                            >
                                                {e.name.charAt(0)}
                                            </div>
                                        {/if}
                                    </div>
                                    <span class="truncate text-[11px] leading-tight text-(--theme-modal-text)"
                                        >{e.name}</span
                                    >
                                </button>
                            {/each}
                            {#if filteredEchoes.length === 0}
                                <div class="w-full py-8 text-center text-xs text-(--theme-muted-text)">无匹配声骸</div>
                            {/if}
                        </div>
                    {:else}
                        <div class="grid grid-cols-2 gap-2">
                            {#each echoSets as set}
                                <div
                                    class={[
                                        'flex flex-col gap-2 rounded-lg border p-2.5 transition-colors',
                                        createSet?.name === set.name
                                            ? 'border-(--theme-accent-bg) bg-(--theme-accent-bg)/10'
                                            : 'border-(--theme-card-border) bg-(--theme-card-bg)'
                                    ].join(' ')}
                                >
                                    <button
                                        onclick={() => {
                                            createSet = set
                                            createSetPieces = 0
                                        }}
                                        class="flex items-center gap-2 min-w-0"
                                    >
                                        {#if echoSetIcons[set.name]}
                                            <img
                                                src={echoSetIcons[set.name]}
                                                alt={set.name}
                                                use:fallbackIcon={'/icons/placeholder-echo-set.svg'}
                                                class="size-8 shrink-0 rounded object-contain"
                                            />
                                        {/if}
                                        <span class="min-w-0 truncate text-sm font-medium text-(--theme-layout-text)">
                                            {set.name}
                                        </span>
                                    </button>
                                    <div class="flex gap-1">
                                        {#each set.pieces as piece}
                                            <button
                                                onclick={() => (createSetPieces = piece)}
                                                disabled={createSet?.name !== set.name}
                                                class={[
                                                    'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
                                                    createSet?.name === set.name && createSetPieces === piece
                                                        ? 'bg-(--theme-accent-bg)/30 text-(--theme-accent-text)'
                                                        : 'bg-(--theme-input-bg) text-(--theme-muted-text) hover:bg-(--theme-modal-text)/10',
                                                    createSet?.name !== set.name ? 'opacity-40 pointer-events-none' : ''
                                                ]
                                                    .filter(Boolean)
                                                    .join(' ')}
                                            >
                                                {piece}件
                                            </button>
                                        {/each}
                                    </div>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
            </div>
            <div class="mt-4 flex items-center justify-end gap-2 border-t border-(--theme-card-border) pt-3">
                <button
                    onclick={closeCreate}
                    class="rounded-lg px-4 py-1.5 text-sm text-(--theme-muted-text) transition-colors hover:bg-(--theme-card-bg-focused)"
                >
                    取消
                </button>
                <button
                    onclick={handleCreate}
                    disabled={!createCanSubmit}
                    class="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-all hover:brightness-125 disabled:opacity-40"
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
