<script lang="ts">
    /**
     * @desc 词条方案编辑器：与「工程-词条配置」页完全相同的五个声骸卡片（cost / 主词条 / 副词条档位），
     * 用于词条集里修改标准14词条与自定义方案。数据在本地草稿上编辑，保存时交回父组件。
     */
    import type { ComponentsProps } from '$lib/types'
    import type { EchoSlotConfig } from '$lib/calc/config.types'
    import EchoSlotCard from '$lib/components/layout/echo-slot-card.svelte'
    import SubstatPickerModal from '$lib/components/layout/substat-picker-modal.svelte'
    import MainStatPickerModal from '$lib/components/layout/main-stat-picker-modal.svelte'
    import RandomEnhanceModal from '$lib/components/page/home/config/random-enhance-modal.svelte'
    import { SECOND_MAIN_STAT, SUBSTAT_OPTIONS } from '$lib/consts/stat-data'
    import { cloneSlots, planSubstatTotal, STANDARD_SUBSTAT_TOTAL } from '$lib/calc/standard-substats'

    interface Props extends ComponentsProps {
        initialSlots: EchoSlotConfig[]
        /** @desc 标准14词条：保存时要求副词条恰好 14 条 */
        standard?: boolean
        saving?: boolean
        onsave: (slots: EchoSlotConfig[]) => void
        oncancel: () => void
    }

    let {
        initialSlots,
        standard = false,
        saving = false,
        onsave,
        oncancel,
        class: className,
        style: styleProp
    }: Props = $props()

    let draft = $state<EchoSlotConfig[]>(cloneSlots(initialSlots))
    let pickerSlot = $state<number | null>(null)
    let mainStatSlot = $state<number | null>(null)
    let enhanceSlot = $state<number | null>(null)

    const totalCost = $derived(draft.reduce((sum, slot) => sum + slot.cost, 0))
    const totalSubstats = $derived(planSubstatTotal(draft))
    const costOk = $derived(totalCost <= 12)
    const substatOk = $derived(standard ? totalSubstats === STANDARD_SUBSTAT_TOTAL : true)

    const patchSlot = (index: number, patch: Partial<EchoSlotConfig>) => {
        draft = draft.map((slot, i) => (i === index ? { ...slot, ...patch } : slot))
    }

    /** @desc 换 cost：按工程配置页的行为清空主词条，并按新 cost 写入第二主词条 */
    const setCost = (index: number, cost: number) => {
        const otherCost = draft.reduce((sum, slot, i) => sum + (i === index ? 0 : slot.cost), 0)
        if (otherCost + cost > 12) return
        const second = SECOND_MAIN_STAT[cost as keyof typeof SECOND_MAIN_STAT]
        patchSlot(index, {
            cost,
            mainStat: null,
            secondMainStat: second ? { type: second.label, value: second.value, unit: second.unit } : null
        })
    }

    const addSubstat = (index: number, label: string) => {
        const slot = draft[index]
        if (slot.substats.length >= 5 || slot.substats.some((s) => s.type === label)) return
        const option = SUBSTAT_OPTIONS.find((o) => o.label === label)
        const value = option ? option.tiers[Math.floor((option.tiers.length - 1) / 2)] : 0
        patchSlot(index, { substats: [...slot.substats, { type: label, value, unit: option?.unit ?? '' }] })
    }

    const removeSubstat = (index: number, subIndex: number) => {
        patchSlot(index, { substats: draft[index].substats.filter((_, i) => i !== subIndex) })
    }

    const setSubstatValue = (index: number, subIndex: number, value: number) => {
        patchSlot(index, {
            substats: draft[index].substats.map((sub, i) => (i === subIndex ? { ...sub, value } : sub))
        })
    }

    const clearSubstats = (index: number) => patchSlot(index, { substats: [] })

    const setMainStat = (index: number, stat: { type: string; value: number; unit: string } | null) => {
        patchSlot(index, { mainStat: stat })
    }

    /** @desc 随机强化结果写回草稿（同类型覆盖，其余追加） */
    const applyEnhance = (index: number, result: { substats: { type: string; value: number }[] }) => {
        const slot = draft[index]
        const substats = [...slot.substats]
        for (const hit of result.substats) {
            const option = SUBSTAT_OPTIONS.find((o) => o.label === hit.type)
            const exist = substats.findIndex((s) => s.type === hit.type)
            if (exist >= 0) substats[exist] = { ...substats[exist], value: hit.value }
            else if (substats.length < 5) substats.push({ type: hit.type, value: hit.value, unit: option?.unit ?? '' })
        }
        patchSlot(index, { substats })
    }
