/**
 * @desc Buff 弹窗列表的**拖拽子系统**（起手 / 移动落点 / 松手结算 / 拖出删除）。
 *
 * 抽因（T2-followup）：这部分原本内联在 `buff-modal.svelte` 里约 156 行，是一套与弹窗其余部分
 * （多选 / 右键菜单 / 引用弹窗）互不重叠的完整交互。抽出后宿主只剩接线。
 *
 * 与宿主的**双向耦合**及处理方式（这是本模块唯一的设计难点）：
 * - `dragState` 要 `bind:` 给 `BuffModalList`（子组件也会改它）→ 本模块经
 *   `getState` / `setState` 读写宿主的 `$state`，宿主仍可把该变量 `bind:` 下去；
 * - 折叠态 `collapsedFolders` 同时被宿主的 `toggleFolder` 与本模块的
 *   「拖动时收起所有目录 / 松手还原」读写 → 同样走 `getCollapsed` / `setCollapsed`
 *   （不用 onCollapse 回调，是为了让 `savedCollapsedState` 的存取留在模块内，避免
 *   把「谁保存/谁还原」的协议摊到宿主）；
 * - `buffTree.folderKeys` 由宿主的派生树提供 → 传 `getFolderKeys` 回调；
 * - 删除确认与「将被删除的成员 id」写在宿主（模板要用）→ 走 `setDeleteFolderIds` / `confirmDeleteFolder`。
 *
 * 刻意**不**碰共享可变状态的所有权：所有跨边界状态都由宿主持有，本模块只做读-改-写。
 */
import { computeDraggedOrder, dragBlockIndex } from '$lib/calc/buff-drag'
import type { BuffDragMode } from '$lib/calc/buff-drag'
import type { BuffListContext } from './buff-modal.types'
import { createDragState } from './buff-modal.utils'
import type { DragState } from './buff-modal.utils'
import { DRAG_OUTSIDE_MARGIN } from './buff-modal.consts'
import {
    deleteBuffSet,
    deleteBuffSets,
    reorderNonGlobalBuffSets,
    getGlobalBuffSetIds,
    getAllBuffConfs
} from '$lib/calc/calculation.store.svelte'
import { getConfirmDeletes } from '$lib/data/interaction-prefs.svelte'

export interface BuffDragDeps {
    getState: () => DragState | null
    setState: (s: DragState | null) => void
    getCollapsed: () => Set<string>
    setCollapsed: (s: Set<string>) => void
    /** @desc 数字目录的分组 key 全集（拖动时除被拖单元所在链外全部收起） */
    getFolderKeys: () => string[]
    /** @desc 将被整目录删除的成员 id（松手时写入；宿主模板用它渲染确认弹窗文案） */
    setDeleteFolderIds: (ids: string[]) => void
    getSelectedId: () => string | null
    setSelectedId: (id: string | null) => void
    /** @desc 删除目录确认弹窗的开关（宿主持有；「是否需要确认」读用户偏好） */
    setConfirmDeleteFolder: (v: boolean) => void
}

/** @desc 列表滚动容器（拖拽的行序列与落点都从它里面读） */
const listContainerOf = (el: EventTarget | null): HTMLElement | null =>
    (el as HTMLElement | null)?.closest('.buff-list-container') ?? null

/**
 * @desc 某个父容器的**直接行**元素（DOM 顺序）。
 * 行用 `data-drag-parent` 标注自己属于哪个容器，落点只在同一容器内计算 ——
 * 目录顺序由名字/条件派生，跨容器搬行没有意义（渲染时会被重新归档）。
 */
const parentRowsOf = (container: HTMLElement, parentKey: string): HTMLElement[] => [
    ...container.querySelectorAll<HTMLElement>(`[data-buffset-id][data-drag-parent="${parentKey}"]`)
]

/** @desc 父容器行 id 序列（DOM 顺序，可能含正在搬运的行 —— 落点计算内部会剔除它们） */
const parentRowIdsOf = (container: HTMLElement, parentKey: string): string[] =>
    parentRowsOf(container, parentKey)
        .map((row) => row.dataset.buffsetId ?? '')
        .filter((id) => id.length > 0)

