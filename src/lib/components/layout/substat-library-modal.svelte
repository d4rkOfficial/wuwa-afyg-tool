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
    import { getCharacterIcons, getCharacterList, getElementIcons } from '$lib/api/data-cache'
    import type { Character } from '$lib/api/types'
    import type { EchoSlotConfig } from '$lib/calc/config.types'
    import { addToast } from '$lib/data/toast.svelte'
    import {
        isKuroLoggedIn,
        KuroGeetestRequiredError,
        refreshKuroSession,
        requestKuroSettings,
        waitForKuroLogin
    } from '$lib/kuro-app/kuro.svelte'
    import { solveGeetest } from '$lib/kuro-app/geetest'
    import { openPanel } from '$lib/ai/panels.svelte'
    import { ELEMENT_ORDER } from '$lib/consts/game-terms'
    import { compareRoverStarName, groupInOrder } from '$lib/utils/grouping'
    import {
        applyKuroSync,
        previewSubstatPlansFromKuro,
        type KuroPlanPick,
        type KuroSyncPreview
    } from '$lib/kuro-app/kuro-sync.svelte'
    import KuroSyncPreviewModal from '$lib/kuro-app/kuro-sync-preview-modal.svelte'

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
    /** @desc 库街区同步进行中（与工坊同步分开，两者可各自独立禁用） */
    let kuroSyncing = $state(false)
    /** @desc 库街区同步预览（确认弹窗展示，确认后才落盘） */
    let kuroPreview = $state<KuroSyncPreview | null>(null)
    let kuroPreviewOpen = $state(false)
    let renameId = $state<string | null>(null)
    let renameText = $state('')

    let characters = $state<Character[]>([])
    let icons = $state<Record<string, string>>({})
    let elementIcons = $state<Record<string, string>>({})
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
        Promise.allSettled([getCharacterList(), getCharacterIcons(), getElementIcons()]).then((results) => {
            const [list, iconMap, elementMap] = results
            if (list.status === 'fulfilled') characters = list.value
            if (iconMap.status === 'fulfilled') icons = iconMap.value
            if (elementMap.status === 'fulfilled') elementIcons = elementMap.value
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

    /** @desc 主页管理视图角色分组：按属性分类（属性图标 + 属性名当小标题），组内漂泊者最先、再按星级与名字 */
    const homeGroups = $derived.by(() => {
        const byName = new Map(characters.map((c) => [c.name, c]))
        const all = characters.map((c) => c.name)
        if (selected && !all.includes(selected)) all.push(selected)
        const q = query.trim().toLowerCase()
        const items = all
            .filter((name) => (q ? name.toLowerCase().includes(q) : true))
            .map((name) => ({ name, star: byName.get(name)?.star, element: byName.get(name)?.element ?? '' }))
        return groupInOrder(items, (item) => item.element, ELEMENT_ORDER).map((group) => ({
            key: group.key,
            items: [...group.items].sort(compareRoverStarName)
        }))
    })

    const homeCount = $derived(homeGroups.reduce((n, g) => n + g.items.length, 0))

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

    /** @desc 库街区同步：把账号下鸣潮角色「当前装配的声骸」存成自定义方案（同名覆盖，可重复同步）；
     *  与 AI/WS 工具共用 kuro-sync 里的同一份实现。
     *  没登录时不直接报错：先按 cookie 读会话，仍没登录就打开设置（连接配置）并等登录结果，登录完自动继续；
     *  不做「检验有效性」——那是设置里的入口。 */
    async function syncFromKuro() {
        if (kuroSyncing) return
        kuroSyncing = true
        try {
            await refreshKuroSession(false)
            if (!isKuroLoggedIn()) {
                requestKuroSettings()
                openPanel('settings', true)
                addToast('请先在「设置 → 连接配置 → 库街区账号」登录，登录完成后会自动继续同步', 'info')
                const loggedIn = await waitForKuroLogin()
                if (!loggedIn) {
                    addToast('未完成库街区登录，已取消同步', 'error')
                    return
                }
            }
            // 先只读预览，交用户在确认弹窗里挑选角色/改方案名，再落盘。
            // 上游风控（取数接口返回 data.geeTest=true）时要求极验：就地弹验证，拿到数据后重试一次。
            let res: Awaited<ReturnType<typeof previewSubstatPlansFromKuro>>
            try {
                res = await previewSubstatPlansFromKuro()
            } catch (e) {
                if (!(e instanceof KuroGeetestRequiredError)) throw e
                // 没配置库街区的极验 captchaId 就不弹验证窗口（弹错租户的验证过了也没用），只给可执行的提示
                if (!e.captchaId) {
                    addToast('上游要求人机验证（短时间请求过多会触发风控）：请等几分钟再同步一次', 'error')
                    return
                }
                addToast('库街区要求完成人机验证，请在弹出的验证窗口里完成', 'info')
                let validate: Awaited<ReturnType<typeof solveGeetest>>
                try {
                    validate = await solveGeetest(e.captchaId, e.product)
                } catch (err) {
                    addToast(`人机验证失败：${err instanceof Error ? err.message : String(err)}`, 'error')
                    return
                }
                res = await previewSubstatPlansFromKuro({
                    geeTestData: JSON.stringify({ ...validate, captcha_id: e.captchaId })
                }).catch((err) => {
                    // 验证数据已提交但上游仍要验证：说明该 captchaId 不是这个接口的租户，或验证只对单次请求有效
                    if (err instanceof KuroGeetestRequiredError) {
                        throw new Error(
                            '验证已提交但上游仍然要求人机验证（可能极验租户不对，或验证数据只对单次请求有效）'
                        )
                    }
                    throw err
                })
            }
            if (!res.preview) {
                addToast(`库街区同步失败：${res.error ?? '未知错误'}`, 'error')
                return
            }
            // 上游有数据但一个都没能落到方案上时，也要把确认弹窗打开：里面能看到每个角色被跳过的原因
            if (!res.ok) addToast(`库街区同步：${res.error ?? '没有可同步的角色'}`, 'error')
            kuroPreview = res.preview
            kuroPreviewOpen = true
        } catch (e) {
            addToast(`库街区同步失败：${e instanceof Error ? e.message : String(e)}`, 'error')
        } finally {
            kuroSyncing = false
        }
    }

    /** @desc 确认弹窗里点「写入」：按勾选角色落盘（同名方案覆盖），漂泊者等形态在弹窗里已指定 */
    async function confirmKuroSync(opts: { planName: string; picks: KuroPlanPick[] }) {
        if (!kuroPreview) return
        kuroSyncing = true
        const result = await applyKuroSync(kuroPreview, opts)
        kuroSyncing = false
        kuroPreviewOpen = false
        if (!result.ok) {
            addToast(`库街区同步失败：${result.error ?? '未知错误'}`, 'error')
            return
        }
        addToast(
            `已从库街区同步 ${result.synced} 个角色的声骸方案${result.skipped.length > 0 ? `，跳过 ${result.skipped.length} 个` : ''}`,
            'success'
        )
        if (result.unmatchedNames.length > 0) {
            addToast(`有未识别的词条名：${result.unmatchedNames.slice(0, 4).join('、')}`, 'error')
        }
        kuroPreview = null
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
                                            {#if row.standard}
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
            <div
                class="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b pb-2.5"
                style="border-color: var(--theme-divider-border);"
            >
                <p class="text-[10px] leading-relaxed text-(--theme-modal-text)/40">
                    管理各角色的标准14词条与自定义声骸方案；进入工程后可一键套用到配队角色
                </p>
                <div class="flex items-center gap-2">
                    <button
                        onclick={syncFromKuro}
                        disabled={kuroSyncing}
                        class="inline-flex items-center gap-1 rounded-none border px-3 py-1.5 text-[11px] font-medium text-(--theme-accent-text) transition-colors hover:border-(--theme-accent-bg) disabled:opacity-40"
                        style="border-color: var(--theme-divider-border);"
                        title="登录库街区后，把账号下鸣潮角色当前装配的声骸同步成自定义方案（实验性）"
                    >
                        <Icon
                            icon={kuroSyncing ? 'mdi:loading' : 'mdi:account-sync-outline'}
                            class={kuroSyncing ? 'size-3.5 animate-spin' : 'size-3.5'}
                        />
                        从库街区同步
                    </button>
                    <button
                        onclick={syncFromShare}
                        disabled={syncing}
                        class="inline-flex items-center gap-1 rounded-none px-3 py-1.5 text-[11px] font-medium transition-all hover:brightness-125 disabled:opacity-40"
                        style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
                        title="从工坊同步全部角色的标准14词条集"
                    >
                        <Icon
                            icon={syncing ? 'mdi:loading' : 'mdi:download'}
                            class={syncing ? 'size-3.5 animate-spin' : 'size-3.5'}
                        />
                        从工坊同步
                    </button>
                </div>
            </div>

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
                    <div class="theme-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
                        {#each homeGroups as group (group.key || 'other')}
                            <div class="space-y-1">
                                <div class="flex items-center gap-1.5">
                                    {#if elementIcons[group.key]}
                                        <img
                                            src={elementIcons[group.key]}
                                            alt=""
                                            class="size-4 shrink-0 object-contain"
                                        />
                                    {/if}
                                    <span class="text-[11px] font-black text-(--theme-modal-text)/60">{group.key}</span>
                                    <span class="text-[10px] text-(--theme-modal-text)/30">{group.items.length}</span>
                                    <span
                                        class="h-px flex-1"
                                        style="background: color-mix(in srgb, var(--theme-modal-text) 10%, transparent);"
                                    ></span>
                                </div>
                                {#each group.items as item (item.name)}
                                    <button
                                        onclick={() => {
                                            selected = item.name
                                            editing = null
                                        }}
                                        in:fade={{ duration: 100 }}
                                        class={[
                                            'flex w-full items-center gap-2 rounded-none border px-2.5 py-2 text-left text-xs transition-colors',
                                            selected === item.name
                                                ? 'border-(--theme-accent-bg)'
                                                : 'border-(--theme-divider-border) bg-(--theme-input-bg) hover:bg-(--theme-modal-text)/5'
                                        ].join(' ')}
                                        style={selected === item.name
                                            ? 'background: color-mix(in srgb, var(--theme-accent-bg) 18%, transparent);'
                                            : ''}
                                    >
                                        {#if icons[item.name]}
                                            <img
                                                src={icons[item.name]}
                                                alt=""
                                                class="size-8 shrink-0 rounded-full object-cover"
                                            />
                                        {:else}
                                            <span
                                                class="flex size-8 shrink-0 items-center justify-center rounded-full bg-(--theme-input-bg) text-[10px] text-(--theme-modal-text)/40"
                                                >{item.name.slice(0, 1)}</span
                                            >
                                        {/if}
                                        <span class="min-w-0 flex-1 truncate text-(--theme-modal-text)"
                                            >{item.name}</span
                                        >
                                    </button>
                                {/each}
                            </div>
                        {/each}
                        {#if homeCount === 0}
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

<!-- 库街区同步预览/确认弹窗：与列表弹窗同级、DOM 在后，因此叠在列表之上 -->
<KuroSyncPreviewModal
    open={kuroPreviewOpen}
    preview={kuroPreview}
    {characters}
    {icons}
    busy={kuroSyncing}
    onconfirm={confirmKuroSync}
    onclose={() => {
        kuroPreviewOpen = false
        kuroPreview = null
    }}
/>
