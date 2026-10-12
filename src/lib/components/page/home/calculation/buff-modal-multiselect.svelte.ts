/**
 * @desc Buff 弹窗的**多选模式**状态机（勾选集合 / 全选 / 批量删除·并入全局·排序）。
 *
 * 抽因（T2-followup）：这部分原本内联在 `buff-modal.svelte` 的 `<script>` 里约 100 行，
 * 是一套**自成一体**的状态机 —— 只依赖「有哪些 buff、哪些是内置全局块、当前选中项」
 * 与几个 store 写操作，与弹窗的其余部分（拖拽 / 右键菜单 / 引用弹窗）互不重叠。
 * 抽出来后它可独立推理（也不必再读 1200 行的宿主），宿主只保留接线。
 *
 * 生命周期约定（**宿主必须遵守**，否则会出幽灵勾选）：
 * - `ids` 在**退出多选**时必须清空（`toggle()` 已负责）；宿主在关闭弹窗时也应调用 `reset()`；
 * - `active` 由宿主持有（它同时驱动 UI 与其它子系统的互斥清理，见宿主的 `toggle()`）。
 */
import {
    getAllBuffConfs,
    getGlobalBuffSetIds,
    deleteBuffSets,
    setBuffSetsGlobal,
    reorderNonGlobalBuffSets,
    compareNatural
} from '$lib/calc/calculation.store.svelte'
import { sortedSelectionOrder, toggledSet, toggledGroupSet } from './buff-modal.utils'
import { addToast } from '$lib/data/toast.svelte'
import { getConfirmDeletes } from '$lib/data/interaction-prefs.svelte'
import type { BuffConf } from '$lib/calc/calculation.types'
import type { ComponentsProps } from '$lib/types'

/** @desc 内置默认全局块的 id 前缀：既不可删除、也不可移出全局，故多选里一律不可勾选 */
const DEFAULT_GLOBAL_PREFIX = 'global-'

export interface MultiSelectDeps extends ComponentsProps {
    /** @desc 当前是否处于多选模式（宿主持有；本模块只读写通过 getter/setter 传入的引用） */
    isActive: () => boolean
    setActive: (v: boolean) => void
    /** @desc 当前选中的 buff id（批量删除若命中它，需由宿主清空选中） */
    getSelectedId: () => string | null
    setSelectedId: (id: string | null) => void
    /** @desc 批量删除确认弹窗的开关（宿主持有）。「是否需要确认」读用户偏好 `getConfirmDeletes()`，不从这里传 */
    setConfirmDelete: (v: boolean) => void
    /** @desc 退出多选时由宿主一并做的互斥清理（关右键菜单 / 清拖拽状态 / 还原折叠态） */
    onExit?: () => void
}

/**
 * @desc 创建多选模式状态机。
 * 注意 `selectedIds` 是模块内 `$state`：宿主模板直接读它即可获得响应式更新。
 */
export const createMultiSelect = (deps: MultiSelectDeps) => {
    let selectedIds = $state<Set<string>>(new Set())

    /** @desc 内置默认全局块不可勾选（既不能删除也不能移出全局） */
    const isDisabled = (id: string): boolean => id.startsWith(DEFAULT_GLOBAL_PREFIX)

    /** @desc 可勾选的全部 buff id（排除内置全局块） */
    const selectableIds = (): string[] =>
        getAllBuffConfs()
            .map((bs) => bs.id)
            .filter((id) => !isDisabled(id))

    /** @desc 是否已全选（可勾选条目全部选中） */
    const isAllSelected = (): boolean => {
        const selectable = selectableIds()
        return selectable.length > 0 && selectable.every((id) => selectedIds.has(id))
    }

    /** @desc 已选是否**全部非全局**（满足「批量并入全局」的前置条件） */
    const allNonGlobal = (): boolean =>
        selectedIds.size > 0 && [...selectedIds].every((id) => !getGlobalBuffSetIds().includes(id))

    /** @desc 已选是否**全部全局**（满足「批量移出全局」的前置条件） */
    const allGlobal = (): boolean =>
        selectedIds.size > 0 && [...selectedIds].every((id) => getGlobalBuffSetIds().includes(id))

    /** @desc 可参与排序的已选数量（全局块不参与重排，且 <2 时排序无意义） */
    const sortableCount = (): number => [...selectedIds].filter((id) => !getGlobalBuffSetIds().includes(id)).length

    /** @desc 进入/退出多选：两个方向都清空勾选，退出时再由宿主做互斥清理 */
    const toggle = () => {
        const next = !deps.isActive()
        deps.setActive(next)
        selectedIds = new Set()
        deps.onExit?.()
    }

    /** @desc 勾选/取消单个 buff（内置全局块忽略） */
    const toggleId = (id: string) => {
        if (isDisabled(id)) return
        selectedIds = toggledSet(selectedIds, id)
    }

    /** @desc 整组勾选/取消（传入目录的全部成员；内置全局块跳过） */
    const toggleGroup = (members: BuffConf[]) => {
        const childIds = members.map((c) => c.id).filter((id) => !isDisabled(id))
        if (childIds.length === 0) return
        selectedIds = toggledGroupSet(selectedIds, childIds)
    }

    /** @desc 全选 / 清空 */
    const toggleAll = () => {
        selectedIds = isAllSelected() ? new Set() : new Set(selectableIds())
    }

    /** @desc 确认批量删除（宿主确认弹窗的回调） */
    const confirmDelete = () => {
        const ids = [...selectedIds]
        if (ids.length === 0) return
        deleteBuffSets(ids)
        addToast(`已删除 ${ids.length} 条 BUFF`, 'success')
        selectedIds = new Set()
        deps.setConfirmDelete(false)
        if (deps.getSelectedId() && ids.includes(deps.getSelectedId()!)) deps.setSelectedId(null)
    }

    /** @desc 请求批量删除：关了「删除二次确认」偏好就直接删，否则弹确认 */
    const requestDelete = () => {
        if (selectedIds.size === 0) return
        if (getConfirmDeletes()) deps.setConfirmDelete(true)
        else confirmDelete()
    }

    /** @desc 按名称排序「已选中的那些位置」（未选项与其位置保持不变） */
    const sortSelected = () => {
        const sorted = sortedSelectionOrder(getAllBuffConfs(), selectedIds, getGlobalBuffSetIds(), compareNatural)
        if (!sorted) return
        reorderNonGlobalBuffSets(sorted.order)
        addToast(`已按名称排序 ${sorted.count} 个 BUFF`, 'success')
    }

    /** @desc 批量并入 / 移出全局 */
    const setGlobal = (global: boolean) => {
        const ids = [...selectedIds]
        if (ids.length === 0) return
        if (setBuffSetsGlobal(ids, global)) {
            addToast(global ? `已并入全局 ${ids.length} 条 BUFF` : `已移出全局 ${ids.length} 条 BUFF`, 'success')
            selectedIds = new Set()
        }
    }

    return {
        get selectedIds() {
            return selectedIds
        },
        set selectedIds(v: Set<string>) {
            selectedIds = v
        },
        isDisabled,
        isAllSelected,
        allNonGlobal,
        allGlobal,
        sortableCount,
        toggle,
        toggleId,
        toggleGroup,
        toggleAll,
        confirmDelete,
        requestDelete,
        sortSelected,
        setGlobal
    }
}
