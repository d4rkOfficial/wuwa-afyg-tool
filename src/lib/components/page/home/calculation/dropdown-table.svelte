<script lang="ts">
    /** @desc 下拉表（拉表默认视图）：每条伤害可点击展开，配置伤害类型/增益勾选/叠层文件夹/复制前后段，支持 Buff 差异模式展示 */
    import { tick } from 'svelte'
    import { slide } from 'svelte/transition'
    import { MOTION_MS, slideParams } from '$lib/utils/motion'
    import { buffLeafName } from '$lib/calc/buff-name'
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
        getPaneEffectSources,
        getBuffTree
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
        buildBuffWaterfall,
        buildEntryBuffDiff,
        findNextDirectEntry,
        findNextEffectEntry,
        findPrevDirectEntry,
        findPrevEffectEntry,
        rangeText,
        visibleBuffSetsOf,
        type BuffDiffItem
    } from './dropdown-table.utils'
    import { ensureCharInfo, ensureEchoSkillText, getCharInfoMap, getEchoSkillText } from '$lib/data/char-info.svelte'
    import { buildEchoDescByEntry } from '$lib/calc/skill-infer'
    import { addToast } from '$lib/data/toast.svelte'
    import { getActiveId } from '$lib/data/project.svelte'
    import { attachSessionScroll } from '$lib/data/view-session'
    import { getShortcutKey, normalizeShortcutEvent } from '$lib/data/shortcuts.svelte'
    import { mergeClass } from '$lib/utils/component-style'
    import { DAMAGE_TYPES } from '$lib/calc/calculation.consts'
    import type { BuffConf, DamageEntry } from '$lib/calc/calculation.types'
    import type { ConditionProfile } from '$lib/calc/compute'
    import type { CharSlot } from '$lib/types/project'
    import type { CalcState } from '$lib/calc/calculation.types'
    import type { FolderIconSpec } from '$lib/calc/buff-tree-state'
    import type { ComponentsProps } from '$lib/types'
    import Icon from '@iconify/svelte'
    import Chip from '$lib/components/ui/chip.svelte'
    import Tag from '$lib/components/ui/tag.svelte'
    import EmptyState from '$lib/components/ui/empty-state.svelte'

    interface Props extends ComponentsProps {
        team: [CharSlot, CharSlot, CharSlot]
        damageEntries: DamageEntry[]
        buffSets: BuffConf[]
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

    /** @desc 视角记忆所属工程：本组件随工程切换重挂载（+page 的 `{#key activeProject.id}`），取挂载时的活动工程即可 */
    const sessionProjectId = getActiveId()
    /** @desc 表格滚动位置（横纵都记）：切页签/切工程再回来时回到原来的视野 */
    $effect(() => {
        const el = calcContainer
        if (!el) return
        return attachSessionScroll(el, sessionProjectId, 'calculation', 'dropdown')
    })

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
    /** @desc buffId → BuffConf 查找索引（替代渲染/差异计算中的线性 find） */
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
    const buffMatches = (bs: BuffConf | undefined, entry: DamageEntry): boolean =>
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
    /** @desc 显式树 → 卡片瀑布（根 / 一级 / 二级；只保留当前条目可见 Buff） */
    let waterfallSections = $derived(
        buildBuffWaterfall(getBuffTree(), buffSets, new Set(visibleBuffSets.map((buff) => buff.id)), team)
    )

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

    /** @desc 文件夹整体勾选/取消（显式树） */
    function handleToggleIds(ids: readonly string[]) {
        if (!expandedEntryId || ids.length === 0) return
        setBuffSetIdsForEntry(expandedEntryId, toggleAllIds([...ids], selectedEntrySetIds))
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
    <table class="w-full border-x border-(--theme-divider-border) text-xs table-fixed sf-radius">
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
                            {#each [...new Set(entryDamageTypeMap[damageEntry.id] ?? [])] as dt (dt)}
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
                                <!-- key 用 setId（而不是 diff.name）：同名的两个 Buff 是完全合法的数据，
                                    用显示名当 key 会抛 each_key_duplicate -->
                                {#each entryBuffDiff[damageEntry.id] ?? [] as diff (diff.setId)}
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
                                <!-- 绑定表去重后再渲染：历史工程/外部导入的数据里可能带重复 id，
                                     重复 key 会让整张下拉表抛 each_key_duplicate（store 侧写入与载入已同步去重，此处兜底） -->
                                {#each [...new Set(entryBuffSetIdMap[damageEntry.id] ?? [])].filter( (sid) => buffMatches(buffById.get(sid), damageEntry) ) as setId (setId)}
                                    {@const buffSet = buffById.get(setId)}
                                    {#if buffSet && !globalBuffSetIds.includes(setId)}
                                        <Chip
                                            variant="plain"
                                            style="background: color-mix(in srgb, var(--theme-accent-bg) 15%, transparent); color: var(--theme-accent-text);"
                                        >
                                            {buffLeafName(buffSet.name)}
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
                                        {#if waterfallSections.length > 0}
                                            <div class="columns-1 gap-3 md:columns-2 2xl:columns-3">
                                                {#each waterfallSections as section (section.key)}
                                                    {@const sectionIds = [
                                                        ...section.buffs.map((b) => b.id),
                                                        ...section.groups.flatMap((g) => g.buffs.map((b) => b.id))
                                                    ]}
                                                    {@const sectionAll =
                                                        sectionIds.length > 0 &&
                                                        sectionIds.every((id) => selectedEntrySetIds.includes(id))}
                                                    <section
                                                        class="mb-3 break-inside-avoid space-y-1.5 rounded border p-2 sf-radius"
                                                        style="border-color: var(--theme-divider-border);"
                                                    >
                                                        {#if section.key === '__ungrouped__'}
                                                            <button
                                                                type="button"
                                                                onclick={(e) => {
                                                                    e.stopPropagation()
                                                                    handleToggleIds(sectionIds)
                                                                }}
                                                                class="flex w-full items-center gap-1.5 rounded-none px-0.5 py-0.5 text-left text-[10px] font-black tracking-[0.12em] text-(--theme-modal-text)/35 transition-colors hover:text-(--theme-accent-text)"
                                                                title={sectionAll ? '全不选本组' : '全选本组'}
                                                            >
                                                                <span class="min-w-0 flex-1 truncate">未归组</span>
                                                                <span class="shrink-0 tabular-nums opacity-70"
                                                                    >{sectionIds.length}</span
                                                                >
                                                                <Icon
                                                                    icon={sectionAll
                                                                        ? 'mdi:checkbox-marked'
                                                                        : 'mdi:checkbox-blank-outline'}
                                                                    class="size-3.5 shrink-0"
                                                                />
                                                            </button>
                                                        {:else}
                                                            <button
                                                                type="button"
                                                                onclick={(e) => {
                                                                    e.stopPropagation()
                                                                    handleToggleIds(sectionIds)
                                                                }}
                                                                class="flex w-full items-center gap-1.5 rounded-none px-0.5 py-0.5 text-left transition-colors hover:text-(--theme-accent-text)"
                                                                title={sectionAll ? '全不选本组' : '全选本组'}
                                                            >
                                                                {@render folderSpecIcon(section.iconSpec)}
                                                                <span
                                                                    class="min-w-0 flex-1 truncate text-xs font-medium text-(--theme-modal-text)/70"
                                                                    >{section.name}</span
                                                                >
                                                                <span
                                                                    class="shrink-0 text-[10px] tabular-nums text-(--theme-modal-text)/30"
                                                                    >{sectionIds.length}</span
                                                                >
                                                                <Icon
                                                                    icon={sectionAll
                                                                        ? 'mdi:checkbox-marked'
                                                                        : 'mdi:checkbox-blank-outline'}
                                                                    class="size-3.5 shrink-0 text-(--theme-modal-text)/35"
                                                                />
                                                            </button>
                                                        {/if}
                                                        {#if section.buffs.length > 0}
                                                            <div
                                                                class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1.5"
                                                            >
                                                                {#each section.buffs as buff (buff.id)}
                                                                    {@render buffCard(buff)}
                                                                {/each}
                                                            </div>
                                                        {/if}
                                                        {#each section.groups as group (group.key)}
                                                            {@const groupAll =
                                                                group.buffs.length > 0 &&
                                                                group.buffs.every((b) =>
                                                                    selectedEntrySetIds.includes(b.id)
                                                                )}
                                                            <div class="ml-2 space-y-1.5">
                                                                <button
                                                                    type="button"
                                                                    onclick={(e) => {
                                                                        e.stopPropagation()
                                                                        handleToggleIds(group.buffs.map((b) => b.id))
                                                                    }}
                                                                    class="flex w-full items-center gap-1.5 rounded-none px-0.5 py-0.5 text-left transition-colors hover:text-(--theme-accent-text)"
                                                                    title={groupAll ? '全不选本组' : '全选本组'}
                                                                >
                                                                    {@render folderSpecIcon(group.iconSpec)}
                                                                    <span
                                                                        class="min-w-0 flex-1 truncate text-[11px] text-(--theme-modal-text)/60"
                                                                        >{group.name}</span
                                                                    >
                                                                    <span
                                                                        class="shrink-0 text-[10px] tabular-nums text-(--theme-modal-text)/30"
                                                                        >{group.buffs.length}</span
                                                                    >
                                                                    <Icon
                                                                        icon={groupAll
                                                                            ? 'mdi:checkbox-marked'
                                                                            : 'mdi:checkbox-blank-outline'}
                                                                        class="size-3.5 shrink-0 text-(--theme-modal-text)/35"
                                                                    />
                                                                </button>
                                                                <div
                                                                    class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1.5"
                                                                >
                                                                    {#each group.buffs as buff (buff.id)}
                                                                        {@render buffCard(buff)}
                                                                    {/each}
                                                                </div>
                                                            </div>
                                                        {/each}
                                                    </section>
                                                {/each}
                                            </div>
                                        {/if}
                                        {#if waterfallSections.length === 0}
                                            <div class="text-xs text-(--theme-modal-text)/30">
                                                无可用 BUFF 块，点击底栏【BUFF配置】按钮进行配置
                                            </div>
                                        {/if}
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

<!-- @desc 文件夹图标（显式树派生）：头像/武器用 mdi 兜底，范围角标并排 -->
{#snippet folderSpecIcon(spec: FolderIconSpec | undefined)}
    {#if spec?.kind === 'character'}
        <Icon icon="mdi:account-outline" class="size-3.5 shrink-0" style="color: var(--theme-accent-text);" />
        {#each spec.chainRanges as range (range.from + '-' + range.to)}
            <span
                class="flex h-3 min-w-3 items-center justify-center rounded-none px-0.5 text-[8px] font-black leading-none"
                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                >{rangeText(range)}</span
            >
        {/each}
    {:else if spec?.kind === 'weapon'}
        <Icon icon="mdi:sword" class="size-3.5 shrink-0" style="color: var(--theme-accent-text);" />
        {#each spec.refineRanges as range (range.from + '-' + range.to)}
            <span
                class="flex h-3 min-w-3 items-center justify-center rounded-none px-0.5 text-[8px] font-black leading-none"
                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                >{rangeText(range)}</span
            >
        {/each}
    {:else if spec?.kind === 'effect'}
        <Icon icon="mdi:auto-fix" class="size-3.5 shrink-0 opacity-60" />
    {:else}
        <Icon icon="mdi:folder" class="size-3.5 shrink-0 opacity-40" />
    {/if}
{/snippet}

{#snippet buffCard(buff: BuffConf)}
    {@const checked = selectedEntrySetIds.includes(buff.id)}
    {@const paneSrc = entryPaneSources[buff.id] !== undefined}
    <button
        type="button"
        onclick={(e) => {
            e.stopPropagation()
            handleToggleBuffSetForEntry(buff.id)
        }}
        class={[
            'flex min-w-0 items-center gap-1.5 rounded-none border px-2 py-1.5 text-left text-xs transition-colors',
            checked ? 'text-(--theme-accent-text)' : 'text-(--theme-modal-text)/55 hover:text-(--theme-modal-text)/80'
        ].join(' ')}
        style={checked
            ? 'background: color-mix(in srgb, var(--theme-accent-bg) 20%, transparent); border-color: color-mix(in srgb, var(--theme-accent-bg) 40%, transparent);'
            : 'background: var(--theme-card-bg); border-color: var(--theme-divider-border);'}
    >
        <Icon icon={checked ? 'mdi:check' : 'mdi:close'} class="size-3 shrink-0" />
        {#if Array.isArray(buff.scope) && buff.scope.length === 0}
            <Icon icon="mdi:auto-fix" class="size-3 shrink-0 opacity-60" />
        {/if}
        <span class="min-w-0 flex-1 truncate">{buffLeafName(buff.name)}</span>
        {#if paneSrc}
            <span class="shrink-0" title={paneSourceTooltip(buff.id)} style="color: var(--theme-accent-text);">
                <Icon icon="mdi:transit-connection-variant" class="size-3" />
            </span>
        {/if}
    </button>
{/snippet}

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
