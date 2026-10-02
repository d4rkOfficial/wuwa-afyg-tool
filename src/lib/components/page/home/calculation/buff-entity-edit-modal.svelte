<script lang="ts">
    /**
     * @desc 工坊 Buff 预设编辑器（「Buff 集 → 编辑预设」打开）：
     * 数据模型与工程内「BUFF 配置」完全一致 —— 左侧条目列表 / 中部编辑区（作用域 + 链阶硬门槛 + 乘区贡献条目列表）
     * / 右侧「添加乘区」清单。
     *
     * 乘区是**贡献条目列表**：同一乘区可添加多次，每条各带数值 / 引用 / 覆盖 / **自己的乘区级生效条件**；
     * 覆盖同一乘区唯一；链条件与阶条件互斥（只能挂在整条 Buff 上）。
     * 数据在本地草稿上编辑，保存时整体写回本地 Buff 集（`updateEntityBuffs`）。
     *
     * 结构（Phase 5.6 拆分，标记与行为未改）：
     * - 本文件 = 弹窗外壳（标题 / 底栏 / 左栏条目列表 / 右栏乘区清单）+ **Buff 草稿的唯一真相源**。
     * - 中部就地编辑区 → `buff-entity-editor.svelte`（受控区域，两条视图状态用 `$bindable` 回写）。
     * - 引用配置弹窗 → `buff-entity-ref-modal.svelte`（自带 11 个草稿 `$state`，确认时交回本外壳）。
     * - `zoneLabel` / `zoneUnit` / `simplifyPct` → `buff-entity-utils.ts`（跨上述组件复用的纯函数）。
     */
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import Button from '$lib/components/ui/button.svelte'
    import BuffEntityEditor from './buff-entity-editor.svelte'
    import BuffEntityRefModal from './buff-entity-ref-modal.svelte'
    import { ZONE_NO_OVERRIDE_IDS, ZONE_SECTION_VIEWS } from '$lib/calc/calculation.consts'
    import type { BuffCondition } from '$lib/calc/calculation.types'
    import type { BuffEntityType, BuffLibraryBuff, BuffLibraryScope } from '$lib/data/buff-library.svelte'
    import { ENTITY_TYPE_LABELS, updateEntityBuffs } from '$lib/data/buff-library.svelte'
    import { describeZoneConditionBadge } from '$lib/calc/condition'
    import { addToast } from '$lib/data/toast.svelte'
    import { mergeComponentsStyle } from '$lib/utils/component-style'
    import { zoneLabel } from './buff-entity-utils'

    interface Props extends ComponentsProps {
        open: boolean
        entityType: BuffEntityType
        entityName: string
        initialBuffs: BuffLibraryBuff[]
        onclose?: () => void
        onsaved?: () => void
    }

    let {
        open,
        entityType,
        entityName,
        initialBuffs,
        onclose,
        onsaved,
        backgroundImage,
        textColor,
        class: className,
        style: styleProp
    }: Props = $props()

    let mergedStyle = $derived(mergeComponentsStyle({ backgroundImage, textColor, style: styleProp }))

    let buffs = $state<BuffLibraryBuff[]>([])
    let activeBuffIdx = $state(0)
    let flash = $state<string | null>(null)
    /** @desc 展开行内「乘区条件」面板的乘区下标（同一乘区可有多条，故用下标定位） */
    let expandedZoneIdx = $state<number | null>(null)
    let condPanelOpen = $state(false)

    $effect(() => {
        if (open) {
            buffs = initialBuffs.map((b) => ({
                buffName: b.buffName,
                scope: b.scope,
                exclusive: b.exclusive,
                ...(b.condition
                    ? {
                          condition: {
                              ...b.condition,
                              ...(b.condition.chains ? { chains: b.condition.chains.map((c) => ({ ...c })) } : {}),
                              ...(b.condition.refinements
                                  ? { refinements: b.condition.refinements.map((c) => ({ ...c })) }
                                  : {}),
                              ...(b.condition.elements ? { elements: [...b.condition.elements] } : {}),
                              ...(b.condition.damageTypes ? { damageTypes: [...b.condition.damageTypes] } : {})
                          }
                      }
                    : {}),
                zones: b.zones.map((z) => ({
                    ...z,
                    ...(z.ref ? { ref: { ...z.ref } } : {}),
                    ...(z.condition
                        ? {
                              condition: {
                                  ...z.condition,
                                  ...(z.condition.elements ? { elements: [...z.condition.elements] } : {}),
                                  ...(z.condition.damageTypes ? { damageTypes: [...z.condition.damageTypes] } : {})
                              }
                          }
                        : {})
                }))
            }))
            activeBuffIdx = 0
            expandedZoneIdx = null
            condPanelOpen = false
            flash = null
        }
    })

    const activeBuff = $derived(buffs[activeBuffIdx] ?? null)
    const activeZones = $derived(activeBuff?.zones ?? [])
    const canSave = $derived(buffs.some((b) => b.buffName.trim() && b.zones.length > 0))

    /** @desc 各乘区当前条目数（右栏「添加乘区」计数徽标用） */
    const zoneCounts = $derived.by(() => {
        const map = new Map<string, number>()
        for (const z of activeZones) map.set(z.zoneId, (map.get(z.zoneId) ?? 0) + 1)
        return map
    })

    /**
     * @desc 设置实例级链门槛（再次点击取消）。
     * 链条件与阶条件**只能生效其中一个**：设置链会清空全部阶条件。
     */
    function setBuffChain(min: number) {
        const cond = activeBuff?.condition ?? {}
        const clearing = (cond.chains?.[0]?.min ?? cond.chain) === min
        const next: BuffCondition = { ...cond }
        delete next.chain
        delete next.refinement
        delete next.refinements
        if (clearing) delete next.chains
        else next.chains = [{ charIdx: 0, min }]
        buffs = buffs.map((b, i) => (i === activeBuffIdx ? { ...b, condition: next } : b))
    }

    /** @desc 设置实例级阶门槛（再次点击取消）；设置阶会清空全部链条件 */
    function setBuffRefinement(min: number) {
        const cond = activeBuff?.condition ?? {}
        const clearing = (cond.refinements?.[0]?.min ?? cond.refinement) === min
        const next: BuffCondition = { ...cond }
        delete next.chain
        delete next.chains
        delete next.refinement
        if (clearing) delete next.refinements
        else next.refinements = [{ charIdx: 0, min }]
        buffs = buffs.map((b, i) => (i === activeBuffIdx ? { ...b, condition: next } : b))
    }

    function clearCondition() {
        buffs = buffs.map((b, i) => (i === activeBuffIdx ? { ...b, condition: undefined } : b))
        condPanelOpen = false
    }

    function selectBuff(idx: number) {
        activeBuffIdx = idx
        expandedZoneIdx = null
    }

    function addBuff() {
        buffs = [...buffs, { buffName: '', scope: 'team', exclusive: false, zones: [] }]
        activeBuffIdx = buffs.length - 1
        expandedZoneIdx = null
    }

    function removeBuff(idx: number) {
        buffs = buffs.filter((_, i) => i !== idx)
        if (activeBuffIdx >= buffs.length) activeBuffIdx = Math.max(0, buffs.length - 1)
        expandedZoneIdx = null
    }

    function renameBuff(idx: number, value: string) {
        buffs = buffs.map((b, i) => (i === idx ? { ...b, buffName: value } : b))
    }

    function setBuffScope(idx: number, scope: BuffLibraryScope) {
        buffs = buffs.map((b, i) => (i === idx ? { ...b, scope, exclusive: scope === 'effect_only' } : b))
    }

    /** @desc 添加一条乘区贡献条目（同一乘区可添加多次，各自独立配置） */
    function addZone(zoneId: string) {
        const idx = activeBuffIdx
        if (idx < 0) return
        buffs = buffs.map((b, i) => (i === idx ? { ...b, zones: [...b.zones, { zoneId, value: 0 }] } : b))
    }

    /** @desc 按下标移除某个乘区条目 */
    function removeZoneAt(zoneIndex: number) {
        const idx = activeBuffIdx
        buffs = buffs.map((b, i) => (i === idx ? { ...b, zones: b.zones.filter((_, k) => k !== zoneIndex) } : b))
        expandedZoneIdx = expandedZoneIdx === zoneIndex ? null : expandedZoneIdx
    }

    /** @desc 按下标更新某个乘区条目 */
    function patchZoneAt(zoneIndex: number, patch: Partial<BuffLibraryBuff['zones'][number]>) {
        const idx = activeBuffIdx
        buffs = buffs.map((b, i) =>
            i === idx ? { ...b, zones: b.zones.map((z, k) => (k === zoneIndex ? { ...z, ...patch } : z)) } : b
        )
    }

    /**
     * @desc 切换覆盖：extraRatio / 百分比类乘区恒为追加；
     * 同一乘区只允许一个覆盖条目（开启时清掉同乘区其它条目的覆盖），设覆盖会清掉该条引用。
     */
    function setZoneOverride(zoneIndex: number, override: boolean) {
        const target = activeZones[zoneIndex]
        if (!target) return
        const nextOverride = override && !ZONE_NO_OVERRIDE_IDS.has(target.zoneId)
        const idx = activeBuffIdx
        buffs = buffs.map((b, i) => {
            if (i !== idx) return b
            return {
                ...b,
                zones: b.zones.map((z, k) => {
                    if (k === zoneIndex)
                        return { ...z, override: nextOverride || undefined, ref: nextOverride ? undefined : z.ref }
                    if (nextOverride && z.zoneId === target.zoneId && z.override) return { ...z, override: undefined }
                    return z
                })
            }
        })
    }

    // ── 引用配置弹窗：本外壳只持有「开哪一条乘区」，草稿状态在 buff-entity-ref-modal.svelte 内 ──
    let showRefModal = $state(false)
    let refZoneIndex = $state(-1)
    /** @desc 当前编辑乘区的 zoneId（由下标推出，供引用弹窗过滤目标属性） */
    let refZoneId = $derived(refZoneIndex >= 0 ? (activeZones[refZoneIndex]?.zoneId ?? '') : '')

    /** @desc 打开引用配置弹窗（按**下标**定位乘区，同一乘区可添加多次） */
    function openRefModal(zoneIndex: number) {
        if (!activeZones[zoneIndex]) return
        refZoneIndex = zoneIndex
        showRefModal = true
    }

    async function handleSave() {
        if (!buffs.some((b) => b.buffName.trim())) {
            flash = '至少保留一条带名称的 Buff'
            return
        }
        await updateEntityBuffs(entityType, entityName, buffs)
        addToast('已保存预设', 'success')
        onsaved?.()
        onclose?.()
    }
