<script lang="ts">
    /** @desc 计算页入口组件：连接 store（calculation.store.svelte.ts）与页面状态，根据 calcViewMode 切换 铺开表/下拉表 两种拉表视图 */
    import { untrack } from 'svelte'
    import {
        getAllDamageEntries,
        getAllBuffSets,
        getBuffSetIdsForEntry,
        toggleBuffSetForEntry,
        setBuffSetIdsForEntry,
        getShowBuffModal,
        setShowBuffModal,
        getCalcState,
        getDamageTypesForEntry,
        toggleDamageTypeForEntry,
        init,
        getGlobalBuffSetIds,
        getBuffDiffMode,
        getConditionProfile,
        getHideConditionMismatch
    } from './calculation.store.svelte'
    import type { CharSlot } from '$lib/data/types'
    import type { TimelineData } from '../timeline/timeline.types'
    import type { CalcState } from './calculation.types'
    import BuffModal from './buff-modal.svelte'
    import SpreadTable from './spread-table.svelte'
    import DropdownTable from './dropdown-table.svelte'
    import { getCalcViewMode } from '$lib/data/calc-view.svelte'

    interface Props {
        team: [CharSlot, CharSlot, CharSlot]
        timelineData: TimelineData | null
        calcState: CalcState | null
        locked?: boolean
        onupdate: (state: CalcState) => void
    }

    let { team, timelineData, calcState, locked = false, onupdate }: Props = $props()

    /** @desc 依赖变化时（队伍/时间线/外部状态/锁定）重新初始化 store（untrack 避免重复执行 $effect 自依赖） */
    $effect(() => {
        team
        timelineData
        calcState
        locked
        untrack(() => init(team, timelineData, calcState, locked, onupdate))
    })

    /** @desc 从 store 派生：全部伤害条目 / Buff 块列表 / Buff 弹窗开关 / 全局 Buff 列表 */
    let damageEntries = $derived(getAllDamageEntries())
    let buffSets = $derived(getAllBuffSets())
    let showBuffModal = $derived(getShowBuffModal())
    let globalBuffSetIds = $derived(getGlobalBuffSetIds())
    /** @desc 条目→已选伤害类型 / 条目→已绑定 Buff 的映射（供表格展示） */
    let entryDamageTypeMap = $derived<Record<string, string[]>>(
        Object.fromEntries(damageEntries.map((e) => [e.id, getDamageTypesForEntry(e.id)]))
    )
    let entryBuffSetIdMap = $derived<Record<string, string[]>>(
        Object.fromEntries(damageEntries.map((e) => [e.id, getBuffSetIdsForEntry(e.id)]))
    )

    /** @desc 当前拉表视图：铺开（spread）/ 下拉（dropdown） */
    let calcViewMode = $derived(getCalcViewMode())

    /** @desc 关闭 Buff 弹窗并持久化最新状态 */
    function handleCloseBuffModal() {
        setShowBuffModal(false)
        onupdate(getCalcState())
    }

    /** @desc 铺开表：切换某条目↔某 Buff 的绑定后持久化 */
    function handleSpreadToggle(entryId: string, buffId: string) {
        toggleBuffSetForEntry(entryId, buffId)
        onupdate(getCalcState())
    }

    /** @desc 铺开表：切换某条目的伤害类型后持久化 */
    function handleSpreadToggleDamageType(entryId: string, damageType: string) {
        toggleDamageTypeForEntry(entryId, damageType)
        onupdate(getCalcState())
    }

    /** @desc 铺开表：批量覆写某条目绑定的 Buff 集合（框选/行列头三态用）后持久化 */
    function handleSpreadSetEntryBuffSetIds(entryId: string, ids: string[]) {
        setBuffSetIdsForEntry(entryId, ids)
        onupdate(getCalcState())
    }
</script>

/** @desc Buff 配置弹窗（挂载于页面顶层，open 由 store 控制） */
<BuffModal open={showBuffModal} {team} onclose={handleCloseBuffModal} />

/** @desc 视图切换：spread → 铺开表（传绑定映射/条件配置/回调用）；否则 → 下拉表（多传 buffDiffMode 差异模式） */
{#if calcViewMode === 'spread'}
    <SpreadTable
        {team}
        {damageEntries}
        {buffSets}
        {entryBuffSetIdMap}
        {entryDamageTypeMap}
        {globalBuffSetIds}
        conditionProfile={getConditionProfile()}
        hideConditionMismatch={getHideConditionMismatch()}
        onToggle={handleSpreadToggle}
        onToggleDamageType={handleSpreadToggleDamageType}
        onSetEntryBuffSetIds={handleSpreadSetEntryBuffSetIds}
    />
{:else}
    <DropdownTable
        {team}
        {damageEntries}
        {buffSets}
        {entryBuffSetIdMap}
        {entryDamageTypeMap}
        {globalBuffSetIds}
        conditionProfile={getConditionProfile()}
        hideConditionMismatch={getHideConditionMismatch()}
        buffDiffMode={getBuffDiffMode()}
        {onupdate}
    />
{/if}
