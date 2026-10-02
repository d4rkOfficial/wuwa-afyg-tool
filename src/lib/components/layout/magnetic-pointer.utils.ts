// 磁力光标的纯逻辑层：阈值/灵敏度常量、光标 token 解析、磁力目标与拖拽模式查找。
// 刻意不 import 任何 store（开关来自 render-prefs、配色来自 theme，均由组件侧读取），
// 使本文件可以单独推理，也避免「几何/阈值计算」与「DOM 写入 + 样式」挤在同一个文件里。
// 组件里只保留 $state/$derived/$effect 与事件接线，以及 Tailwind 类名常量。

/** 跟手性（ms）：固定跟手 */
export const FOLLOW_MS = 50
/** 灵敏度：磁吸最强（向目标中心 lerp 的系数） */
export const SENSITIVITY = 0.05
/** 旋转速度（s）：最快 */
export const SPIN_S = 4
/** 吸附晃动幅度（px）：最强 */
export const WOBBLE = 10
/** 描边粗细（px）：3px */
export const BORDER_W = 3

// 磁力目标：按钮类 = 有点击事件的元素（a/button/select/role=button/summary + 显式 cursor:pointer 的元素），
// 动态渲染的元素由事件委托覆盖。注意：Svelte 5 的 onclick={} 编译为 addEventListener，
// DOM 上不产生 onclick 属性，因此选择器不含 [onclick]；非标准交互元素用 [data-magnetic] 手动标记。
export const TARGET_SELECTOR = 'a, button, select, [role="button"], summary, [data-magnetic]'
// 磁力光标自身除外（文本编辑类由 text 模式接管，不再整体豁免）。
// 底部工具栏悬浮窗 / AI 悬浮窗整体豁免：它们是拖拽型浮层，hover 时保持默认
// 四角+点（不显示 grab/move 字形），按住拖动时由 dragging 圆环接管。
export const EXCLUDE_SELECTOR = '.magnetic-pointer, .simplified-toolbar, .ai-assistant'
// 拖拽/滑动类光标 → 展示对应光标样式，不框选不磁吸
export const RESIZE_H = new Set(['col-resize', 'ew-resize'])
export const RESIZE_V = new Set(['row-resize', 'ns-resize'])
export const RESIZE_DIAG = new Set(['nesw-resize', 'nwse-resize'])

export type PointerMode =
    'default' | 'pointer' | 'text' | 'grab' | 'move' | 'resize-h' | 'resize-v' | 'resize-diag' | 'crosshair' | 'range'

// 拖动/滑动/文本输入类模式：过渡 0ms，光标实时贴手；按下时精确对准
// （text 不记录偏移，避免 I-beam 脱节）
export const DRAG_MODES: ReadonlySet<PointerMode> = new Set([
    'grab',
    'move',
    'resize-h',
    'resize-v',
    'resize-diag',
    'crosshair',
    'range',
    'text'
])

/** @desc 把元素声明的光标 token 映射为光标模式（default = 不接管） */
export const modeForCursor = (cursor: string): PointerMode => {
    if (cursor === 'text') return 'text'
    if (cursor === 'grab' || cursor === 'grabbing') return 'grab'
    if (cursor === 'move' || cursor === 'all-scroll') return 'move'
    if (cursor === 'crosshair') return 'crosshair'
    if (RESIZE_H.has(cursor)) return 'resize-h'
    if (RESIZE_V.has(cursor)) return 'resize-v'
    if (RESIZE_DIAG.has(cursor)) return 'resize-diag'
    return 'default'
}

/**
 * @desc 解析元素声明的光标 token（如 col-resize / grab / pointer）。
 * 注意：磁力光标开启时 layout.css 会对全 DOM 施加 `cursor: none !important`，
 * getComputedStyle().cursor 恒为 none，无法用于光标语义检测——必须从
 * Tailwind cursor-* 类名或内联 style 解析，才能识别拖拽线/拖拽手柄等元素。
 */
export const cursorToken = (el: Element): string => {
    const cls = typeof el.className === 'string' ? el.className : ''
    const m = cls.match(/(?:^|\s)cursor-([a-z-]+)/)
    if (m) return m[1]
    const styleAttr = el.getAttribute('style') || ''
    const sm = styleAttr.match(/cursor\s*:\s*([a-z-]+)/i)
    return sm ? sm[1].toLowerCase() : ''
}

/**
 * @desc 向上查找磁力目标：
 * - 命中标签/属性选择器 → 框选该元素
 * - cursor:pointer 仅认显式声明（Tailwind cursor-pointer 类或内联样式），排除继承（子元素穿透到父元素时框选父元素）
 * - 命中拖拽/滑动类光标 → 整条路径不磁吸
 * - disabled / aria-disabled / cursor:not-allowed → 不可交互，不磁吸
 */
export const findMagneticTarget = (el: Element | null): HTMLElement | null => {
    let cur: Element | null = el
    while (cur && cur !== document.body) {
        const token = cursorToken(cur)
        if (token === 'not-allowed') return null
        if (modeForCursor(token) !== 'default' && modeForCursor(token) !== 'pointer') return null
        if (cur.matches(TARGET_SELECTOR)) {
            if (cur.matches(':disabled, [aria-disabled="true"]')) return null
            return cur as HTMLElement
        }
        if (token === 'pointer') {
            if (cur.matches(':disabled, [aria-disabled="true"]')) return null
            return cur as HTMLElement
        }
        cur = cur.parentElement
    }
    return null
}

/**
 * @desc 向上查找拖拽/滑动类光标：能点又能拖时优先显示拖的样式。
 * 返回非 default/pointer 的光标模式，找不到返回 null。
 */
export const findDragMode = (el: Element | null): PointerMode | null => {
    let cur: Element | null = el
    while (cur && cur !== document.body) {
        const m = modeForCursor(cursorToken(cur))
        if (m !== 'default' && m !== 'pointer') return m
        cur = cur.parentElement
    }
    return null
}
