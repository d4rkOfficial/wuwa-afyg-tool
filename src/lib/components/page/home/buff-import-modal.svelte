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
    import type { BuffLibraryEntity, BuffLibraryZone, BuffLibraryScope } from '$lib/data/buff-library.svelte'
    import type { BuffCondition } from './calculation/calculation.types'
    import { importBuffSets } from './calculation/calculation.store.svelte'
    import { ZONE_MAP } from './calculation/calculation.consts'
    import { addToast } from '$lib/data/toast.svelte'
    import type { CharSlot } from '$lib/data/types'

    interface Props extends ComponentsProps {
        open: boolean
        team: [CharSlot, CharSlot, CharSlot]
        onclose?: () => void
    }

    let { open, onclose, team, backgroundImage, textColor, class: className, style: styleProp }: Props = $props()

    let mergedStyle = $derived(
        [
            backgroundImage ? `background: ${backgroundImage}` : '',
            textColor ? `color: ${textColor}` : '',
            styleProp || ''
        ]
            .filter(Boolean)
            .join(';')
    )

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

    const TYPE_ICONS: Record<string, string> = {
        character: 'mdi:account-outline',
        weapon: 'mdi:sword-cross',
        echo: 'mdi:ghost-outline',
        set: 'mdi:layers-outline'
    }

    let selected = $state<Record<string, boolean>>({})

    // 「已下载 · 其它」默认折叠，点击展开（搜索时自动展开）
    let showOthers = $state(false)

    const otherSelectedCount = $derived(otherEntities.filter((e) => selected[entityKey(e)]).length)

    const countSelectedBuffs = $derived(
        [...recommendedEntities, ...otherEntities].reduce(
            (sum, e) => sum + (selected[entityKey(e)] ? e.buffs.length : 0),
            0
        )
    )

    function isChecked(entity: BuffLibraryEntity) {
        return !!selected[entityKey(entity)]
    }

    function toggle(entity: BuffLibraryEntity) {
        const key = entityKey(entity)
        selected = { ...selected, [key]: !selected[key] }
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
                return `${b.buffName}${zones ? `（${zones}）` : ''}`
            })
            .join(' / ')
    }

    function handleImport() {
        const picked = [...recommendedEntities, ...otherEntities].filter((e) => isChecked(e))
        if (!picked.length) {
            addToast('请先勾选要导入的 Buff 集', 'info')
            return
        }
        // 定位每个实体归属的角色槽位：character 直接用实体名匹配；武器/声骸/套装找配装中该角色（可能多人共用）
        function ownerIdxFor(e: BuffLibraryEntity): number[] {
            if (e.entityType === 'character') {
                const idx = team.findIndex((s) => s?.character === e.entityName)
                return idx >= 0 ? [idx] : []
            }
            const idxs: number[] = []
            team.forEach((s, i) => {
                if (!s) return
                if (s.weapon === e.entityName) return idxs.push(i)
                if (s.echoes?.some((ec) => ec.name === e.entityName)) return idxs.push(i)
                if (s.triggerSets?.some((ts) => ts.name === e.entityName && `${ts.pieces}set` === e.entityType))
                    idxs.push(i)
            })
            return idxs
        }
        function toImportItem(
            b: {
                name: string
                scope?: BuffLibraryScope
                condition?: BuffCondition
                zones: BuffLibraryZone[]
            },
            ownerIdx: number
        ) {
            return {
                name: b.name,
                scope: b.scope,
                ownerIdx,
                ...(b.condition ? { condition: b.condition } : {}),
                zones: b.zones
            }
        }
        const items = picked.flatMap((e) => {
            const owners = ownerIdxFor(e)
            const firstOwner = owners[0] ?? -1
            // 多主人：self（主人专属）buff 按每个主人生成独立条目；其它 scope 单条（引用第一主人）
            if (owners.length > 1) {
                const selfItems = owners.flatMap((owner) =>
                    e.buffs
                        .filter((b) => b.scope === 'self')
                        .map((b) =>
                            toImportItem(
                                { name: b.buffName, scope: b.scope, condition: b.condition, zones: b.zones },
                                owner
                            )
                        )
                )
                const otherItems = e.buffs
                    .filter((b) => b.scope !== 'self')
                    .map((b) =>
                        toImportItem(
                            { name: b.buffName, scope: b.scope, condition: b.condition, zones: b.zones },
                            firstOwner
                        )
                    )
                return [...selfItems, ...otherItems]
            }
            return e.buffs.map((b) =>
                toImportItem({ name: b.buffName, scope: b.scope, condition: b.condition, zones: b.zones }, firstOwner)
            )
        })
        const count = importBuffSets(items, -1, team.length)
        if (count > 0) addToast(`已导入 ${count} 条 buff`, 'success')
        onclose?.()
    }
</script>