</script>

<div class="flex flex-col gap-3 {className ?? ''}" style={styleProp || ''}>
    <!-- 五张声骸卡片打横一排（窄屏时整排横向滚动，卡片平分可用宽度） -->
    <div class="theme-scrollbar -mb-1 flex min-h-0 gap-3 overflow-x-auto pb-1">
        {#each draft as slot, si (si)}
            <EchoSlotCard
                class="flex-1"
                {slot}
                otherCost={totalCost - slot.cost}
                oncost={(cost) => setCost(si, cost)}
                onmainstat={() => (mainStatSlot = si)}
                onclearsubstats={() => clearSubstats(si)}
                onaddsubstat={() => (pickerSlot = si)}
                onsubstatvalue={(idx, value) => setSubstatValue(si, idx, value)}
                onremovesubstat={(idx) => removeSubstat(si, idx)}
                onenhance={() => (enhanceSlot = si)}
            />
        {/each}
    </div>

    <div class="flex shrink-0 flex-wrap items-center gap-2">
        <span class="text-[11px] {costOk ? 'text-(--theme-muted-text)' : 'text-red-500'}">cost 合计 {totalCost}/12</span
        >
        <span class="text-[11px] {standard && !substatOk ? 'text-red-500' : 'text-(--theme-muted-text)'}"
            >副词条 {totalSubstats} 条{#if standard}（标准14词条需恰好 {STANDARD_SUBSTAT_TOTAL} 条）{/if}</span
        >
        <span class="flex-1"></span>
        <button
            onclick={oncancel}
            class="rounded-none border px-3 py-1 text-[11px] transition-colors"
            style="border-color: var(--theme-divider-border); color: var(--theme-modal-text)/70;">取消</button
        >
        <button
            onclick={() => onsave(cloneSlots(draft))}
            disabled={!costOk || !substatOk || saving}
            class="rounded-none border px-3.5 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style="border-color: var(--theme-accent-bg); color: var(--theme-accent-text);">保存</button
        >
    </div>
</div>

<SubstatPickerModal
    open={pickerSlot !== null}
    existingTypes={pickerSlot !== null ? draft[pickerSlot].substats.map((s) => s.type) : []}
    onpick={(label) => {
        if (pickerSlot !== null) addSubstat(pickerSlot, label)
        pickerSlot = null
    }}
    onclose={() => (pickerSlot = null)}
/>

<MainStatPickerModal
    open={mainStatSlot !== null}
    cost={mainStatSlot !== null ? draft[mainStatSlot].cost : 4}
    current={mainStatSlot !== null ? (draft[mainStatSlot].mainStat?.type ?? null) : null}
    onpick={(stat) => {
        if (mainStatSlot !== null) setMainStat(mainStatSlot, stat)
        mainStatSlot = null
    }}
    onclose={() => (mainStatSlot = null)}
/>

{#if enhanceSlot !== null}
    <RandomEnhanceModal
        existingTypes={draft[enhanceSlot].substats.map((s) => s.type)}
        onclose={() => (enhanceSlot = null)}
        onresult={(result) => {
            if (enhanceSlot !== null) applyEnhance(enhanceSlot, result)
            enhanceSlot = null
        }}
    />
{/if}
