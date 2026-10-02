<script lang="ts">
    /** @desc 下拉表（拉表默认视图）：每条伤害可点击展开，配置伤害类型/增益勾选/叠层文件夹/复制前后段，支持 Buff 差异模式展示 */
    import { tick } from 'svelte'
    import { slide } from 'svelte/transition'
    import { MOTION_MS, slideParams } from '$lib/utils/motion'
    import {
        getBuffSetIdsForEntry,
        toggleBuffSetForEntry,
        setBuffSetIdsForEntry,
        getCalcState,
        getCalcElementMap,
        getDamageTypesForEntry,
        toggleDamageTypeForEntry,
        setDamageTypesForEntry,
        syncDamageTypesToSameName,
        countSameNameEntries,
        getPaneEffectSources
    } from '$lib/calc/calculation.store.svelte'
    import {
        buildCharToIdx,
        buildDamageTypesByEntry,
        buildInferredDamageTypeMap,
        buffMatchesEntry,
        damageTypeShort,
        entryCharIdx as entryCharIdxOf,
        inferredDamageTypeText,
        isDirectDamage,
        paneSourceText,
        toggleAllIds,
        zoneLabelsOf
    } from './damage-table.utils'
    import {
        buildEntryBuffDiff,
        findNextDirectEntry,
        findNextEffectEntry,
        findPrevDirectEntry,
        findPrevEffectEntry,
        layeredChildLabel,
        visibleBuffSetsOf,
        type BuffDiffItem
    } from './dropdown-table.utils'
    import { ensureCharInfo, ensureEchoSkillText, getCharInfoMap, getEchoSkillText } from '$lib/data/char-info.svelte'
    import { buildEchoDescByEntry } from '$lib/calc/skill-infer'
    import { addToast } from '$lib/data/toast.svelte'
    import { getShortcutKey, normalizeShortcutEvent } from '$lib/data/shortcuts.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import { DAMAGE_TYPES, groupBuffSets } from '$lib/calc/calculation.consts'
    import type { GroupedBuffSetItem } from '$lib/calc/calculation.consts'
    import type { BuffSet, DamageEntry } from '$lib/calc/calculation.types'
    import type { ConditionProfile } from '$lib/calc/compute'
    import type { CharSlot } from '$lib/types/project'
    import type { CalcState } from '$lib/calc/calculation.types'
    import type { ComponentsProps } from '$lib/types'
    import Icon from '@iconify/svelte'
    import Chip from '$lib/components/ui/chip.svelte'
    import Tag from '$lib/components/ui/tag.svelte'
    import EmptyState from '$lib/components/ui/empty-state.svelte'

    interface Props extends ComponentsProps {
        team: [CharSlot, CharSlot, CharSlot]
        damageEntries: DamageEntry[]
        buffSets: BuffSet[]
        entryBuffSetIdMap: Record<string, string[]>
        entryDamageTypeMap: Record<string, string[]>
        globalBuffSetIds: string[]
        conditionProfile: ConditionProfile
        hideConditionMismatch: boolean
        buffDiffMode: boolean
        onupdate: (state: CalcState) => void
    }

    let {
        team,
        damageEntries,
        buffSets,
        entryBuffSetIdMap,
        entryDamageTypeMap,
        globalBuffSetIds,
        conditionProfile,
        hideConditionMismatch,
        buffDiffMode,
        onupdate,
        class: className,
        style: styleProp
    }: Props = $props()

    let expandedEntryId = $state<string | null>(null)
    let calcContainer = $state<HTMLDivElement | undefined>()

    /** @desc 角色元素映射与自动推导伤害类型（未手填时按条目特征推断；规则2需要角色/声骸技能文案，故先补齐数据） */
    let calcElementMap = $derived(getCalcElementMap())
    let charInfoMap = $derived(getCharInfoMap())
    let echoSkillText = $derived(getEchoSkillText())
    let echoDescByEntry = $derived(buildEchoDescByEntry(damageEntries, team, echoSkillText))
    $effect(() => {
        for (const slot of team) {
            if (slot.character) void ensureCharInfo(slot.character)
            const echoName = slot.echoes?.[0]?.name
            if (echoName) void ensureEchoSkillText(echoName)
        }
    })
    let inferredDamageTypeMap = $derived(buildInferredDamageTypeMap(damageEntries, charInfoMap, echoDescByEntry))

    /** @desc 当前展开条目及它的 Buff/伤害类型绑定、角色槽位索引 */
    let selectedEntry = $derived(damageEntries.find((e) => e.id === expandedEntryId) ?? null)
    let selectedEntrySetIds = $derived(expandedEntryId ? getBuffSetIdsForEntry(expandedEntryId) : [])
    let charToIdx = $derived(buildCharToIdx(team))
    let entryCharIdx = $derived(selectedEntry ? entryCharIdxOf(selectedEntry, charToIdx) : -1)
    /** @desc buffId → BuffSet 查找索引（替代渲染/差异计算中的线性 find） */
    let buffById = $derived(new Map(buffSets.map((b) => [b.id, b])))

    /** @desc 条目 → 生效伤害类型：只依赖「条目本身」，与具体 buff 无关（两个视图共用同一口径与同一次记忆） */
    const damageTypesByEntry = $derived(
        buildDamageTypesByEntry(damageEntries, entryDamageTypeMap, charInfoMap, echoDescByEntry)
    )

    /**
     * @desc 条件匹配判定（隐藏开关开启时过滤链/阶低于配置、属性/类型对不上条目的 buff）。
     * 口径在 `damage-table.utils.buffMatchesEntry`：用 `buffContributesToEntry` 而非实例级条件 ——
     * 属性/类型条件挂在**乘区条目**上，只看实例级会让「乘区条件不满足」的 buff 仍可勾选。
     */
    const buffMatches = (bs: BuffSet | undefined, entry: DamageEntry): boolean =>
        buffMatchesEntry(bs, entry, {
            hideConditionMismatch,
            conditionProfile,
            damageTypes: damageTypesByEntry.get(entry.id),
            charIdx: entryCharIdxOf(entry, charToIdx)
        })

    /**
     * @desc 当前条目的「影响源」Buff：作用域指向**被本条目的引用所指向的角色**、且会改写该面板乘区的 Buff。
     * 伤害是当下的 —— 勾上它们就会参与该角色在这一段伤害下的面板计算，所以它们要和普通 Buff 一样
     * 出现在本条目的 BUFF 区里（可勾选），而不是塞进引用配置弹窗。
     */
    const entryPaneSources = $derived.by(() => (selectedEntry ? getPaneEffectSources(selectedEntry.id) : {}))

    /** @desc 影响源提示文案（chips tooltip） */
    const paneSourceTooltip = (buffId: string): string => {
        const src = entryPaneSources[buffId]
        if (!src) return ''
        const charName = team[src.charIdx]?.character ?? `角色${src.charIdx + 1}`
        return paneSourceText(charName, zoneLabelsOf(src.zoneIds), '本段伤害')
    }

    /** @desc 对当前展开条目可见（非全局、作用域匹配或属于跨角色引用影响源、条件满足）的 Buff，并按叠层规则分组 */
    let visibleBuffSets = $derived(
        visibleBuffSetsOf({
            buffSets,
            globalBuffSetIds,
            entryPaneSources,
            selectedEntry,
            entryCharIdx,
            matches: buffMatches
        })
    )
    let groupedVisibleSets = $derived(groupBuffSets(visibleBuffSets))
    let groupedFolderItems = $derived(groupedVisibleSets.filter((g) => g.type === 'folder'))
    let groupedStandaloneItems = $derived(groupedVisibleSets.filter((g) => g.type !== 'folder'))

    /** @desc Buff 差异模式的数据：逐条目对比上一段（同角色直伤 / 同名效应），标出 新增/移除/不变/全局 */
    let entryBuffDiff = $derived(
        buffDiffMode
            ? buildEntryBuffDiff({
                  damageEntries,
                  entryBuffSetIdMap,
                  globalBuffSetIds,
                  buffById,
                  matches: buffMatches
              })
            : ({} as Record<string, BuffDiffItem[]>)
    )

    /** @desc 展开/收起条目（展开后滚动到该行，block: nearest 平滑滚动） */
    function handleToggleExpand(id: string, _index: number) {
        const expanding = expandedEntryId !== id
        expandedEntryId = expanding ? id : null
        if (expanding) {
            tick().then(() => {
                calcContainer
                    ?.querySelector<HTMLElement>(`[data-entry-id="${id}"]`)
                    ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
            })
        }
    }

    /** @desc 切换当前展开条目与某 Buff 的绑定并持久化 */
    function handleToggleBuffSetForEntry(setId: string) {
        if (!expandedEntryId) return
        toggleBuffSetForEntry(expandedEntryId, setId)
        onupdate(getCalcState())
    }

    /** @desc 叠层文件夹整体勾选/取消（子项全选则全部取消，否则全选） */
    function handleToggleFolder(folder: GroupedBuffSetItem) {
        if (!expandedEntryId || !folder.children) return
        const childIds = folder.children.map((c) => c.id)
        setBuffSetIdsForEntry(expandedEntryId, toggleAllIds(childIds, selectedEntrySetIds))
        onupdate(getCalcState())
    }

    /** @desc 叠层文件夹按前缀段批量勾选：前 index+1 个（1层、2层…）全选或全取消 */
    function handleToggleBuffPrefix(folder: GroupedBuffSetItem, index: number) {
        if (!expandedEntryId || !folder.children) return
        const prefixIds = folder.children.slice(0, index + 1).map((c) => c.id)
        setBuffSetIdsForEntry(expandedEntryId, toggleAllIds(prefixIds, selectedEntrySetIds))
        onupdate(getCalcState())
    }

    /** @desc 切换条目伤害类型并持久化 */
    function handleToggleDamageType(entryId: string, damageType: string) {
        toggleDamageTypeForEntry(entryId, damageType)
        onupdate(getCalcState())
    }

    /** @desc 复制当前直伤的伤害类型到同角色下一段直伤（并展开那段） */
    function handleCopyDamageTypeToNext(entryId: string) {
        const entry = damageEntries.find((e) => e.id === entryId)
        if (!entry || !entry.character) return
        const entryIndex = damageEntries.findIndex((e) => e.id === entryId)
        if (entryIndex < 0) return
        const currentTypes = getDamageTypesForEntry(entryId)
        const next = findNextDirectEntry(damageEntries, entryIndex, entry.character)
        if (next) {
            setDamageTypesForEntry(next.id, [...currentTypes])
            onupdate(getCalcState())
            expandedEntryId = next.id
            addToast('已复制伤害类型到下一段直伤', 'success')
            return
        }
        addToast('已经是本角色最后一段直伤', 'info')
    }

    /** @desc 把本条伤害类型同步到所有同名伤害（同一角色 + 同一技能类型 + 同名） */
    function handleSyncDamageTypeToSameName(entryId: string) {
        const entry = damageEntries.find((e) => e.id === entryId)
        const types = getDamageTypesForEntry(entryId)
        const count = syncDamageTypesToSameName(entryId)
        if (count <= 1) {
            addToast('没有其它同名伤害（同名范围：同一角色 + 同一技能类型）', 'info')
            return
        }
        onupdate(getCalcState())
        addToast(
            types.length === 0
                ? `已清空 ${count} 条同名伤害的手动设置（回到自动推导）`
                : `已把「${entry?.displayName ?? '本条'}」的伤害类型同步到 ${count} 条同名伤害`,
            'success'
        )
    }

    /** @desc 从同角色上一段直伤复制增益 */
    function handleCopyFromPrevDirect(entryId: string) {
        const entry = damageEntries.find((e) => e.id === entryId)
        if (!entry || !entry.character) return

        const entryIndex = damageEntries.findIndex((e) => e.id === entryId)
        if (entryIndex <= 0) {
            addToast('未找到本角色的上一个直伤', 'info')
            return
        }

        const prev = findPrevDirectEntry(damageEntries, entryIndex, entry.character)
        if (prev) {
            const prevSetIds = getBuffSetIdsForEntry(prev.id)
            if (!setBuffSetIdsForEntry(entryId, prevSetIds)) return
            onupdate(getCalcState())
            addToast('已复制前段直伤的增益', 'success')
            return
        }

        addToast('未找到本角色的上一个直伤', 'info')
    }

    /** @desc 复制当前直伤的增益到同角色下一段直伤（并展开那段） */
    function handleCopyToNextDirect(entryId: string) {
        const entry = damageEntries.find((e) => e.id === entryId)
        if (!entry || !entry.character) return

        const entryIndex = damageEntries.findIndex((e) => e.id === entryId)
        const currentSetIds = getBuffSetIdsForEntry(entryId)
        const next = findNextDirectEntry(damageEntries, entryIndex, entry.character)
        if (next) {
            if (!setBuffSetIdsForEntry(next.id, [...currentSetIds])) return
            onupdate(getCalcState())
            expandedEntryId = next.id
            addToast('已复制增益到下一段直伤', 'success')
            return
        }

        expandedEntryId = null
        addToast('已经是本角色最后一段直伤', 'info')
    }

    /** @desc 从上一个同名效应复制增益 */
    function handleCopyFromPrevEffect(entryId: string) {
        const entry = damageEntries.find((e) => e.id === entryId)
        if (!entry || !entry.isEffect) return

        const entryIndex = damageEntries.findIndex((e) => e.id === entryId)
        if (entryIndex <= 0) {
            addToast('未找到上一个同名效应', 'info')
            return
        }

        const prev = findPrevEffectEntry(damageEntries, entryIndex, entry.hitName)
        if (prev) {
            const prevSetIds = getBuffSetIdsForEntry(prev.id)
            if (!setBuffSetIdsForEntry(entryId, prevSetIds)) return
            onupdate(getCalcState())
            addToast('已复制前段效应的增益', 'success')
            return
        }

        addToast('未找到上一个同名效应', 'info')
    }

    /** @desc 复制当前效应的增益到下一个同名效应（并展开那段） */
    function handleCopyToNextEffect(entryId: string) {
        const entry = damageEntries.find((e) => e.id === entryId)
        if (!entry || !entry.isEffect) return

        const entryIndex = damageEntries.findIndex((e) => e.id === entryId)
        const currentSetIds = getBuffSetIdsForEntry(entryId)
        const next = findNextEffectEntry(damageEntries, entryIndex, entry.hitName)
        if (next) {
            if (!setBuffSetIdsForEntry(next.id, [...currentSetIds])) return
            onupdate(getCalcState())
            expandedEntryId = next.id
            addToast('已复制增益到下一段效应', 'success')
            return
        }

        expandedEntryId = null
        addToast('已经是本效应最后一次伤害结算', 'info')
    }

    /** @desc 清空当前条目的全部 Buff 绑定 */
    function handleClearAllBuffs(entryId: string) {
        if (!setBuffSetIdsForEntry(entryId, [])) return
        onupdate(getCalcState())
    }
