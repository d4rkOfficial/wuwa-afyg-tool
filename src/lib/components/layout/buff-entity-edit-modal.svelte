<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import { ZONE_DEFS, ZONE_MAP, ZONE_REF_DEFS, ZONE_REF_MAP } from '$lib/calc/calculation.consts'
    import type {
        BuffEntityType,
        BuffLibraryBuff,
        BuffLibraryScope,
        BuffLibraryZoneRef
    } from '$lib/data/buff-library.svelte'
    import { ENTITY_TYPE_LABELS, updateEntityBuffs, CHAIN_MAX, REFINE_MAX } from '$lib/data/buff-library.svelte'
    import { ELEMENTS, DAMAGE_TYPES, DAMAGE_TYPE_SHORT } from '$lib/consts/game-terms'
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
                              ...(b.condition.elements ? { elements: [...b.condition.elements] } : {}),
                              ...(b.condition.damageTypes ? { damageTypes: [...b.condition.damageTypes] } : {})
                          }
                      }
                    : {}),
                zones: b.zones.map((z) => ({ ...z }))
            }))
            activeBuffIdx = 0
            flash = null
        }
    })

    const activeBuff = $derived(buffs[activeBuffIdx] ?? null)
    const activeZoneIds = $derived(new Set((activeBuff?.zones ?? []).map((z) => z.zoneId)))
    const canSave = $derived(buffs.some((b) => b.buffName.trim() && b.zones.length > 0))

    const SCOPE_TABS: { value: BuffLibraryScope; label: string }[] = [
        { value: 'self', label: '自己' },
        { value: 'self_except', label: '队友' },
        { value: 'team', label: '全队' },
        { value: 'effect_only', label: '效应' }
    ]

    function zoneLabel(id: string) {
        return ZONE_MAP.get(id as never)?.label ?? id
    }

    let condPanelOpen = $state(false)

    function toggleCondPanel() {
        condPanelOpen = !condPanelOpen
    }

    function clearCondition() {
        buffs = buffs.map((b, i) => (i === activeBuffIdx ? { ...b, condition: undefined } : b))
        condPanelOpen = false
    }

    // 各实体类型可配置的条件：角色可设共鸣链、武器可设精炼、声骸/套装均不可
    const canChain = $derived(entityType === 'character')
    const canRefinement = $derived(entityType === 'weapon')

    const conditionSummary = $derived.by(() => {
        const cond = activeBuff?.condition
        if (!cond) return ''
        const parts: string[] = []
        if (cond.chain !== undefined && canChain) parts.push(`${entityName} ≥${cond.chain}链`)
        if (cond.refinement !== undefined && canRefinement) parts.push(`${entityName} ≥${cond.refinement}阶`)
        if (cond.elements?.length) parts.push(`伤害属性 ${cond.elements.join('/')}`)
        if (cond.damageTypes?.length)
            parts.push(`伤害类型 ${cond.damageTypes.map((d) => DAMAGE_TYPE_SHORT[d] ?? d).join('/')}`)
        return parts.join('，')
    })

    function setBuffChain(min: number) {
        const cond = activeBuff?.condition ?? {}
        const next = cond.chain === min ? { ...cond, chain: undefined } : { ...cond, chain: min }
        if (next.chain === undefined) delete next.chain
        buffs = buffs.map((b, i) => (i === activeBuffIdx ? { ...b, condition: next } : b))
    }

    function setBuffRefinement(min: number) {
        const cond = activeBuff?.condition ?? {}
        const next = cond.refinement === min ? { ...cond, refinement: undefined } : { ...cond, refinement: min }
        if (next.refinement === undefined) delete next.refinement
        buffs = buffs.map((b, i) => (i === activeBuffIdx ? { ...b, condition: next } : b))
    }

    function toggleConditionElement(el: string) {
        const cond = activeBuff?.condition ?? {}
        const list = cond.elements ?? []
        const next = list.includes(el) ? list.filter((e) => e !== el) : [...list, el]
        buffs = buffs.map((b, i) => (i === activeBuffIdx ? { ...b, condition: { ...cond, elements: next } } : b))
    }

    function toggleConditionDamageType(dt: string) {
        const cond = activeBuff?.condition ?? {}
        const list = cond.damageTypes ?? []
        const next = list.includes(dt) ? list.filter((d) => d !== dt) : [...list, dt]
        buffs = buffs.map((b, i) => (i === activeBuffIdx ? { ...b, condition: { ...cond, damageTypes: next } } : b))
    }

    function selectBuff(idx: number) {
        activeBuffIdx = idx
    }

    function addBuff() {
        buffs = [...buffs, { buffName: '', scope: 'team', exclusive: false, zones: [] }]
        activeBuffIdx = buffs.length - 1
    }

    function removeBuff(idx: number) {
        buffs = buffs.filter((_, i) => i !== idx)
        if (activeBuffIdx >= buffs.length) activeBuffIdx = Math.max(0, buffs.length - 1)
    }

    function renameBuff(idx: number, value: string) {
        buffs = buffs.map((b, i) => (i === idx ? { ...b, buffName: value } : b))
    }

    function setBuffScope(idx: number, scope: BuffLibraryScope) {
        buffs = buffs.map((b, i) => (i === idx ? { ...b, scope, exclusive: scope === 'effect_only' } : b))
    }

    function toggleAddZone(zoneId: string) {
        const idx = activeBuffIdx
        if (idx < 0) return
        const zs = buffs[idx].zones
        if (zs.some((z) => z.zoneId === zoneId)) {
            buffs = buffs.map((b, i) => (i === idx ? { ...b, zones: zs.filter((z) => z.zoneId !== zoneId) } : b))
        } else {
            buffs = buffs.map((b, i) => (i === idx ? { ...b, zones: [...zs, { zoneId, value: 0 }] } : b))
        }
    }

    function setZoneValue(zoneId: string, value: number) {
        buffs = buffs.map((b, i) =>
            i === activeBuffIdx ? { ...b, zones: b.zones.map((z) => (z.zoneId === zoneId ? { ...z, value } : z)) } : b
        )
    }

    function setZoneOverride(zoneId: string, override: boolean) {
        if (zoneId === 'extraRatio') return
        buffs = buffs.map((b, i) =>
            i === activeBuffIdx
                ? {
                      ...b,
                      zones: b.zones.map((z) =>
                          z.zoneId === zoneId
                              ? { ...z, ...(override ? { override: true } : { override: undefined }) }
                              : z
                      )
                  }
                : b
        )
    }

    function setZoneRef(zoneId: string, ref: BuffLibraryZoneRef | null) {
        buffs = buffs.map((b, i) =>
            i === activeBuffIdx
                ? {
                      ...b,
                      zones: b.zones.map((z) =>
                          z.zoneId === zoneId ? { ...z, ...(ref ? { ref } : { ref: undefined }) } : z
                      )
                  }
                : b
        )
    }

    let showRefModal = $state(false)
    let refZoneId = $state('')
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

    function openRefModal(zoneId: string) {
        const zone = activeBuff?.zones.find((z) => z.zoneId === zoneId)
        refZoneId = zoneId
        showRefZoneMenu = false
        if (zone?.ref) {
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
        setZoneRef(refZoneId, ref)
        showRefModal = false
    }

    function handleClearRef() {
        setZoneRef(refZoneId, null)
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
        编辑 Buff 预设
    {/snippet}

    {#snippet footer()}
        <div
            class="flex items-center justify-end gap-2 border-t pt-3"
            style="border-color: var(--theme-divider-border);"
        >
            <button
                onclick={onclose}
                class="h-7 rounded-md px-4 text-xs text-(--theme-modal-text)/60 transition-colors hover:bg-(--theme-modal-text)/10"
                style="background: var(--theme-input-bg);"
            >
                取消
            </button>
            <button
                onclick={handleSave}
                disabled={!canSave}
                class="inline-flex h-7 items-center gap-1.5 rounded-md px-4 text-xs font-medium transition-all hover:brightness-125 disabled:opacity-40 disabled:pointer-events-none"
                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
            >
                <Icon icon="mdi:check" class="size-3.5" />
                保存
            </button>
        </div>
    {/snippet}

    <div class="flex h-full flex-col">
        <p class="mb-3 text-xs text-(--theme-muted-text)">
            {ENTITY_TYPE_LABELS[entityType]} · {entityName}
            {#if entityType !== 'echo'}（编辑后将自动设为不同步工坊）{/if}
        </p>

        {#if flash}
            <div class="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
                {flash}
            </div>
        {/if}

        <div class="flex min-h-0 flex-1 gap-3">
            <!-- Left: buff list -->
            <div class="flex w-64 shrink-0 flex-col rounded-lg border border-(--theme-card-border)">
                <div
                    class="flex shrink-0 items-center justify-between border-b px-3 py-2"
                    style="border-color: var(--theme-divider-border);"
                >
                    <span class="text-xs font-medium text-(--theme-muted-text)">Buff 条目（{buffs.length}）</span>
                    <button
                        onclick={addBuff}
                        class="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium"
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
                                    'w-full rounded-lg px-2 py-1.5 text-left transition-colors',
                                    i === activeBuffIdx
                                        ? 'bg-(--theme-accent-bg)/15 text-(--theme-accent-text)'
                                        : 'text-(--theme-modal-text)/70 hover:bg-(--theme-modal-text)/5'
                                ].join(' ')}
                            >
                                <span class="block truncate text-xs font-medium">
                                    {buff.buffName.trim() || '（未命名）'}
                                </span>
                                <span class="block truncate text-[10px] text-(--theme-modal-text)/40">
                                    {buff.zones.map((z) => `${zoneLabel(z.zoneId)}+${z.value}`).join(' · ') || '无乘区'}
                                </span>
                            </button>
                        {/each}
                    {/if}
                </div>
            </div>

            <!-- Middle: selected buff editor -->
            <div class="flex min-w-0 flex-1 flex-col rounded-lg border border-(--theme-card-border)">
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
                                class="min-w-0 flex-1 rounded border bg-(--theme-input-bg) px-2 py-1 text-xs outline-none text-(--theme-modal-text) placeholder:text-(--theme-modal-text)/30 focus:border-(--theme-accent-bg)"
                                style="border-color: var(--theme-divider-border);"
                            />
                            <button
                                onclick={() => removeBuff(activeBuffIdx)}
                                class="shrink-0 rounded p-1 text-(--theme-modal-text)/40 transition-colors hover:text-red-500"
                                title="删除该 Buff"
                            >
                                <Icon icon="mdi:delete-outline" class="size-3.5" />
                            </button>
                        </div>
                        <div
                            class="flex shrink-0 overflow-hidden rounded border"
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
                    <div class="shrink-0 border-b" style="border-color: var(--theme-divider-border);">
                        <button
                            onclick={toggleCondPanel}
                            class={[
                                'flex w-full items-center gap-1.5 px-3 py-2 text-left text-[10px] transition-colors hover:bg-(--theme-modal-text)/5',
                                conditionSummary ? 'text-(--theme-accent-text)' : 'text-(--theme-modal-text)/60'
                            ].join(' ')}
                        >
                            <Icon
                                icon={condPanelOpen ? 'mdi:chevron-down' : 'mdi:chevron-right'}
                                class="size-3.5 shrink-0 text-(--theme-modal-text)/40"
                            />
                            <span class="shrink-0">生效条件</span>
                            {#if conditionSummary}
                                <span class="min-w-0 truncate">：{conditionSummary}</span>
                            {/if}
                        </button>
                        {#if condPanelOpen}
                            {@const cond = activeBuff?.condition ?? {}}
                            <div
                                transition:slide|local={{ duration: 200 }}
                                class="flex flex-wrap items-center gap-2 px-3 pb-2.5"
                            >
                                {#if canChain}
                                    <div
                                        class="flex items-center gap-2 rounded border px-2 py-1"
                                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                    >
                                        <span class="flex h-6 items-center text-[10px] text-(--theme-modal-text)/70"
                                            >共鸣链</span
                                        >
                                        <div
                                            class="flex overflow-hidden rounded border"
                                            style="border-color: var(--theme-divider-border);"
                                        >
                                            {#each Array.from({ length: CHAIN_MAX + 1 }, (_, k) => k) as n}
                                                <button
                                                    onclick={() => setBuffChain(n)}
                                                    class={[
                                                        'flex h-6 min-w-6 items-center justify-center px-1 text-[11px] transition-colors',
                                                        cond.chain === n
                                                            ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/15'
                                                            : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'
                                                    ].join(' ')}
                                                >
                                                    {n}
                                                </button>
                                            {/each}
                                        </div>
                                        {#if cond.chain !== undefined}
                                            <span
                                                class="flex h-6 items-center text-[10px] font-medium text-(--theme-accent-text)"
                                                >≥{cond.chain}链</span
                                            >
                                        {/if}
                                    </div>
                                {/if}
                                {#if canRefinement}
                                    <div
                                        class="flex items-center gap-2 rounded border px-2 py-1"
                                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                    >
                                        <span class="flex h-6 items-center text-[10px] text-(--theme-modal-text)/70"
                                            >精炼</span
                                        >
                                        <div
                                            class="flex overflow-hidden rounded border"
                                            style="border-color: var(--theme-divider-border);"
                                        >
                                            {#each Array.from({ length: REFINE_MAX }, (_, k) => k + 1) as n}
                                                <button
                                                    onclick={() => setBuffRefinement(n)}
                                                    class={[
                                                        'flex h-6 min-w-6 items-center justify-center px-1 text-[11px] transition-colors',
                                                        cond.refinement === n
                                                            ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/15'
                                                            : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'
                                                    ].join(' ')}
                                                >
                                                    {n}
                                                </button>
                                            {/each}
                                        </div>
                                        {#if cond.refinement}
                                            <span
                                                class="flex h-6 items-center text-[10px] font-medium text-(--theme-accent-text)"
                                                >≥{cond.refinement}阶</span
                                            >
                                        {/if}
                                    </div>
                                {/if}
                                <div
                                    class="flex flex-wrap items-center gap-1 rounded border px-2 py-1"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    <span class="flex h-6 items-center text-[10px] text-(--theme-modal-text)/70"
                                        >伤害属性</span
                                    >
                                    {#each ELEMENTS as el}
                                        <button
                                            onclick={() => toggleConditionElement(el)}
                                            class={[
                                                'rounded px-1.5 py-0.5 text-[10px] transition-colors',
                                                (cond.elements ?? []).includes(el)
                                                    ? 'bg-(--theme-accent-bg)/20 text-(--theme-accent-text)'
                                                    : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'
                                            ].join(' ')}
                                        >
                                            {el}
                                        </button>
                                    {/each}
                                </div>
                                <div
                                    class="flex flex-wrap items-center gap-1 rounded border px-2 py-1"
                                    style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                                >
                                    <span class="flex h-6 items-center text-[10px] text-(--theme-modal-text)/70"
                                        >伤害类型</span
                                    >
                                    {#each DAMAGE_TYPES as dt}
                                        <button
                                            onclick={() => toggleConditionDamageType(dt)}
                                            title={dt}
                                            class={[
                                                'rounded px-1.5 py-0.5 text-[10px] transition-colors',
                                                (cond.damageTypes ?? []).includes(dt)
                                                    ? 'bg-(--theme-accent-bg)/20 text-(--theme-accent-text)'
                                                    : 'text-(--theme-modal-text)/40 hover:text-(--theme-modal-text)/70'
                                            ].join(' ')}
                                        >
                                            {DAMAGE_TYPE_SHORT[dt] ?? dt}
                                        </button>
                                    {/each}
                                </div>
                                <button
                                    onclick={clearCondition}
                                    class="flex h-6 items-center gap-1 rounded border px-2 text-[10px] text-(--theme-modal-text)/40 transition-colors hover:border-red-500/40 hover:text-red-500"
                                    style="border-color: var(--theme-divider-border);"
                                >
                                    <Icon icon="mdi:close-circle-outline" class="size-3" />
                                    清除
                                </button>
                            </div>
                        {/if}
                    </div>
                    <div class="theme-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
                        {#if activeBuff.zones.length === 0}
                            <div class="py-6 text-center text-xs text-(--theme-modal-text)/30">
                                暂无乘区，请点击右侧乘区添加
                            </div>
                        {:else}
                            {#each activeBuff.zones as z}
                                <div
                                    class="flex items-center gap-1.5 rounded px-3 py-2"
                                    style="background: var(--theme-input-bg);"
                                >
                                    <span class="shrink-0 text-xs text-(--theme-modal-text) truncate"
                                        >{zoneLabel(z.zoneId)}</span
                                    >
                                    {#if z.ref}
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
                                            class="flex-1 text-[10px] text-(--theme-modal-text)/40 truncate min-w-0 text-right"
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
                                                    setZoneValue(
                                                        z.zoneId,
                                                        Number((e.currentTarget as HTMLInputElement).value)
                                                    )}
                                                class="w-14 h-6 rounded border bg-transparent px-1.5 text-xs text-right tabular-nums text-(--theme-modal-text) outline-none"
                                                style="border-color: var(--theme-divider-border);"
                                            />
                                            <span class="w-3 text-[10px] text-(--theme-modal-text)/40">
                                                {ZONE_MAP.get(z.zoneId as never)?.unit === '%' ? '%' : ''}
                                            </span>
                                        </div>
                                    {/if}
                                    {#if z.zoneId !== 'extraRatio'}
                                        <button
                                            onclick={() => setZoneOverride(z.zoneId, !z.override)}
                                            class={[
                                                'shrink-0 rounded border px-1.5 py-0.5 text-[10px] transition-colors flex items-center gap-0.5',
                                                z.override
                                                    ? 'border-(--theme-accent-bg) text-(--theme-accent-text)'
                                                    : 'border-transparent text-(--theme-modal-text)/30 hover:border-(--theme-divider-border) hover:text-(--theme-modal-text)/60'
                                            ].join(' ')}
                                        >
                                            <Icon icon="mdi:swap-horizontal-bold" class="size-3" />
                                            {z.override ? '覆盖' : '追加'}
                                        </button>
                                    {/if}
                                    <button
                                        onclick={() => openRefModal(z.zoneId)}
                                        class={[
                                            'shrink-0 rounded border px-1.5 py-0.5 text-[10px] transition-colors flex items-center gap-0.5',
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
                                    <button
                                        onclick={() => toggleAddZone(z.zoneId)}
                                        class="shrink-0 rounded p-1 text-(--theme-modal-text)/40 transition-colors hover:text-red-500"
                                    >
                                        <Icon icon="mdi:close" class="size-3.5" />
                                    </button>
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

            <!-- Right: zone picker -->
            <div class="flex w-52 shrink-0 flex-col rounded-lg border border-(--theme-card-border)">
                <div
                    class="shrink-0 border-b px-3 py-2 text-xs font-medium text-(--theme-muted-text)"
                    style="border-color: var(--theme-divider-border);"
                >
                    乘区
                </div>
                <div class="theme-scrollbar min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
                    {#each ZONE_DEFS as def}
                        {@const exists = activeZoneIds.has(def.id)}
                        <button
                            onclick={() => toggleAddZone(def.id)}
                            class={[
                                'flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs font-medium transition-colors',
                                exists
                                    ? 'bg-(--theme-accent-bg)/20 text-(--theme-accent-text)'
                                    : 'text-(--theme-modal-text)/50 hover:bg-(--theme-modal-text)/5'
                            ].join(' ')}
                        >
                            <Icon icon={exists ? 'mdi:check' : 'mdi:circle-outline'} class="size-3.5 shrink-0" />
                            {def.label}
                        </button>
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
            class="animate-pop-in theme-scrollbar rounded-xl border p-5 shadow-xl w-[30rem] max-h-[88vh] overflow-y-auto"
            style="background: color-mix(in srgb, var(--theme-modal-bg) 75%, transparent); border-color: var(--theme-divider-border);"
            onclick={(e) => e.stopPropagation()}
        >
            <h3 class="text-sm font-semibold mb-5 flex items-baseline gap-1">
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
                <div>
                    <label class="text-[10px] text-(--theme-modal-text)/50 block mb-1.5">引用属性</label>
                    <div class="relative">
                        <button
                            onclick={() => (showRefZoneMenu = !showRefZoneMenu)}
                            class="w-full flex items-center justify-between rounded-lg border px-3 py-2 text-xs text-(--theme-modal-text) transition-colors hover:bg-(--theme-modal-text)/5"
                            style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                        >
                            <span class="truncate">{refTargetDef?.label ?? refTargetZoneId}</span>
                            <Icon icon="mdi:chevron-down" class="size-3.5 shrink-0 text-(--theme-modal-text)/40" />
                        </button>
                        {#if showRefZoneMenu}
                            <div
                                class="theme-scrollbar absolute left-0 top-full z-10 mt-1.5 w-full max-h-60 overflow-y-auto rounded-lg border bg-(--theme-modal-bg) py-1 shadow-xl backdrop-blur-lg"
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
                        class="rounded-lg border px-4 py-3.5 space-y-3"
                        style="border-color: var(--theme-divider-border); background: var(--theme-input-bg);"
                    >
                        <div class="text-xs text-(--theme-modal-text)/60">
                            <span class="font-medium text-(--theme-modal-text)/80">{refTargetDef.label}</span>
                        </div>

                        <!-- Line 1: 超过 [threshold] unit1 的部分 -->
                        <div
                            class="flex items-center rounded-md border overflow-hidden"
                            style="border-color: var(--theme-divider-border);"
                        >
                            <button
                                onclick={() => {
                                    refHasThreshold = !refHasThreshold
                                }}
                                class={[
                                    'px-3 py-1.5 text-xs font-medium transition-all',
                                    refHasThreshold
                                        ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12 shadow-sm'
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
                            class="flex rounded-md border overflow-hidden"
                            style="border-color: var(--theme-divider-border);"
                        >
                            <button
                                onclick={() => {
                                    refIsDiscrete = false
                                }}
                                class={[
                                    'flex-1 px-3 py-1.5 text-xs font-medium transition-all',
                                    !refIsDiscrete
                                        ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12 shadow-sm'
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
                                        ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12 shadow-sm'
                                        : 'text-(--theme-modal-text)/25 bg-transparent hover:text-(--theme-modal-text)/50'
                                ].join(' ')}
                            >
                                离散地
                            </button>
                        </div>

                        <!-- Line 2: 每 [divisor] unit1 转换为 [multiplier] unit2 -->
                        <div
                            class="flex items-center rounded-md border overflow-hidden"
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
                        class="flex items-center flex-1 rounded-md border overflow-hidden"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <button
                            onclick={() => {
                                refHasLower = !refHasLower
                            }}
                            class={[
                                'px-3 py-1.5 text-xs font-medium transition-all',
                                refHasLower
                                    ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12 shadow-sm'
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
                        class="flex items-center flex-1 rounded-md border overflow-hidden"
                        style="border-color: var(--theme-divider-border);"
                    >
                        <button
                            onclick={() => {
                                refHasUpper = !refHasUpper
                            }}
                            class={[
                                'px-3 py-1.5 text-xs font-medium transition-all',
                                refHasUpper
                                    ? 'text-(--theme-accent-text) bg-(--theme-accent-bg)/12 shadow-sm'
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
                    class="rounded-md px-3 py-1.5 text-xs text-red-500 transition-colors hover:bg-red-500/15"
                    >清除引用</button
                >
                <div class="flex items-center gap-2">
                    <button
                        onclick={() => (showRefModal = false)}
                        class="rounded-md px-3 py-1.5 text-xs text-(--theme-modal-text)/50 transition-colors hover:bg-(--theme-modal-text)/10"
                        >取消</button
                    >
                    <button
                        onclick={handleConfirmRef}
                        class="rounded-md px-4 py-1.5 text-xs transition-all hover:brightness-125 shadow-sm"
                        style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg, #ffffff);"
                        >确认</button
                    >
                </div>
            </div>
        </div>
    </div>
{/if}