</script>

<Modal
    {open}
    {onclose}
    backdropClose={false}
    class={className}
    style="width: min(96vw, 1400px); height: min(90vh, 760px); {mergedStyle}"
>
    {#snippet title()}
        <span class="flex items-center gap-2">
            <Icon icon="mdi:pencil-outline" class="size-4 shrink-0" style="color: var(--theme-accent-text);" />
            <span class="font-black tracking-tight">编辑 Buff 预设</span>
        </span>
    {/snippet}

    {#snippet footer()}
        <div
            class="flex items-center justify-end gap-2 border-t pt-3"
            style="border-color: var(--theme-divider-border);"
        >
            <Button
                variant="text"
                compact
                bare
                onclick={onclose}
                backgroundImage="var(--theme-input-bg)"
                class="px-4 text-(--theme-modal-text)/60 transition-colors hover:bg-(--theme-modal-text)/10"
                >取消</Button
            >
            <Button
                variant="icon-text"
                compact
                bare
                keepDisabled
                icon="mdi:check"
                disabled={!canSave}
                backgroundImage="var(--theme-accent-bg)"
                textColor="var(--theme-accent-text-on-bg)"
                class="px-4 transition-all hover:brightness-125"
                onclick={handleSave}>保存</Button
            >
        </div>
    {/snippet}

    <div class="flex h-full flex-col">
        <p class="mb-3 text-[10px] text-(--theme-modal-text)/40">
            {ENTITY_TYPE_LABELS[entityType]} · {entityName}
            {#if entityType !== 'echo'}（编辑后将自动设为不同步工坊）{/if}
        </p>

        {#if flash}
            <div class="mb-3 rounded-none border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
                {flash}
            </div>
        {/if}

        <div class="flex min-h-0 flex-1 gap-3">
            <!-- ① 左：Buff 条目列表 -->
            <div
                class="flex w-64 shrink-0 flex-col rounded-none border"
                style="border-color: var(--theme-divider-border);"
            >
                <div
                    class="flex shrink-0 items-center justify-between border-b px-3 py-2"
                    style="border-color: var(--theme-divider-border);"
                >
                    <span class="text-[10px] font-black tracking-[0.12em] text-(--theme-modal-text)/40"
                        >Buff 条目（{buffs.length}）</span
                    >
                    <button
                        onclick={addBuff}
                        class="inline-flex items-center gap-1 rounded-none px-1.5 py-1 text-xs font-medium"
                        style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
                    >
                        <Icon icon="mdi:plus" class="size-3.5" />
                        新增
                    </button>
                </div>
                <div class="theme-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5">
                    {#if buffs.length === 0}
                        <div class="py-6 text-center text-xs text-(--theme-modal-text)/30">暂无 Buff，点击上方新增</div>
                    {:else}
                        {#each buffs as buff, i (i)}
                            <button
                                onclick={() => selectBuff(i)}
                                class={[
                                    'w-full rounded-none px-2 py-1.5 text-left transition-colors',
                                    i === activeBuffIdx
                                        ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                        : 'text-(--theme-modal-text)/70 hover:bg-(--theme-modal-text)/5'
                                ].join(' ')}
                            >
                                <span class="block truncate text-xs font-medium">
                                    {buff.buffName.trim() || '（未命名）'}
                                </span>
                                <span class="block truncate text-[10px] text-(--theme-modal-text)/40">
                                    {buff.zones
                                        .map(
                                            (z) =>
                                                `${zoneLabel(z.zoneId)}+${z.ref ? '引用' : z.value}${
                                                    describeZoneConditionBadge(z.condition)
                                                        ? `[${describeZoneConditionBadge(z.condition)}]`
                                                        : ''
                                                }`
                                        )
                                        .join(' · ') || '无乘区'}
                                </span>
                            </button>
                        {/each}
                    {/if}
                </div>
            </div>

            <!-- ② 中：就地编辑器（作用域 / 链阶硬门槛 / 乘区贡献条目列表） -->
            <BuffEntityEditor
                buff={activeBuff}
                buffIndex={activeBuffIdx}
                {entityType}
                bind:expandedZoneIdx
                bind:condPanelOpen
                onrename={renameBuff}
                onremove={removeBuff}
                onscope={setBuffScope}
                onchain={setBuffChain}
                onrefine={setBuffRefinement}
                onClearCondition={clearCondition}
                onPatchZone={patchZoneAt}
                onoverride={setZoneOverride}
                onRemoveZone={removeZoneAt}
                onOpenRef={openRefModal}
            />

            <!-- ③ 右：乘区清单（点击即添加一条贡献条目；同一乘区可多次添加） -->
            <div
                class="flex w-52 shrink-0 flex-col rounded-none border"
                style="border-color: var(--theme-divider-border);"
            >
                <div
                    class="flex shrink-0 items-center gap-1.5 border-b px-3 py-2"
                    style="border-color: var(--theme-divider-border);"
                >
                    <Icon icon="mdi:playlist-plus" class="size-3.5 shrink-0" style="color: var(--theme-accent-text);" />
                    <span class="text-[10px] font-black tracking-[0.12em] text-(--theme-modal-text)/40">添加乘区</span>
                </div>
                <div class="theme-scrollbar min-h-0 flex-1 overflow-y-auto p-1.5">
                    {#each ZONE_SECTION_VIEWS as section (section.title)}
                        <div class="mb-1.5">
                            <div class="px-1 pb-1 text-[10px] font-black tracking-[0.1em] text-(--theme-modal-text)/35">
                                {section.title}
                            </div>
                            <div class="space-y-0.5">
                                {#each section.defs as def (def.id)}
                                    {@const count = zoneCounts.get(def.id) ?? 0}
                                    <button
                                        onclick={() => addZone(def.id)}
                                        title={`添加「${def.label}」${count > 0 ? `（已有 ${count} 条）` : ''}`}
                                        class={[
                                            'flex w-full items-center gap-1.5 rounded-none px-2 py-1.5 text-left text-xs font-medium transition-colors',
                                            count > 0
                                                ? 'text-(--theme-accent-text) hover:bg-(--theme-modal-text)/5'
                                                : 'text-(--theme-modal-text)/50 hover:bg-(--theme-modal-text)/5'
                                        ].join(' ')}
                                    >
                                        <Icon icon="mdi:plus" class="size-3.5 shrink-0" />
                                        <span class="min-w-0 flex-1 truncate">{def.label}</span>
                                        {#if count > 0}
                                            <span
                                                class="shrink-0 px-1 text-[10px] tabular-nums"
                                                style="background: color-mix(in srgb, var(--theme-accent-bg) 18%, transparent); color: var(--theme-accent-text);"
                                                >{count}</span
                                            >
                                        {/if}
                                    </button>
                                {/each}
                            </div>
                        </div>
                    {/each}
                </div>
            </div>
        </div>
    </div>
</Modal>

<BuffEntityRefModal
    open={showRefModal}
    {entityType}
    {entityName}
    zoneId={refZoneId}
    zoneRef={activeZones[refZoneIndex]?.ref}
    onclose={() => (showRefModal = false)}
    onconfirm={(ref) => patchZoneAt(refZoneIndex, { ref, override: undefined })}
    onclear={() => patchZoneAt(refZoneIndex, { ref: undefined })}
/>
