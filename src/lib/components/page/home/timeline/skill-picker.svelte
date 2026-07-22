<script lang="ts">
    import {
        getSkillPickerBlockId,
        setSkillPickerBlockId,
        getSkillPickerLoading,
        getSkillPickerCharacter,
        getSkillPickerGroups,
        getSkillPickerSelected,
        setSkillPickerSelected,
        getSkillPickerIsRef,
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
        applySkillHits,
        switchRefSkillPickerTab
    } from './timeline.store.svelte'
    import { ELEMENT_COLORS } from './timeline.consts'
    import type { CustomHit } from './timeline.types'
    import { addToast } from '$lib/data/toast.svelte'
    import QuickLookup from '../calculation/quick-lookup.svelte'
    import Icon from '@iconify/svelte'

    const PCT_UNITS = [
        '攻击百分比',
        '生命百分比',
        '防御百分比',
        '偏谐系数' // 特殊 根据怪物品质
        // '共鸣效率',
        // '谐度破坏增幅',
        // '偏谐值累积效率',
        // '暴击率',
        // '暴击伤害'
    ]
    const ELEMENTS = ['物理', '冷凝', '热熔', '导电', '气动', '衍射', '湮灭']

    let showLookup = $state(false)
    let showCustomModal = $state(false)
    let customName = $state('')
    let customFlat = $state('')
    let customPct = $state('')
    let customPctUnit = $state('攻击百分比')
    let customElement = $state('物理')
    let showUnitMenu = $state(false)
    let showElementMenu = $state(false)

    function openAddCustom(charName: string) {
        customName = ''
        customFlat = ''
        customPct = ''
        customPctUnit = '攻击百分比'
        customElement = '物理'
        showCustomModal = true
    }

    function confirmAddCustom(charName: string) {
        const flat = parseFloat(customFlat)
        const pct = parseFloat(customPct)
        if (!customName.trim()) {
            addToast('请输入直伤名称', 'info')
            return
        }
        if ((isNaN(flat) || flat <= 0) && (isNaN(pct) || pct <= 0)) {
            addToast('请填写固定值或百分比值', 'info')
            return
        }
        const hit: CustomHit = {
            id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: customName.trim(),
            flatValue: isNaN(flat) || flat <= 0 ? 0 : flat,
            pctValue: isNaN(pct) || pct <= 0 ? 0 : pct,
            pctUnit: customPctUnit,
            element: customElement
        }
        addCustomHit(charName, hit)
        showCustomModal = false
    }

    function openAddCustomWithName(name: string, charName: string) {
        customName = name
        customFlat = ''
        customPct = ''
        customPctUnit = '攻击百分比'
        customElement = '物理'
        showCustomModal = true
    }
</script>

