<script lang="ts">
    /** @desc 计算页入口组件：连接 store 与页面状态，按 calcViewMode 切换「分类平铺 / 分段平铺」两种拉表视图 */
    import { untrack } from 'svelte'
    import {
        getAllDamageEntries,
        getAllBuffConfs,
        getBuffSetIdsForEntry,
        toggleBuffSetForEntry,
        setBuffSetIdsForEntry,
        setBuffSetIdsForEntries,
        getShowBuffModal,
        setShowBuffModal,
        getCalcState,
        getDamageTypesForEntry,
        init,
        getConditionProfile
    } from '$lib/calc/calculation.store.svelte'
    import type { CharSlot } from '$lib/types/project'
    import type { TimelineData } from '$lib/calc/timeline.types'
    import type { CalcState } from '$lib/calc/calculation.types'
    import BuffModal from './buff-modal.svelte'
    import SpreadTable from './spread-table.svelte'
    import { getCalcViewMode } from '$lib/data/calc-view.svelte'
    import type { ComponentsProps } from '$lib/types'

    interface Props extends ComponentsProps {
        team: [CharSlot, CharSlot, CharSlot]
        timelineData: TimelineData | null
        calcState: CalcState | null
        locked?: boolean
        onupdate: (state: CalcState) => void
    }

    let {
        team,
        timelineData,
        calcState,
        locked = false,
        onupdate,
        class: className,
        style: styleProp
    }: Props = $props()

    /** @desc 依赖变化时（队伍/时间线/外部状态/锁定）重新初始化 store（untrack 避免重复执行 $effect 自依赖） */
    $effect(() => {
        team
        timelineData
        calcState
        locked
        untrack(() => init(team, timelineData, calcState, locked, onupdate))
    })

    /** @desc 从 store 派生：全部伤害条目 / Buff 块列表 / Buff 弹窗开关 */
    let damageEntries = $derived(getAllDamageEntries())
    let buffSets = $derived(getAllBuffConfs())
    let showBuffModal = $derived(getShowBuffModal())
    /** @desc 条目→已选伤害类型 / 条目→已绑定 Buff 的映射（供表格展示） */
    let entryDamageTypeMap = $derived<Record<string, string[]>>(
        Object.fromEntries(damageEntries.map((e) => [e.id, getDamageTypesForEntry(e.id)]))
    )
    let entryBuffSetIdMap = $derived<Record<string, string[]>>(
        Object.fromEntries(damageEntries.map((e) => [e.id, getBuffSetIdsForEntry(e.id)]))
    )

    /** @desc 当前拉表视图：铺开（spread）/ 下拉（dropdown） */
    let calcViewMode = $derived(getCalcViewMode())

    /** @desc 先切进来再加载：进入本页/切换视图后，先让出一帧把页面（页签、容器）画出来，
     *  再挂载重表——否则点击「拉表」的那一帧会被表格首屏渲染占满，感官上像是点了没反应。 */
    let viewReady = $state(false)
    $effect(() => {
        calcViewMode
        viewReady = false
        const raf = requestAnimationFrame(() => {
            viewReady = true
        })
        return () => cancelAnimationFrame(raf)
    })

    /** @desc 关闭 Buff 弹窗并持久化最新状态；先让弹窗真正卸载，再做全量快照，避免快照异常把关闭一起拖住 */
    function handleCloseBuffModal() {
        setShowBuffModal(false)
        queueMicrotask(() => {
            try {
                onupdate(getCalcState())
            } catch (err) {
                console.error('[buff-modal] 关闭时持久化失败', err)
            }
        })
    }

    /** @desc 平铺表：切换某条目↔某 Buff 的绑定（store 写入后自行通知宿主持久化） */
    function handleSpreadToggle(entryId: string, buffId: string) {
        toggleBuffSetForEntry(entryId, buffId)
    }

    /** @desc 平铺表：批量覆写某条目绑定的 Buff 集合（框选/行列头三态用；store 写入后自行通知宿主持久化） */
    function handleSpreadSetEntryBuffSetIds(entryId: string, ids: string[]) {
        setBuffSetIdsForEntry(entryId, ids)
    }

    /** @desc 平铺表：批量覆写多条目的 Buff 绑定（框选批量用，单次通知） */
    function handleSpreadSetEntriesBuffSetIds(entries: Record<string, string[]>) {
        setBuffSetIdsForEntries(entries)
    }
</script>

<div class="flex h-full flex-col {className}" style={styleProp}>
    <!-- @desc Buff 配置弹窗（挂载于页面顶层，open 由 store 控制） -->
    <BuffModal open={showBuffModal} {team} onclose={handleCloseBuffModal} />

    <!-- @desc 视图切换：两张平铺表共用同一个组件，只靠 mode 切换结构（分类平铺 / 分段平铺） -->
    {#if !viewReady}
        <!-- 让出的一帧：页面已可见，重表还在路上（首屏渲染被推迟到下一帧，避免点击后整帧卡住） -->
        <div class="flex flex-1 items-center justify-center text-xs text-(--theme-modal-text)/40">加载中…</div>
    {:else}
        <SpreadTable
            {team}
            {damageEntries}
            {buffSets}
            {entryBuffSetIdMap}
            {entryDamageTypeMap}
            conditionProfile={getConditionProfile()}
            mode={calcViewMode}
            ontoggle={handleSpreadToggle}
            onSetEntryBuffSetIds={handleSpreadSetEntryBuffSetIds}
            onSetEntriesBuffSetIds={handleSpreadSetEntriesBuffSetIds}
        />
    {/if}
</div>