</script>

<!-- @desc 全局快捷键：展开下一条 / 复制伤害类型到下段直伤 / 复制前段/后段直伤 / 清除所有增益（输入框/按钮内不拦截） -->
<svelte:window
    onkeydown={(e) => {
        const el = e.target as HTMLElement
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON') return
        const norm = normalizeShortcutEvent(e)
        if (norm === getShortcutKey('calc-dropdown.expand-next') && expandedEntryId !== null) {
            e.preventDefault()
            const idx = damageEntries.findIndex((de) => de.id === expandedEntryId)
            if (idx >= 0) {
                const nextIdx = idx + 1 < damageEntries.length ? idx + 1 : 0
                handleToggleExpand(damageEntries[nextIdx].id, nextIdx)
            }
        }
        if (norm === getShortcutKey('calc-dropdown.copy-dt-next') && expandedEntryId !== null) {
            e.preventDefault()
            handleCopyDamageTypeToNext(expandedEntryId)
        }
        if (norm === getShortcutKey('calc-dropdown.copy-from-prev') && expandedEntryId !== null) {
            e.preventDefault()
            handleCopyFromPrevDirect(expandedEntryId)
        }
        if (norm === getShortcutKey('calc-dropdown.copy-to-next') && expandedEntryId !== null) {
            e.preventDefault()
            handleCopyToNextDirect(expandedEntryId)
        }
        if (norm === getShortcutKey('calc-dropdown.clear-all') && expandedEntryId !== null) {
            e.preventDefault()
            handleClearAllBuffs(expandedEntryId)
        }
    }}