{#if getSkillPickerBlockId() !== null}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-lg"
        onclick={(e) => {
            if ((e.target as HTMLElement) === e.currentTarget) {
                setSkillPickerBlockId(null)
                setSkillPickerIsRef(false)
            }
        }}
        onkeydown={(e) => {
            if (e.key === 'Escape') {
                setSkillPickerBlockId(null)
                setSkillPickerIsRef(false)
            }
        }}
    >
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="w-full max-h-[70vh] max-w-xl rounded-lg border border-white/10 bg-[var(--theme-modal-bg)] text-[var(--theme-modal-text)] shadow-xl overflow-hidden flex flex-col"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
        >
            <!-- Header -->
            <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <h2 class="text-sm font-semibold">配置直伤倍率</h2>
                <div class="flex items-center gap-2">
                    {#if getSkillPickerIsRef()}
                        <div class="flex items-center gap-1.5">
                            {#each getTeamCharNames() as name}
                                <button
                                    class="size-7 rounded-full overflow-hidden {getSkillPickerCharacter() === name
                                        ? 'ring-2 ring-indigo-500'
                                        : 'ring-1 ring-zinc-600'}"
                                    onclick={() => switchRefSkillPickerTab(name)}
                                >
                                    {#if getCharIconMap()[name]}
                                        <img
                                            src={getCharIconMap()[name]}
                                            alt={name}
                                            draggable="false"
                                            class="size-full object-cover"
                                        />
                                    {:else}
                                        <span
                                            class="flex size-full items-center justify-center text-[10px] font-medium text-[var(--theme-modal-text)]/60 bg-[var(--theme-modal-bg)]/80"
                                            >{name[0]}</span
                                        >
                                    {/if}
                                </button>
                            {/each}
                        </div>
                    {:else}
                        {@const name = getSkillPickerCharacter()}
                        <div class="flex items-center gap-1.5">
                            {#if getCharIconMap()[name]}
                                <div
                                    class="size-7 rounded-full overflow-hidden ring-2 ring-indigo-500 flex items-center justify-center bg-white/10"
                                >
                                    <img
                                        src={getCharIconMap()[name]}
                                        alt={name}
                                        draggable="false"
                                        class="size-full object-cover"
                                    />
                                </div>
                            {:else}
                                <div
                                    class="size-7 rounded-full ring-2 ring-indigo-500 flex items-center justify-center text-[10px] font-medium text-[var(--theme-modal-text)]/60 bg-[var(--theme-modal-bg)]/80"
                                >
                                    {name[0]}
                                </div>
                            {/if}
                        </div>
                    {/if}
                </div>
            </div>

            <!-- Body -->
            <div class="flex-1 overflow-y-auto p-2">
                {#if getSkillPickerLoading()}
                    <div class="flex items-center justify-center py-8">
                        <span class="text-xs text-[var(--theme-modal-text)]/50">加载中…</span>
                    </div>
                {:else if getSkillPickerGroups().length === 0}
                    <div class="flex items-center justify-center py-8">
                        <span class="text-xs text-[var(--theme-modal-text)]/50">无可用倍率数据</span>
                    </div>
                {:else}
                    <div class="space-y-1">
                        {#each getSkillPickerGroups() as group}
                            <div
                                class="text-[10px] font-semibold text-[var(--theme-modal-text)]/50 uppercase tracking-wider px-2 pt-2 pb-1 flex items-center justify-between"
                            >
                                <span>
                                    {group.type} ({group.hits.length})
                                    {#if group.type === '谐度破坏'}
                                        <span class="text-zinc-600 font-normal normal-case">(请到非直伤配置中配置)</span
                                        >
                                    {/if}
                                </span>
                                {#if group.type === '自定义'}
                                    <button
                                        onclick={() => openAddCustom(getSkillPickerCharacter())}
                                        class="text-indigo-400 hover:text-indigo-300 text-[10px] flex items-center gap-0.5"
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
                                <!-- svelte-ignore a11y_click_events_have_key_events -->
                                <!-- svelte-ignore a11y_no_static_element_interactions -->
                                <div
                                    class={[
                                        'flex items-center gap-2 px-2 py-1 rounded text-xs transition-colors',
                                        group.type === '谐度破坏' || isResponseHit
                                            ? 'opacity-40 cursor-not-allowed select-none text-[var(--theme-modal-text)]/60'
                                            : getSkillPickerSelected().has(key)
                                              ? 'bg-white/5 text-[var(--theme-modal-text)]'
                                              : 'text-[var(--theme-modal-text)]/60 hover:bg-white/5'
                                    ].join(' ')}
                                    onclick={() => {
                                        if (group.type === '谐度破坏' || isResponseHit) return
                                        const next = new Set(getSkillPickerSelected())
                                        if (next.has(key)) next.delete(key)
                                        else next.add(key)
                                        setSkillPickerSelected(next)
                                    }}
                                >
                                    <div
                                        class="size-5 shrink-0 rounded-full flex items-center justify-center {order >
                                            0 &&
                                        group.type !== '谐度破坏' &&
                                        !isResponseHit
                                            ? 'bg-indigo-500 text-white'
                                            : 'border border-white/20'}"
                                    >
                                        {#if order > 0 && group.type !== '谐度破坏' && !isResponseHit}<span
                                                class="text-[10px] font-bold">{order}</span
                                            >{/if}
                                    </div>
                                    <span class="flex-1 truncate" title={displayName}>
                                        {displayName}
                                        {#if isResponseHit}
                                            <span class="text-zinc-600 font-normal normal-case ml-1"
                                                >(请到非直伤配置中配置)</span
                                            >
                                        {/if}
                                    </span>
                                    <span class="text-[var(--theme-modal-text)]/50"
                                        >{hit.ratio}{#if hit.element}<span
                                                class="ml-1"
                                                style="color: {(ELEMENT_COLORS as Record<string, string>)[
                                                    hit.element
                                                ] ?? '#888'}">{hit.element}</span
                                            >{/if}</span
                                    >
                                    {#if getSkillPickerSelected().has(key) && group.type !== '谐度破坏' && !isResponseHit}
                                        <span class="flex items-center gap-1" onclick={(e) => e.stopPropagation()}>
                                            <span class="text-xs text-[var(--theme-modal-text)]/50">×</span>
                                            <input
                                                type="number"
                                                min="0"
                                                max="20"
                                                value={getSkillPickerHitHits()[key] ?? 1}
                                                oninput={(e) => {
                                                    const v = parseInt((e.target as HTMLInputElement).value)
                                                    setSkillPickerHitHits({
                                                        ...getSkillPickerHitHits(),
                                                        [key]: Math.min(20, Math.max(0, isNaN(v) ? 1 : v))
                                                    })
                                                }}
                                                class="w-10 h-6 bg-[var(--theme-modal-bg)]/60 text-xs text-[var(--theme-modal-text)] text-center rounded outline-none border border-white/20 tabular-nums"
                                            />
                                        </span>
                                    {/if}
                                    {#if group.type === '自定义'}
                                        <button
                                            onclick={(e) => {
                                                e.stopPropagation()
                                                removeCustomHit(getSkillPickerCharacter(), hit.name)
                                            }}
                                            class="shrink-0 rounded p-0.5 text-zinc-500 transition-colors hover:text-red-400"
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
            <div class="flex items-center justify-between gap-2 border-t border-white/10 px-4 py-2.5">
                <div class="flex items-center gap-1">
                    <button
                        class="flex items-center gap-1 rounded px-2 py-1 text-xs text-indigo-400 transition-colors hover:bg-white/5"
                        onclick={() => openAddCustom(getSkillPickerCharacter())}
                    >
                        <Icon icon="mdi:plus-circle-outline" class="size-3.5" />
                        添加自定义直伤
                    </button>
                    <button
                        onclick={() => (showLookup = true)}
                        class="flex items-center gap-1 rounded px-2 py-1 text-xs text-indigo-400 transition-colors hover:bg-white/5"
                    >
                        <Icon icon="mdi:magnify" class="size-3.5" />
                        速查
                    </button>
                </div>
                <div class="flex items-center gap-2">
                    <button
                        class="h-7 rounded-md bg-[var(--theme-modal-bg)]/60 px-3 text-xs text-[var(--theme-modal-text)]/60 transition-colors hover:bg-white/10"
                        onclick={() => {
                            setSkillPickerBlockId(null)
                            setSkillPickerIsRef(false)
                        }}>取消</button
                    >
                    <button
                        class="h-7 rounded-md bg-indigo-600 px-3 text-xs text-white transition-colors hover:bg-indigo-500"
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
        class="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-lg"
        onkeydown={(e) => e.key === 'Escape' && (showCustomModal = false)}
    >
        <div
            class="rounded-xl border border-white/10 bg-[var(--theme-modal-bg)] p-5 shadow-xl w-96"
            onclick={(e) => e.stopPropagation()}
        >
            <h3 class="text-sm font-semibold mb-4">自定义直伤</h3>
            <div class="space-y-3">
                <div>
                    <label class="text-[10px] text-[var(--theme-modal-text)]/50 block mb-1">名称</label>
                    <input
                        type="text"
                        bind:value={customName}
                        placeholder="输入名称"
                        class="w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-xs outline-none text-[var(--theme-modal-text)] placeholder:text-[var(--theme-modal-text)]/30"
                    />
                </div>
                <div>
                    <label class="text-[10px] text-[var(--theme-modal-text)]/50 block mb-1">固定值</label>
                    <input
                        type="number"
                        bind:value={customFlat}
                        placeholder="0"
                        class="w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-xs outline-none text-[var(--theme-modal-text)] placeholder:text-[var(--theme-modal-text)]/30"
                    />
                </div>
                <div class="flex gap-2">
                    <div class="flex-1">
                        <label class="text-[10px] text-[var(--theme-modal-text)]/50 block mb-1">百分比值</label>
                        <input
                            type="number"
                            bind:value={customPct}
                            placeholder="0"
                            class="w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-xs outline-none text-[var(--theme-modal-text)] placeholder:text-[var(--theme-modal-text)]/30"
                        />
                    </div>
                    <div class="w-32 relative">
                        <label class="text-[10px] text-[var(--theme-modal-text)]/50 block mb-1">单位</label>
                        <button
                            onclick={() => {
                                showUnitMenu = !showUnitMenu
                                showElementMenu = false
                            }}
                            class="w-full flex items-center justify-between rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-[var(--theme-modal-text)] transition-colors hover:bg-white/10"
                        >
                            <span>{customPctUnit}</span>
                            <svg
                                class="size-3 text-[var(--theme-modal-text)]/40"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"><path d="M6 9l6 6 6-6" /></svg
                            >
                        </button>
                        {#if showUnitMenu}
                            <div
                                class="absolute left-0 top-full z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-[var(--theme-modal-bg)] py-1 shadow-xl backdrop-blur-lg"
                                onclick={(e) => e.stopPropagation()}
                            >
                                {#each PCT_UNITS as u}
                                    <button
                                        onclick={() => {
                                            customPctUnit = u
                                            showUnitMenu = false
                                        }}
                                        class="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left text-[var(--theme-modal-text)] transition-colors hover:bg-white/5"
                                    >
                                        <span class="flex-1">{u}</span>
                                        {#if u === customPctUnit}<svg
                                                class="size-3 text-indigo-400"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                stroke-width="3"><path d="M5 13l4 4L19 7" /></svg
                                            >{/if}
                                    </button>
                                {/each}
                            </div>
                        {/if}
                    </div>
                </div>
                <div class="relative">
                    <label class="text-[10px] text-[var(--theme-modal-text)]/50 block mb-1">属性</label>
                    <button
                        onclick={() => {
                            showElementMenu = !showElementMenu
                            showUnitMenu = false
                        }}
                        class="w-full flex items-center justify-between rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-[var(--theme-modal-text)] transition-colors hover:bg-white/10"
                    >
                        <span>{customElement}</span>
                        <svg
                            class="size-3 text-[var(--theme-modal-text)]/40"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"><path d="M6 9l6 6 6-6" /></svg
                        >
                    </button>
                    {#if showElementMenu}
                        <div
                            class="absolute left-0 top-full z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-[var(--theme-modal-bg)] py-1 shadow-xl backdrop-blur-lg"
                            onclick={(e) => e.stopPropagation()}
                        >
                            {#each ELEMENTS as el}
                                <button
                                    onclick={() => {
                                        customElement = el
                                        showElementMenu = false
                                    }}
                                    class="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left text-[var(--theme-modal-text)] transition-colors hover:bg-white/5"
                                >
                                    <span class="flex-1">{el}</span>
                                    {#if el === customElement}<svg
                                            class="size-3 text-indigo-400"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="3"><path d="M5 13l4 4L19 7" /></svg
                                        >{/if}
                                </button>
                            {/each}
                        </div>
                    {/if}
                </div>
            </div>
            <div class="flex justify-end gap-2 mt-5">
                <button
                    onclick={() => (showCustomModal = false)}
                    class="h-7 rounded-md bg-white/5 px-3 text-xs text-[var(--theme-modal-text)]/60 transition-colors hover:bg-white/10"
                    >取消</button
                >
                <button
                    onclick={() => confirmAddCustom(getSkillPickerCharacter())}
                    class="h-7 rounded-md bg-indigo-600 px-3 text-xs text-white transition-colors hover:bg-indigo-500"
                    >确认</button
                >
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
