<script lang="ts">
    /**
     * @desc 词条集弹窗（两套 UI，由打开入口决定）：
     * - project（标题「快速词条方案」）：从工程打开 → 配队三个角色各一栏，每栏列出该角色全部方案（标准14词条在最前，其余为自定义），可就地套用/重命名/删除；
     * - home（标题「词条集」）：从主页打开（此时没有工程）→ 全角色管理视图，标准14词条可修改/可从工坊同步（不可删除），自定义方案可增删改。
     */
    import Icon from '@iconify/svelte'
    import { fade } from 'svelte/transition'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import SubstatPlanCard from '$lib/components/layout/substat-plan-card.svelte'
    import SubstatPlanEditModal from '$lib/components/layout/substat-plan-edit-modal.svelte'
    import {
        deleteSubstatPlan,
        fetchSubstatPlansFromShare,
        getStoredStandardPlan,
        getSubstatPlansFor,
        loadSubstatLibrary,
        renameSubstatPlan,
        resetStandardPlan,
        saveSubstatPlan,
        type SubstatPlan
    } from '$lib/data/substat-library.svelte'
    import {
        closeSubstatLibrary,
        getSubstatLibraryCharacter,
        getSubstatLibraryMode,
        getSubstatLibraryOpen
    } from '$lib/data/substat-library-ui.svelte'
    import { ensureCharInfo, getCharInfoMap } from '$lib/data/char-info.svelte'
    import {
        buildBlankSlots,
        buildStandardSlots,
        cloneSlots,
        samePlanSlots,
        STANDARD_PLAN_NAME
    } from '$lib/calc/standard-substats'
    import { getConfig, setEchoSlots } from '$lib/calc/config.store.svelte'
    import { getActiveProject, updateConfig } from '$lib/data/project.svelte'
    import { getCharacterIcons, getCharacterList } from '$lib/api/data-cache'
    import type { Character } from '$lib/api/types'
    import type { EchoSlotConfig } from '$lib/calc/config.types'
    import { addToast } from '$lib/data/toast.svelte'

    interface Props extends ComponentsProps {}

    let { backgroundImage, textColor, class: className, style: styleProp }: Props = $props()

    let mergedStyle = $derived(
        [
            backgroundImage ? `background: ${backgroundImage}` : '',
            textColor ? `color: ${textColor}` : '',
            styleProp || ''
        ]
            .filter(Boolean)
            .join(';')
    )

    /** @desc 工程版栏内的一张方案卡片数据（标准14词条 + 自定义方案统一成一种结构） */
    interface PlanRow {
        key: string
        standard: boolean
        name: string
        slots: EchoSlotConfig[]
        origin?: string
        plan?: SubstatPlan
    }

    let selected = $state('')
    let query = $state('')
    /** @desc 卡片展开状态：标准14词条默认展开，自定义默认收起；逐卡片独立，互不影响 */
    let expandOverride = $state<Record<string, boolean>>({})
    /** @desc 正在编辑的方案（主页管理视图）：key 为卡片 key，新建的方案用 draft- 前缀 */
    let editing = $state<{ key: string; name: string; standard: boolean; slots: EchoSlotConfig[] } | null>(null)
    let saving = $state(false)
    let syncing = $state(false)
    let renameId = $state<string | null>(null)
    let renameText = $state('')

    let characters = $state<Character[]>([])
    let icons = $state<Record<string, string>>({})
    let dataLoaded = false

    const open = $derived(getSubstatLibraryOpen())
    const mode = $derived(getSubstatLibraryMode())
    const project = $derived(getActiveProject())
    /** @desc 工程版要求确实有工程与配队，否则自动回落到管理视图 */
    const isProjectMode = $derived(mode === 'project' && !!project)
    const charInfoMap = $derived(getCharInfoMap())

    /** @desc 配队三角色（按位次，忽略空位） */
    const teamChars = $derived((project?.team ?? []).map((s) => s.character).filter((name): name is string => !!name))

    $effect(() => {
        if (dataLoaded) return
        dataLoaded = true
        Promise.allSettled([getCharacterList(), getCharacterIcons()]).then((results) => {
            const [list, iconMap] = results
            if (list.status === 'fulfilled') characters = list.value
            if (iconMap.status === 'fulfilled') icons = iconMap.value
        })
    })

    /** @desc 打开时：懒加载本地库，并把初始角色（词条页传入）设为管理视图选中项 */
    let prevOpen = $state(false)
    $effect(() => {
        if (open && !prevOpen) {
            void loadSubstatLibrary()
            const initial = getSubstatLibraryCharacter()
            const names = characters.map((c) => c.name)
            selected = initial ?? project?.team.find((s) => s.character)?.character ?? names[0] ?? ''
            expandOverride = {}
        }
        prevOpen = open
    })

    /** @desc 角色数据（标准词条按角色元素/固有属性自动生成，需要先补齐） */
    $effect(() => {
        if (!open) return
        for (const name of teamChars) void ensureCharInfo(name)
        if (!isProjectMode && selected) void ensureCharInfo(selected)
    })

    /** @desc 某角色的标准 14 词条：工坊/本地已保存的优先，否则按角色数据自动生成 */
    const standardSlotsFor = (character: string): EchoSlotConfig[] | null => {
        const stored = getStoredStandardPlan(character)
        if (stored) return stored.slots
        const info = charInfoMap[character]
        if (!info) return null
        return buildStandardSlots({ element: info.element, statNodes: info.statNodes })
    }

    const standardOriginFor = (character: string): string => {
        const stored = getStoredStandardPlan(character)
        if (!stored) return '自动生成'
        return stored.source === 'share' ? '工坊' : '本地自定义'
    }

    /** @desc 某角色的全部方案：标准14词条在最前，其余为该角色的自定义方案（按名称排序） */
    const planRowsFor = (character: string): PlanRow[] => {
        const rows: PlanRow[] = []
        const standardSlots = standardSlotsFor(character)
        if (standardSlots) {
            rows.push({
                key: `standard|${character}`,
                standard: true,
                name: STANDARD_PLAN_NAME,
                slots: standardSlots,
                origin: standardOriginFor(character)
            })
        }
        for (const plan of getSubstatPlansFor(character)
            .filter((p) => !p.standard)
            .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))) {
            rows.push({ key: plan.id, standard: false, name: plan.name, slots: plan.slots, plan })
        }
        return rows
    }

    /** @desc 主页管理视图角色列表：全部角色 + 库里已有但角色目录没有的名字；有自定义方案在前，标准14词条有改动/同步过的其次，最后是无记录角色 */
    const homeRows = $derived.by(() => {
        const all = characters.map((c) => c.name)
        if (selected && !all.includes(selected)) all.push(selected)
        const q = query.trim().toLowerCase()
        const rows = all
            .filter((name) => (q ? name.toLowerCase().includes(q) : true))
            .map((name) => {
                const hasCustom = getSubstatPlansFor(name).some((p) => !p.standard)
                const standardChanged = !!getStoredStandardPlan(name)
                return { name, hasCustom, standardChanged, group: hasCustom ? 0 : standardChanged ? 1 : 2 }
            })
        return rows.sort((a, b) =>
            a.group !== b.group ? a.group - b.group : a.name.localeCompare(b.name, 'zh-Hans-CN')
        )
    })

    const teamIndexOf = (character: string) => project?.team.findIndex((s) => s.character === character) ?? -1
    const slotLabelOf = (character: string) => {
        const idx = teamIndexOf(character)
        return idx >= 0 ? `队伍 ${idx + 1} 号位` : '不在当前配队中'
    }

    /** @desc 当前工程里该角色已配置的词条（用于判断某方案是否「已是当前方案」） */
    const currentSlotsFor = (character: string): EchoSlotConfig[] => {
        const idx = teamIndexOf(character)
        return idx >= 0 ? (getConfig().characters[idx]?.echoes ?? []) : []
    }

    const isCurrentPlan = (character: string, slots: EchoSlotConfig[]) =>
        samePlanSlots(currentSlotsFor(character), slots)

    /** @desc 展开状态：标准14词条默认展开，自定义默认收起；逐卡片记忆，互不影响 */
    const isExpanded = (row: PlanRow) => expandOverride[row.key] ?? row.standard

    const toggleExpand = (row: PlanRow) => {
        expandOverride = { ...expandOverride, [row.key]: !isExpanded(row) }
    }

    function applyPlan(character: string, slots: EchoSlotConfig[], label: string) {
        const idx = teamIndexOf(character)
        if (idx < 0) {
            addToast('该角色不在当前配队中：请先把角色编入队伍', 'info')
            return
        }
        if (!setEchoSlots(idx, cloneSlots(slots))) {
            addToast('套用失败：方案结构非法或声骸总 cost 超过 12', 'error')
            return
        }
        void updateConfig(getConfig())
        addToast(`已把「${character}」的声骸词条替换为「${label}」`, 'success')
    }

    async function commitRename(plan: SubstatPlan) {
        const name = renameText.trim()
        if (!name || name === plan.name) {
            renameId = null
            return
        }
        const ok = await renameSubstatPlan(plan.id, name)
        addToast(ok ? `已重命名为「${name}」` : '重命名失败', ok ? 'success' : 'error')
        renameId = null
    }

    async function removePlan(plan: SubstatPlan) {
        const ok = await deleteSubstatPlan(plan.id)
        addToast(ok ? `已删除方案「${plan.name}」` : '删除失败', ok ? 'success' : 'info')
    }

    async function resetStandard(character: string) {
        await resetStandardPlan(character)
        addToast('已重置标准词条集：将回落到工坊方案 / 自动生成', 'success')
    }

    /** @desc 从工坊同步全部角色的标准14词条集（主页管理视图用） */
    async function syncFromShare() {
        if (syncing) return
        syncing = true
        const result = await fetchSubstatPlansFromShare()
        syncing = false
        if (result.ok) addToast(`已从工坊同步 ${result.added} 个角色的标准词条集`, 'success')
        else addToast(`同步失败：${result.error ?? '未知错误'}`, 'error')
    }

    /** @desc 进入编辑：标准卡带出当前标准方案，自定义卡带出该方案；新建卡以标准14词条为起点 */
    const startEdit = (key: string, name: string, standard: boolean, slots: EchoSlotConfig[]) => {
        editing = { key, name, standard, slots: cloneSlots(slots) }
    }

    const cancelEdit = () => {
        editing = null
    }

    /** @desc 新建自定义方案：可选以该角色标准14词条为起点，或从空白骨架（43311、无主副词条）开始 */
    const startNewPlan = (character: string, fromStandard: boolean) => {
        const standard = fromStandard ? standardSlotsFor(character) : null
        if (fromStandard && !standard) {
            addToast('角色数据还没加载完，请稍候再试', 'info')
            return
        }
        const count = getSubstatPlansFor(character).filter((p) => !p.standard).length
        const name = `方案${count + 1}`
        startEdit(`draft|${character}|${name}`, name, false, standard ?? buildBlankSlots())
    }

    /** @desc 保存编辑器草稿：标准14词条要求恰好 14 条副词条（数据层会再校验一次） */
    async function saveEditing(slots: EchoSlotConfig[]) {
        const target = editing
        if (!target || !selected) return
        saving = true
        const id = await saveSubstatPlan({
            character: selected,
            name: target.standard ? STANDARD_PLAN_NAME : target.name,
            standard: target.standard,
            slots
        })
        saving = false
        if (!id) {
            addToast(target.standard ? '保存失败：标准词条集需要恰好 14 条副词条' : '保存失败：方案结构非法', 'error')
            return
        }
        editing = null
        addToast(`已保存方案「${target.name}」`, 'success')
    }