/>

<!-- @desc 表格容器：Ctrl+滚轮横向滚动；外层是「主内容区」表面，行/表头由「卡片」表面提供底色 -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    data-sf="content"
    class="theme-scrollbar h-full overflow-auto pb-48 {className}"
    style={styleProp}
    bind:this={calcContainer}
    onwheel={(e) => {
        if (e.ctrlKey) {
            e.preventDefault()
            ;(e.currentTarget as HTMLElement).scrollLeft += e.deltaY
        }
    }}
>
    <table class="w-full text-xs table-fixed">
        <!-- 表头：来源 / 条目 / 视为（伤害类型） / Buff 四列，吸顶毛玻璃 -->
        <thead>
            <tr
                data-sf="card"
                class="text-(--theme-modal-text)/50 sticky top-0 opacity-100!"
                style="--sf-base: var(--theme-modal-bg); border-top: 1px solid var(--theme-divider-border); border-bottom: 1px solid var(--theme-divider-border);"
            >
                <th
                    class="text-left font-black tracking-[0.12em] py-2 px-3 w-20 shrink-0 border-r"
                    style="border-color: var(--theme-divider-border);">来源</th
                >
                <th
                    class="text-left font-black tracking-[0.12em] py-2 px-3 w-56 shrink-0 border-r"
                    style="border-color: var(--theme-divider-border);">条目</th
                >
                <th
                    class="text-left font-black tracking-[0.12em] py-2 px-3 w-32 shrink-0 border-r"
                    style="border-color: var(--theme-divider-border);">视为</th
                >
                <th class="text-left font-black tracking-[0.12em] py-2 px-3">Buff</th>
            </tr>
        </thead>
        <!-- 表体：每行一个伤害条目（点击展开编辑）；展开行内嵌增益配置面板。
             行底色由「卡片」表面提供（可与表头分别调透明度/毛玻璃/深度） -->
        <tbody data-sf="card" style="--sf-base: var(--theme-modal-bg);">
            {#each damageEntries as damageEntry, i (damageEntry.id)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <tr
                    onclick={() => handleToggleExpand(damageEntry.id, i)}
                    data-press="row"
                    data-entry-id={damageEntry.id}
                    class={[
                        'cursor-pointer border-b transition-colors',
                        expandedEntryId === damageEntry.id ? '' : 'hover:bg-(--theme-modal-text)/5',
                        expandedEntryId !== null && expandedEntryId !== damageEntry.id ? 'opacity-40' : ''
                    ].join(' ')}
                    style={'content-visibility: auto; contain-intrinsic-size: 30px;' +
                        'border-color: var(--theme-divider-border);' +
                        (expandedEntryId === damageEntry.id
                            ? 'background: color-mix(in srgb, var(--theme-accent-bg) 10%, transparent);'
                            : '')}
                >
                    <!-- 来源列：角色名（按元素着色） -->
                    <td
                        class="py-1.5 px-3 w-20 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap border-r"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <span style="color: var(--theme-element-{calcElementMap[damageEntry.character ?? '']}, #888)">
                            {damageEntry.character ?? '—'}
                        </span>
                    </td>
                    <!-- 条目列：伤害名（按伤害元素着色），超宽省略 + title 完整名 -->
                    <td
                        class="py-1.5 px-3 w-56 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap border-r"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <span
                            style="color: var(--theme-element-{damageEntry.damageElement}, #888)"
                            title={damageEntry.displayName}
                        >
                            {damageEntry.displayName}
                        </span>
                    </td>
                    <!-- 视为列：已选伤害类型标签；未选时显示自动推导结果 -->
                    <td
                        class="py-1.5 px-3 w-32 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap border-r"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <div class="flex flex-wrap gap-0.5">
                            {#each entryDamageTypeMap[damageEntry.id] ?? [] as dt (dt)}
                                <Tag style="background: var(--theme-input-bg);">{damageTypeShort(dt)}</Tag>
                            {:else}
                                {@const inferred = inferredDamageTypeMap[damageEntry.id] ?? []}
                                {#if inferred.length > 0}
                                    <span class="text-[10px] leading-tight text-(--theme-modal-text)/35"
                                        >{inferredDamageTypeText(inferred)}</span
                                    >
                                {/if}
                            {/each}
                        </div>
                    </td>
                    <!-- Buff 列：差异模式显示 新增(绿+)/移除(红-)/不变/全局(黄皇冠)；普通模式显示已绑定且条件匹配的 buff 标签 -->
                    <td class="py-1.5 px-3">
                        <div class="flex flex-wrap gap-1">
                            {#if buffDiffMode}
                                {#each entryBuffDiff[damageEntry.id] ?? [] as diff (diff.name)}
                                    {#if diff.type === 'global'}
                                        <Chip
                                            style="background: var(--theme-buff-yellow-bg); color: var(--theme-buff-yellow-text);"
                                        >
                                            <Icon icon="mdi:crown" class="size-3" />{diff.name}
                                        </Chip>
                                    {:else if diff.type === 'added'}
                                        <Chip
                                            style="background: var(--theme-buff-green-bg); color: var(--theme-buff-green-text);"
                                        >
                                            <Icon icon="mdi:plus" class="size-3" />{diff.name}
                                        </Chip>
                                    {:else if diff.type === 'removed'}
                                        <Chip class="bg-red-500/15 text-red-500">
                                            <Icon icon="mdi:minus" class="size-3" />{diff.name}
                                        </Chip>
                                    {:else}
                                        <Chip
                                            variant="plain"
                                            style="background: color-mix(in srgb, var(--theme-accent-bg) 15%, transparent); color: var(--theme-accent-text);"
                                        >
                                            {diff.name}
                                        </Chip>
                                    {/if}
                                {/each}
                            {:else}
                                {#each (entryBuffSetIdMap[damageEntry.id] ?? []).filter( (sid) => buffMatches(buffById.get(sid), damageEntry) ) as setId (setId)}
                                    {@const buffSet = buffById.get(setId)}
                                    {#if buffSet && !globalBuffSetIds.includes(setId)}
                                        <Chip
                                            variant="plain"
                                            style="background: color-mix(in srgb, var(--theme-accent-bg) 15%, transparent); color: var(--theme-accent-text);"
                                        >
                                            {buffSet.name}
                                        </Chip>
                                    {/if}
                                {/each}
                            {/if}
                        </div>
                    </td>
                </tr>
                <!-- 展开面板：伤害类型编辑（直伤）+ 增益选择（复制前段/下段、清除、下一条、叠层文件夹、独立 buff 按钮） -->
                {#if expandedEntryId === damageEntry.id}
                    <tr style="background: var(--theme-input-bg);">
                        <td colspan="4" class="p-0">
                            <div
                                transition:slide|local={slideParams(MOTION_MS.base)}
                                class="border-b px-6 py-3 space-y-3"
                                style="border-color: var(--theme-divider-border);"
                            >
                                {#if !damageEntry.isEffect && !damageEntry.isTuneBreak && !damageEntry.isTuneResponse}
                                    <div>
                                        {@render panelSectionHead('mdi:swap-horizontal-bold', '伤害类型')}
                                        {#if isDirectDamage(damageEntry) && damageEntry.character}
                                            <div class="mb-1.5 flex flex-wrap gap-1.5">
                                                {@render copyButton(
                                                    'mdi:content-paste',
                                                    '复制到下段直伤',
                                                    'Shift+Enter',
                                                    () => handleCopyDamageTypeToNext(damageEntry.id)
                                                )}
                                                {@render copyButton(
                                                    'mdi:sync',
                                                    `同步伤害类型到所有同名伤害${
                                                        countSameNameEntries(damageEntry.id) > 1
                                                            ? `（${countSameNameEntries(damageEntry.id)}）`
                                                            : ''
                                                    }`,
                                                    '把本条的伤害类型同步到所有同名伤害（同一角色 + 同一技能类型）',
                                                    () => handleSyncDamageTypeToSameName(damageEntry.id),
                                                    countSameNameEntries(damageEntry.id) <= 1,
                                                    'disabled:opacity-40'
                                                )}
                                            </div>
                                        {/if}
                                        <div class="flex flex-wrap gap-1">
                                            {#each DAMAGE_TYPES as dt (dt)}
                                                {@const selected = (entryDamageTypeMap[damageEntry.id] ?? []).includes(
                                                    dt
                                                )}
                                                <!-- svelte-ignore a11y_click_events_have_key_events -->
                                                <!-- svelte-ignore a11y_no_static_element_interactions -->
                                                <button
                                                    onclick={(e) => {
                                                        e.stopPropagation()
                                                        handleToggleDamageType(damageEntry.id, dt)
                                                    }}
                                                    title={dt}
                                                    class={[
                                                        'px-2 py-1 text-xs rounded-none transition-colors border',
                                                        selected
                                                            ? ''
                                                            : 'text-(--theme-modal-text)/50 hover:bg-(--theme-modal-text)/10'
                                                    ].join(' ')}
                                                    style={selected
                                                        ? 'background: color-mix(in srgb, var(--theme-accent-bg) 20%, transparent); color: var(--theme-accent-text); border-color: color-mix(in srgb, var(--theme-accent-bg) 40%, transparent);'
                                                        : 'background: var(--theme-card-bg); border-color: var(--theme-divider-border);'}
                                                >
                                                    {damageTypeShort(dt)}
                                                </button>
                                            {/each}
                                        </div>
                                    </div>
                                {/if}
                                <div>
                                    {@render panelSectionHead('mdi:layers-triple-outline', '增益选择')}
                                    {#if visibleBuffSets.length > 0}
                                        <div
                                            class="flex flex-wrap items-center gap-1 pb-2 border-b mb-2"
                                            style="border-color: var(--theme-divider-border);"
                                        >
                                            {#if isDirectDamage(damageEntry)}
                                                {@render copyButton('mdi:content-copy', '复制前段直伤', 'Shift+Z', () =>
                                                    handleCopyFromPrevDirect(damageEntry.id)
                                                )}
                                                {@render copyButton(
                                                    'mdi:content-paste',
                                                    '复制到下段直伤',
                                                    'Shift+X',
                                                    () => handleCopyToNextDirect(damageEntry.id)
                                                )}
                                            {:else if damageEntry.isEffect}
                                                {@render copyButton('mdi:content-copy', '复制前段效应', undefined, () =>
                                                    handleCopyFromPrevEffect(damageEntry.id)
                                                )}
                                                {@render copyButton(
                                                    'mdi:content-paste',
                                                    '复制到下段效应',
                                                    undefined,
                                                    () => handleCopyToNextEffect(damageEntry.id)
                                                )}
                                            {/if}
                                            {@render copyButton(
                                                'mdi:close-circle-outline',
                                                '清除所有增益',
                                                'Shift+C',
                                                () => handleClearAllBuffs(damageEntry.id),
                                                selectedEntrySetIds.length === 0,
                                                'disabled:opacity-40 disabled:pointer-events-none',
                                                'hover:border-red-500/50 hover:text-red-500'
                                            )}
                                            <div class="flex-1"></div>
                                            <button
                                                onclick={(e) => {
                                                    e.stopPropagation()
                                                    const nextIdx = i + 1 < damageEntries.length ? i + 1 : 0
                                                    handleToggleExpand(damageEntries[nextIdx].id, nextIdx)
                                                }}
                                                title="Space"
                                                class="inline-flex items-center gap-1 rounded-none border px-2 py-1 text-[10px] font-medium transition-all hover:brightness-110"
                                                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff); border-color: var(--theme-divider-border);"
                                            >
                                                <Icon icon="mdi:arrow-down" class="size-3 shrink-0" />
                                                下一条
                                            </button>
                                        </div>
                                        {#if groupedFolderItems.length > 0}
                                            <div class="flex flex-wrap gap-1 mb-2">
                                                {#each groupedFolderItems as item (item.key)}
                                                    {@const folderActive = item.children!.some((c) =>
                                                        selectedEntrySetIds.includes(c.id)
                                                    )}
                                                    <div
                                                        class="flex flex-wrap items-center gap-1 rounded-none border px-2 py-1 text-xs transition-colors"
                                                        style={folderActive
                                                            ? 'background: color-mix(in srgb, var(--theme-accent-bg) 15%, transparent); border-color: color-mix(in srgb, var(--theme-accent-bg) 40%, transparent);'
                                                            : 'background: var(--theme-card-bg); border-color: var(--theme-divider-border);'}
                                                    >
                                                        <button
                                                            onclick={(e) => {
                                                                e.stopPropagation()
                                                                handleToggleFolder(item)
                                                            }}
                                                            class="shrink-0 transition-colors"
                                                            class:text-(--theme-accent-text)={item.children!.some((c) =>
                                                                selectedEntrySetIds.includes(c.id)
                                                            )}
                                                        >
                                                            <Icon
                                                                icon={item.children!.some((c) =>
                                                                    selectedEntrySetIds.includes(c.id)
                                                                )
                                                                    ? 'mdi:check'
                                                                    : 'mdi:close'}
                                                                class="size-3"
                                                            />
                                                        </button>
                                                        <span class="text-(--theme-modal-text)/70 whitespace-nowrap"
                                                            >{item.prefixText}</span
                                                        >
                                                        <div class="flex flex-wrap gap-0.5">
                                                            {#each item.children! as child, ci (child.id)}
                                                                {@const childChecked = selectedEntrySetIds.includes(
                                                                    child.id
                                                                )}
                                                                <button
                                                                    onclick={(e) => {
                                                                        e.stopPropagation()
                                                                        if (e.ctrlKey || e.metaKey) {
                                                                            handleToggleBuffPrefix(item, ci)
                                                                        } else {
                                                                            handleToggleBuffSetForEntry(child.id)
                                                                        }
                                                                    }}
                                                                    class={[
                                                                        'rounded-none px-2 py-1 text-[10px] font-medium tabular-nums transition-colors min-w-[1.2em] text-center',
                                                                        childChecked
                                                                            ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/30'
                                                                            : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70 hover:bg-(--theme-accent-bg)/10'
                                                                    ].join(' ')}
                                                                >
                                                                    {layeredChildLabel(child.name)}
                                                                    {#if entryPaneSources[child.id] !== undefined}
                                                                        <!-- @desc 影响源（叠层子项） -->
                                                                        <span
                                                                            class="ml-0.5 inline-flex shrink-0 align-middle"
                                                                            title={paneSourceTooltip(child.id)}
                                                                            style="color: var(--theme-accent-text);"
                                                                        >
                                                                            <Icon
                                                                                icon="mdi:transit-connection-variant"
                                                                                class="size-2.5"
                                                                            />
                                                                        </span>
                                                                    {/if}
                                                                </button>
                                                            {/each}
                                                        </div>
                                                    </div>
                                                {/each}
                                            </div>
                                        {/if}
                                        {#if groupedStandaloneItems.length > 0}
                                            <div class="flex flex-wrap gap-1">
                                                {#each groupedStandaloneItems as item (item.key)}
                                                    {@const checked = selectedEntrySetIds.includes(item.buffSet!.id)}
                                                    {@const paneSrc = entryPaneSources[item.buffSet!.id] !== undefined}
                                                    <button
                                                        onclick={(e) => {
                                                            e.stopPropagation()
                                                            handleToggleBuffSetForEntry(item.buffSet!.id)
                                                        }}
                                                        class={[
                                                            'px-2 py-1 text-xs rounded-none transition-colors inline-flex items-center gap-1 border',
                                                            checked
                                                                ? ''
                                                                : 'text-(--theme-modal-text)/50 hover:bg-(--theme-modal-text)/10'
                                                        ].join(' ')}
                                                        style={checked
                                                            ? 'background: color-mix(in srgb, var(--theme-accent-bg) 20%, transparent); color: var(--theme-accent-text); border-color: color-mix(in srgb, var(--theme-accent-bg) 40%, transparent);'
                                                            : 'background: var(--theme-card-bg); border-color: var(--theme-divider-border);'}
                                                    >
                                                        <Icon
                                                            icon={checked ? 'mdi:check' : 'mdi:close'}
                                                            class="size-3 shrink-0"
                                                        />
                                                        {item.buffSet!.name}
                                                        {#if paneSrc}
                                                            <!-- @desc 影响源：作用于本段引用到的角色面板，勾上即参与该角色在这一段的面板 -->
                                                            <span
                                                                class="shrink-0"
                                                                title={paneSourceTooltip(item.buffSet!.id)}
                                                                style="color: var(--theme-accent-text);"
                                                            >
                                                                <Icon
                                                                    icon="mdi:transit-connection-variant"
                                                                    class="size-3"
                                                                />
                                                            </span>
                                                        {/if}
                                                    </button>
                                                {/each}
                                            </div>
                                        {/if}
                                    {:else}
                                        <div class="text-xs text-(--theme-modal-text)/30">
                                            无可用 BUFF 块，点击底栏【BUFF配置】按钮进行配置
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        </td>
                    </tr>
                {/if}
            {/each}
        </tbody>
    </table>
    <!-- @desc 无条目时的占位提示 -->
    {#if damageEntries.length === 0}
        <EmptyState size="lg" class="flex items-center justify-center">暂无伤害数据</EmptyState>
    {/if}
</div>

<!-- @desc 展开面板的区块标题（伤害类型 / 增益选择）：同一壳在两处复用 -->
{#snippet panelSectionHead(icon: string, label: string)}
    <div class="flex items-center gap-1.5 text-[10px] font-black tracking-[0.12em] text-(--theme-modal-text)/40 mb-1.5">
        <Icon {icon} class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
        {label}
    </div>
{/snippet}

<!-- @desc 增益/伤害类型的复制·清除按钮：同一壳共 7 处（差异只有图标·文案·快捷键提示·禁用态·强调色类） -->
{#snippet copyButton(
    icon: string,
    label: string,
    title: string | undefined,
    run: () => void,
    disabled = false,
    extraClass = '',
    hoverClass = 'hover:border-(--theme-accent-bg) hover:text-(--theme-modal-text)'
)}
    <button
        onclick={(e) => {
            e.stopPropagation()
            run()
        }}
        {title}
        {disabled}
        class={mergeClass([
            'inline-flex items-center gap-1 rounded-none border px-2 py-1 text-[10px] text-(--theme-modal-text)/60 transition-colors',
            // hover 强调色分两档：默认跟随主题强调色；「清除所有增益」用红色（与 hover 属性同名，故必须二选一而不是叠加，
            // 否则两条 hover:border/color 工具类会同时存在，谁生效取决于生成样式表里的顺序）
            hoverClass,
            extraClass
        ])}
        style="border-color: var(--theme-divider-border);"
    >
        <Icon {icon} class="size-3 shrink-0" />
        {label}
    </button>
{/snippet}
