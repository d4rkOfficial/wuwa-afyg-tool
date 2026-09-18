<script lang="ts">
    import {
        getSkillPickerBlockId,
        setSkillPickerBlockId,
        getSkillPickerLoading,
        getSkillPickerCharacter,
        getSkillPickerGroups,
        getSkillPickerSelected,
        setSkillPickerSelected,
        setSkillPickerIsRef,
        getRefSkillPickerCache,
        getSkillPickerHitHits,
        setSkillPickerHitHits,
        getTeam,
        getTeamCharNames,
        getSkillPickerOrder,
        getCharIconMap,
        getCustomSkillHits,
        addCustomHit,
        removeCustomHit,
        duplicateCustomHit,
        applySkillHits,
        switchSkillPickerTab
    } from '$lib/calc/timeline.store.svelte'
    import { parseRatioHits, summarizeSelectedHits } from '$lib/calc/skill-segments'
    import { ELEMENTS, PCT_UNITS } from '$lib/consts/game-terms'
    import type { CustomHit } from '$lib/calc/timeline.types'
    import { addToast } from '$lib/data/toast.svelte'
    import QuickLookup from '$lib/components/layout/quick-lookup.svelte'
    import Icon from '@iconify/svelte'
    import { fallbackIcon } from '$lib/utils/icons'
    import { focusTrap } from '$lib/utils/focus-trap'

    let showLookup = $state(false)
    let showCustomModal = $state(false)
    let customName = $state('')
    let customFlat = $state('')
    let customPct = $state('')
    let customPctUnit = $state('攻击%')
    let customElement = $state('物理')
    let showUnitMenu = $state(false)
    let hasFlat = $state(false)
    let hasPct = $state(false)
    let customHitsCount = $state(1)
    let showSegmentPicker = $state(false)
    /** @desc 取段来源：当前角色技能命中名（来自数据表的多段倍率） */
    let segmentSourceName = $state('')
    /** @desc 展开后的逐段选中集合（索引对应 segmentHits） */
    let segmentSelected = $state<Set<number>>(new Set())
    let copySourceId = $state('')

    /** @desc 可取的技能命中（排除自定义/谐度破坏/响应，这些不走直伤） */
    let segmentOptions = $derived.by(() => {
        const out: { name: string; ratio: string; element: string }[] = []
        for (const group of getSkillPickerGroups()) {
            if (group.type === '自定义' || group.type === '谐度破坏') continue
            for (const hit of group.hits) {
                if (hit.name.includes('响应')) continue
                out.push({ name: hit.name, ratio: hit.ratio, element: hit.element })
            }
        }
        return out
    })
    let segmentSourceRatio = $derived(segmentOptions.find((o) => o.name === segmentSourceName)?.ratio ?? '')
    let segmentHits = $derived(segmentSourceName ? parseRatioHits(segmentSourceRatio) : [])
    let selectedSegmentHits = $derived(segmentHits.filter((_, i) => segmentSelected.has(i)))
    let segmentSummary = $derived(selectedSegmentHits.length > 0 ? summarizeSelectedHits(selectedSegmentHits) : null)
    let existingCustomHits = $derived(getCustomSkillHits()[getSkillPickerCharacter()] ?? [])

    function toggleSegment(index: number) {
        const next = new Set(segmentSelected)
        if (next.has(index)) next.delete(index)
        else next.add(index)
        segmentSelected = next
    }

    function selectAllSegments() {
        segmentSelected = new Set(segmentHits.map((_, i) => i))
    }

    function clearSegments() {
        segmentSelected = new Set()
    }

    /** @desc 取用所选段：写入名称/倍率/段数（同倍率选择 → 倍率×段数；混合选择 → 合计倍率×1，保证总倍率精确） */
    function applySegments() {
        const summary = segmentSummary
        if (!summary) {
            addToast('请先勾选要取用的段', 'info')
            return
        }
        const option = segmentOptions.find((o) => o.name === segmentSourceName)
        if (option) {
            customName = option.name
            if (option.element) customElement = option.element
        }
        if (summary.kind === '%') {
            hasPct = true
            customPct = String(summary.ratio)
            customPctUnit = summary.unit
        } else {
            hasFlat = true
            customFlat = String(summary.ratio)
        }
        customHitsCount = summary.hits
        addToast(
            `已取用 ${selectedSegmentHits.length} 段：倍率 ${summary.ratio}${summary.kind === '%' ? '%' : ''} × ${summary.hits} 段`,
            'success'
        )
    }

    /** @desc 直接复制一条已有自定义直伤到表单（同名不同 Buff 的倍率可改个后缀名再存一条） */
    function fillFromExisting() {
        const source = existingCustomHits.find((h) => h.id === copySourceId)
        if (!source) return
        customName = source.name
        hasFlat = source.flatValue > 0
        customFlat = source.flatValue > 0 ? String(source.flatValue) : ''
        hasPct = source.pctValue > 0
        customPct = source.pctValue > 0 ? String(source.pctValue) : ''
        customPctUnit = source.pctUnit
        customElement = source.element
        customHitsCount = source.hits ?? 1
    }

    function openAddCustom(charName: string) {
        customName = ''
        customFlat = ''
        customPct = ''
        customPctUnit = '攻击%'
        customElement = '物理'
        hasFlat = false
        hasPct = false
        customHitsCount = 1
        showSegmentPicker = false
        segmentSourceName = ''
        segmentSelected = new Set()
        copySourceId = ''
        showCustomModal = true
    }

    function confirmAddCustom(charName: string) {
        const flat = hasFlat ? parseFloat(customFlat) : 0
        const pct = hasPct ? parseFloat(customPct) : 0
        if (!customName.trim()) {
            addToast('请输入直伤名称', 'info')
            return
        }
        if (!hasFlat && !hasPct) {
            addToast('请填写固定值或百分比值', 'info')
            return
        }
        const hit: CustomHit = {
            id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: customName.trim(),
            flatValue: isNaN(flat) || flat <= 0 ? 0 : flat,
            pctValue: isNaN(pct) || pct <= 0 ? 0 : pct,
            pctUnit: customPctUnit,
            element: customElement,
            hits: Math.max(1, Math.floor(customHitsCount) || 1)
        }
        addCustomHit(charName, hit)
        // 新建后自动勾选并带上段数，省一次手动 ×N 输入
        const key = `${charName}|自定义|${hit.id}`
        const nextSelected = new Set(getSkillPickerSelected())
        nextSelected.add(key)
        setSkillPickerSelected(nextSelected)
        setSkillPickerHitHits({ ...getSkillPickerHitHits(), [key]: hit.hits ?? 1 })
        showCustomModal = false
    }

    function openAddCustomWithName(name: string, charName: string) {
        openAddCustom(charName)
        customName = name
    }

    function toggleSkillSelection(key: string) {
        const next = new Set(getSkillPickerSelected())
        if (next.has(key)) next.delete(key)
        else next.add(key)
        setSkillPickerSelected(next)
    }
