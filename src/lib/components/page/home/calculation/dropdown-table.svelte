<script lang="ts">
    /** @desc 下拉表（拉表默认视图）：每条伤害可点击展开，配置伤害类型/增益勾选/叠层文件夹/复制前后段，支持 Buff 差异模式展示 */
    import { tick } from 'svelte'
    import { slide } from 'svelte/transition'
    import {
        getBuffSetIdsForEntry,
        toggleBuffSetForEntry,
        setBuffSetIdsForEntry,
        getCalcState,
        getCalcElementMap,
        getDamageTypesForEntry,
        toggleDamageTypeForEntry,
        setDamageTypesForEntry
    } from '$lib/calc/calculation.store.svelte'
    import { inferDamageTypes } from '$lib/calc/utils'
    import { conditionMet } from '$lib/calc/compute'
    import { addToast } from '$lib/data/toast.svelte'
    import { getShortcutKey, normalizeShortcutEvent } from '$lib/data/shortcuts.svelte'
    import { DAMAGE_TYPES, DAMAGE_TYPE_SHORT, groupBuffSets, LAYERED_BUFF_PATTERN } from '$lib/calc/calculation.consts'
    import type { GroupedBuffSetItem } from '$lib/calc/calculation.consts'
    import type { BuffSet, DamageEntry } from '$lib/calc/calculation.types'
    import type { ConditionProfile } from '$lib/calc/compute'
    import type { CharSlot } from '$lib/types/project'
    import type { CalcState } from '$lib/calc/calculation.types'
    import type { ComponentsProps } from '$lib/types'
    import Icon from '@iconify/svelte'

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

    /** @desc 角色元素映射与自动推导伤害类型（未手填时按条目特征推断） */
    let calcElementMap = $derived(getCalcElementMap())
    let inferredDamageTypeMap = $derived<Record<string, string[]>>(
        Object.fromEntries(damageEntries.map((e) => [e.id, inferDamageTypes(e)]))
    )

    /** @desc 当前展开条目及它的 Buff/伤害类型绑定、角色槽位索引 */
    let selectedEntry = $derived(damageEntries.find((e) => e.id === expandedEntryId) ?? null)
    let selectedEntrySetIds = $derived(expandedEntryId ? getBuffSetIdsForEntry(expandedEntryId) : [])
    let charToIdx = $derived<Record<string, number>>(
        Object.fromEntries(team.map((s, i) => [s.character ?? '', i]).filter(([name]) => name !== ''))
    )
    let entryCharIdx = $derived(selectedEntry?.character ? (charToIdx[selectedEntry.character] ?? -1) : -1)
    /** @desc buffId → BuffSet 查找索引（替代渲染/差异计算中的线性 find） */
    let buffById = $derived(new Map(buffSets.map((b) => [b.id, b])))

    /** @desc 条件匹配判定（隐藏开关开启时过滤链/阶低于配置、属性/类型对不上条目的 buff） */
    const buffMatches = (bs: BuffSet | undefined, entry: DamageEntry): boolean => {
        if (!bs) return false
        if (!hideConditionMismatch) return true
        const charIdx = entry.character ? (charToIdx[entry.character] ?? -1) : -1
        return conditionMet(bs, conditionProfile, charIdx, entry, entryDamageTypeMap)
    }

    /** @desc 对当前展开条目可见（非全局、作用域匹配、条件满足）的 Buff，并按叠层规则分组 */
    let visibleBuffSets = $derived(
        buffSets.filter((b) => {
            if (globalBuffSetIds.includes(b.id)) return false
            const scopeOk = selectedEntry?.isEffect
                ? b.scope === 'all' || (Array.isArray(b.scope) && b.scope.length === 0)
                : entryCharIdx >= 0 && (b.scope === 'all' || (b.scope as number[]).includes(entryCharIdx))
            if (!scopeOk) return false
            if (selectedEntry && !buffMatches(b, selectedEntry)) return false
            return true
        })
    )
    let groupedVisibleSets = $derived(groupBuffSets(visibleBuffSets))
    let groupedFolderItems = $derived(groupedVisibleSets.filter((g) => g.type === 'folder'))
    let groupedStandaloneItems = $derived(groupedVisibleSets.filter((g) => g.type !== 'folder'))

    interface BuffDiffItem {
        setId: string
        name: string
        type: 'added' | 'removed' | 'same' | 'global'
    }

    /** @desc Buff 差异模式的数据：逐条目对比上一段（同角色直伤 / 同名效应），标出 新增/移除/不变/全局 */
    let entryBuffDiff = $derived.by(() => {
        if (!buffDiffMode) return {} as Record<string, BuffDiffItem[]>

        const result: Record<string, BuffDiffItem[]> = {}
        for (let i = 0; i < damageEntries.length; i++) {
            const e = damageEntries[i]

            const match = (sid: string) => buffMatches(buffById.get(sid), e)

            const globalItems = (entryBuffSetIdMap[e.id] ?? [])
                .filter((sid) => globalBuffSetIds.includes(sid) && match(sid))
                .map((sid) => ({
                    setId: sid,
                    name: buffById.get(sid)?.name ?? '',
                    type: 'global' as const
                }))

            const isFirstCharEntry = e.character
                ? !damageEntries.slice(0, i).some((p) => p.character === e.character)
                : true

            if (e.isTuneBreak || e.isTuneResponse) {
                result[e.id] = [
                    ...(isFirstCharEntry ? globalItems : []),
                    ...(entryBuffSetIdMap[e.id] ?? [])
                        .filter((sid) => !globalBuffSetIds.includes(sid) && match(sid))
                        .map((sid) => ({
                            setId: sid,
                            name: buffById.get(sid)?.name ?? '',
                            type: 'same' as const
                        }))
                ]
                continue
            }

            let prevId: string | null = null
            if (e.isEffect) {
                for (let j = i - 1; j >= 0; j--) {
                    const p = damageEntries[j]
                    if (p.isEffect && p.hitName === e.hitName) {
                        prevId = p.id
                        break
                    }
                }
            } else {
                for (let j = i - 1; j >= 0; j--) {
                    const p = damageEntries[j]
                    if (!p.isEffect && !p.isTuneBreak && !p.isTuneResponse && p.character === e.character) {
                        prevId = p.id
                        break
                    }
                }
            }

            if (!prevId) {
                result[e.id] = [
                    ...(isFirstCharEntry ? globalItems : []),
                    ...(entryBuffSetIdMap[e.id] ?? [])
                        .filter((sid) => !globalBuffSetIds.includes(sid) && match(sid))
                        .map((sid) => ({
                            setId: sid,
                            name: buffById.get(sid)?.name ?? '',
                            type: 'added' as const
                        }))
                ]
                continue
            }

            const curr = new Set(entryBuffSetIdMap[e.id] ?? [])
            const prev = new Set(entryBuffSetIdMap[prevId] ?? [])
            const items: BuffDiffItem[] = []
            for (const id of curr)
                if (!prev.has(id) && match(id))
                    items.push({ setId: id, name: buffById.get(id)?.name ?? '', type: 'added' })
            for (const id of prev)
                if (!curr.has(id) && match(id))
                    items.push({ setId: id, name: buffById.get(id)?.name ?? '', type: 'removed' })
            result[e.id] = items
        }
        return result
    })

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
        const allSelected = childIds.every((id) => selectedEntrySetIds.includes(id))
        const currentSet = new Set(selectedEntrySetIds)
        if (allSelected) {
            for (const id of childIds) currentSet.delete(id)
        } else {
            for (const id of childIds) currentSet.add(id)
        }
        setBuffSetIdsForEntry(expandedEntryId, [...currentSet])
        onupdate(getCalcState())
    }

    /** @desc 叠层文件夹按前缀段批量勾选：前 index+1 个（1层、2层…）全选或全取消 */
    function handleToggleBuffPrefix(folder: GroupedBuffSetItem, index: number) {
        if (!expandedEntryId || !folder.children) return
        const prefixIds = folder.children.slice(0, index + 1).map((c) => c.id)
        const allSelected = prefixIds.every((id) => selectedEntrySetIds.includes(id))
        const currentSet = new Set(selectedEntrySetIds)
        if (allSelected) {
            for (const id of prefixIds) currentSet.delete(id)
        } else {
            for (const id of prefixIds) currentSet.add(id)
        }
        setBuffSetIdsForEntry(expandedEntryId, [...currentSet])
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
        const char = entry.character
        const currentTypes = getDamageTypesForEntry(entryId)
        for (let i = entryIndex + 1; i < damageEntries.length; i++) {
            const next = damageEntries[i]
            if (next.character === char && isDirectDamage(next)) {
                setDamageTypesForEntry(next.id, [...currentTypes])
                onupdate(getCalcState())
                expandedEntryId = next.id
                addToast('已复制伤害类型到下一段直伤', 'success')
                return
            }
        }
        addToast('已经是本角色最后一段直伤', 'info')
    }

    /** @desc 是否为直伤条目（非效应/非处决/非响应） */
    function isDirectDamage(e: { isEffect: boolean; isTuneBreak: boolean; isTuneResponse: boolean }): boolean {
        return !e.isEffect && !e.isTuneBreak && !e.isTuneResponse
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

        for (let i = entryIndex - 1; i >= 0; i--) {
            const prev = damageEntries[i]
            if (prev.character === entry.character && isDirectDamage(prev)) {
                const prevSetIds = getBuffSetIdsForEntry(prev.id)
                if (!setBuffSetIdsForEntry(entryId, prevSetIds)) return
                onupdate(getCalcState())
                addToast('已复制前段直伤的增益', 'success')
                return
            }
        }

        addToast('未找到本角色的上一个直伤', 'info')
    }

    /** @desc 复制当前直伤的增益到同角色下一段直伤（并展开那段） */
    function handleCopyToNextDirect(entryId: string) {
        const entry = damageEntries.find((e) => e.id === entryId)
        if (!entry || !entry.character) return

        const entryIndex = damageEntries.findIndex((e) => e.id === entryId)
        const char = entry.character
        const currentSetIds = getBuffSetIdsForEntry(entryId)

        for (let i = entryIndex + 1; i < damageEntries.length; i++) {
            const next = damageEntries[i]
            if (next.character === char && isDirectDamage(next)) {
                if (!setBuffSetIdsForEntry(next.id, [...currentSetIds])) return
                onupdate(getCalcState())
                expandedEntryId = next.id
                addToast('已复制增益到下一段直伤', 'success')
                return
            }
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

        for (let i = entryIndex - 1; i >= 0; i--) {
            const prev = damageEntries[i]
            if (prev.isEffect && prev.hitName === entry.hitName) {
                const prevSetIds = getBuffSetIdsForEntry(prev.id)
                if (!setBuffSetIdsForEntry(entryId, prevSetIds)) return
                onupdate(getCalcState())
                addToast('已复制前段效应的增益', 'success')
                return
            }
        }

        addToast('未找到上一个同名效应', 'info')
    }

    /** @desc 复制当前效应的增益到下一个同名效应（并展开那段） */
    function handleCopyToNextEffect(entryId: string) {
        const entry = damageEntries.find((e) => e.id === entryId)
        if (!entry || !entry.isEffect) return

        const entryIndex = damageEntries.findIndex((e) => e.id === entryId)
        const currentSetIds = getBuffSetIdsForEntry(entryId)

        for (let i = entryIndex + 1; i < damageEntries.length; i++) {
            const next = damageEntries[i]
            if (next.isEffect && next.hitName === entry.hitName) {
                if (!setBuffSetIdsForEntry(next.id, [...currentSetIds])) return
                onupdate(getCalcState())
                expandedEntryId = next.id
                addToast('已复制增益到下一段效应', 'success')
                return
            }
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

<!-- @desc 表格容器：Ctrl+滚轮横向滚动，背景为弹窗底色 -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="theme-scrollbar snap-scroll-y h-full overflow-auto pb-48 {className}"
    style="background: var(--theme-modal-bg); {styleProp || ''}"
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
                class="text-(--theme-modal-text)/50 sticky top-0 opacity-100!"
                style="background: color-mix(in srgb, var(--theme-modal-bg) 92%, transparent) !important; backdrop-filter: blur(12px) !important; -webkit-backdrop-filter: blur(12px) !important; border-bottom: 1px solid var(--theme-divider-border);"
            >
                <th
                    class="text-left font-medium py-2 px-3 w-20 shrink-0 border-r border-dashed"
                    style="border-color: var(--theme-divider-border);">来源</th
                >
                <th
                    class="text-left font-medium py-2 px-3 w-56 shrink-0 border-r border-dashed"
                    style="border-color: var(--theme-divider-border);">条目</th
                >
                <th
                    class="text-left font-medium py-2 px-3 w-32 shrink-0 border-r border-dashed"
                    style="border-color: var(--theme-divider-border);">视为</th
                >
                <th class="text-left font-medium py-2 px-3">Buff</th>
            </tr>
        </thead>
        <!-- 表体：每行一个伤害条目（点击展开编辑）；展开行内嵌增益配置面板 -->
        <tbody>
            {#each damageEntries as damageEntry, i}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <tr
                    onclick={() => handleToggleExpand(damageEntry.id, i)}
                    data-entry-id={damageEntry.id}
                    class={[
                        'snap-row cursor-pointer border-b transition-colors',
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
                        class="py-1.5 px-3 w-20 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap border-r border-dashed"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <span style="color: var(--theme-element-{calcElementMap[damageEntry.character ?? '']}, #888)">
                            {damageEntry.character ?? '—'}
                        </span>
                    </td>
                    <!-- 条目列：伤害名（按伤害元素着色），超宽省略 + title 完整名 -->
                    <td
                        class="py-1.5 px-3 w-56 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap border-r border-dashed"
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
                        class="py-1.5 px-3 w-32 shrink-0 overflow-hidden text-ellipsis whitespace-nowrap border-r border-dashed"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <div class="flex flex-wrap gap-0.5">
                            {#each entryDamageTypeMap[damageEntry.id] ?? [] as dt}
                                <span
                                    class="text-[10px] px-1 rounded text-(--theme-modal-text)/70 leading-tight"
                                    style="background: var(--theme-input-bg);"
                                    >{DAMAGE_TYPE_SHORT[dt as keyof typeof DAMAGE_TYPE_SHORT] ?? dt}</span
                                >
                            {:else}
                                {@const inferred = inferredDamageTypeMap[damageEntry.id] ?? []}
                                {#if inferred.length > 0}
                                    <span class="text-[10px] leading-tight text-(--theme-modal-text)/35"
                                        >自动推导：{inferred
                                            .map((t) => DAMAGE_TYPE_SHORT[t as keyof typeof DAMAGE_TYPE_SHORT] ?? t)
                                            .join('/')}</span
                                    >
                                {/if}
                            {/each}
                        </div>
                    </td>
                    <!-- Buff 列：差异模式显示 新增(绿+)/移除(红-)/不变/全局(黄皇冠)；普通模式显示已绑定且条件匹配的 buff 标签 -->
                    <td class="py-1.5 px-3">
                        <div class="flex flex-wrap gap-1">
                            {#if buffDiffMode}
                                {#each entryBuffDiff[damageEntry.id] ?? [] as diff}
                                    {#if diff.type === 'global'}
                                        <span
                                            class="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium"
                                            style="background: var(--theme-buff-yellow-bg); color: var(--theme-buff-yellow-text);"
                                        >
                                            <Icon icon="mdi:crown" class="size-3" />{diff.name}
                                        </span>
                                    {:else if diff.type === 'added'}
                                        <span
                                            class="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium"
                                            style="background: var(--theme-buff-green-bg); color: var(--theme-buff-green-text);"
                                        >
                                            <Icon icon="mdi:plus" class="size-3" />{diff.name}
                                        </span>
                                    {:else if diff.type === 'removed'}
                                        <span
                                            class="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-500/15 text-red-500"
                                        >
                                            <Icon icon="mdi:minus" class="size-3" />{diff.name}
                                        </span>
                                    {:else}
                                        <span
                                            class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
                                            style="background: color-mix(in srgb, var(--theme-accent-bg) 15%, transparent); color: var(--theme-accent-text);"
                                        >
                                            {diff.name}
                                        </span>
                                    {/if}
                                {/each}
                            {:else}
                                {#each (entryBuffSetIdMap[damageEntry.id] ?? []).filter( (sid) => buffMatches(buffById.get(sid), damageEntry) ) as setId}
                                    {@const buffSet = buffById.get(setId)}
                                    {#if buffSet && !globalBuffSetIds.includes(setId)}
                                        <span
                                            class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
                                            style="background: color-mix(in srgb, var(--theme-accent-bg) 15%, transparent); color: var(--theme-accent-text);"
                                        >
                                            {buffSet.name}
                                        </span>
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
                                transition:slide|local={{ duration: 200 }}
                                class="border-b px-6 py-3 space-y-3"
                                style="border-color: var(--theme-divider-border);"
                            >
                                {#if !damageEntry.isEffect && !damageEntry.isTuneBreak && !damageEntry.isTuneResponse}
                                    <div>
                                        <div class="text-xs text-(--theme-modal-text)/50 mb-1.5">伤害类型</div>
                                        {#if isDirectDamage(damageEntry) && damageEntry.character}
                                            <div class="mb-1.5">
                                                <button
                                                    onclick={(e) => {
                                                        e.stopPropagation()
                                                        handleCopyDamageTypeToNext(damageEntry.id)
                                                    }}
                                                    title="Shift+Enter"
                                                    class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors bg-(--theme-input-bg) text-(--theme-input-text) border border-(--theme-input-border) hover:bg-(--theme-input-bg-focused)"
                                                >
                                                    <Icon icon="mdi:content-paste" class="size-3 shrink-0" />
                                                    复制到下段直伤
                                                </button>
                                            </div>
                                        {/if}
                                        <div class="flex flex-wrap gap-1">
                                            {#each DAMAGE_TYPES as dt}
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
                                                        'px-2 py-1 text-xs rounded transition-colors border',
                                                        selected
                                                            ? ''
                                                            : 'text-(--theme-modal-text)/50 hover:bg-(--theme-modal-text)/10'
                                                    ].join(' ')}
                                                    style={selected
                                                        ? 'background: color-mix(in srgb, var(--theme-accent-bg) 20%, transparent); color: var(--theme-accent-text); border-color: color-mix(in srgb, var(--theme-accent-bg) 40%, transparent);'
                                                        : 'background: var(--theme-input-bg); border-color: var(--theme-divider-border);'}
                                                >
                                                    {DAMAGE_TYPE_SHORT[dt as keyof typeof DAMAGE_TYPE_SHORT] ?? dt}
                                                </button>
                                            {/each}
                                        </div>
                                    </div>
                                {/if}
                                <div>
                                    <div class="text-xs text-(--theme-modal-text)/50 mb-1.5">增益选择</div>
                                    {#if visibleBuffSets.length > 0}
                                        <div
                                            class="flex flex-wrap items-center gap-1 pb-2 border-b mb-2"
                                            style="border-color: var(--theme-divider-border);"
                                        >
                                            {#if isDirectDamage(damageEntry)}
                                                <button
                                                    onclick={(e) => {
                                                        e.stopPropagation()
                                                        handleCopyFromPrevDirect(damageEntry.id)
                                                    }}
                                                    title="Shift+Z"
                                                    class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors bg-(--theme-input-bg) text-(--theme-input-text) border border-(--theme-input-border) hover:bg-(--theme-input-bg-focused)"
                                                >
                                                    <Icon icon="mdi:content-copy" class="size-3 shrink-0" />
                                                    复制前段直伤
                                                </button>
                                                <button
                                                    onclick={(e) => {
                                                        e.stopPropagation()
                                                        handleCopyToNextDirect(damageEntry.id)
                                                    }}
                                                    title="Shift+X"
                                                    class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors bg-(--theme-input-bg) text-(--theme-input-text) border border-(--theme-input-border) hover:bg-(--theme-input-bg-focused)"
                                                >
                                                    <Icon icon="mdi:content-paste" class="size-3 shrink-0" />
                                                    复制到下段直伤
                                                </button>
                                            {:else if damageEntry.isEffect}
                                                <button
                                                    onclick={(e) => {
                                                        e.stopPropagation()
                                                        handleCopyFromPrevEffect(damageEntry.id)
                                                    }}
                                                    class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors bg-(--theme-input-bg) text-(--theme-input-text) border border-(--theme-input-border) hover:bg-(--theme-input-bg-focused)"
                                                >
                                                    <Icon icon="mdi:content-copy" class="size-3 shrink-0" />
                                                    复制前段效应
                                                </button>
                                                <button
                                                    onclick={(e) => {
                                                        e.stopPropagation()
                                                        handleCopyToNextEffect(damageEntry.id)
                                                    }}
                                                    class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors bg-(--theme-input-bg) text-(--theme-input-text) border border-(--theme-input-border) hover:bg-(--theme-input-bg-focused)"
                                                >
                                                    <Icon icon="mdi:content-paste" class="size-3 shrink-0" />
                                                    复制到下段效应
                                                </button>
                                            {/if}
                                            <button
                                                disabled={selectedEntrySetIds.length === 0}
                                                onclick={(e) => {
                                                    e.stopPropagation()
                                                    handleClearAllBuffs(damageEntry.id)
                                                }}
                                                title="Shift+C"
                                                class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors bg-(--theme-input-bg) text-(--theme-input-text) border border-(--theme-input-border) hover:bg-(--theme-input-bg-focused) disabled:opacity-40 disabled:pointer-events-none"
                                            >
                                                <Icon icon="mdi:close-circle-outline" class="size-3 shrink-0" />
                                                清除所有增益
                                            </button>
                                            <div class="flex-1"></div>
                                            <button
                                                onclick={(e) => {
                                                    e.stopPropagation()
                                                    const nextIdx = i + 1 < damageEntries.length ? i + 1 : 0
                                                    handleToggleExpand(damageEntries[nextIdx].id, nextIdx)
                                                }}
                                                title="Space"
                                                class="inline-flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors bg-(--theme-accent-bg)/20 text-(--theme-accent-text) border border-(--theme-accent-bg)/30 hover:bg-(--theme-accent-bg)/30"
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
                                                        class="flex flex-wrap items-center gap-1 rounded border px-2 py-1 text-xs transition-colors"
                                                        style={folderActive
                                                            ? 'background: color-mix(in srgb, var(--theme-accent-bg) 15%, transparent); border-color: color-mix(in srgb, var(--theme-accent-bg) 40%, transparent);'
                                                            : 'background: var(--theme-input-bg); border-color: var(--theme-divider-border);'}
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
                                                            {#each item.children! as child, ci}
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
                                                                        'rounded px-2 py-1 text-[10px] font-medium tabular-nums transition-colors min-w-[1.2em] text-center',
                                                                        childChecked
                                                                            ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/30'
                                                                            : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70 hover:bg-(--theme-accent-bg)/10'
                                                                    ].join(' ')}
                                                                >
                                                                    {child.name
                                                                        .match(LAYERED_BUFF_PATTERN)
                                                                        ?.slice(2)
                                                                        .join('') ?? child.name}
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
                                                    <button
                                                        onclick={(e) => {
                                                            e.stopPropagation()
                                                            handleToggleBuffSetForEntry(item.buffSet!.id)
                                                        }}
                                                        class={[
                                                            'px-2 py-1 text-xs rounded transition-colors inline-flex items-center gap-1 border',
                                                            checked
                                                                ? ''
                                                                : 'text-(--theme-modal-text)/50 hover:bg-(--theme-modal-text)/10'
                                                        ].join(' ')}
                                                        style={checked
                                                            ? 'background: color-mix(in srgb, var(--theme-accent-bg) 20%, transparent); color: var(--theme-accent-text); border-color: color-mix(in srgb, var(--theme-accent-bg) 40%, transparent);'
                                                            : 'background: var(--theme-input-bg); border-color: var(--theme-divider-border);'}
                                                    >
                                                        <Icon
                                                            icon={checked ? 'mdi:check' : 'mdi:close'}
                                                            class="size-3 shrink-0"
                                                        />
                                                        {item.buffSet!.name}
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
        <div class="flex items-center justify-center py-12 text-xs text-(--theme-modal-text)/40">暂无伤害数据</div>
    {/if}
</div>