</script>

{#snippet standardActions(character: string)}
    {#if isCurrentPlan(character, standardSlotsFor(character) ?? [])}
        <button
            disabled
            class="rounded-none border px-2.5 py-1 text-[10px] whitespace-nowrap text-(--theme-modal-text)/40 transition-colors disabled:opacity-100"
            style="border-color: var(--theme-divider-border);"
            title="当前工程该角色的词条已与这套方案一致">已是当前方案</button
        >
    {:else}
        <button
            onclick={() => applyPlan(character, standardSlotsFor(character) ?? [], STANDARD_PLAN_NAME)}
            disabled={teamIndexOf(character) < 0}
            class="rounded-none border px-2.5 py-1 text-[10px] transition-colors disabled:opacity-40"
            style="border-color: var(--theme-accent-bg); color: var(--theme-accent-text);">一键套用</button
        >
    {/if}
    {#if standardOriginFor(character) !== '自动生成'}
        <button
            onclick={() => resetStandard(character)}
            class="rounded-none border px-2.5 py-1 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
            style="border-color: var(--theme-divider-border);"
            title="清掉本地/工坊保存的方案，回落到工坊同步或自动生成">重置</button
        >
    {/if}
{/snippet}

{#snippet customActions(character: string, plan: SubstatPlan)}
    {#if isCurrentPlan(character, plan.slots)}
        <button
            disabled
            class="rounded-none border px-2.5 py-1 text-[10px] whitespace-nowrap text-(--theme-modal-text)/40 transition-colors disabled:opacity-100"
            style="border-color: var(--theme-divider-border);"
            title="当前工程该角色的词条已与这套方案一致">已是当前方案</button
        >
    {:else}
        <button
            onclick={() => applyPlan(character, plan.slots, plan.name)}
            disabled={teamIndexOf(character) < 0}
            class="rounded-none border px-2.5 py-1 text-[10px] transition-colors disabled:opacity-40"
            style="border-color: var(--theme-accent-bg); color: var(--theme-accent-text);">套用</button
        >
    {/if}
    <button
        onclick={() => {
            renameId = plan.id
            renameText = plan.name
        }}
        class="rounded-none border px-2.5 py-1 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
        style="border-color: var(--theme-divider-border);">重命名</button
    >
    <button
        onclick={() => removePlan(plan)}
        class="rounded-none border px-2.5 py-1 text-[10px] text-(--theme-modal-text)/40 transition-colors hover:border-red-500/50 hover:text-red-500"
        style="border-color: var(--theme-divider-border);">删除</button
    >
{/snippet}

<Modal
    {open}
    onclose={closeSubstatLibrary}
    backdropClose
    noScroll
    class="{isProjectMode ? 'w-[84rem] max-w-[97vw]' : 'w-[60rem] max-w-[94vw]'} h-[80vh] {className}"
    style={mergedStyle}
>
    {#snippet title()}
        <span class="flex items-center gap-2">
            <Icon icon="mdi:clipboard-text-outline" class="size-4" style="color: var(--theme-accent-text);" />
            <span class="font-black tracking-tight">{isProjectMode ? '快速词条方案' : '词条集'}</span>
            {#if isProjectMode}
                <span class="text-[10px] font-normal tracking-[0.22em] text-(--theme-modal-text)/40">当前配队</span>
            {/if}
        </span>
    {/snippet}

    {#if isProjectMode}
        <!-- ── 工程版：配队三角色各一栏，栏内列出该角色全部方案 ── -->
        <div class="grid h-full min-h-0 grid-cols-3 gap-4">
            {#each project!.team as slot, ci (ci)}
                {@const character = slot.character}
                <div
                    class="flex min-h-0 flex-col gap-3 rounded-none border p-3.5"
                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                >
                    <!-- 栏头：角色 + 位次 -->
                    <div class="flex shrink-0 items-center gap-2.5">
                        {#if character && icons[character]}
                            <img src={icons[character]} alt="" class="size-10 shrink-0 rounded-full object-cover" />
                        {:else}
                            <span
                                class="flex size-10 shrink-0 items-center justify-center rounded-full bg-(--theme-input-bg) text-xs text-(--theme-modal-text)/40"
                                >{character?.slice(0, 1) ?? ci + 1}</span
                            >
                        {/if}
                        <div class="min-w-0 flex-1">
                            <div class="truncate text-sm font-black tracking-tight text-(--theme-modal-text)">
                                {character ?? `空位 ${ci + 1}`}
                            </div>
                            <div class="text-[10px] text-(--theme-modal-text)/40">{slotLabelOf(character ?? '')}</div>
                        </div>
                    </div>

                    {#if !character}
                        <div class="py-6 text-center text-xs text-(--theme-modal-text)/40">该位次没有角色</div>
                    {:else}
                        <!-- 方案列表：标准14词条在最前，其余为自定义 -->
                        <div class="theme-scrollbar -mr-1.5 min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1.5">
                            {#each planRowsFor(character) as row (row.key)}
                                <div in:fade={{ duration: 100 }}>
                                    <SubstatPlanCard
                                        name={row.name}
                                        slots={row.slots}
                                        standard={row.standard}
                                        origin={row.origin}
                                        expanded={isExpanded(row)}
                                        onexpand={() => toggleExpand(row)}
                                    >
                                        {#snippet actions()}
                                            {#if renameId === row.key && row.plan}
                                                <input
                                                    bind:value={renameText}
                                                    class="h-7 min-w-0 flex-1 rounded-none border bg-transparent px-2 text-[10px] outline-none"
                                                    style="border-color: var(--theme-divider-border); color: var(--theme-modal-text);"
                                                />
                                                <button
                                                    onclick={() => commitRename(row.plan!)}
                                                    class="rounded-none border px-2.5 py-1 text-[10px]"
                                                    style="border-color: var(--theme-accent-bg); color: var(--theme-accent-text);"
                                                    >确定</button
                                                >
                                                <button
                                                    onclick={() => (renameId = null)}
                                                    class="rounded-none border px-2.5 py-1 text-[10px] text-(--theme-modal-text)/40"
                                                    style="border-color: var(--theme-divider-border);">取消</button
                                                >
                                            {:else if row.standard}
                                                {@render standardActions(character)}
                                            {:else if row.plan}
                                                {@render customActions(character, row.plan)}
                                            {/if}
                                        {/snippet}
                                    </SubstatPlanCard>
                                </div>
                            {/each}
                            {#if planRowsFor(character).length === 0}
                                <div class="py-6 text-center text-xs text-(--theme-modal-text)/40">
                                    正在加载角色数据…
                                </div>
                            {/if}
                        </div>
                    {/if}
                </div>
            {/each}
        </div>
    {:else}
        <!-- ── 主页版：全角色管理（查看/维护方案，不套用；编辑在独立弹窗里） ── -->
        <div class="flex h-full min-h-0 flex-col">
            <p class="mb-3 shrink-0 text-[10px] leading-relaxed text-(--theme-modal-text)/40">
                管理各角色的标准14词条与自定义声骸方案；进入工程后可一键套用到配队角色
            </p>

            <div class="flex min-h-0 flex-1 gap-4">
                <div class="flex w-72 shrink-0 flex-col gap-2">
                    <div
                        class="flex shrink-0 items-center gap-2 rounded-none border border-(--theme-divider-border) bg-(--theme-input-bg) px-3 py-2"
                    >
                        <Icon icon="mdi:magnify" class="size-4 shrink-0 text-(--theme-modal-text)/40" />
                        <input
                            bind:value={query}
                            placeholder="搜索角色…"
                            class="min-w-0 flex-1 bg-transparent text-sm outline-none text-(--theme-modal-text) placeholder:text-(--theme-modal-text)/35"
                        />
                    </div>
                    <div class="theme-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
                        {#each homeRows as row (row.name)}
                            <button
                                onclick={() => {
                                    selected = row.name
                                    editing = null
                                }}
                                in:fade={{ duration: 100 }}
                                class={[
                                    'flex w-full items-center gap-2 rounded-none border px-2.5 py-2 text-left text-xs transition-colors',
                                    selected === row.name
                                        ? 'border-(--theme-accent-bg)'
                                        : 'border-(--theme-divider-border) bg-(--theme-input-bg) hover:bg-(--theme-modal-text)/5'
                                ].join(' ')}
                                style={selected === row.name
                                    ? 'background: color-mix(in srgb, var(--theme-accent-bg) 18%, transparent);'
                                    : ''}
                            >
                                {#if icons[row.name]}
                                    <img
                                        src={icons[row.name]}
                                        alt=""
                                        class="size-8 shrink-0 rounded-full object-cover"
                                    />
                                {:else}
                                    <span
                                        class="flex size-8 shrink-0 items-center justify-center rounded-full bg-(--theme-input-bg) text-[10px] text-(--theme-modal-text)/40"
                                        >{row.name.slice(0, 1)}</span
                                    >
                                {/if}
                                <span class="min-w-0 flex-1 truncate text-(--theme-modal-text)">{row.name}</span>
                                <span class="flex shrink-0 items-center gap-1">
                                    {#if row.hasCustom}
                                        <span
                                            class="rounded-none px-1 py-0.5 text-[10px] whitespace-nowrap text-(--theme-modal-text)/40"
                                            style="background: color-mix(in srgb, var(--theme-accent-bg) 18%, transparent); color: var(--theme-accent-text);"
                                            >有自定义</span
                                        >
                                    {/if}
                                    {#if row.standardChanged}
                                        <span
                                            class="rounded-none px-1 py-0.5 text-[10px] whitespace-nowrap text-(--theme-modal-text)/40"
                                            style="background: color-mix(in srgb, var(--theme-modal-text) 8%, transparent);"
                                            >14词条·改</span
                                        >
                                    {/if}
                                </span>
                            </button>
                        {/each}
                        {#if homeRows.length === 0}
                            <div class="py-8 text-center text-xs text-(--theme-modal-text)/40">没有匹配的角色</div>
                        {/if}
                    </div>
                </div>

                <div class="theme-scrollbar min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-0.5">
                    {#if !selected}
                        <div
                            class="flex h-full flex-col items-center justify-center gap-2 text-xs text-(--theme-modal-text)/40"
                        >
                            <Icon icon="mdi:account-search-outline" class="size-9" />
                            从左侧选择一个角色
                        </div>
                    {:else}
                        <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                            <Icon
                                icon="mdi:clipboard-text-outline"
                                class="size-4 shrink-0"
                                style="color: var(--theme-accent-text);"
                            />
                            <h3 class="text-base font-black tracking-tight text-(--theme-modal-text)">{selected}</h3>
                            <span class="flex-1"></span>
                            <button
                                onclick={() => startNewPlan(selected, true)}
                                class="rounded-none border border-(--theme-accent-bg) px-2.5 py-1 text-[10px] text-(--theme-accent-text) transition-colors hover:bg-(--theme-accent-bg)/10"
                                title="以该角色的标准14词条为起点新建一条自定义方案">从14词条新建</button
                            >
                            <button
                                onclick={() => startNewPlan(selected, false)}
                                class="rounded-none border px-2.5 py-1 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                                style="border-color: var(--theme-divider-border);"
                                title="从空白骨架（43311 cost、无主词条与副词条）新建自定义方案">从空白新建</button
                            >
                        </div>
                        {#each planRowsFor(selected) as row (row.key)}
                            <SubstatPlanCard
                                name={row.name}
                                slots={row.slots}
                                standard={row.standard}
                                origin={row.origin}
                                expanded={isExpanded(row)}
                                onexpand={() => toggleExpand(row)}
                            >
                                {#snippet actions()}
                                    {#if renameId === row.key && row.plan}
                                        <input
                                            bind:value={renameText}
                                            class="h-7 min-w-0 flex-1 rounded-none border bg-transparent px-2 text-[10px] outline-none"
                                            style="border-color: var(--theme-divider-border); color: var(--theme-modal-text);"
                                        />
                                        <button
                                            onclick={() => commitRename(row.plan!)}
                                            class="rounded-none border px-2.5 py-1 text-[10px]"
                                            style="border-color: var(--theme-accent-bg); color: var(--theme-accent-text);"
                                            >确定</button
                                        >
                                        <button
                                            onclick={() => (renameId = null)}
                                            class="rounded-none border px-2.5 py-1 text-[10px] text-(--theme-modal-text)/40"
                                            style="border-color: var(--theme-divider-border);">取消</button
                                        >
                                    {:else if row.standard}
                                        <button
                                            onclick={() => startEdit(row.key, row.name, true, row.slots)}
                                            class="rounded-none border border-(--theme-accent-bg) px-2.5 py-1 text-[10px] text-(--theme-accent-text) transition-colors hover:bg-(--theme-accent-bg)/10"
                                            title="修改该角色的标准14词条（保存时需恰好 14 条副词条）">修改</button
                                        >
                                        <button
                                            onclick={syncFromShare}
                                            disabled={syncing}
                                            class="inline-flex items-center gap-1 rounded-none border px-2.5 py-1 text-[10px] transition-colors disabled:opacity-40"
                                            style="border-color: var(--theme-divider-border); color: var(--theme-accent-text);"
                                            title="从工坊同步全部角色的标准14词条集"
                                        >
                                            <Icon
                                                icon={syncing ? 'mdi:loading' : 'mdi:cloud-download-outline'}
                                                class={syncing ? 'size-3 animate-spin' : 'size-3'}
                                            />
                                            从工坊同步
                                        </button>
                                        {#if standardOriginFor(selected) !== '自动生成'}
                                            <button
                                                onclick={() => resetStandard(selected)}
                                                class="rounded-none border px-2.5 py-1 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                                                style="border-color: var(--theme-divider-border);"
                                                title="清掉本地/工坊保存的方案，回落到工坊同步或自动生成">重置</button
                                            >
                                        {/if}
                                    {:else if row.plan}
                                        <button
                                            onclick={() =>
                                                startEdit(row.plan!.id, row.plan!.name, false, row.plan!.slots)}
                                            class="rounded-none border border-(--theme-accent-bg) px-2.5 py-1 text-[10px] text-(--theme-accent-text) transition-colors hover:bg-(--theme-accent-bg)/10"
                                            >修改</button
                                        >
                                        <button
                                            onclick={() => {
                                                renameId = row.plan!.id
                                                renameText = row.plan!.name
                                            }}
                                            class="rounded-none border px-2.5 py-1 text-[10px] text-(--theme-modal-text)/60 transition-colors hover:text-(--theme-modal-text)"
                                            style="border-color: var(--theme-divider-border);">重命名</button
                                        >
                                        <button
                                            onclick={() => removePlan(row.plan!)}
                                            class="rounded-none border px-2.5 py-1 text-[10px] text-(--theme-modal-text)/40 transition-colors hover:border-red-500/50 hover:text-red-500"
                                            style="border-color: var(--theme-divider-border);">删除</button
                                        >
                                    {/if}
                                {/snippet}
                            </SubstatPlanCard>
                        {/each}
                        {#if planRowsFor(selected).length === 0}
                            <div class="py-8 text-center text-xs text-(--theme-modal-text)/40">正在加载角色数据…</div>
                        {/if}
                    {/if}
                </div>
            </div>
        </div>
    {/if}
</Modal>

<!-- 方案编辑弹窗：与列表弹窗同级、DOM 在后，因此叠在列表之上 -->
<SubstatPlanEditModal
    open={editing !== null}
    character={selected}
    name={editing?.name ?? ''}
    standard={editing?.standard ?? false}
    slots={editing?.slots ?? []}
    {saving}
    onsave={saveEditing}
    oncancel={cancelEdit}
/>
