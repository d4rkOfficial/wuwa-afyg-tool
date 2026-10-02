/**
 * `buff-modal.svelte` 的常量层（**不 import 任何 store**）：
 * 只放组件内部多次引用或需要语义命名的静态清单。
 */

/** @desc 引用值转换口径（线性地 / 离散地）：2 选 1 分段页签，交给 ui/tabs（等宽分段 + 滑动指示块） */
export const REF_MODE_TABS = [
    { value: 'linear', label: '线性地' },
    { value: 'discrete', label: '离散地' }
]

/** @desc 左栏可拖拽调宽范围（与主页 sidebar 拖动条一致的三态样式） */
export const LEFT_WIDTH_MIN = 180
export const LEFT_WIDTH_MAX = 480
export const LEFT_WIDTH_DEFAULT = 256

/** @desc 拖出列表判定的边缘余量（超出容器四周该距离即视为「拖出」，松手删除） */
export const DRAG_OUTSIDE_MARGIN = 30
