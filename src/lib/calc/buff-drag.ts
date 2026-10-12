/**
 * @desc Buff 列表拖拽的纯逻辑部分（界面只负责从 DOM 读出「目标父容器的行序列」与落点下标）。
 *
 * 列表是**派生**的：二级目录按链/阶条件算、三级数字目录按名字算，目录顺序也由名字自然序决定，
 * 所以拖拽唯一能改变的是 `BuffConf[]` 的相对顺序；而渲染顺序里只有「同一父容器内的行」受数组顺序影响
 * —— 于是把一次拖拽归一为：「把一个拖拽单元（单个 Buff / 数字目录整组）搬到某个父容器行序列的指定插入位」。
 */

/** @desc 拖拽单元种类：item=单个 Buff 条目；folder=数字前后缀目录（整组成员一起搬） */
export type BuffDragMode = 'item' | 'folder'

/** @desc 一次拖拽的落点描述 */
export interface BuffDragOrderInput {
    /** @desc 顺序真源：当前全部 Buff 的 id（数组顺序即各容器内行的相对顺序） */
    orderedIds: readonly string[]
    /** @desc 目标父容器的直接行 id 序列（DOM 顺序，可含拖拽单元自身的行） */
    parentRowIds: readonly string[]
    /** @desc 被搬运的 id（item=单个 / folder=整组） */
    unitIds: readonly string[]
    /** @desc 目标插入位：在「父容器行序列去掉拖拽单元」后的下标（0..n，n=插到末尾） */
    dropIdx: number
}

/** @desc 拖拽单元在「父容器行序列」中的起始下标（= 不移动时的落点下标）；单元不在该容器里（数字目录整组搬）返回 -1 */
export const dragBlockIndex = (parentRowIds: readonly string[], unitIds: readonly string[]): number => {
    const unit = new Set(unitIds)
    let count = 0
    for (const id of parentRowIds) {
        if (unit.has(id)) return count
        count++
    }
    return -1
}

/**
 * @desc 计算拖拽后的新顺序；以下情况返回 null（等价于「顺序不变」）：
 * - dropIdx 非法（负数 = 没产生有效落点，例如拖出列表或原地松开）
 * - 拖拽单元不在当前数据里（找不到可搬运的 id）
 * - 目标父容器没有任何可作锚点的行
 * - 算出来的顺序与原来完全一致
 */
export const computeDraggedOrder = (input: BuffDragOrderInput): string[] | null => {
    const { orderedIds, parentRowIds, unitIds, dropIdx } = input
    if (!Number.isInteger(dropIdx) || dropIdx < 0) return null
    const unit = new Set(unitIds)
    const moved = orderedIds.filter((id) => unit.has(id))
    if (moved.length === 0) return null
    const rest = orderedIds.filter((id) => !unit.has(id))
    const targets = parentRowIds.filter((id) => !unit.has(id))
    if (targets.length === 0) return null
    // 落点在末尾时插到最后一个锚点行之后
    const before = dropIdx < targets.length ? targets[dropIdx] : null
    const anchor = before ?? targets[targets.length - 1]
    const at = rest.indexOf(anchor)
    if (at < 0) return null
    const insertAt = before === null ? at + 1 : at
    const next = [...rest.slice(0, insertAt), ...moved, ...rest.slice(insertAt)]
    return next.every((id, i) => id === orderedIds[i]) ? null : next
}