<Modal {open} {onclose} class={className} style="max-width: min(92vw, 720px); {mergedStyle}">
    {#snippet title()}
        导入 Buff 集
    {/snippet}

    <p class="mb-3 text-xs text-(--theme-muted-text)">
        勾选对应角色/武器/首位声骸/套装即可全选其全部 Buff。上方为根据当前配装推荐的实体，下方为其它已下载的
    </p>

    <div
        class="mb-3 flex items-center gap-2 rounded-lg border border-(--theme-card-border) bg-(--theme-input-bg) px-3 py-2"
    >
        <Icon icon="mdi:magnify" class="size-4 shrink-0 text-(--theme-muted-text)" />
        <input
            bind:value={query}
            placeholder="搜索实体 / Buff 名…"
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
    </div>

    <div class="space-y-4">
        <div>
            <h3 class="mb-1.5 flex items-center gap-1 text-xs font-medium text-(--theme-accent-text)">
                <Icon icon="mdi:star" class="size-3.5" />
                推荐（匹配当前配装）
            </h3>
            {#if recommendedEntities.length === 0}
                <div
                    class="flex items-center gap-2 rounded-lg border border-(--theme-card-border) bg-(--theme-card-bg) px-3 py-3 text-xs text-(--theme-muted-text)"
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
                class="mb-1.5 flex w-full items-center gap-1 text-xs font-medium text-(--theme-muted-text) transition-colors hover:text-(--theme-modal-text)"
                title="展开 / 收起非推荐实体"
            >
                <Icon icon={showOthers || query ? 'mdi:chevron-down' : 'mdi:chevron-right'} class="size-3.5 shrink-0" />
                <Icon icon="mdi:download" class="size-3.5" />
                已下载 · 其它（{otherEntities.length}）
                {#if otherSelectedCount > 0}
                    <span class="rounded bg-(--theme-accent-bg)/10 px-1.5 py-0.5 text-[10px] text-(--theme-accent-text)"
                        >已选 {otherSelectedCount}</span
                    >
                {/if}
            </button>
            {#if showOthers || query}
                {#if otherEntities.length === 0}
                    <div
                        class="rounded-lg border border-(--theme-card-border) bg-(--theme-card-bg) px-3 py-3 text-xs text-(--theme-muted-text)"
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
        <div class="flex items-center justify-end gap-2 border-t border-(--theme-card-border) pt-3">
            <button
                onclick={onclose}
                class="rounded-lg px-4 py-1.5 text-sm text-(--theme-muted-text) transition-colors hover:bg-(--theme-card-bg-focused)"
            >
                取消
            </button>
            <button
                onclick={handleImport}
                disabled={countSelectedBuffs === 0}
                class="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-all hover:brightness-125 disabled:opacity-40"
                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
            >
                <Icon icon="mdi:import" class="size-4" />
                导入{#if countSelectedBuffs > 0}（{countSelectedBuffs} 条）{/if}
            </button>
        </div>
    {/snippet}
</Modal>

{#snippet CategoryGroup(list: BuffLibraryEntity[])}
    {#each BUFF_CATEGORY_ORDER as cat}
        {@const group = list
            .filter((e) => categoryOfType(e.entityType) === cat)
            .sort((a, b) => setPiecesOf(a.entityType) - setPiecesOf(b.entityType))}
        {#if group.length > 0}
            <div class="mb-2">
                <h4 class="mb-1 px-0.5 text-[10px] font-medium text-(--theme-muted-text)">
                    {BUFF_CATEGORY_LABELS[cat]}（{group.length}）
                </h4>
                <div class="space-y-1.5">
                    {#each group as entity (entityKey(entity))}
                        {@render EntityRow(entity, isChecked(entity))}
                    {/each}
                </div>
            </div>
        {/if}
    {/each}
{/snippet}

{#snippet EntityRow(entity: BuffLibraryEntity, checked: boolean)}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class={[
            'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 transition-colors',
            checked
                ? 'border-(--theme-accent-bg) bg-(--theme-accent-bg)/10'
                : 'border-(--theme-card-border) bg-(--theme-card-bg) hover:bg-(--theme-card-bg-focused)'
        ].join(' ')}
        onclick={() => toggle(entity)}
        title="点击选中"
    >
        <span
            class="mt-0.5 flex size-5 shrink-0 items-center justify-center {checked
                ? 'text-(--theme-accent-text)'
                : 'text-(--theme-muted-text)'}"
        >
            <Icon icon={TYPE_ICONS[categoryOfType(entity.entityType)]} class="size-5" />
        </span>
        <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
                <span class="truncate text-sm font-medium text-(--theme-layout-text)">{entity.entityName}</span>
                <span
                    class="shrink-0 rounded bg-(--theme-accent-bg)/10 px-1.5 py-0.5 text-[10px] text-(--theme-accent-text)"
                >
                    {categoryOfType(entity.entityType) === 'set'
                        ? `${setPiecesOf(entity.entityType)}件`
                        : ENTITY_TYPE_LABELS[entity.entityType]}
                </span>
                <span class="shrink-0 text-[10px] text-(--theme-muted-text)">{entity.buffs.length} 条</span>
            </div>
            <div class="mt-0.5 truncate text-xs text-(--theme-muted-text)" title={buffDetail(entity)}>
                {buffDetail(entity)}
            </div>
        </div>
        {#if checked}
            <Icon icon="mdi:check-circle" class="mt-0.5 size-4 shrink-0 text-(--theme-accent-text)" />
        {/if}
    </div>
{/snippet}
