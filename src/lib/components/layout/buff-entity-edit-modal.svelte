<script lang="ts">
    /**
     * @desc 工坊 Buff 预设编辑器（「Buff 集 → 编辑预设」打开）：
     * 数据模型与工程内「BUFF 配置」完全一致 —— 左侧条目列表 / 中部编辑区（作用域 + 链阶硬门槛 + 乘区贡献条目列表）
     * / 右侧「添加乘区」清单。
     *
     * 乘区是**贡献条目列表**：同一乘区可添加多次，每条各带数值 / 引用 / 覆盖 / **自己的乘区级生效条件**；
     * 覆盖同一乘区唯一；链条件与阶条件互斥（只能挂在整条 Buff 上）。
     * 数据在本地草稿上编辑，保存时整体写回本地 Buff 集（`updateEntityBuffs`）。
     */
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import ZoneConditionPanel from '$lib/components/layout/zone-condition-panel.svelte'
    import {
        ZONE_MAP,
        ZONE_NO_REF_IDS,
        ZONE_NO_OVERRIDE_IDS,
        ZONE_REF_DEFS,
        ZONE_REF_MAP,
        ZONE_SECTION_VIEWS
    } from '$lib/calc/calculation.consts'
    import type { BuffCondition } from '$lib/calc/calculation.types'
    import type {
        BuffEntityType,
        BuffLibraryBuff,
        BuffLibraryScope,
        BuffLibraryZoneRef
    } from '$lib/data/buff-library.svelte'
    import { ENTITY_TYPE_LABELS, updateEntityBuffs, CHAIN_MAX, REFINE_MAX } from '$lib/data/buff-library.svelte'
    import { describeCondition, describeZoneConditionBadge, isConditionEmpty } from '$lib/calc/condition'
    import { addToast } from '$lib/data/toast.svelte'
    import { slide } from 'svelte/transition'

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

    let mergedStyle = $derived(
        [
            backgroundImage ? `background: ${backgroundImage}` : '',
            textColor ? `color: ${textColor}` : '',
            styleProp || ''
        ]
            .filter(Boolean)
            .join(';')
    )

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

    const SCOPE_TABS: { value: BuffLibraryScope; label: string }[] = [
        { value: 'self', label: '自己' },
        { value: 'self_except', label: '队友' },
        { value: 'team', label: '全队' },
        { value: 'effect_only', label: '效应' }
    ]

    function zoneLabel(id: string) {
        return ZONE_MAP.get(id as never)?.label ?? id
    }

    function zoneUnit(id: string) {
        return ZONE_MAP.get(id as never)?.unit === '%' ? '%' : ''
    }

    /** @desc 各实体类型可配置的硬门槛：角色 = 共鸣链、武器 = 精炼（与工坊业务口径一致） */
    const canChain = $derived(entityType === 'character')
    const canRefinement = $derived(entityType === 'weapon')

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

    /** @desc 门槛条件摘要（只描述链/阶硬门槛；属性/类型条件挂在乘区上） */
    const conditionSummary = $derived.by(() => {
        const cond = activeBuff?.condition
        if (!cond) return ''
        const parts: string[] = []
        const chain = cond.chains?.[0]?.min ?? cond.chain
        if (chain !== undefined && canChain) parts.push(chain > 0 ? `≥${chain}链` : '角色本体')
        const refine = cond.refinements?.[0]?.min ?? cond.refinement
        if (refine !== undefined && canRefinement) parts.push(`武器 ≥${refine}阶`)
        return parts.join('，')
    })

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

    const toggleZoneCondition = (index: number) => {
        expandedZoneIdx = expandedZoneIdx === index ? null : index
    }

    const handleZoneConditionChange = (index: number, next: BuffCondition | null) => {
        patchZoneAt(index, { condition: next ?? undefined })
    }

    let showRefModal = $state(false)
    let refZoneIndex = $state(-1)
    let refTargetZoneId = $state('baseAtk')
    let refThreshold = $state(0)
    let refLower = $state<number | undefined>(undefined)
    let refUpper = $state<number | undefined>(undefined)
    let showRefZoneMenu = $state(false)
    let refHasThreshold = $state(true)
    let refDivisor = $state(10)
    let refMultiplier = $state(0)
    let refHasLower = $state(false)
    let refHasUpper = $state(false)
    let refIsDiscrete = $state(false)

    /** @desc 当前编辑乘区的 zoneId（由下标推出，供引用弹窗过滤目标属性） */
    let refZoneId = $derived(refZoneIndex >= 0 ? (activeZones[refZoneIndex]?.zoneId ?? '') : '')
    let refTargetDef = $derived(ZONE_REF_MAP.get(refTargetZoneId) ?? ZONE_MAP.get(refTargetZoneId as never) ?? null)
    let refTargetDefUnit = $derived(refTargetDef?.unit === '%' ? '%' : '点')
    let currentZoneDef = $derived(ZONE_MAP.get(refZoneId as never) ?? null)
    let currentZoneUnit = $derived(currentZoneDef?.unit === '%' ? '%' : '点')

    function gcd(a: number, b: number): number {
        return b === 0 ? a : gcd(b, a % b)
    }

    function simplifyPct(pct: number): { divisor: number; multiplier: number } {
        if (pct === 0) return { divisor: 1, multiplier: 0 }
        const num = Math.round(pct)
        const g = gcd(num, 100)
        return { divisor: 100 / g, multiplier: num / g }
    }

    /** @desc 打开引用配置弹窗（按**下标**定位乘区，同一乘区可添加多次） */
    function openRefModal(zoneIndex: number) {
        const zone = activeZones[zoneIndex]
        if (!zone) return
        refZoneIndex = zoneIndex
        showRefZoneMenu = false
        if (zone.ref) {
            refTargetZoneId = zone.ref.targetZoneId
            refThreshold = zone.ref.threshold ?? 0
            refLower = zone.ref.lower
            refUpper = zone.ref.upper
            const s = simplifyPct(zone.ref.pct)
            refDivisor = zone.ref.divisor ?? s.divisor
            refMultiplier = zone.ref.multiplier ?? s.multiplier
            refIsDiscrete = zone.ref.discrete ?? false
            refHasThreshold = true
            refHasLower = zone.ref.lower !== undefined
            refHasUpper = zone.ref.upper !== undefined
        } else {
            refTargetZoneId = 'baseAtk'
            refThreshold = 0
            refLower = undefined
            refUpper = undefined
            refDivisor = 10
            refMultiplier = 0
            refIsDiscrete = false
            refHasThreshold = true
            refHasLower = false
            refHasUpper = false
        }
        if (refTargetZoneId === refZoneId) {
            const fallback = ZONE_REF_DEFS.find((d) => d.id !== refZoneId)
            refTargetZoneId = fallback?.id ?? 'baseAtk'
        }
        showRefModal = true
    }

    /** @desc 确认引用：由 除数/乘数 反算百分比并写入（设引用即清覆盖） */
    function handleConfirmRef() {
        const pct = refDivisor !== 0 ? (refMultiplier / refDivisor) * 100 : 0
        const ref: BuffLibraryZoneRef = {
            targetZoneId: refTargetZoneId,
            threshold: refHasThreshold ? refThreshold : 0,
            pct,
            lower: refHasLower && refLower !== undefined && !isNaN(refLower) ? refLower : undefined,
            upper: refHasUpper && refUpper !== undefined && !isNaN(refUpper) ? refUpper : undefined,
            discrete: refIsDiscrete,
            divisor: refDivisor,
            multiplier: refMultiplier,
            refOwner: entityType === 'character' ? 'self' : 'owner'
        }
        patchZoneAt(refZoneIndex, { ref, override: undefined })
        showRefModal = false
    }

    /** @desc 清除引用 */
    function handleClearRef() {
        patchZoneAt(refZoneIndex, { ref: undefined })
        showRefModal = false
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
            <button
                onclick={onclose}
                class="h-7 rounded-none px-4 text-xs text-(--theme-modal-text)/60 transition-colors hover:bg-(--theme-modal-text)/10"
                style="background: var(--theme-input-bg);"
            >
                取消
            </button>
            <button
                onclick={handleSave}
                disabled={!canSave}
                class="inline-flex h-7 items-center gap-1.5 rounded-none px-4 text-xs font-medium transition-all hover:brightness-125 disabled:opacity-40 disabled:pointer-events-none"
                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
            >
                <Icon icon="mdi:check" class="size-3.5" />
                保存
            </button>
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
            <div
                class="flex min-w-0 flex-1 flex-col rounded-none border"
                style="border-color: var(--theme-divider-border);"
            >
                {#if activeBuff}
                    <div
                        class="flex shrink-0 flex-col gap-2 border-b px-3 py-2"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <div class="flex items-center gap-2">
                            <input
                                value={activeBuff.buffName}
                                oninput={(e) => renameBuff(activeBuffIdx, (e.currentTarget as HTMLInputElement).value)}
                                placeholder="Buff 名"
                                class="min-w-0 flex-1 rounded-none border bg-(--theme-input-bg) px-2 py-1 text-xs outline-none text-(--theme-modal-text) placeholder:text-(--theme-modal-text)/30 focus:border-(--theme-accent-bg)"
                                style="border-color: var(--theme-divider-border);"
                            />
                            <button
                                onclick={() => removeBuff(activeBuffIdx)}
                                class="shrink-0 rounded-none p-1 text-(--theme-modal-text)/40 transition-colors hover:text-red-500"
                                title="删除该 Buff"
                            >
                                <Icon icon="mdi:delete-outline" class="size-3.5" />
                            </button>
                        </div>
                        <div
                            class="flex shrink-0 overflow-hidden rounded-none border"
                            style="border-color: var(--theme-divider-border);"
                            title="受益目标：自己=仅自身；队友=自己除外；全队=整个队伍；效应=效应专属（互斥）"
                        >
                            {#each SCOPE_TABS as t}
                                <button
                                    onclick={() => setBuffScope(activeBuffIdx, t.value)}
                                    class={[
                                        'flex-1 px-2.5 py-1 text-xs transition-colors',
                                        (activeBuff.scope ?? 'team') === t.value
                                            ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12'
                                            : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'
                                    ].join(' ')}
                                >
                                    {t.label}
                                </button>
                            {/each}
                        </div>
                    </div>

                    <!-- 链/阶硬门槛（折叠面板，链阶互斥；属性/类型条件挂在乘区上） -->
                    <div class="shrink-0 border-b" style="border-color: var(--theme-divider-border);">
                        <button
                            onclick={() => (condPanelOpen = !condPanelOpen)}
                            class={[
                                'flex w-full items-center gap-1.5 px-3 py-2 text-left text-[10px] transition-colors hover:bg-(--theme-modal-text)/5',
                                conditionSummary ? 'text-(--theme-accent-text)' : 'text-(--theme-modal-text)/60'
                            ].join(' ')}
                            title="链/阶条件（硬性门槛，链阶互斥）"
                        >
                            <Icon
                                icon={condPanelOpen ? 'mdi:chevron-down' : 'mdi:chevron-right'}
                                class="size-3.5 shrink-0 text-(--theme-modal-text)/40"
                            />
                            <span class="shrink-0">链/阶条件</span>
                            {#if conditionSummary}
                                <span class="min-w-0 truncate">：{conditionSummary}</span>
                            {/if}
                        </button>
                        {#if condPanelOpen}
                            {@const cond = activeBuff.condition ?? {}}
                            <div
                                transition:slide|local={{ duration: 200 }}
                                class="flex flex-wrap items-center gap-2 px-3 pb-2.5"
                            >
                                {#if canChain}
                                    <div
                                        class="flex items-center gap-2 rounded-none border px-2 py-1"
                                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                    >
                                        <span class="flex h-6 items-center text-[10px] text-(--theme-modal-text)/70"
                                            >共鸣链</span
                                        >
                                        <div
                                            class="flex overflow-hidden rounded-none border"
                                            style="border-color: var(--theme-divider-border);"
                                        >
                                            {#each Array.from({ length: CHAIN_MAX + 1 }, (_, k) => k) as n}
                                                <button
                                                    onclick={() => setBuffChain(n)}
                                                    title={n === 0 ? '本体（0链）' : `≥${n}链`}
                                                    class={[
                                                        'flex h-6 min-w-6 items-center justify-center px-1 text-[11px] transition-colors',
                                                        (cond.chains?.[0]?.min ?? cond.chain) === n
                                                            ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/15'
                                                            : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'
                                                    ].join(' ')}
                                                >
                                                    {n === 0 ? '本体' : n}
                                                </button>
                                            {/each}
                                        </div>
                                    </div>
                                {/if}
                                {#if canRefinement}
                                    <div
                                        class="flex items-center gap-2 rounded-none border px-2 py-1"
                                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                    >
                                        <span class="flex h-6 items-center text-[10px] text-(--theme-modal-text)/70"
                                            >精炼</span
                                        >
                                        <div
                                            class="flex overflow-hidden rounded-none border"
                                            style="border-color: var(--theme-divider-border);"
                                        >
                                            {#each Array.from({ length: REFINE_MAX }, (_, k) => k + 1) as n}
                                                <button
                                                    onclick={() => setBuffRefinement(n)}
                                                    title={`≥${n}阶`}
                                                    class={[
                                                        'flex h-6 min-w-6 items-center justify-center px-1 text-[11px] transition-colors',
                                                        (cond.refinements?.[0]?.min ?? cond.refinement) === n
                                                            ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/15'
                                                            : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'
                                                    ].join(' ')}
                                                >
                                                    {n}
                                                </button>
                                            {/each}
                                        </div>
                                    </div>
                                {/if}
                                {#if !canChain && !canRefinement}
                                    <span class="text-[10px] text-(--theme-modal-text)/35"
                                        >链/阶条件只用于角色（共鸣链）与武器（精炼）实体</span
                                    >
                                {/if}
                                <button
                                    onclick={clearCondition}
                                    class="flex h-6 items-center gap-1 rounded-none border px-2 text-[10px] text-(--theme-modal-text)/40 transition-colors hover:border-red-500/40 hover:text-red-500"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    <Icon icon="mdi:close-circle-outline" class="size-3" />
                                    清除
                                </button>
                            </div>
                        {/if}
                    </div>

                    <!-- 乘区贡献条目列表（同一乘区可多条，各自带数值 / 引用 / 覆盖 / 乘区级条件） -->
                    <div class="theme-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
                        {#if activeZones.length === 0}
                            <div class="py-6 text-center text-xs text-(--theme-modal-text)/30">
                                暂无乘区，请点击右侧乘区清单添加
                            </div>
                        {:else}
                            {#each activeZones as z, zoneIndex (zoneIndex)}
                                {@const badge = describeZoneConditionBadge(z.condition)}
                                <div class="space-y-1">
                                    <div
                                        class="flex items-center gap-1.5 rounded-none px-3 py-2"
                                        style="background: var(--theme-input-bg);"
                                    >
                                        <span class="shrink-0 truncate text-xs text-(--theme-modal-text)"
                                            >{zoneLabel(z.zoneId)}</span
                                        >
                                        {#if badge}
                                            <span
                                                class="shrink-0 max-w-32 truncate rounded-none border px-1.5 py-0.5 text-[10px]"
                                                style="border-color: transparent; background: color-mix(in srgb, var(--theme-accent-bg) 18%, transparent); color: var(--theme-accent-text);"
                                                title={`该乘区条件：${describeCondition(z.condition)}`}>{badge}</span
                                            >
                                        {/if}
                                        {#if z.override}
                                            <span
                                                class="shrink-0 px-1 py-0.5 text-[10px] font-black tracking-tight"
                                                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #fff);"
                                                title="覆盖优先于一切：该乘区的其它条目都不参与计算">覆盖生效</span
                                            >
                                        {/if}
                                        {#if z.ref && !ZONE_NO_REF_IDS.has(z.zoneId)}
                                            {@const refDef =
                                                ZONE_REF_MAP.get(z.ref.targetZoneId) ??
                                                ZONE_MAP.get(z.ref.targetZoneId as never)}
                                            {@const refOp = (z.ref.threshold ?? 0) < 0 ? '+' : '-'}
                                            {@const refTh = Math.abs(z.ref.threshold ?? 0)}
                                            {@const refS = simplifyPct(z.ref.pct)}
                                            {@const hasThreshold = (z.ref.threshold ?? 0) !== 0}
                                            {@const hasLower = z.ref.lower !== undefined}
                                            {@const hasUpper = z.ref.upper !== undefined}
                                            <span
                                                class="min-w-0 flex-1 truncate text-right text-[10px] text-(--theme-modal-text)/40"
                                                title="引用: ({refDef?.label ?? '?'}{hasThreshold
                                                    ? ' ' + refOp + ' ' + refTh + (refDef?.unit === '%' ? '%' : '')
                                                    : ''}) ÷{refS.divisor}×{refS.multiplier}{hasLower || hasUpper
                                                    ? ' clamp(' +
                                                      (hasLower ? String(z.ref.lower) : '') +
                                                      ' ~ ' +
                                                      (hasUpper ? String(z.ref.upper) : '') +
                                                      ')'
                                                    : ''}"
                                            >
                                                引用: ({refDef?.label ?? '?'}{hasThreshold
                                                    ? refOp + refTh + (refDef?.unit === '%' ? '%' : '')
                                                    : ''}) ÷{refS.divisor}×{refS.multiplier}
                                                {#if hasLower || hasUpper}
                                                    <span class="text-(--theme-modal-text)/30">
                                                        ({hasLower ? z.ref.lower : ''}~{hasUpper ? z.ref.upper : ''})
                                                    </span>
                                                {/if}
                                            </span>
                                        {:else}
                                            <div class="flex flex-1 items-center justify-end gap-1">
                                                <input
                                                    type="number"
                                                    value={z.value}
                                                    oninput={(e) =>
                                                        patchZoneAt(zoneIndex, {
                                                            value: Number((e.currentTarget as HTMLInputElement).value)
                                                        })}
                                                    class="w-14 h-6 rounded-none border bg-transparent px-1.5 text-xs text-right tabular-nums text-(--theme-modal-text) outline-none"
                                                    style="border-color: var(--theme-divider-border);"
                                                />
                                                <span class="w-3 text-[10px] text-(--theme-modal-text)/40">
                                                    {zoneUnit(z.zoneId)}
                                                </span>
                                            </div>
                                        {/if}
                                        {#if !ZONE_NO_OVERRIDE_IDS.has(z.zoneId)}
                                            <button
                                                onclick={() => setZoneOverride(zoneIndex, !z.override)}
                                                class={[
                                                    'shrink-0 rounded-none border px-1.5 py-0.5 text-[10px] transition-colors flex items-center gap-0.5',
                                                    z.override
                                                        ? 'border-(--theme-accent-bg) text-(--theme-accent-text)'
                                                        : 'border-transparent text-(--theme-modal-text)/30 hover:border-(--theme-divider-border) hover:text-(--theme-modal-text)/60'
                                                ].join(' ')}
                                            >
                                                <Icon icon="mdi:swap-horizontal-bold" class="size-3" />
                                                {z.override ? '覆盖' : '追加'}
                                            </button>
                                        {/if}
                                        {#if !ZONE_NO_REF_IDS.has(z.zoneId)}
                                            <button
                                                onclick={() => openRefModal(zoneIndex)}
                                                class={[
                                                    'shrink-0 rounded-none border px-1.5 py-0.5 text-[10px] transition-colors flex items-center gap-0.5',
                                                    z.ref
                                                        ? 'border-(--theme-accent-bg) text-(--theme-accent-text)'
                                                        : 'border-transparent text-(--theme-modal-text)/30 hover:border-(--theme-divider-border) hover:text-(--theme-modal-text)/60'
                                                ].join(' ')}
                                                title={z.ref
                                                    ? `引${entityType === 'character' ? '自己' : '主人'} ${ZONE_REF_MAP.get(z.ref.targetZoneId)?.label ?? z.ref.targetZoneId} × ${z.ref.pct}%`
                                                    : '引用某属性（如 当前攻击×N%）'}
                                            >
                                                <Icon icon="mdi:link-variant" class="size-3" />
                                                {z.ref ? '已引用' : '引用'}
                                            </button>
                                        {/if}
                                        <!-- 乘区级生效条件（行内下拉展开）：伤害类型 / 伤害属性 -->
                                        <button
                                            onclick={() => toggleZoneCondition(zoneIndex)}
                                            class={[
                                                'shrink-0 rounded-none border px-1.5 py-0.5 text-[10px] transition-colors flex items-center gap-0.5',
                                                z.condition
                                                    ? 'border-(--theme-accent-bg) text-(--theme-accent-text)'
                                                    : 'border-transparent text-(--theme-modal-text)/30 hover:border-(--theme-divider-border) hover:text-(--theme-modal-text)/60'
                                            ].join(' ')}
                                            title={z.condition
                                                ? `该乘区条件：${describeCondition(z.condition)}`
                                                : '为该乘区设置生效条件（伤害类型/属性）'}
                                        >
                                            <Icon
                                                icon={expandedZoneIdx === zoneIndex
                                                    ? 'mdi:chevron-up'
                                                    : 'mdi:filter-outline'}
                                                class="size-3"
                                            />
                                            条件
                                        </button>
                                        <!-- 移除该乘区条目（同名乘区可添加多个，逐个移除） -->
                                        <button
                                            onclick={() => removeZoneAt(zoneIndex)}
                                            class="shrink-0 rounded-none border border-transparent px-1 py-0.5 text-[10px] text-(--theme-modal-text)/30 transition-colors hover:border-red-500/40 hover:text-red-500"
                                            title="移除该乘区条目"
                                        >
                                            <Icon icon="mdi:close" class="size-3" />
                                        </button>
                                    </div>
                                    {#if expandedZoneIdx === zoneIndex}
                                        <ZoneConditionPanel
                                            condition={z.condition}
                                            onchange={(next) => handleZoneConditionChange(zoneIndex, next)}
                                        />
                                    {/if}
                                </div>
                            {/each}
                        {/if}
                    </div>
                {:else}
                    <div class="flex flex-1 items-center justify-center text-xs text-(--theme-modal-text)/40">
                        点击左侧 Buff 条目进行编辑
                    </div>
                {/if}
            </div>

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

{#if showRefModal}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
        style="background: var(--theme-overlay-bg, rgba(0,0,0,0.5));"
        class="animate-fade-in fixed inset-0 z-60 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        onkeydown={(e) => e.key === 'Escape' && (showRefModal = false)}
    >
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
            data-sf="modal"
            class="animate-pop-in theme-scrollbar w-120 max-h-[88vh] overflow-y-auto rounded-none border p-5 shadow-2xl"
            style="border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
        >
            <h3 class="text-base font-black tracking-tight mb-5 flex items-baseline gap-1.5">
                <Icon
                    icon="mdi:link-variant"
                    class="size-4 shrink-0 self-center"
                    style="color: var(--theme-accent-text);"
                />
                引用
                <span
                    class="text-lg scale-110 inline-block leading-none text-(--theme-accent-text)"
                    style="color: var(--theme-accent-text);"
                >
                    {entityName}
                </span>
                {entityType === 'character' ? '自身的' : '装备者的'}
            </h3>

            <div class="space-y-4">
                <!-- Zone selector -->
                <div role="group" aria-label="引用属性">
                    <span class="text-[10px] text-(--theme-modal-text)/50 block mb-1.5">引用属性</span>
                    <div class="relative">
                        <button
                            onclick={() => (showRefZoneMenu = !showRefZoneMenu)}
                            class="w-full flex items-center justify-between rounded-none border px-3 py-2 text-xs text-(--theme-modal-text) transition-colors hover:bg-(--theme-modal-text)/5"
                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                        >
                            <span class="truncate">{refTargetDef?.label ?? refTargetZoneId}</span>
                            <Icon icon="mdi:chevron-down" class="size-3.5 shrink-0 text-(--theme-modal-text)/40" />
                        </button>
                        {#if showRefZoneMenu}
                            <div
                                class="theme-scrollbar absolute left-0 top-full z-10 mt-1.5 w-full max-h-60 overflow-y-auto rounded-none border bg-(--theme-modal-bg) py-1 backdrop-blur-lg"
                                style="border-color: var(--theme-divider-border);"
                                onclick={(e) => e.stopPropagation()}
                            >
                                {#each ZONE_REF_DEFS.filter((d) => d.id !== refZoneId) as def}
                                    <button
                                        onclick={() => {
                                            refTargetZoneId = def.id
                                            showRefZoneMenu = false
                                        }}
                                        class={[
                                            'flex w-full items-center gap-2 px-3 py-2 text-xs text-left transition-colors',
                                            refTargetZoneId === def.id
                                                ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/15'
                                                : 'text-(--theme-modal-text) hover:bg-(--theme-modal-text)/5'
                                        ].join(' ')}
                                    >
                                        <span class="flex-1">{def.label}</span>
                                        <span class="text-[10px] text-(--theme-modal-text)/40"
                                            >{def.unit === '%' ? '%' : ''}</span
                                        >
                                    </button>
                                {/each}
                            </div>
                        {/if}
                    </div>
                </div>

                <!-- Conversion rule card -->
                {#if refTargetDef && currentZoneDef}
                    <div
                        class="rounded-none border px-4 py-3.5 space-y-3"
                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                    >
                        <div class="text-xs text-(--theme-modal-text)/60">
                            <span class="font-medium text-(--theme-modal-text)/80">{refTargetDef.label}</span>
                        </div>

                        <!-- Line 1: 超过 [threshold] unit1 的部分 -->
                        <div
                            class="flex items-center rounded-none border overflow-hidden"
                            style="border-color: var(--theme-divider-border);"
                        >
                            <button
                                onclick={() => {
                                    refHasThreshold = !refHasThreshold
                                }}
                                class={[
                                    'px-3 py-1.5 text-xs font-medium transition-all',
                                    refHasThreshold
                                        ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12'
                                        : 'text-(--theme-modal-text)/25 bg-transparent hover:text-(--theme-modal-text)/50'
                                ].join(' ')}
                            >
                                超过
                            </button>
                            <div
                                class="flex items-center flex-1 px-3 py-1.5 border-x"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                            >
                                <input
                                    type="number"
                                    bind:value={refThreshold}
                                    disabled={!refHasThreshold}
                                    class="w-full min-w-0 text-xs outline-none tabular-nums text-center bg-transparent disabled:text-(--theme-modal-text)/20"
                                    class:text-(--theme-modal-text)={refHasThreshold}
                                />
                                <span class="text-xs text-(--theme-modal-text)/40">{refTargetDefUnit}</span>
                            </div>
                            <span class="text-xs text-(--theme-modal-text)/40 px-3 py-1.5">的部分</span>
                        </div>

                        <!-- Conversion mode tab -->
                        <div
                            class="flex rounded-none border overflow-hidden"
                            style="border-color: var(--theme-divider-border);"
                        >
                            <button
                                onclick={() => {
                                    refIsDiscrete = false
                                }}
                                class={[
                                    'flex-1 px-3 py-1.5 text-xs font-medium transition-all',
                                    !refIsDiscrete
                                        ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12'
                                        : 'text-(--theme-modal-text)/25 bg-transparent hover:text-(--theme-modal-text)/50'
                                ].join(' ')}
                            >
                                线性地
                            </button>
                            <div class="w-px self-stretch" style="background: var(--theme-divider-border);"></div>
                            <button
                                onclick={() => {
                                    refIsDiscrete = true
                                }}
                                class={[
                                    'flex-1 px-3 py-1.5 text-xs font-medium transition-all',
                                    refIsDiscrete
                                        ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12'
                                        : 'text-(--theme-modal-text)/25 bg-transparent hover:text-(--theme-modal-text)/50'
                                ].join(' ')}
                            >
                                离散地
                            </button>
                        </div>

                        <!-- Line 2: 每 [divisor] unit1 转换为 [multiplier] unit2 -->
                        <div
                            class="flex items-center rounded-none border overflow-hidden"
                            style="border-color: var(--theme-divider-border);"
                        >
                            <span
                                class="text-xs text-(--theme-modal-text)/40 px-3 py-1.5 border-r"
                                style="border-color: var(--theme-divider-border);">每</span
                            >
                            <div
                                class="flex items-center flex-1 px-3 py-1.5 border-r"
                                style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                            >
                                <input
                                    type="number"
                                    bind:value={refDivisor}
                                    class="w-full min-w-0 text-xs text-(--theme-modal-text) outline-none tabular-nums text-center bg-transparent"
                                />
                                <span class="text-xs text-(--theme-modal-text)/40">{refTargetDefUnit}</span>
                            </div>
                            <span
                                class="text-xs text-(--theme-modal-text)/40 px-3 py-1.5 border-r"
                                style="border-color: var(--theme-divider-border);">转换为</span
                            >
                            <div
                                class="flex items-center flex-1 px-3 py-1.5"
                                style="background: var(--theme-input-bg);"
                            >
                                <input
                                    type="number"
                                    bind:value={refMultiplier}
                                    class="w-full min-w-0 text-xs text-(--theme-modal-text) outline-none tabular-nums text-center bg-transparent"
                                />
                                <span class="text-xs text-(--theme-modal-text)/40">{currentZoneUnit}</span>
                            </div>
                        </div>

                        <!-- Footer: 的 targetName -->
                        <div class="flex justify-end text-sm text-(--theme-modal-text)/60">
                            <span class="text-(--theme-modal-text)/30">的</span>
                            <span class="font-medium text-(--theme-accent-text) ml-1">{currentZoneDef.label}</span>
                        </div>
                    </div>
                {/if}

                <!-- Lower & Upper -->
                <div class="flex gap-2">
                    <div
                        class="flex items-center flex-1 rounded-none border overflow-hidden"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <button
                            onclick={() => {
                                refHasLower = !refHasLower
                            }}
                            class={[
                                'px-3 py-1.5 text-xs font-medium transition-all',
                                refHasLower
                                    ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12'
                                    : 'text-(--theme-modal-text)/25 bg-transparent hover:text-(--theme-modal-text)/50'
                            ].join(' ')}
                        >
                            下限
                        </button>
                        <div
                            class="flex items-center flex-1 px-3 py-1.5 border-x"
                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                        >
                            <input
                                type="number"
                                bind:value={refLower}
                                disabled={!refHasLower}
                                class="w-full min-w-0 text-xs outline-none tabular-nums text-center bg-transparent disabled:text-(--theme-modal-text)/20"
                                class:text-(--theme-modal-text)={refHasLower}
                            />
                        </div>
                        <span class="text-xs text-(--theme-modal-text)/40 px-3 py-1.5">{currentZoneUnit}</span>
                    </div>
                    <div
                        class="flex items-center flex-1 rounded-none border overflow-hidden"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <button
                            onclick={() => {
                                refHasUpper = !refHasUpper
                            }}
                            class={[
                                'px-3 py-1.5 text-xs font-medium transition-all',
                                refHasUpper
                                    ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12'
                                    : 'text-(--theme-modal-text)/25 bg-transparent hover:text-(--theme-modal-text)/50'
                            ].join(' ')}
                        >
                            上限
                        </button>
                        <div
                            class="flex items-center flex-1 px-3 py-1.5 border-x"
                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                        >
                            <input
                                type="number"
                                bind:value={refUpper}
                                disabled={!refHasUpper}
                                class="w-full min-w-0 text-xs outline-none tabular-nums text-center bg-transparent disabled:text-(--theme-modal-text)/20"
                                class:text-(--theme-modal-text)={refHasUpper}
                            />
                        </div>
                        <span class="text-xs text-(--theme-modal-text)/40 px-3 py-1.5">{currentZoneUnit}</span>
                    </div>
                </div>
            </div>

            <div
                class="flex items-center justify-between mt-5 pt-4 border-t"
                style="border-color: var(--theme-divider-border);"
            >
                <button
                    onclick={handleClearRef}
                    class="rounded-none px-3 py-1.5 text-xs text-red-500 transition-colors hover:bg-red-500/15"
                    >清除引用</button
                >
                <div class="flex items-center gap-2">
                    <button
                        onclick={() => (showRefModal = false)}
                        class="rounded-none px-3 py-1.5 text-xs text-(--theme-modal-text)/50 transition-colors hover:bg-(--theme-modal-text)/10"
                        >取消</button
                    >
                    <button
                        onclick={handleConfirmRef}
                        class="rounded-none px-4 py-1.5 text-xs transition-all hover:brightness-125"
                        style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);"
                        >确认</button
                    >
                </div>
            </div>
        </div>
    </div>
{/if}
