<script lang="ts">
    import Icon from '@iconify/svelte'
    import type { ComponentsProps } from '$lib/types'
    import Modal from '$lib/components/layout/modal.svelte'
    import { ZONE_DEFS, ZONE_MAP } from '$lib/components/page/home/calculation/calculation.consts'
    import type { BuffEntityType, BuffLibraryBuff, BuffLibraryScope } from '$lib/data/buff-library.svelte'
    import { ENTITY_TYPE_LABELS, ENTITY_TYPES, updateEntityBuffs, SCOPE_LABELS } from '$lib/data/buff-library.svelte'
    import { addToast } from '$lib/data/toast.svelte'
    import Select from '$lib/components/ui/select.svelte'

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
                zones: b.zones.map((z) => ({ ...z }))
            }))
            activeBuffIdx = 0
            flash = null
        }
    })

    const activeBuff = $derived(buffs[activeBuffIdx] ?? null)
    const activeZoneIds = $derived(new Set((activeBuff?.zones ?? []).map((z) => z.zoneId)))
    const canSave = $derived(buffs.some((b) => b.buffName.trim() && b.zones.length > 0))

    function zoneLabel(id: string) {
        return ZONE_MAP.get(id as never)?.label ?? id
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
        buffs = buffs.map((b, i) => (i === idx ? { ...b, scope } : b))
    }

    function setBuffExclusive(idx: number, exclusive: boolean) {
        buffs = buffs.map((b, i) => (i === idx ? { ...b, exclusive } : b))
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

<Modal {open} {onclose} backdropClose={false} class={className} style="width: min(92vw, 680px); {mergedStyle}">
    {#snippet title()}
        编辑 Buff 预设
    {/snippet}

    <p class="mb-3 text-xs text-(--theme-muted-text)">
        {ENTITY_TYPE_LABELS[entityType]} · {entityName}
        {#if entityType !== 'echo'}（编辑后将保留为自定义）{/if}
    </p>

    {#if flash}
        <div class="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">{flash}</div>
    {/if}

    <div class="mb-3">
        <div class="mb-1.5 flex items-center justify-between">
            <span class="text-xs font-medium text-(--theme-muted-text)">Buff 条目</span>
            <button
                onclick={addBuff}
                class="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium"
                style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
            >
                <Icon icon="mdi:plus" class="size-3.5" />
                新增 Buff
            </button>
        </div>
        {#if buffs.length === 0}
            <div
                class="rounded-lg border border-(--theme-card-border) bg-(--theme-card-bg) px-3 py-4 text-center text-xs text-(--theme-muted-text)"
            >
                暂无 Buff，点击右上角新增
            </div>
        {:else}
            <div class="space-y-1">
                {#each buffs as buff, i (i)}
                    <div
                        class="flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors"
                        class:border-(--theme-accent-bg)={i === activeBuffIdx}
                        style={`background: ${
                            i === activeBuffIdx
                                ? 'color-mix(in srgb, var(--theme-accent-bg) 10%, transparent)'
                                : 'var(--theme-card-bg)'
                        };`}
                    >
                        <button onclick={() => selectBuff(i)} class="min-w-0 flex-1 text-left">
                            <span class="block truncate text-sm font-medium text-(--theme-layout-text)">
                                {buff.buffName.trim() || '（未命名）'}
                            </span>
                            <span class="block truncate text-[10px] text-(--theme-muted-text)">
                                {buff.zones.map((z) => `${zoneLabel(z.zoneId)}+${z.value}`).join(' · ') || '无乘区'}
                            </span>
                        </button>
                        <input
                            value={buff.buffName}
                            oninput={(e) => renameBuff(i, (e.currentTarget as HTMLInputElement).value)}
                            placeholder="Buff 名"
                            class="min-w-0 flex-1 rounded border border-(--theme-card-border) bg-(--theme-input-bg) px-2 py-1 text-xs outline-none focus:border-(--theme-accent-bg)"
                        />
                        <button
                            onclick={() => removeBuff(i)}
                            class="shrink-0 rounded p-1 text-(--theme-muted-text) transition-colors hover:text-red-500"
                        >
                            <Icon icon="mdi:close" class="size-4" />
                        </button>
                    </div>
                    <div class="mt-1 flex flex-wrap items-center gap-2">
                        <Select
                            options={Object.entries(SCOPE_LABELS).map(([k, v]) => ({ value: k, label: v }))}
                            value={buff.scope ?? 'team'}
                            onchange={(v) => setBuffScope(i, v as BuffLibraryScope)}
                            style="width: 6.5rem;"
                        />
                        <button
                            onclick={() => setBuffExclusive(i, !buff.exclusive)}
                            class="rounded border px-1.5 py-1 text-[10px] transition-colors"
                            class:border-(--theme-accent-bg)={!!buff.exclusive}
                            class:text-(--theme-accent-text)={!!buff.exclusive}
                            class:border-transparent={!buff.exclusive}
                            class:text-(--theme-muted-text)={!buff.exclusive}
                        >
                            {buff.exclusive ? '效应专属' : '非专属'}
                        </button>
                    </div>
                {/each}
            </div>
        {/if}
    </div>

    {#if activeBuff}
        <div
            class="header flex flex-col gap-4 rounded-lg border border-(--theme-card-border) bg-(--theme-card-bg) p-3 md:flex-row"
        >
            <div class="shrink-0 md:w-40">
                <div class="mb-1 text-xs text-(--theme-muted-text)">乘区（点击添加/移除）</div>
                <div class="grid grid-cols-2 gap-1 md:grid-cols-1">
                    {#each ZONE_DEFS as def}
                        <button
                            onclick={() => toggleAddZone(def.id)}
                            class="flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors"
                            class:text-(--theme-accent-text)={activeZoneIds.has(def.id)}
                            class:text-(--theme-muted-text)={!activeZoneIds.has(def.id)}
                            style={`background: ${
                                activeZoneIds.has(def.id)
                                    ? 'color-mix(in srgb, var(--theme-accent-bg) 10%, transparent)'
                                    : 'var(--theme-card-bg-focused)'
                            };`}
                        >
                            <Icon
                                icon={activeZoneIds.has(def.id) ? 'mdi:check' : 'mdi:circle-outline'}
                                class="size-3.5 shrink-0"
                            />
                            {def.label}
                        </button>
                    {/each}
                </div>
            </div>

            <div class="min-w-0 flex-1 space-y-1.5">
                {#if activeBuff.zones.length === 0}
                    <div class="py-6 text-center text-xs text-(--theme-muted-text)">暂无乘区，请点击左侧乘区添加</div>
                {:else}
                    {#each activeBuff.zones as z}
                        <div class="flex items-center gap-2 rounded-lg bg-(--theme-card-bg-focused) px-3 py-2">
                            <span class="min-w-0 flex-1 truncate text-xs text-(--theme-layout-text)"
                                >{zoneLabel(z.zoneId)}</span
                            >
                            <div class="flex shrink-0 items-center gap-1">
                                <input
                                    type="number"
                                    value={z.value}
                                    oninput={(e) =>
                                        setZoneValue(z.zoneId, Number((e.currentTarget as HTMLInputElement).value))}
                                    class="w-16 rounded border border-(--theme-card-border) bg-(--theme-input-bg) px-1.5 py-1 text-right text-xs tabular-nums outline-none focus:border-(--theme-accent-bg)"
                                />
                                <span class="w-3 text-[10px] text-(--theme-muted-text)">
                                    {ZONE_MAP.get(z.zoneId as never)?.unit === '%' ? '%' : ''}
                                </span>
                            </div>
                            {#if z.zoneId !== 'extraRatio'}
                                <button
                                    onclick={() => setZoneOverride(z.zoneId, !z.override)}
                                    class="shrink-0 rounded border px-1.5 py-1 text-[10px] transition-colors"
                                    class:border-(--theme-accent-bg)={!!z.override}
                                    class:text-(--theme-accent-text)={!!z.override}
                                    class:border-transparent={!z.override}
                                    class:text-(--theme-muted-text)={!z.override}
                                    title="覆盖/追加"
                                >
                                    {z.override ? '覆盖' : '追加'}
                                </button>
                            {/if}
                            <button
                                onclick={() => toggleAddZone(z.zoneId)}
                                class="shrink-0 rounded p-1 text-(--theme-muted-text) transition-colors hover:text-red-500"
                            >
                                <Icon icon="mdi:close" class="size-3.5" />
                            </button>
                        </div>
                    {/each}
                {/if}
            </div>
        </div>
    {/if}

    <div class="mt-4 flex items-center justify-end gap-2 border-t border-(--theme-card-border) pt-3">
        <button
            onclick={onclose}
            class="rounded-lg px-4 py-1.5 text-sm text-(--theme-muted-text) transition-colors hover:bg-(--theme-card-bg-focused)"
        >
            取消
        </button>
        <button
            onclick={handleSave}
            disabled={!canSave}
            class="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition-all hover:brightness-125 disabled:opacity-40"
            style="background: var(--theme-accent-bg); color: var(--theme-accent-text-on-bg);"
        >
            <Icon icon="mdi:check" class="size-4" />
            保存
        </button>
    </div>
</Modal>