</script>

{#if getSkillPickerBlockId() !== null}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        class="animate-fade-in fixed inset-0 z-60 flex items-center justify-center backdrop-blur-sm"
        onclick={(e) => {
            if ((e.target as HTMLElement) === e.currentTarget) {
                setSkillPickerBlockId(null)
                setSkillPickerIsRef(false)
            }
        }}
    >
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            use:focusTrap
            tabindex="-1"
            class="animate-pop-in w-full max-h-[70vh] max-w-xl rounded-lg border text-(--theme-modal-text) shadow-xl overflow-hidden flex flex-col"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => {
                // 放行 ESC/Enter 到 window 层统一处理（保存/关闭），其余按键阻止冒泡
                if (e.key === 'Escape' || e.key === 'Enter') return
                e.stopPropagation()
            }}
        >
            <!-- Header -->
            <div
                class="flex items-center justify-between px-4 py-3 border-b"
                style="border-color: var(--theme-divider-border);"
            >
                <h2 class="text-sm font-semibold">配置直伤倍率</h2>
                <div class="flex items-center gap-2">
                    <div class="flex items-center gap-1.5">
                        {#each getTeamCharNames() as name}
                            <button
                                class="size-7 rounded-full overflow-hidden {getSkillPickerCharacter() === name
                                    ? 'ring-2 ring-(--theme-accent-bg)'
                                    : 'ring-1 ring-(--theme-divider-border)'}"
                                onclick={() => switchSkillPickerTab(name)}
                            >
                                {#if getCharIconMap()[name]}
                                    <img
                                        src={getCharIconMap()[name]}
                                        alt={name}
                                        draggable="false"
                                        use:fallbackIcon={'/icons/placeholder-character.svg'}
                                        class="size-full object-cover"
                                    />
                                {:else}
                                    <span
                                        class="flex size-full items-center justify-center text-[10px] font-medium text-(--theme-modal-text)/60 bg-(--theme-modal-bg)/80"
                                        >{name[0]}</span
                                    >
                                {/if}
                            </button>
                        {/each}
                    </div>
                </div>
            </div>

            <!-- Body -->
            <div class="theme-scrollbar flex-1 overflow-y-auto p-2">
                {#if getSkillPickerLoading()}
                    <div class="flex items-center justify-center py-8">
                        <span class="text-xs text-(--theme-modal-text)/50">加载中…</span>
                    </div>
                {:else if getSkillPickerGroups().length === 0}
                    <div class="flex items-center justify-center py-8">
                        <span class="text-xs text-(--theme-modal-text)/50">无可用倍率数据</span>
                    </div>
                {:else}
                    <div class="space-y-1">
                        {#each getSkillPickerGroups() as group}
                            <div
                                class="text-[10px] font-semibold text-(--theme-modal-text)/50 uppercase tracking-wider px-2 pt-2 pb-1 flex items-center justify-between"
                            >
                                <span>
                                    {group.type} ({group.hits.length})
                                    {#if group.type === '谐度破坏'}
                                        <span class="text-(--theme-modal-text)/50 font-normal normal-case"
                                            >(请到非直伤配置中配置)</span
                                        >
                                    {/if}
                                </span>
                                {#if group.type === '自定义'}
                                    <button
                                        onclick={() => openAddCustom(getSkillPickerCharacter())}
                                        class="text-(--theme-accent-text) hover:text-(--theme-accent-text) text-[10px] flex items-center gap-0.5"
                                    >
                                        <Icon icon="mdi:plus" class="size-3" /> 添加
                                    </button>
                                {/if}
                            </div>
                            {#each group.hits as hit}
                                {@const key = getSkillPickerCharacter() + '|' + group.type + '|' + hit.name}
                                {@const order = getSkillPickerSelected().has(key)
                                    ? getSkillPickerOrder().indexOf(key) + 1
                                    : 0}
                                {@const slot = getTeam().find((s) => s.character === getSkillPickerCharacter())}
                                {@const echoName = slot?.echoes?.[0]?.name}
                                {@const isResponseHit = hit.name.includes('响应')}
                                {@const displayName =
                                    group.type === '声骸技能' && echoName
                                        ? echoName + '·' + hit.name
                                        : group.type === '自定义'
                                          ? ((getCustomSkillHits()[getSkillPickerCharacter()] ?? []).find(
                                                (c) => c.id === hit.name
                                            )?.name ?? hit.name)
                                          : hit.name}
                                {@const customHit =
                                    group.type === '自定义'
                                        ? (getCustomSkillHits()[getSkillPickerCharacter()] ?? []).find(
                                              (c) => c.id === hit.name
                                          )
                                        : undefined}
                                <!-- svelte-ignore a11y_click_events_have_key_events -->
                                <!-- svelte-ignore a11y_no_static_element_interactions -->
                                <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                                <div
                                    tabindex={group.type === '谐度破坏' || isResponseHit ? -1 : 0}
                                    class={[
                                        'flex items-center gap-2 px-2 py-1 rounded text-xs transition-colors',
                                        group.type === '谐度破坏' || isResponseHit
                                            ? 'opacity-40 cursor-not-allowed select-none text-(--theme-modal-text)/60'
                                            : getSkillPickerSelected().has(key)
                                              ? 'bg-(--theme-input-bg) text-(--theme-modal-text)'
                                              : 'text-(--theme-modal-text)/60 hover:bg-(--theme-modal-text)/5',
                                        group.type !== '谐度破坏' && !isResponseHit
                                            ? 'focus-visible:outline-none focus-visible:bg-(--theme-modal-text)/5 focus-visible:ring-1 focus-visible:ring-(--theme-accent-bg)'
                                            : ''
                                    ].join(' ')}
                                    onclick={() => {
                                        if (group.type === '谐度破坏' || isResponseHit) return
                                        toggleSkillSelection(key)
                                    }}
                                    onkeydown={(e) => {
                                        if (group.type === '谐度破坏' || isResponseHit) return
                                        // 段数输入框的 Enter 由输入框自身处理，不触发选中切换
                                        if (e.target !== e.currentTarget) return
                                        if (e.key !== 'Enter' && e.key !== ' ') return
                                        e.preventDefault()
                                        toggleSkillSelection(key)
                                    }}
                                >
                                    <div
                                        class="size-5 shrink-0 rounded-full flex items-center justify-center {order >
                                            0 &&
                                        group.type !== '谐度破坏' &&
                                        !isResponseHit
                                            ? 'bg-(--theme-accent-bg) text-(--theme-accent-text-on-bg)'
                                            : 'border'}"
                                        style="border-color: {order > 0 && group.type !== '谐度破坏' && !isResponseHit
                                            ? 'transparent'
                                            : 'var(--theme-divider-border)'};"
                                    >
                                        {#if order > 0 && group.type !== '谐度破坏' && !isResponseHit}<span
                                                class="text-[10px] font-bold">{order}</span
                                            >{/if}
                                    </div>
                                    <span class="flex-1 truncate" title={displayName}>
                                        {displayName}
                                        {#if isResponseHit}
                                            <span class="text-(--theme-modal-text)/50 font-normal normal-case ml-1"
                                                >(请到非直伤配置中配置)</span
                                            >
                                        {/if}
                                    </span>
                                    <span class="text-(--theme-modal-text)/50"
                                        >{hit.ratio}{#if hit.element}<span
                                                class="ml-1"
                                                style="color: var(--theme-element-{hit.element}, #888)"
                                                >{hit.element}</span
                                            >{/if}</span
                                    >
                                    {#if getSkillPickerSelected().has(key) && group.type !== '谐度破坏' && !isResponseHit}
                                        <span class="flex items-center gap-1" onclick={(e) => e.stopPropagation()}>
                                            <span class="text-xs text-(--theme-modal-text)/50">×</span>
                                            <input
                                                type="number"
                                                min="0"
                                                value={getSkillPickerHitHits()[key] ?? customHit?.hits ?? 1}
                                                oninput={(e) => {
                                                    const v = parseInt((e.target as HTMLInputElement).value)
                                                    setSkillPickerHitHits({
                                                        ...getSkillPickerHitHits(),
                                                        [key]: Math.max(0, isNaN(v) ? 1 : v)
                                                    })
                                                }}
                                                class="w-10 h-6 bg-(--theme-modal-bg)/60 text-xs text-(--theme-modal-text) text-center rounded outline-none border tabular-nums"
                                                style="border-color: var(--theme-divider-border);"
                                            />
                                        </span>
                                    {/if}
                                    {#if group.type === '自定义'}
                                        <button
                                            onclick={(e) => {
                                                e.stopPropagation()
                                                const id = duplicateCustomHit(getSkillPickerCharacter(), hit.name)
                                                if (id) addToast('已复制该自定义直伤', 'success')
                                            }}
                                            class="shrink-0 rounded p-0.5 text-(--theme-modal-text)/40 transition-colors hover:text-(--theme-accent-text)"
                                            title="复制这条倍率（同名不同 Buff 的倍率可直接复用）"
                                            ><Icon icon="mdi:content-copy" class="size-3.5" /></button
                                        >
                                        <button
                                            onclick={(e) => {
                                                e.stopPropagation()
                                                removeCustomHit(getSkillPickerCharacter(), hit.name)
                                            }}
                                            class="shrink-0 rounded p-0.5 text-(--theme-modal-text)/40 transition-colors hover:text-red-500"
                                            ><Icon icon="mdi:close" class="size-3.5" /></button
                                        >
                                    {/if}
                                </div>
                            {/each}
                        {/each}
                    </div>
                {/if}
            </div>

            <!-- Footer -->
            <div
                class="flex items-center justify-between gap-2 border-t px-4 py-2.5"
                style="border-color: var(--theme-divider-border);"
            >
                <div class="flex items-center gap-1">
                    <button
                        class="flex items-center gap-1 rounded px-2 py-1 text-xs text-(--theme-accent-text) transition-colors hover:bg-(--theme-modal-text)/5"
                        onclick={() => openAddCustom(getSkillPickerCharacter())}
                    >
                        <Icon icon="mdi:plus-circle-outline" class="size-3.5" />
                        添加自定义直伤
                    </button>
                    <button
                        onclick={() => (showLookup = true)}
                        class="flex items-center gap-1 rounded px-2 py-1 text-xs text-(--theme-accent-text) transition-colors hover:bg-(--theme-modal-text)/5"
                    >
                        <Icon icon="mdi:magnify" class="size-3.5" />
                        速查
                    </button>
                </div>
                <div class="flex items-center gap-2">
                    <button
                        class="h-7 rounded-md bg-(--theme-modal-bg)/60 px-3 text-xs text-(--theme-modal-text)/60 transition-colors hover:bg-(--theme-modal-text)/10"
                        onclick={() => {
                            setSkillPickerBlockId(null)
                            setSkillPickerIsRef(false)
                        }}>取消</button
                    >
                    <button
                        class="h-7 rounded-md px-3 text-xs transition-colors"
                        style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);"
                        onclick={applySkillHits}>确认</button
                    >
                </div>
            </div>
        </div>
    </div>
{/if}

<!-- Custom Hit Add Modal -->
{#if showCustomModal}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        class="animate-fade-in fixed inset-0 z-70 flex items-center justify-center backdrop-blur-sm"
        onkeydown={(e) => {
            if (e.key === 'Escape') {
                showCustomModal = false
                e.stopPropagation()
            }
        }}
    >
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
            use:focusTrap={{ initial: 'input' }}
            tabindex="-1"
            class="animate-pop-in rounded-xl border p-5 shadow-xl w-md"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
        >
            <div class="flex items-center justify-between mb-5">
                <h3 class="text-sm font-semibold">自定义直伤</h3>
            </div>

            <div class="space-y-4">
                <div>
                    <label for="custom-name" class="text-[10px] text-(--theme-modal-text)/50 block mb-1.5">名称</label>
                    <input
                        id="custom-name"
                        type="text"
                        bind:value={customName}
                        placeholder="输入名称"
                        class="w-full rounded-lg border px-3 py-2 text-xs outline-none text-(--theme-modal-text) placeholder:text-(--theme-modal-text)/30"
                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                    />
                </div>

                <div class="flex items-end gap-3">
                    <div class="flex-1">
                        <label for="custom-hits" class="text-[10px] text-(--theme-modal-text)/50 block mb-1.5"
                            >段数</label
                        >
                        <input
                            id="custom-hits"
                            type="number"
                            min="1"
                            bind:value={customHitsCount}
                            class="w-full rounded-lg border px-3 py-2 text-xs tabular-nums outline-none text-(--theme-modal-text)"
                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                        />
                    </div>
                    {#if existingCustomHits.length > 0}
                        <div class="flex-1">
                            <label for="custom-copy" class="text-[10px] text-(--theme-modal-text)/50 block mb-1.5"
                                >复制已有</label
                            >
                            <select
                                id="custom-copy"
                                bind:value={copySourceId}
                                onchange={fillFromExisting}
                                class="w-full rounded-lg border px-2 py-2 text-xs outline-none text-(--theme-modal-text)"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                            >
                                <option value="">选择一条…</option>
                                {#each existingCustomHits as ch}
                                    <option value={ch.id}>{ch.name}</option>
                                {/each}
                            </select>
                        </div>
                    {/if}
                </div>

                <!-- 从技能倍率取段：多段倍率（如 60%*2+40%*3）可只取其中几段 -->
                <div class="rounded-lg border" style="border-color: var(--theme-divider-border);">
                    <button
                        class="flex w-full items-center justify-between px-3 py-2 text-[11px] text-(--theme-modal-text)"
                        onclick={() => (showSegmentPicker = !showSegmentPicker)}
                    >
                        <span class="flex items-center gap-1.5">
                            <Icon icon="mdi:format-list-numbered" class="size-3.5" />
                            从技能倍率取段（多段倍率只取其中几段）
                        </span>
                        <Icon icon={showSegmentPicker ? 'mdi:chevron-up' : 'mdi:chevron-down'} class="size-3.5" />
                    </button>
                    {#if showSegmentPicker}
                        <div class="space-y-2 border-t px-3 py-2" style="border-color: var(--theme-divider-border);">
                            <div class="theme-scrollbar max-h-36 space-y-0.5 overflow-y-auto">
                                {#each segmentOptions as option}
                                    <button
                                        onclick={() => {
                                            segmentSourceName = option.name
                                            segmentSelected = new Set()
                                        }}
                                        class={[
                                            'flex w-full items-center gap-2 rounded px-2 py-1 text-[11px] transition-colors',
                                            segmentSourceName === option.name
                                                ? 'bg-(--theme-input-bg) text-(--theme-modal-text)'
                                                : 'text-(--theme-modal-text)/60 hover:bg-(--theme-modal-text)/5'
                                        ].join(' ')}
                                    >
                                        <span class="min-w-0 flex-1 truncate text-left" title={option.name}
                                            >{option.name}</span
                                        >
                                        <span class="shrink-0 text-(--theme-modal-text)/50">{option.ratio}</span>
                                    </button>
                                {/each}
                                {#if segmentOptions.length === 0}
                                    <div class="py-2 text-[11px] text-(--theme-modal-text)/50">
                                        当前角色暂无可用的技能倍率数据
                                    </div>
                                {/if}
                            </div>
                            {#if segmentSourceName && segmentHits.length > 0}
                                <div class="flex items-center gap-2 text-[11px] text-(--theme-modal-text)/70">
                                    <span class="min-w-0 flex-1 truncate" title={segmentSourceName}
                                        >{segmentSourceName}：共 {segmentHits.length} 段</span
                                    >
                                    <button
                                        onclick={selectAllSegments}
                                        class="shrink-0 transition-colors hover:text-(--theme-accent-text)">全选</button
                                    >
                                    <button
                                        onclick={clearSegments}
                                        class="shrink-0 transition-colors hover:text-(--theme-accent-text)">清空</button
                                    >
                                </div>
                                <div class="flex flex-wrap gap-1">
                                    {#each segmentHits as segment, i}
                                        <button
                                            onclick={() => toggleSegment(i)}
                                            class={[
                                                'rounded border px-1.5 py-0.5 text-[11px] tabular-nums transition-colors',
                                                segmentSelected.has(i)
                                                    ? 'border-(--theme-accent-bg) text-(--theme-accent-text)'
                                                    : 'border-(--theme-divider-border) text-(--theme-modal-text)/50 hover:text-(--theme-modal-text)'
                                            ].join(' ')}
                                        >
                                            {segment.value}{segment.kind === '%' ? '%' : ''}
                                            <span class="ml-0.5 opacity-50">#{i + 1}</span>
                                        </button>
                                    {/each}
                                </div>
                                {#if segmentSummary}
                                    <div class="text-[11px] text-(--theme-modal-text)/70">
                                        合计 {segmentSummary.total}{segmentSummary.kind === '%' ? '%' : ''} → 写入
                                        <b>{segmentSummary.ratio}{segmentSummary.kind === '%' ? '%' : ''}</b>
                                        × <b>{segmentSummary.hits}</b> 段
                                        {#if !segmentSummary.uniform}
                                            <span class="opacity-50"
                                                >（所选段倍率不一致：按「合计倍率 × 1 段」写入，保证总倍率精确）</span
                                            >
                                        {/if}
                                    </div>
                                    <button
                                        onclick={applySegments}
                                        class="rounded-lg border px-2.5 py-1 text-[11px] transition-colors"
                                        style="border-color: var(--theme-accent-bg); color: var(--theme-accent-text);"
                                    >
                                        取用所选段（{selectedSegmentHits.length}）
                                    </button>
                                {/if}
                            {/if}
                        </div>
                    {/if}
                </div>

                <div ondblclick={() => (hasFlat = true)}>
                    <label for="custom-flat" class="text-[10px] text-(--theme-modal-text)/50 block mb-1.5">固定值</label
                    >
                    <div class="flex items-center rounded-md border" style="border-color: var(--theme-divider-border);">
                        <button
                            onclick={() => (hasFlat = !hasFlat)}
                            class={[
                                'rounded-l-md px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap',
                                hasFlat
                                    ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12 shadow-sm'
                                    : 'text-(--theme-modal-text)/25 bg-transparent hover:text-(--theme-modal-text)/50'
                            ].join(' ')}
                        >
                            固定值
                        </button>
                        <div
                            class="flex items-center flex-1 px-3 py-1.5 border-x"
                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                        >
                            <input
                                id="custom-flat"
                                type="number"
                                bind:value={customFlat}
                                readonly={!hasFlat}
                                ondblclick={() => (hasFlat = true)}
                                placeholder="0"
                                title={hasFlat ? '' : '双击启用'}
                                class="w-full min-w-0 text-xs outline-none tabular-nums text-center bg-transparent readonly:text-(--theme-modal-text)/20"
                                class:text-(--theme-modal-text)={hasFlat}
                            />
                        </div>
                        <span class="w-24 text-xs text-(--theme-modal-text)/40 px-3 py-1.5 text-left">点</span>
                    </div>
                </div>

                <div ondblclick={() => (hasPct = true)}>
                    <label for="custom-pct" class="text-[10px] text-(--theme-modal-text)/50 block mb-1.5"
                        >百分比值</label
                    >
                    <div class="flex items-center rounded-md border" style="border-color: var(--theme-divider-border);">
                        <button
                            onclick={() => (hasPct = !hasPct)}
                            class={[
                                'rounded-l-md px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap',
                                hasPct
                                    ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12 shadow-sm'
                                    : 'text-(--theme-modal-text)/25 bg-transparent hover:text-(--theme-modal-text)/50'
                            ].join(' ')}
                        >
                            百分比
                        </button>
                        <div
                            class="flex items-center flex-1 px-3 py-1.5 border-x"
                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                        >
                            <input
                                id="custom-pct"
                                type="number"
                                bind:value={customPct}
                                readonly={!hasPct}
                                ondblclick={() => (hasPct = true)}
                                placeholder="0"
                                title={hasPct ? '' : '双击启用'}
                                class="w-full min-w-0 text-xs outline-none tabular-nums text-center bg-transparent readonly:text-(--theme-modal-text)/20"
                                class:text-(--theme-modal-text)={hasPct}
                            />
                        </div>
                        <div class="relative shrink-0 w-24">
                            <button
                                onclick={() => (showUnitMenu = !showUnitMenu)}
                                class="flex w-full items-center justify-between rounded-r-md px-3 py-1.5 text-xs text-(--theme-modal-text) transition-colors hover:bg-(--theme-modal-text)/5"
                            >
                                <span class="text-left">{customPctUnit}</span>
                                <Icon icon="mdi:chevron-down" class="size-3 text-(--theme-modal-text)/40 shrink-0" />
                            </button>
                            {#if showUnitMenu}
                                <div
                                    class="theme-scrollbar absolute right-0 top-full z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border bg-(--theme-modal-bg) py-1 shadow-xl backdrop-blur-lg"
                                    style="border-color: var(--theme-divider-border);"
                                    onclick={(e) => e.stopPropagation()}
                                >
                                    {#each PCT_UNITS as u}
                                        <button
                                            onclick={() => {
                                                customPctUnit = u
                                                showUnitMenu = false
                                            }}
                                            class={[
                                                'flex w-full items-center gap-2 px-3 py-2 text-xs text-left transition-colors',
                                                u === customPctUnit
                                                    ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/15'
                                                    : 'text-(--theme-modal-text) hover:bg-(--theme-modal-text)/5'
                                            ].join(' ')}
                                        >
                                            <span class="flex-1">{u}</span>
                                            {#if u === customPctUnit}
                                                <Icon icon="mdi:check" class="size-3 text-(--theme-accent-text)" />
                                            {/if}
                                        </button>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    </div>
                </div>

                <div role="group" aria-label="属性">
                    <span class="text-[10px] text-(--theme-modal-text)/50 block mb-1.5">属性</span>
                    <div class="flex flex-wrap gap-1.5">
                        {#each ELEMENTS as el}
                            <button
                                onclick={() => (customElement = el)}
                                class={[
                                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                                    el === customElement
                                        ? 'shadow-sm'
                                        : 'text-(--theme-modal-text)/50 hover:text-(--theme-modal-text) bg-transparent hover:bg-(--theme-modal-text)/5 border-transparent'
                                ].join(' ')}
                                style={el === customElement
                                    ? `color: var(--theme-element-${el}, #71717a); background: color-mix(in srgb, var(--theme-element-${el}, #71717a) 15%, transparent); border-color: var(--theme-element-${el}, #71717a)`
                                    : undefined}
                            >
                                {el}
                            </button>
                        {/each}
                    </div>
                </div>
            </div>

            <div
                class="flex items-center justify-between mt-5 pt-4 border-t"
                style="border-color: var(--theme-divider-border);"
            >
                <div></div>
                <div class="flex items-center gap-2">
                    <button
                        onclick={() => (showCustomModal = false)}
                        class="rounded-md px-3 py-1.5 text-xs text-(--theme-modal-text)/50 transition-colors hover:bg-(--theme-modal-text)/10"
                        >取消</button
                    >
                    <button
                        onclick={() => confirmAddCustom(getSkillPickerCharacter())}
                        class="rounded-md px-4 py-1.5 text-xs transition-all hover:brightness-125 shadow-sm"
                        style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);"
                        >确认</button
                    >
                </div>
            </div>
        </div>
    </div>
{/if}

<QuickLookup
    open={showLookup}
    team={getTeam()}
    showBuffOption={false}
    onCreateCustomHit={(name) => openAddCustomWithName(name, getSkillPickerCharacter())}
    onclose={() => (showLookup = false)}
/>