export const createBuffDrag = (deps: BuffDragDeps) => {
    /** @desc 拖拽开始前的折叠态快照（松手/取消时还原） */
    let savedCollapsedState: Set<string> | null = null

    /** @desc 拖拽落点计算所需的 DOM 查询（注入列表组件，它只负责识别把手并回传事件） */
    const listContext: BuffListContext = {
        listContainerOf,
        parentRowIdsOf,
        dragKeepExpanded: (el, container) => {
            const keys = new Set<string>()
            let node: HTMLElement | null = el
            while (node && node !== container) {
                const key = node.dataset?.folderCollapseKey
                if (key) keys.add(key)
                node = node.parentElement
            }
            return keys
        }
    }

    /** @desc 拖动进入 AI 悬浮窗等"禁区"时取消拖拽（不触发 drop 的删除/重排/确认弹窗） */
    const cancel = () => {
        if (!deps.getState()) return
        deps.setState(null)
        if (savedCollapsedState !== null) {
            deps.setCollapsed(savedCollapsedState)
            savedCollapsedState = null
        }
    }

    /**
     * @desc 开始拖拽（列表组件已确认从 `.drag-handle` 起手）。
     * `id` 是拖拽单元：item=Buff id；folder=数字目录的分组 key。`memberIds` 由目录头按**数据**给出
     * （整组成员），因此目录处于折叠状态时也能整组搬/整组删。
     */
    const start = (e: PointerEvent, id: string, parentKey: string, memberIds?: string[]) => {
        const mode: BuffDragMode = memberIds ? 'folder' : 'item'
        const el = e.currentTarget as HTMLElement
        const container = listContainerOf(el)
        if (!container) return
        const unitIds = mode === 'folder' ? [...(memberIds ?? [])] : [id]
        if (unitIds.length === 0) return
        el.setPointerCapture(e.pointerId)
        savedCollapsedState = new Set(deps.getCollapsed())
        // 拖动时**收起所有目录**：列表变短、落点更清晰；被拖动单元所在目录链保持展开
        const keep = listContext.dragKeepExpanded(el, container)
        deps.setCollapsed(new Set(deps.getFolderKeys().filter((key) => !keep.has(key))))
        const idx = dragBlockIndex(parentRowIdsOf(container, parentKey), unitIds)
        deps.setState(createDragState(id, mode, parentKey, unitIds, idx))
    }

    /** @desc 拖拽移动：超出容器边缘 30px 判定为「拖出」（删除/删目录），否则按同一父容器内行的中心线算落点 */
    const move = (e: PointerEvent) => {
        const state = deps.getState()
        if (!state) return
        const container = listContainerOf(e.currentTarget)
        if (!container) return

        const cr = container.getBoundingClientRect()
        const margin = DRAG_OUTSIDE_MARGIN
        const outside =
            e.clientX < cr.left - margin ||
            e.clientX > cr.right + margin ||
            e.clientY < cr.top - margin ||
            e.clientY > cr.bottom + margin

        if (outside) {
            deps.setState({ ...state, outside: true, dropIdx: -1, dropBeforeId: null, dropAfterId: null })
            return
        }

        const rows = parentRowsOf(container, state.parentKey).filter(
            (row) => !state.unitIds.includes(row.dataset.buffsetId ?? '')
        )
        let dropIdx = rows.length
        let dropBeforeId: string | null = null
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i].getBoundingClientRect()
            if (e.clientY < r.top + r.height / 2) {
                dropIdx = i
                dropBeforeId = rows[i].dataset.buffsetId ?? null
                break
            }
        }
        // 落在最后一行下方（或容器没有可作锚点的行）时，指示条画在最后一个锚点行下方
        const dropAfterId =
            dropBeforeId === null && rows.length > 0 ? (rows[rows.length - 1].dataset.buffsetId ?? null) : null
        deps.setState({ ...state, outside: false, dropIdx, dropBeforeId, dropAfterId })
    }

    /** @desc 确认删除目录（拖出列表松手触发）：删除其全部子 Buff（全局 buff 由 store 跳过）并清空选中 */
    const confirmDeleteFolder = (ids: string[]) => {
        if (ids.length > 0) {
            deleteBuffSets(ids)
            const sel = deps.getSelectedId()
            if (sel && ids.includes(sel)) deps.setSelectedId(null)
        }
        deps.setConfirmDeleteFolder(false)
        deps.setDeleteFolderIds([])
    }

    /** @desc 拖拽结束：拖出→删除（目录弹确认）；拖入→同父重排；原地未动→选中 */
    const end = (e: PointerEvent) => {
        const state = deps.getState()
        if (!state) return

        if (state.outside) {
            if (state.mode === 'folder') {
                // 全局 buff 不可删（deleteBuffSets 会跳过），这里先剔除，避免弹出「删除 0 条」的确认框
                const ids = state.unitIds.filter((id) => !getGlobalBuffSetIds().includes(id))
                deps.setDeleteFolderIds(ids)
                if (ids.length > 0) {
                    if (getConfirmDeletes()) deps.setConfirmDeleteFolder(true)
                    else confirmDeleteFolder(ids)
                }
            } else {
                deleteBuffSet(state.id)
                if (deps.getSelectedId() === state.id) deps.setSelectedId(null)
            }
        } else if (state.mode === 'folder' || state.dropIdx !== state.idx) {
            const container = listContainerOf(e.currentTarget)
            if (container) {
                const next = computeDraggedOrder({
                    // 顺序真源取整份列表（含全局，保证锚点都能找到）；reorderNonGlobalBuffSets 只应用非全局部分
                    orderedIds: getAllBuffConfs().map((bs) => bs.id),
                    parentRowIds: parentRowIdsOf(container, state.parentKey),
                    unitIds: state.unitIds,
                    dropIdx: state.dropIdx
                })
                if (next) reorderNonGlobalBuffSets(next)
            }
        } else {
            deps.setSelectedId(state.id)
        }

        if (savedCollapsedState !== null) {
            deps.setCollapsed(savedCollapsedState)
            savedCollapsedState = null
        }
        deps.setState(null)
    }

    return { listContext, cancel, start, move, end, confirmDeleteFolder }
}
